"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { rememberContext, forgetContext } from "@/lib/intelligence/context";
import { authorizedRepo } from "@/lib/queries/intelligence";
import { intelligenceAccess } from "@/lib/intelligence/access";
import { FEATURE_KEYS } from "@/lib/billing/types";

/**
 * Toggle "save this pull request as my active work context".
 *
 * The repository is resolved server-side from `owner`/`repo` through
 * `authorizedRepo`. An earlier revision took `repoId` straight off the form and
 * forwarded it: `rememberContext` re-checks visibility so no cross-tenant write
 * was possible, but a client-supplied identifier that the server then validates
 * is an accident waiting to happen, and there is no reason to accept it.
 */

const toggleInput = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  prNumber: z.number().int().positive(),
  title: z.string().min(1).max(500),
  existingContextId: z.string().max(100).optional(),
});

export async function toggleSaveContextAction(
  input: z.input<typeof toggleInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = toggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { owner, repo, prNumber, title, existingContextId } = parsed.data;

  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return { ok: false, error: "Repository not found." };

  if (!(await intelligenceAccess(user.id, FEATURE_KEYS.workContext)).allowed) {
    return { ok: false, error: "Saved work context is part of a paid plan." };
  }

  const targetUrl = `/dashboard/repos/${owner}/${repo}/pulls/${prNumber}`;

  if (existingContextId) {
    // `forgetContext` scopes the delete to the caller's own rows, so a forged
    // id from another account removes nothing.
    await forgetContext(user.id, existingContextId);
  } else {
    const id = await rememberContext({
      userId: user.id,
      repoId: repoRow.id,
      kind: "pr",
      label: `PR #${prNumber}: ${title.slice(0, 50)}`,
      targetUrl,
      payload: { owner, repo, prNumber },
    });
    if (!id) return { ok: false, error: "That context could not be saved." };
  }

  revalidatePath(`/dashboard/repos/${owner}/${repo}/pulls/${prNumber}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
