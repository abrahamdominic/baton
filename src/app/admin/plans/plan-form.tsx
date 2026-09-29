"use client";

import { useActionState } from "react";
import type { PlanRecord } from "@/lib/billing/types";
import { savePlanAction, syncStripePricingAction } from "./actions";
import { useTranslation } from "@/lib/i18n/provider";

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

  const { t } = useTranslation();
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
          {t("admin:plan_section_general")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(t("admin:plan_slug"), "slug", plan?.slug ?? "", t("admin:plan_slug_hint"))}
          {field(t("admin:plan_name"), "name", plan?.name ?? "", t("admin:plan_name_hint"))}
        </div>

        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {t("admin:plan_description")}
          </span>
          <textarea
            name="description"
            defaultValue={plan?.description ?? ""}
            rows={2}
            className="input w-full text-xs"
            placeholder={t("admin:plan_description_placeholder")}
          />
        </label>
      </div>

      {/* Pricing in Cents */}
      <div className="space-y-4 border-t border-white/[0.06] pt-5">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          {t("admin:plan_section_pricing")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field(
            t("admin:plan_price_monthly"),
            "monthlyPriceCents",
            String(plan?.monthly_price_cents ?? 0),
            t("admin:plan_price_monthly_hint"),
          )}
          {field(
            t("admin:plan_price_annual"),
            "annualPriceCents",
            String(plan?.annual_price_cents ?? 0),
            t("admin:plan_price_annual_hint"),
          )}
          {field(
            t("admin:plan_sort_order"),
            "sortOrder",
            String(plan?.sort_order ?? 0),
            t("admin:plan_sort_order_hint"),
          )}
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
                ? t("admin:plan_flag_price_custom")
                : key === "isActive"
                  ? t("admin:plan_flag_is_active")
                  : t("admin:plan_flag_is_public");
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
          {t("admin:plan_section_stripe")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field(
            t("admin:plan_stripe_product"),
            "stripeProductId",
            plan?.stripe_product_id ?? "",
            "prod_...",
          )}
          {field(
            t("admin:plan_stripe_monthly"),
            "stripeMonthlyPriceId",
            plan?.stripe_monthly_price_id ?? "",
            "price_...",
          )}
          {field(
            t("admin:plan_stripe_annual"),
            "stripeAnnualPriceId",
            plan?.stripe_annual_price_id ?? "",
            "price_...",
          )}
        </div>

        {plan ? (
          // Not a nested <form>: forms cannot nest, and browsers drop the inner
          // element during parsing, which left this submit button with no form
          // owner. `formAction` points the same submission at the Stripe sync
          // action instead, and the plan id is already in the outer form.
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-ink-950/40 px-4 py-3">
            <div className="min-w-0 flex-1 text-xs text-ink-300">
              <p className="font-semibold text-ink-200">{t("admin:plan_stripe_sync_title")}</p>
              <p className="mt-0.5 text-[10px] text-ink-500">{t("admin:plan_stripe_sync_body")}</p>
            </div>
            <button type="submit" formAction={stripeAction} className="btn btn-ghost btn-sm">
              {stripePending ? t("admin:plan_stripe_syncing") : t("admin:plan_stripe_sync")}
            </button>
            {stripeState?.error ? (
              <p className="w-full text-xs font-medium text-danger-300">{stripeState.error}</p>
            ) : null}
            {stripeState?.ok ? (
              <p className="w-full text-xs font-medium text-signal-300">
                {t("admin:plan_stripe_sync_ok")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Features & Limits */}
      <div className="space-y-4 border-t border-white/[0.06] pt-5">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-400">
          {t("admin:plan_section_features")}
        </h3>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {t("admin:plan_features")}
          </span>
          <textarea
            name="features"
            defaultValue={featuresText}
            rows={5}
            className="input w-full font-mono text-xs"
            placeholder={t("admin:plan_features_placeholder")}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {t("admin:plan_limits")}
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
            {t("admin:plan_limits_hint")}
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
          {t("admin:plan_saved")}
        </p>
      ) : null}

      {/* Form Action Buttons */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
        <button type="submit" className="btn btn-primary btn-sm">
          {plan ? t("admin:plan_save_changes") : t("admin:plan_create")}
        </button>
        <a href="/admin/plans" className="btn btn-ghost btn-sm">
          {t("messaging:cancel")}
        </a>
      </div>
    </form>
  );
}
