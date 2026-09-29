"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for failures in the root layout itself.
 *
 * This file replaces `<html>` and `<body>`, so it cannot use `useI18n` — the
 * provider lives in the layout that just failed, and the document is being
 * rebuilt from scratch here. That is why the copy below is English-only: the
 * alternative is a boundary that cannot render at all. Everything above this
 * level (route `error.tsx`, `not-found.tsx`) is translated.
 *
 * Styling is inline because this renders without `globals.css` being applied
 * yet, and the raw hex values are the dark theme's tokens.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[baton] global error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 48,
          background: "#0B0D14",
          color: "#E6E9F0",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Baton could not load
        </h1>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.6, color: "#9AA3B8" }}>
          Something went wrong while starting the application. Reloading usually clears it.
        </p>

        {error.digest ? (
          <p style={{ margin: 0, fontSize: 11, color: "#5C6478" }}>
            Technical details: {error.digest}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              background: "#4F46E5",
              color: "#FFFFFF",
            }}
          >
            Reload
          </button>
          {/* next/link is deliberately not used here: this boundary renders when the
              root layout has already thrown, so relying on the router context that
              the layout provides would risk a second failure on the error page. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: "#E6E9F0",
              textDecoration: "none",
            }}
          >
            Go to homepage
          </a>
        </div>
      </body>
    </html>
  );
}
