export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-white/[0.06]" />
        <div className="h-8 w-64 rounded-lg bg-white/[0.06]" />
        <div className="h-4 w-80 max-w-full rounded bg-white/[0.05]" />
      </div>
      <div className="grid grid-cols-2 animate-pulse gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-white/[0.04]" />
    </div>
  );
}