"use client";

import { useState, useTransition } from "react";
import { askAboutRepository } from "./actions";
import { IconSearch, IconAlertCircle, IconExternalLink } from "@/components/icons";
import { useTranslation } from "@/lib/i18n/provider";

/**
 * Grounded question form.
 *
 * The copy is deliberately precise about what this is: it retrieves from
 * Baton's collected evidence and cites it. It is not presented as an AI
 * assistant, because there is no model in the path and calling it one would be
 * a claim the product cannot support.
 *
 * When the answer contains no citable claim, the UI says so rather than
 * rendering an empty box that looks like a bug.
 */

interface Claim {
  text: string;
  evidence: { id: string; label: string; url: string | null }[];
}

export function IntelligenceQuestionForm({ owner, repo }: { owner: string; repo: string }) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answered: boolean; claims: Claim[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const suggestions = [
    "Who reviews changes here?",
    "How does CI work?",
    "What language is this written in?",
    "Is this project actively maintained?",
    "What is the latest release?",
  ];

  function submit(text: string) {
    const q = text.trim();
    if (q.length < 3 || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await askAboutRepository({ owner, repo, question: q });
      if (!res.ok) {
        setError(res.error);
        setAnswer(null);
        return;
      }
      setAnswer(res.data);
      setQuestion(q);
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
      <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
        <h2 className="text-sm font-semibold text-white">{t("intelligence:ask_title")}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{t("intelligence:ask_subtitle")}</p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="repo-question" className="sr-only">
            Ask about this repository
          </label>
          <input
            id="repo-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            placeholder={t("intelligence:ask_placeholder")}
            className="flex-1 rounded-lg border border-white/[0.08] bg-ink-950/60 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-400 focus:outline-none"
          />
          <button type="submit" disabled={pending || question.trim().length < 3} className="btn btn-ghost btn-sm">
            <IconSearch className="h-3.5 w-3.5" />
            <span>{pending ? t("intelligence:ask_searching") : t("intelligence:ask_search")}</span>
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              disabled={pending}
              className="rounded-md border border-white/[0.08] bg-ink-950/40 px-2 py-1 text-[11px] text-ink-400 transition-colors hover:border-brand-400/40 hover:text-ink-200 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {error ? (
          <p className="flex items-start gap-2 text-sm text-danger-300">
            <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {answer ? (
          answer.answered ? (
            <ul className="space-y-2.5">
              {answer.claims.map((c, i) => (
                <li key={i} className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3.5 py-2.5">
                  <p className="text-sm text-ink-100">{c.text}</p>
                  {c.evidence.length > 0 ? (
                    <div className="mt-2">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                        Evidence
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {c.evidence.map((e) =>
                          e.url ? (
                            <a
                              key={e.id}
                              href={e.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-brand-300 transition-colors hover:border-brand-400/40 hover:text-brand-200"
                              title={e.label}
                            >
                              <span className="truncate">{e.label}</span>
                              <IconExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          ) : (
                            <span
                              key={e.id}
                              className="inline-flex max-w-full items-center rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-ink-400"
                              title={e.label}
                            >
                              <span className="truncate">{e.label}</span>
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3.5 py-3">
              <p className="text-sm text-ink-300">
                Nothing in this repository&rsquo;s collected evidence answers that question.
              </p>
              <p className="mt-1 text-xs text-ink-500">
                No claims are shown because none could be cited. This is the intended behaviour
                &mdash; an uncited answer would be a guess.
              </p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
