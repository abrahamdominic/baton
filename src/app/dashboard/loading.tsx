import { getTranslatorForRequest } from "@/lib/i18n/server-t";

export default async function DashboardLoading() {
  const { t } = await getTranslatorForRequest();
  return (
    <div className="space-y-8" aria-busy="true" aria-label={t("dashboard:loading_view")}>
      {/* Header skeleton */}
      <div className="animate-pulse flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-surface-3" />
          <div className="h-7 w-56 rounded-control bg-surface-3" />
          <div className="h-3.5 w-96 max-w-full rounded bg-surface-2" />
        </div>
        <div className="h-9 w-36 rounded-control bg-surface-3" />
      </div>

      {/* Metric cards skeleton */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-panel border border-hairline bg-ink-900/50 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-surface-3" />
              <div className="h-7 w-7 rounded-control bg-surface-2" />
            </div>
            <div className="h-8 w-20 rounded bg-surface-3" />
            <div className="h-2.5 w-32 rounded bg-surface-2" />
          </div>
        ))}
      </div>

      {/* Content panel skeleton */}
      <div className="animate-pulse rounded-panel border border-hairline bg-ink-900/50 p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="h-4 w-44 rounded bg-surface-3" />
          <div className="h-3 w-24 rounded bg-surface-2" />
        </div>
        <div className="space-y-3 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-control bg-surface-1 border border-hairline" />
          ))}
        </div>
      </div>
    </div>
  );
}