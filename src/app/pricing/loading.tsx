/**
 * Loading boundary for the public pricing page.
 *
 * `/pricing` is linked from the header of every marketing page, so it is the
 * first page a visitor reaches that waits on the network: the page itself calls
 * `currentUser()`, `publicPlans()`, and `listPlans()`. Without this file the
 * navigation renders a blank body until all three resolve, which reads as a
 * broken link rather than a slow one.
 */
export default function PricingLoading() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100" aria-busy="true">
      <div className="h-16 border-b border-white/[0.06]" />

      <main className="container-page py-16 md:py-24">
        <div className="mx-auto max-w-2xl animate-pulse text-center">
          <div className="mx-auto h-10 w-full max-w-md rounded-lg bg-white/[0.06]" />
          <div className="mx-auto mt-4 h-4 w-full max-w-lg rounded bg-white/[0.04]" />
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse space-y-5 rounded-2xl border border-white/[0.08] bg-ink-900/70 p-8"
            >
              <div className="h-5 w-28 rounded bg-white/[0.06]" />
              <div className="h-3 w-full rounded bg-white/[0.04]" />
              <div className="border-b border-white/[0.08] pb-6">
                <div className="h-10 w-24 rounded bg-white/[0.07]" />
                <div className="mt-3 h-3 w-40 rounded bg-white/[0.04]" />
              </div>
              <div className="space-y-3">
                {[0, 1, 2, 3, 4, 5].map((row) => (
                  <div key={row} className="h-3 w-full rounded bg-white/[0.03]" />
                ))}
              </div>
              <div className="h-9 w-full rounded-lg bg-white/[0.05]" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
