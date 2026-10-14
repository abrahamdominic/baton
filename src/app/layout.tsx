import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";
import { config } from "@/lib/env-boot";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { buildPrepaintScript, THEME_COLORS } from "@/lib/theme";
import { buildLocalePrepaintScript } from "@/lib/i18n/prepaint";
import { directionFor, localeTag, type Locale } from "@/lib/i18n/config";
import { loadBundle } from "@/lib/i18n/bundles";
import { resolveRequestLocale } from "@/lib/i18n/resolve";
import { I18nProvider } from "@/lib/i18n/provider";
import { savePreferredLanguageAction } from "@/app/actions/language";

/**
 * Type system: IBM Plex across the board. Plex Serif gives the display sizes an
 * editorial, technical-manual voice; Plex Sans carries body copy; Plex Mono
 * labels state names, thresholds and code. Loaded through `next/font`, so the
 * files are self-hosted, subset to latin and preloaded without layout shift.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const display = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const FONT_CLASSES = `${sans.variable} ${display.variable} ${mono.variable}`;

const PREPAINT_SCRIPT = buildPrepaintScript();
const LOCALE_PREPAINT_SCRIPT = buildLocalePrepaintScript();

export const metadata: Metadata = {
  metadataBase: new URL(config.SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "pull request",
    "PR reviewer",
    "stalled pull request",
    "code review",
    "whose turn",
    "GitHub PR",
    "development workflow",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: config.SITE_URL,
    title: SITE_TITLE,
    description:
      "Know whose turn it is on every pull request. Baton pins the state inside the PR and nudges the right person when work stalls.",
    images: [
      {
        url: `${config.SITE_URL}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "Baton status comment on a pull request showing it is waiting for review from sarah-chen",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description:
      "Baton shows which pull requests are waiting on you, who is holding up your work, and nudges the right person at the right time.",
    images: [`${config.SITE_URL}/opengraph-image`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  // Baton's default theme is dark regardless of the OS setting, so the browser
  // chrome starts dark and the pre-paint script keeps it in step with the
  // resolved theme. Media queries are intentionally not used here: they would
  // pick light chrome for a light OS even when the page itself is dark.
  themeColor: THEME_COLORS.dark,
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved on the server so the first paint is already in the right
  // language. `lang` and `dir` are set here rather than by the client provider,
  // which is what removes the "English, then Spanish" flash.
  const { locale, accountLocale } = await resolveRequestLocale();
  const bundles = await loadBundle(locale);

  // The CSP nonce minted per request by the middleware. Next stamps its own
  // inline flight-data scripts automatically; these two are ours, and an inline
  // script withoutiddleware. Next stamps its own
  // inline flight-data scripts automatically; these two are ours, and an inline
  // script without the nonce is blocked, which would drop the theme and locale
  // prepaint and leave a flash on every page load.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={localeTag(locale)}
      dir={directionFor(locale)}
      data-theme="dark"
      className={FONT_CLASSES}
      suppressHydrationWarning
    >
      <head>
        {/*
          Resolve the stored theme before first paint to avoid a flash.

          `suppressHydrationWarning` is required: the browser hides a script's
          `nonce` content attribute after the page loads, so on hydration React
          reads an empty nonce and reports a mismatch against the real value the
          server sent. Both scripts are write-only (they run and are never
          reconciled), so suppressing the diff for these nodes is correct.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }}
        />
        {/*
          Stamps the stored/ detected language onto <html> before React
          hydrates, so direction and language are correct even on the very first
          frame. The server already sent the right value; this keeps the DOM in
          step if local storage holds a more recent explicit choice.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_PREPAINT_SCRIPT }}
        />
      </head>
      <body>
        <I18nProvider
          initialLocale={locale as Locale}
          bundles={bundles}
          accountLocale={accountLocale}
          persist={savePreferredLanguageAction}
        >
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
