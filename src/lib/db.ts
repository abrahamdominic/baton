import { PrismaClient } from "@prisma/client";
import { slowQueryExtension } from "./db-slow-queries";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

// Timing is applied once per process, and the extended client is stored on
// `globalThis` in development for the same reason the raw client is: Next.js
// re-evaluates modules on every hot reload, and a second `PrismaClient` would
// open a second connection pool against Postgres.
export const prisma = (base as unknown as { $extends: (e: ReturnType<typeof slowQueryExtension>) => PrismaClient }).$extends(
  slowQueryExtension(),
);

if (process.env.NODE_ENV !== "production" && !globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
