import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Baton — know whose turn it is on every pull request";

const INK_950 = "#07090D";
const INK_800 = "#11151E";
const INK_300 = "#7C8DAF";
const INK_100 = "#D5DCE9";
const BRAND_400 = "#6D6AF5";
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
          background: `linear-gradient(135deg, ${INK_950} 0%, ${INK_800} 100%)`,
          color: INK_100,
          fontFamily: "sans-serif",
          padding: 64,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 88, fontWeight: 800, letterSpacing: "-0.03em" }}>baton</span>
          <span style={{ fontSize: 40, color: BRAND_400, fontWeight: 700 }}>·</span>
        </div>
        <p
          style={{
            marginTop: 24,
            fontSize: 44,
            fontWeight: 600,
            textAlign: "center",
            maxWidth: 900,
            color: INK_300,
          }}
        >
          Know whose turn it is on every pull request
        </p>
        <div
          style={{
            marginTop: 48,
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 30,
            fontWeight: 600,
          }}
        >
          <span style={{ color: BRAND_400 }}>Waiting for review</span>
          <span style={{ color: SIGNAL_400 }}>Approved</span>
          <span style={{ color: "#F59E0B" }}>Changes required</span>
        </div>
      </div>
    ),
    size,
  );
}