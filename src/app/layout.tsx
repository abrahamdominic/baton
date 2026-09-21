import type { Metadata, Viewport } from "next";
import "./globals.css";
import { config } from "@/lib/env-boot";

export const metadata: Metadata = {
  metadataBase: new URL(config.SITE_URL),
  title: {
    default: "Baton — Know whose turn it is on every pull request",
    template: "%s · Baton",
  },
  description:
    "Baton tracks the state of every open pull request — who it's waiting on and for how long — posts it right in the PR, and nudges the person whose turn it is. No more stalled PRs, no more guesswork.",
  applicationName: "Baton",
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
    siteName: "Baton",
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Baton — know whose turn it is" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Baton — Know whose turn it is on every pull request",
    description:
      "Baton tells you which PRs are waiting on you, who's holding up your work, and nudges the right people at the right time.",
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
  themeColor: "#07090D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}