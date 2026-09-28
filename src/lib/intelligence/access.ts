import { getEntitlement, hasFeature } from "../billing/entitlement";
import { FEATURE_KEYS, type Entitlement, type FeatureKey } from "../billing/types";

/**
 * Plan gating for repository intelligence.
 *
 * The intelligence surface is a paid capability, so the gate lives on the server
 * next to the work it protects — a page that merely *hides* the link still lets
 * anyone who knows the URL render the whole thing, and server actions can be
 * invoked directly from the browser without going through the UI at all.
 *
 * Every caller gets the entitlement back as well as the verdict, so a page can
 * render a specific "this needs a Team plan" panel naming the feature instead of
 * a generic upgrade nag.
 */

export type IntelligenceFeature = Extract<
  FeatureKey,
  | typeof FEATURE_KEYS.repoIntelligence
  | typeof FEATURE_KEYS.briefings
  | typeof FEATURE_KEYS.workContext
  | typeof FEATURE_KEYS.changeImpact
>;

export interface IntelligenceAccess {
  allowed: boolean;
  entitlement: Entitlement;
  feature: IntelligenceFeature;
  /** Copy for the upgrade panel: which capability, and what unlocks it. */
  label: string;
}

const FEATURE_LABELS: Record<IntelligenceFeature, string> = {
  [FEATURE_KEYS.repoIntelligence]: "Repository intelligence and grounded Q&A",
  [FEATURE_KEYS.briefings]: "Developer, review and change-impact briefings",
  [FEATURE_KEYS.workContext]: "Saved work context",
  [FEATURE_KEYS.changeImpact]: "Change-impact analysis and CI investigation",
};

/** Resolve whether `userId` is entitled to an intelligence capability. */
export async function intelligenceAccess(
  userId: string,
  feature: IntelligenceFeature,
): Promise<IntelligenceAccess> {
  const entitlement = await getEntitlement(userId);
  return {
    allowed: hasFeature(entitlement, feature),
    entitlement,
    feature,
    label: FEATURE_LABELS[feature],
  };
}

/** Where the upgrade prompt sends the user. */
export const UPGRADE_HREF = "/dashboard/billing";
