/**
 * Enqueue synthetic jobs and report queue state. Used to prove that a real
 * executor drains real work (see ENVIRONMENT.md, "Verifying the worker").
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.cli.json scripts/queue-probe.ts enqueue [count]
 *   npx tsx --tsconfig tsconfig.cli.json scripts/queue-probe.ts status
 */
import { prisma } from "../src/lib/db";
import { queueSnapshot } from "../src/lib/engine/queue-metrics";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";

  if (cmd === "enqueue") {
    const n = Number(process.argv[3] ?? 1);
    const jobs = Array.from({ length: n }, (_, i) => ({
      kind: "pr_refresh",
      payloadJson: JSON.stringify({
        kind: "pr_refresh",
        installationId: 4242,
        owner: "acme",
        repo: "payments-api",
        number: 1000 + i,
      }),
      maxAttempts: 3,
    }));
    await prisma.job.createMany({ data: jobs });
    const snap = await queueSnapshot();
    console.log(`enqueued=${jobs.length} pending=${snap.pending} runnable=${snap.runnable}`);
    return;
  }

  const snap = await queueSnapshot();
  const recent = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { kind: true, status: true, attempts: true, error: true },
  });
  console.log("queue=" + JSON.stringify(snap));
  console.log("recent=" + JSON.stringify(recent));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
