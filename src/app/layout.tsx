import type { Metadata, Viewport } from "next";
import { getDict } from "@/lib/i18n/server";
import { Instrument_Serif, Inter } from "next/font/google";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

/**
 * Self-hosted at build time. These were a CSS `@import` to fonts.googleapis.com,
 * which blocks first paint on a third-party round trip; next/font inlines the
 * files and hands the family names to CSS as variables.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

/**
 * The tab title follows the reader's language, like everything else. The locale
 * cookie is readable before any query, so the first paint — and the title in
 * the browser tab — is already right rather than flipping after hydration.
 */
export function generateMetadata(): Metadata {
  const t = getDict();
  return { title: t.appName, description: t.tagline };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches --bg in each theme, so the browser chrome doesn't flash the wrong
  // colour on a phone.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0E10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale() === "zh" ? "zh-Hans" : "en"}
      className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
