import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090D",
          900: "#0B0E14",
          800: "#11151E",
          700: "#1A2130",
          600: "#243046",
          500: "#33415C",
          400: "#4A5B7E",
          300: "#7C8DAF",
          200: "#ADB9D2",
          100: "#D5DCE9",
          50: "#EFF2F8",
        },
        signal: {
          400: "#34D17B",
          500: "#22C55E",
          600: "#16A34A",
        },
        warn: "#F59E0B",
        danger: "#EF4444",
        brand: {
          200: "#A7ACFF",
          300: "#8B93FF",
          400: "#6D6AF5",
          500: "#5B5BD6",
          600: "#4B4BBA",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.05), 0 1px 3px rgb(0 0 0 / 0.04)",
        lift: "0 12px 32px -12px rgb(7 9 13 / 0.45)",
      },
    },
  },
  plugins: [typography],
};

export default config;