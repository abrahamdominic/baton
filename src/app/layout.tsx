import type { Metadata, Viewport } from "next";
import "./globals.css";
import { config } from "@/lib/env-boot";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { buildPrepaintScript, THEME_COLORS } from "@/lib/theme";
import { buildLocalePrepaintScript } from "@/lib/i18n/prepaint";
import { directionFor, localeTag, type Locale } from "@/lib/i18n/config";
import { loadBundle } from "@/lib/i18n/bundles";
import { resolveRequestLocale } from "@/lib/i18n/resolve";
import { I18nProvider } from "@/lib/i18n/provider";
import { savePreferredLanguageAction } from "@/app/actions/language";

const PREPAINT_SCRIPT = buildPrepaintScript();
const LOCALE_PREPAINT_SCRIPT = buildLocalePrepaintScript();

export const metadata: Metadata = {
  metadataBase: new URL(config.SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Baton is a GitHub App that tracks the state of every open pull request, shows whose turn it is inside the PR, and nudges the right person when work stalls.",
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
      "Know whose turn it is on every pull request. Baton shows the state in the PR and nudges the right person.",
    images: [{ url: `${config.SITE_URL}/opengraph-image`, width: 1200, height: 630, alt: SITE_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description:
      "Baton tells you which PRs are waiting on you, who is holding up your work, and nudges the right people at the right time.",
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

  return (
    <html lang={localeTag(locale)} dir={directionFor(locale)} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Resolve the stored theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
        {/*
          Stamps the stored/ detected language onto <html> before React
          hydrates, so direction and language are correct even on the very first
          frame. The server already sent the right value; this keeps the DOM in
          step if local storage holds a more recent explicit choice.
        */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_PREPAINT_SCRIPT }} />
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
