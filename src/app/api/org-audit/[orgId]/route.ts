import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { organizationAuditLog, requireOrganizationMember } from "@/lib/workspaces";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Org-scoped audit export (CSV or JSON). Authorized only for organization
 * admins/owner on a paid plan that includes the audit_export feature (admins
 * bypass). Response is a download with a Content-Disposition attachment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }
  if (user.suspendedAt) {
    return NextResponse.json({ error: "account suspended" }, { status: 403 });
  }

  const { orgId } = await params;
  const { role } = await requireOrganizationMember(orgId, user.id).catch(() => ({
    role: "" as string,
  }));
  if (!role) {
    return NextResponse.json({ error: "not a member" }, { status: 403 });
  }

  const entitlement = await getEntitlement(user.id, { organizationId: orgId });
  const allowed =
    user.role === "admin" ||
    ((role === "owner" || role === "admin") && hasFeature(entitlement, FEATURE_KEYS.auditExport));
  if (!allowed) {
    return NextResponse.json(
      { error: "audit export requires the Organization plan" },
      { status: 403 },
    );
  }

  const rows = await organizationAuditLog(orgId, 10_000);
  const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";

  logger.info("org-audit-exported", { orgId, actor: user.login, format, rows: rows.length });

  const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" };

  if (format === "json") {
    const payload = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actor: r.actor,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detailJson ? safeJson(r.detailJson) : null,
      ip: r.ip,
      userAgent: r.userAgent,
    }));
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="baton-org-${orgId}-audit.json"`,
        ...noStoreHeaders,
      },
    });
  }

  const csvHeaders = ["id", "created_at", "actor", "action", "target_type", "target_id", "detail", "ip", "user_agent"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const lines = [
    csvHeaders.join(","),
    ...rows.map((r) =>
      [
        esc(r.id),
        esc(r.createdAt.toISOString()),
        esc(r.actor),
        esc(r.action),
        esc(r.targetType),
        esc(r.targetId),
        esc(r.detailJson),
        esc(r.ip),
        esc(r.userAgent),
      ].join(","),
    ),
  ];

  const body = lines.join("\n");
  const bytes = Buffer.byteLength(body, "utf-8");
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Length": String(bytes),
    "Content-Disposition": `attachment; filename="baton-org-${orgId}-audit.csv"`,
    ...noStoreHeaders,
  };
  return new NextResponse(body, { status: 200, headers });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}