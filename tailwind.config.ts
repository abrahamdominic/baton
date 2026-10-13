import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/**
 * Design tokens for Baton.
 *
 * One place owns color, type, radius, spacing rhythm and motion. Components
 * consume tokens, never raw hex or ad hoc durations. The `ink` scale is the
 * neutral system and flips between themes through CSS variables in
 * `globals.css`; `brand` is the primary accent ("your turn"), `waiting` is the
 * secondary accent ("waiting on others"), and `signal`/`warn`/`danger` are
 * semantic state colors used only inside the simulator and state explorer.
 */
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
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          750: "rgb(var(--ink-750) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          50: "rgb(var(--ink-50) / <alpha-value>)",
        },
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
        waiting: {
          50: "rgb(var(--waiting-50) / <alpha-value>)",
          100: "rgb(var(--waiting-100) / <alpha-value>)",
          300: "rgb(var(--waiting-300) / <alpha-value>)",
          400: "rgb(var(--waiting-400) / <alpha-value>)",
          500: "rgb(var(--waiting-500) / <alpha-value>)",
          600: "rgb(var(--waiting-600) / <alpha-value>)",
          700: "rgb(var(--waiting-700) / <alpha-value>)",
        },
        signal: {
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
        },
        warn: {
          DEFAULT: "#F59E0B",
          200: "#FDE68A",
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
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // Modular display scale. Body sizes come from Tailwind's defaults.
        "display-1": ["clamp(2.75rem, 6.5vw, 4.75rem)", { lineHeight: "1.02", letterSpacing: "-0.032em" }],
        "display-2": ["clamp(2rem, 4.5vw, 3.25rem)", { lineHeight: "1.06", letterSpacing: "-0.026em" }],
        "display-3": ["clamp(1.5rem, 2.6vw, 2.125rem)", { lineHeight: "1.12", letterSpacing: "-0.02em" }],
      },
      lineHeight: {
        reading: "1.6",
      },
      maxWidth: {
        measure: "65ch",
        content: "72rem",
      },
      borderRadius: {
        control: "0.5rem",
        panel: "0.75rem",
        feature: "1rem",
      },
      spacing: {
        section: "7rem",
        "section-sm": "4.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.05), 0 1px 3px rgb(0 0 0 / 0.04)",
        lift: "0 16px 40px -12px rgb(0 0 0 / 0.6)",
        subtle: "0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px -2px rgba(0, 0, 0, 0.4)",
        "card-hover": "0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 24px -4px rgba(0, 0, 0, 0.5)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "220ms",
        slow: "420ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
        entrance: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(0.75rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        handoff: {
          "0%": { transform: "translateX(0)", opacity: "1" },
          "45%": { transform: "translateX(var(--handoff, 0px))", opacity: "0.35" },
          "55%": { transform: "translateX(var(--handoff, 0px))", opacity: "0.35" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
      },
      animation: {
        "rise-in": "rise-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 300ms ease-out both",
        handoff: "handoff 900ms cubic-bezier(0.4, 0, 0.2, 1) both",
      },
    },
  },
  plugins: [typography],
};

export default config;
