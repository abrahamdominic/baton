/**
 * Stand-in for the `server-only` package when running under plain Node (the
 * `worker` and `cron` CLI entrypoints).
 *
 * `server-only` deliberately throws on import outside a bundler that honours
 * its `react-server` export condition. Next.js resolves it to an empty module
 * during the build, but `tsx` does not, so `import "server-only"` crashed both
 * CLI entrypoints at startup — `npm run cron` exited 1 before doing any work.
 *
 * `tsconfig.cli.json` maps `server-only` here, so the CLI runs while the Next
 * build keeps the real guard, which is what stops server code (and the secrets
 * it reaches) from being pulled into a client bundle.
 *
 * This file must stay side-effect free and dependency free.
 */
export {};
