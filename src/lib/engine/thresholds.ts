/**
 * Per-repo nudge thresholds vs Organization-wide policy.
 *
 * A `RepoSetting` row exists for every repo and carries the built-in defaults
 * until the owner customizes it (`updateRepoSettings`). `OrganizationPolicy`
 * holds org-wide defaults that only apply to repos belonging to a paid
 * Organization. Resolution rule (all pure, engine-side):
 *   1. A repo the owner explicitly customized keeps its own values.
 *   2. Otherwise a policy present on the covering Organization applies.
 *   3. Otherwise the built-in defaults apply.
 */
import type { OrganizationPolicy, RepoSetting } from "@prisma/client";

export const REPO_SETTING_DEFAULTS: Record<
  | "firstResponseHours"
  | "reviewFollowUpHours"
  | "changesRequiredHours"
  | "ciFailHours"
  | "conflictHours"
  | "readyToMergeHours"
  | "maxNudgesPerState",
  number
> = {
  firstResponseHours: 24,
  reviewFollowUpHours: 36,
  changesRequiredHours: 72,
  ciFailHours: 24,
  conflictHours: 12,
  readyToMergeHours: 48,
  maxNudgesPerState: 1,
};

export type OrgPolicyThresholds = Pick<
  OrganizationPolicy,
  | "firstResponseHours"
  | "reviewFollowUpHours"
  | "changesRequiredHours"
  | "ciFailHours"
  | "conflictHours"
  | "readyToMergeHours"
  | "maxNudgesPerState"
>;

/** True when a repo's value for `field` is still the built-in default. */
export function isRepoDefault<F extends keyof typeof REPO_SETTING_DEFAULTS>(
  setting: RepoSetting,
  field: F,
): boolean {
  return setting[field] === REPO_SETTING_DEFAULTS[field];
}

/**
 * Return a copy of `setting` with Organization policy values substituted for
 * any threshold the repo has not customized individually. Assignment of a
 * policy carries its own defaults, so an un-configured policy is a no-op.
 */
export function applyOrgPolicyToSetting(
  setting: RepoSetting,
  policy: OrgPolicyThresholds | null,
): RepoSetting {
  if (!policy) return setting;
  const effective: RepoSetting = { ...setting };
  for (const field of Object.keys(REPO_SETTING_DEFAULTS) as (keyof typeof REPO_SETTING_DEFAULTS)[]) {
    if (isRepoDefault(setting, field)) {
      effective[field] = policy[field];
    }
  }
  return effective;
}