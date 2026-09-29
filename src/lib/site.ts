export const SITE_NAME = "Baton";
export const SITE_TITLE = "Know whose turn it is on every pull request";
export const SITE_DESCRIPTION =
  "Baton is a GitHub App that tracks the state of every open pull request, shows whose turn it is inside the PR, and nudges the right person when work stalls.";

/**
 * Canonical public links, in one place so the marketing site, pricing page, docs
 * and FAQ cannot drift apart or point at a repository that no longer exists.
 */
export const GITHUB_REPO = "abrahamdominic/baton";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_CLONE_URL = `https://github.com/${GITHUB_REPO}.git`;
/**
 * Issues, not Discussions. GitHub Discussions is not enabled on the repository,
 * so a `/discussions` link 404s for every visitor who clicks it. Issues is the
 * public channel that actually works.
 */
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;