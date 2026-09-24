"use client";

import { useActionState } from "react";
import type { PlanRecord } from "@/lib/billing/types";
import { savePlanAction, syncStripePricingAction } from "./actions";

function field(label: string, name: string, defaultValue: string, hint?: string) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="input w-full font-mono text-xs"
      />
      {hint ? <span className="mt-1 block text-[10px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function PlanForm({ plan }: { plan?: PlanRecord | null }) {
  const [state, action] = useActionState(savePlanAction, { ok: false } as {
    ok: boolean;
    error?: string;
  });
  const [stripeState, stripeAction, stripePending] = useActionState(syncStripePricingAction, { ok: false } as {
    ok: boolean;
    error?: string;
  });

  const featuresText = Array.isArray(plan?.features)
    ? (plan.features as unknown[]).filter((f): f is string => typeof f === "string").join("\n")
    : "";

  const limitsText =
    plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits)
      ? JSON.stringify(plan.limits, null, 2)
      : "";

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={plan?.id ?? ""} />

      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          General Details
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("Slug (URL Key)", "slug", plan?.slug ?? "", "e.g. team, individual, enterprise")}
          {field("Display Name", "name", plan?.name ?? "", "Customer-facing tier name")}
        </div>

        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Description
          </span>
          <textarea
            name="description"
            defaultValue={plan?.description ?? ""}
            rows={2}
            className="input w-full text-xs"
            placeholder="Brief summary of who this plan is designed for"
          />
        </label>
      </div>

      {/* Pricing in Cents */}
      <div className="space-y-4 border-t border-white/[0.06] pt-5">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          Pricing (Integer Cents)
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field(
            "Monthly Price (Cents)",
            "monthlyPriceCents",
            String(plan?.monthly_price_cents ?? 0),
            "1500 = $15.00 / month",
          )}
          {field(
            "Annual Price (Cents)",
            "annualPriceCents",
            String(plan?.annual_price_cents ?? 0),
            "15000 = $150.00 / year (two months free)",
          )}
          {field("Sort Order", "sortOrder", String(plan?.sort_order ?? 0), "Lower appears first")}
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1">
          {(["priceCustom", "isActive", "isPublic"] as const).map((key) => {
            const checked =
              key === "priceCustom"
                ? Boolean(plan?.price_custom)
                : key === "isActive"
                ? (plan?.is_active ?? true)
                : (plan?.is_public ?? true);
            const labelText =
              key === "priceCustom"
                ? "Custom pricing (contact sales)"
                : key === "isActive"
                ? "Active (sold)"
                : "Public (visible in pricing page)";
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 text-xs text-ink-200"
              >
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={checked}
                  className="h-4 w-4 accent-brand-500"
                />
                <span>{labelText}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Stripe Metadata */}
      <div className="space-y-4 border-t border-white/[0.06] pt-5">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          Stripe Product Linkage (Optional)
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field(
            "Stripe Product ID",
            "stripeProductId",
            plan?.stripe_product_id ?? "",
            "prod_...",
          )}
          {field(
            "Stripe Monthly Price ID",
            "stripeMonthlyPriceId",
            plan?.stripe_monthly_price_id ?? "",
            "price_...",
          )}
          {field(
            "Stripe Annual Price ID",
            "stripeAnnualPriceId",
            plan?.stripe_annual_price_id ?? "",
            "price_...",
          )}
        </div>

        {plan ? (
          <form
            action={stripeAction}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-ink-950/40 px-4 py-3"
          >
            <input type="hidden" name="id" value={plan.id} />
            <div className="min-w-0 flex-1 text-xs text-ink-300">
              <p className="font-semibold text-ink-200">Stripe price sync</p>
              <p className="mt-0.5 text-[10px] text-ink-500">
                Creates (or updates) the Stripe product and monthly/annual prices to match the
                amounts above, then stores the returned IDs on this plan. Stripe uses the saved
                plan amount as the source of truth; re-run after changing prices.
              </p>
            </div>
            <button type="submit" className="btn btn-ghost btn-sm">
              {stripePending ? "Syncing…" : "Sync Stripe Prices"}
            </button>
            {stripeState?.error ? (
              <p className="w-full text-xs font-medium text-danger-300">{stripeState.error}</p>
            ) : null}
            {stripeState?.ok ? (
              <p className="w-full text-xs font-medium text-signal-300">Stripe prices synced successfully.</p>
            ) : null}
          </form>
        ) : null}
      </div>

      {/* Features & Limits */}
      <div className="space-y-4 border-t border-white/[0.06] pt-5">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          Features &amp; Resource Limits
        </h3>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Features (One per line)
          </span>
          <textarea
            name="features"
            defaultValue={featuresText}
            rows={5}
            className="input w-full font-mono text-xs"
            placeholder="Unlimited tracked repositories&#10;Custom nudge thresholds&#10;Repo board views"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Limits (JSON Object)
          </span>
          <textarea
            name="limits"
            defaultValue={limitsText}
            rows={4}
            spellCheck={false}
            className="input w-full font-mono text-xs"
            placeholder={'{ "repos": 3, "seats": 1 }'}
          />
          <span className="mt-1 block text-[10px] text-ink-500">
            Configurable limits JSONB stored with plan. Leave blank if unlimited.
          </span>
        </label>
      </div>

      {/* Feedback Messages */}
      {state?.error ? (
        <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-xs font-medium text-danger-300">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg border border-signal-500/30 bg-signal-500/10 px-4 py-3 text-xs font-medium text-signal-300">
          Plan configuration saved successfully.
        </p>
      ) : null}

      {/* Form Action Buttons */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
        <button type="submit" className="btn btn-primary btn-sm">
          {plan ? "Save Changes" : "Create Plan"}
        </button>
        <a href="/admin/plans" className="btn btn-ghost btn-sm">
          Cancel
        </a>
      </div>
    </form>
  );
}
