import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Know whose turn it is on every pull request";

const INK_950 = "#07090D";
const INK_900 = "#0B0E14";
const INK_300 = "#7C8DAF";
const INK_500 = "#33415C";
const INK_100 = "#D5DCE9";
const BRAND_500 = "#5B5BD6";
const SIGNAL_400 = "#34D17B";

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
            gap: 12,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: BRAND_500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 22,
                height: 6,
                borderRadius: 3,
                background: INK_900,
                transform: "rotate(45deg)",
              }}
            />
          </div>
          <span>baton</span>
        </div>
        <h1
          style={{
            marginTop: 40,
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.1,
          }}
        >
          Know whose turn it is on every pull request
        </h1>
        <div
          style={{
            marginTop: 36,
            display: "flex",
            gap: 12,
            fontSize: 24,
            fontWeight: 500,
            color: INK_300,
          }}
        >
          <span
            style={{
              border: `1px solid ${INK_500}`,
              borderRadius: 8,
              padding: "8px 16px",
            }}
          >
            Waiting for review
          </span>
          <span
            style={{
              border: `1px solid ${INK_500}`,
              borderRadius: 8,
              padding: "8px 16px",
            }}
          >
            Approved
          </span>
          <span
            style={{
              border: `1px solid ${INK_500}`,
              borderRadius: 8,
              padding: "8px 16px",
            }}
          >
            Changes required
          </span>
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 18,
            color: SIGNAL_400,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 5, background: SIGNAL_400 }} />
          <span>Keeps pull requests moving</span>
        </div>
      </div>
    ),
    size,
  );
}