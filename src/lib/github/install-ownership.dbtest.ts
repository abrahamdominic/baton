import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Regression cover for the org-installation ownership flip.
 *
 * A `ghu_` token lists every installation a user administers, which for an
 * Organization account is the *shared* org installation. The old code ran an
 * unconditional `updateMany({ data: { userId } })` over that list, so the last
 * admin to sign in took the stamp and the previous admin silently lost
 * visibility of their own organization's repositories.
 *
 * These run against a real database because the bug is a write-ordering/
 * conditional-update problem that a mocked Prisma cannot demonstrate.
 */

const { prisma } = await import("@/lib/db");
const { claimUnownedInstallations } = await import("@/lib/github/install");
const { myInstallations } = await import("@/lib/queries/dashboard");

const stamp = `ownflip${Date.now().toString(36)}`;
const personalInstall = 9_100_000 + (Date.now() % 800_000);
const orgInstall = 9_900_000 + (Date.now() % 80_000);
const otherPersonalInstall = 9_600_000 + (Date.now() % 80_000);

// Random base per run so a previous failed run's rows (whose cleanup is skipped
// when beforeAll throws) cannot collide on the unique githubId. Kept well under
// the Int ceiling of the SQLite mirror.
let githubIdSeq = 1_000_000_000 + Math.floor(Math.random() * 400_000_000);
function nextGithubId(): number {
  githubIdSeq += 1;
  return githubIdSeq;
}

type TestUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  suspendedAt: Date | null;
};

let adminA: TestUser;
let adminB: TestUser;
let orgId: string;

async function makeUser(login: string) {
  return prisma.user.create({
    data: {
      githubId: nextGithubId(),
      login,
      role: "user",
    },
  });
}

beforeAll(async () => {
  // Purge fixtures abandoned by an earlier failed run.
  await prisma.user.deleteMany({ where: { login: { startsWith: "ownflip" } } });
  adminA = await makeUser(`${stamp}-a`);
  adminB = await makeUser(`${stamp}-b`);

  // A personal-account installation, unowned.
  await prisma.appInstallation.create({
    data: { installationId: personalInstall, accountLogin: `${stamp}-a`, accountType: "User", userId: null },
  });
  // An Organization-account installation, unowned. Shared by every admin.
  await prisma.appInstallation.create({
    data: { installationId: orgInstall, accountLogin: `${stamp}-org`, accountType: "Organization", userId: null },
  });
  // A personal installation already owned by somebody else.
  await prisma.appInstallation.create({
    data: {
      installationId: otherPersonalInstall,
      accountLogin: `${stamp}-stranger`,
      accountType: "User",
      userId: adminB.id,
    },
  });

  const org = await prisma.organization.create({
    data: { slug: `${stamp}-org`, name: "Flip Org", ownerId: adminA.id },
    select: { id: true },
  });
  orgId = org.id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: adminA.id, role: "owner" } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: adminB.id, role: "admin" } });
  // The org installation is linked to the Baton organization, as an admin would
  // do. The join key is AppInstallation.id (the cuid), not the GitHub number.
  const orgRow = await prisma.appInstallation.findUniqueOrThrow({
    where: { installationId: orgInstall },
    select: { id: true },
  });
  await prisma.organizationInstallation.create({
    data: { organizationId: orgId, installationId: orgRow.id, addedById: adminA.id },
  });
});

afterAll(async () => {
  await prisma.organizationInstallation.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.appInstallation.deleteMany({
    where: { installationId: { in: [personalInstall, orgInstall, otherPersonalInstall] } },
  });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("installation ownership (real database)", () => {
  it("claims an unowned personal installation", async () => {
    const claimed = await claimUnownedInstallations([personalInstall], adminA.id);
    expect(claimed).toContain(personalInstall);
    const row = await prisma.appInstallation.findUniqueOrThrow({
      where: { installationId: personalInstall },
    });
    expect(row.userId).toBe(adminA.id);
  });

  it("never displaces an existing owner", async () => {
    const claimed = await claimUnownedInstallations([otherPersonalInstall], adminA.id);
    expect(claimed).not.toContain(otherPersonalInstall);
    const row = await prisma.appInstallation.findUniqueOrThrow({
      where: { installationId: otherPersonalInstall },
    });
    expect(row.userId).toBe(adminB.id);
  });

  it("never personally owns an Organization installation", async () => {
    const claimed = await claimUnownedInstallations([orgInstall], adminA.id);
    expect(claimed).not.toContain(orgInstall);
    const row = await prisma.appInstallation.findUniqueOrThrow({
      where: { installationId: orgInstall },
    });
    expect(row.userId).toBeNull();
  });

  it("ownership does not flip when a second admin of the same org signs in", async () => {
    // Both admins of the org sign in, in sequence, as the real flow does.
    await claimUnownedInstallations([orgInstall], adminA.id);
    await claimUnownedInstallations([orgInstall], adminB.id);

    const row = await prisma.appInstallation.findUniqueOrThrow({
      where: { installationId: orgInstall },
    });
    // Neither admin owns the org install, so it cannot flip between them.
    expect(row.userId).toBeNull();

    // Both admins still see the org's repositories.
    const seenByA = await myInstallations(adminA);
    const seenByB = await myInstallations(adminB);
    expect(seenByA.map((i) => i.installationId)).toContain(orgInstall);
    expect(seenByB.map((i) => i.installationId)).toContain(orgInstall);
  });

  it("a non-member of the organization cannot see its installation", async () => {
    const outsider = await makeUser(`${stamp}-outsider`);
    try {
      const seen = await myInstallations(outsider);
      expect(seen.map((i) => i.installationId)).not.toContain(orgInstall);
    } finally {
      await prisma.user.delete({ where: { id: outsider.id } });
    }
  });

  it("ignores invalid installation ids", async () => {
    const claimed = await claimUnownedInstallations([0, -1, Number.NaN, 1.5], adminA.id);
    expect(claimed).toEqual([]);
  });
});
