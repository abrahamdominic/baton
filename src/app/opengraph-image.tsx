import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Baton: Know whose turn it is on every pull request";

const INK_950 = "#08090C";
const INK_300 = "#98A7C4";
const INK_500 = "#242E3F";
const INK_100 = "#E3EBF6";
const BRAND_500 = "#6366F1";
const SIGNAL_400 = "#10B981";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: INK_950,
          color: INK_100,
          fontFamily: "sans-serif",
          padding: 64,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#0D0F18",
              border: "1.5px solid #1E2333",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 10,
                bottom: 10,
                width: 8,
                height: 8,
                borderRadius: 4,
                background: "#10B981",
              }}
            />
            <div
              style={{
                width: 20,
                height: 4,
                background: "#FFFFFF",
                transform: "rotate(-45deg)",
                borderRadius: 2,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 10,
                top: 10,
                width: 8,
                height: 8,
                borderRadius: 4,
                background: "#818CF8",
              }}
            />
          </div>
          <span>baton</span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: INK_300,
            }}
          >
            v0.1
          </span>
        </div>

        <h1
          style={{
            marginTop: 40,
            fontSize: 62,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            textAlign: "center",
            maxWidth: 960,
            lineHeight: 1.15,
            color: "#FFFFFF",
          }}
        >
          Know whose turn it is on every pull request
        </h1>

        <div
          style={{
            marginTop: 36,
            display: "flex",
            gap: 14,
            fontSize: 20,
            fontWeight: 600,
            color: INK_300,
          }}
        >
          <span
            style={{
              border: `1px solid ${BRAND_500}40`,
              background: `${BRAND_500}15`,
              color: "#A5B4FC",
              borderRadius: 8,
              padding: "8px 18px",
            }}
          >
            Waiting for review
          </span>
          <span
            style={{
              border: `1px solid ${SIGNAL_400}40`,
              background: `${SIGNAL_400}15`,
              color: "#6EE7B7",
              borderRadius: 8,
              padding: "8px 18px",
            }}
          >
            Approved and ready
          </span>
          <span
            style={{
              border: `1px solid ${INK_500}`,
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 8,
              padding: "8px 18px",
            }}
          >
            Changes required
          </span>
        </div>

        <div
          style={{
            marginTop: 44,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 18,
            fontWeight: 500,
            color: SIGNAL_400,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 5, background: SIGNAL_400 }} />
          <span>Deterministic PR Workflow · Zero Code Access</span>
        </div>
      </div>
    ),
    size,
  );
}