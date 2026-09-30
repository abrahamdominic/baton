"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/workspaces";
import { askQuestion } from "@/lib/intelligence/answer";
import { authorizedRepo, evidenceByIds } from "@/lib/queries/intelligence";
import { confirmWorkSignalAsContext } from "@/lib/intelligence/work-detection";
import { intelligenceAccess, UPGRADE_HREF } from "@/lib/intelligence/access";
import { recordDecision, forgetDecision } from "@/lib/intelligence/knowledge";
import { prisma } from "@/lib/db";
import { FEATURE_KEYS } from "@/lib/billing/types";

/**
 * Server actions for repository intelligence.
 *
 * Every action resolves the repository through `authorizedRepo`, which defers to
 * the same `myInstallations` rule the dashboard uses. Authorisation is therefore
 * checked here rather than trusted from the form, because a hidden field in a
 * server action payload is just a number the client chose.
 *
 * Plan gating is enforced in the same place, for the same reason: an action that
 * is only "hidden" behind a paywall in the UI is still callable.
 */

export type IntelligenceActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; upgrade?: string };

/** Consistent refusal for a gated capability, naming what would unlock it. */
async function denied(
  userId: string,
  feature: Parameters<typeof intelligenceAccess>[1],
): Promise<{ ok: false; error: string; upgrade: string }> {
  const access = await intelligenceAccess(userId, feature);
  return {
    ok: false,
    error: `${access.label} is part of a paid plan.`,
    upgrade: UPGRADE_HREF,
  };
}

const MAX_QUESTION_LENGTH = 300;

const confirmWorkSignalInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  signalId: z.string().min(1).max(120),
});

const askInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  question: z.string().trim().min(3).max(MAX_QUESTION_LENGTH),
});

/**
 * Answer a question from collected evidence.
 *
 * The question is stored so a developer can see what they asked, but the answer
 * is always recomputed from the current profile rather than replayed, so a stale
 * answer is impossible even though old questions are retained.
 */
export async function askAboutRepository(input: z.input<typeof askInput>): Promise<
  IntelligenceActionResult<{
    answered: boolean;
    claims: {
      text: string;
      evidence: { id: string; label: string; url: string | null }[];
    }[];
  }>
> {
  const user = await requireActiveUser();
  const parsed = askInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a question of at least 3 characters." };
  const { owner, repo, question } = parsed.data;

  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return { ok: false, error: "Repository not found." };

  if (!(await intelligenceAccess(user.id, FEATURE_KEYS.repoIntelligence)).allowed) {
    return await denied(user.id, FEATURE_KEYS.repoIntelligence);
  }

  const answer = await askQuestion(user.id, repoRow.id, question);

  // Resolve the cited evidence to something linkable. Returning bare ids left
  // the UI able to say "3 sources cited" and nothing more, which asks a
  // developer to trust the claim instead of check it -- the opposite of what a
  // citation is for.
  const evidence = await evidenceByIds(answer.claims.flatMap((c) => c.evidenceIds));

  revalidatePath(`/dashboard/repos/${owner}/${repo}/intelligence`);
  return {
    ok: true,
    data: {
      answered: answer.answered,
      claims: answer.claims.map((c) => ({
        text: c.text,
        evidence: c.evidenceIds
          .map((id) => evidence.get(id))
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
          .map((e) => ({ id: e.id, label: e.label, url: e.url })),
      })),
    },
  };
}

/**
 * Confirm a detected work signal (aa.md §17).
 *
 * Work detection never creates anything on its own. This is the confirmation
 * step, and it re-derives the signal server-side from the database so the
 * client cannot supply its own label, URL or payload.
 */
export async function confirmWorkSignalAction(
  input: z.input<typeof confirmWorkSignalInput>,
): Promise<IntelligenceActionResult<{ contextId: string }>> {
  const user = await requireActiveUser();
  const parsed = confirmWorkSignalInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That work signal could not be confirmed." };
  const { owner, repo, signalId } = parsed.data;

  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return { ok: false, error: "Repository not found." };

  if (!(await intelligenceAccess(user.id, FEATURE_KEYS.workContext)).allowed) {
    return await denied(user.id, FEATURE_KEYS.workContext);
  }

  const result = await confirmWorkSignalAsContext(user, repoRow.id, signalId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/repos/${owner}/${repo}/intelligence`);
  return { ok: true, data: { contextId: result.contextId } };
}

/**
 * Record a decision in repository memory (skill.md §15).
 *
 * This is the one place Baton accepts prose it did not observe, which is why the
 * write is explicit and marked `source = "recorded"`, so the automatic
 * derivation can never overwrite it or retire it. Decisions are shared
 * repository knowledge rather than private notes: anyone with access to this
 * repository's intelligence can read or withdraw one, which is why the delete
 * path is restricted to recorded claims and re-checks the same authorization.
 */
const decisionInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  title: z.string().trim().min(4).max(160),
  detail: z.string().trim().min(10).max(2_000),
});

export async function recordDecisionAction(
  input: z.input<typeof decisionInput>,
): Promise<IntelligenceActionResult<{ knowledgeId: string }>> {
  const user = await requireActiveUser();
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "A decision needs a short title and at least a sentence explaining it.",
    };
  }
  const { owner, repo, title, detail } = parsed.data;

  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return { ok: false, error: "Repository not found." };

  if (!(await intelligenceAccess(user.id, FEATURE_KEYS.repoIntelligence)).allowed) {
    return await denied(user.id, FEATURE_KEYS.repoIntelligence);
  }

  // A memory row hangs off the insight, so an un-indexed repository cannot
  // accept a decision: there would be nothing to hang it from and nothing to
  // reconcile it against.
  const insight = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRow.id },
    select: { id: true },
  });
  if (!insight) {
    return { ok: false, error: "This repository has not been indexed yet. Sync it first." };
  }

  const fact = await recordDecision({
    userId: user.id,
    repoId: repoRow.id,
    insightId: insight.id,
    title,
    detail,
  });

  revalidatePath(`/dashboard/repos/${owner}/${repo}/intelligence`);
  return { ok: true, data: { knowledgeId: fact.id } };
}

/** Remove a recorded decision. Derived knowledge is not deletable this way. */
const forgetDecisionInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  knowledgeId: z.string().min(1).max(64),
});

export async function forgetDecisionAction(
  input: z.input<typeof forgetDecisionInput>,
): Promise<IntelligenceActionResult<{ removed: true }>> {
  const user = await requireActiveUser();
  const parsed = forgetDecisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That decision could not be removed." };
  const { owner, repo, knowledgeId } = parsed.data;

  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return { ok: false, error: "Repository not found." };

  if (!(await intelligenceAccess(user.id, FEATURE_KEYS.repoIntelligence)).allowed) {
    return await denied(user.id, FEATURE_KEYS.repoIntelligence);
  }

  const removed = await forgetDecision(user.id, repoRow.id, knowledgeId);
  if (!removed) {
    return { ok: false, error: "Only decisions recorded by a person can be removed." };
  }

  revalidatePath(`/dashboard/repos/${owner}/${repo}/intelligence`);
  return { ok: true, data: { removed: true } };
}
