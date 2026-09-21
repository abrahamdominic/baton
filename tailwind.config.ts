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
          950: "#08090C",
          900: "#0E1117",
          850: "#12161F",
          800: "#161B22",
          750: "#1C2330",
          700: "#242E3F",
          600: "#323F56",
          500: "#4B5B7A",
          400: "#6B7C9E",
          300: "#98A7C4",
          200: "#C4D0E4",
          100: "#E3EBF6",
          50: "#F4F7FC",
        },
        signal: {
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
        },
        warn: {
          DEFAULT: "#F59E0B",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
        },
        danger: {
          DEFAULT: "#EF4444",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#EF4444",
          600: "#DC2626",
        },
        brand: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"SFMono-Regular"',
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.05), 0 1px 3px rgb(0 0 0 / 0.04)",
        lift: "0 16px 40px -12px rgb(0 0 0 / 0.6)",
        subtle: "0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px -2px rgba(0, 0, 0, 0.4)",
        "card-hover": "0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 24px -4px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [typography],
};

export default config;