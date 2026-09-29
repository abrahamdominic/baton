/**
 * Display name for a Baton engine state.
 *
 * `STATE_META[x].label` is the canonical English phrase, kept in the engine
 * because logs, worker output, and non-UI consumers need a stable name
 * independent of the request. Rendering it directly is what put English state
 * names in a Spanish dashboard, so every user-facing surface resolves through
 * here instead.
 *
 * The engine stays the source of truth for *which* states exist and how they
 * are toned; this module only translates the name of one it recognises. An
 * unrecognised value (a newer engine than the shipped resources, or a state
 * stored by a rollback) renders as the raw key rather than a generic
 * "Unknown", so a gap is visible in the UI instead of hiding behind a word
 * that looks like real data.
 */

import { STATE_META } from "@/lib/engine/types";
import type { Translator } from "@/lib/i18n/translate";

/** Every key that has a `state:<key>` resource entry. */
const KNOWN_STATES: readonly string[] = Object.keys(STATE_META);

export function stateLabel(state: string, t: Translator): string {
  if (KNOWN_STATES.includes(state)) return t(`state:${state}`);
  return state;
}
