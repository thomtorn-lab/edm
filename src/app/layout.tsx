import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import PrivacyAwareAnalytics from "@/components/PrivacyAwareAnalytics";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/siteUrl";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Big Shoulders (display font) is loaded with next/font/local from the
// woff2 files @fontsource/big-shoulders already vendors through npm — not
// next/font/google, whose Big Shoulders CSS once served one broken asset URL
// for all three weights and 404'd the build. next/font self-hosts and
// preloads the files; together with the width-matched fallback face below,
// the swap from the fallback to Big Shoulders no longer resizes the header
// and shifts the page (CLS) the way the plain @fontsource rules did.
const bigShoulders = localFont({
  src: [
    { path: "../../node_modules/@fontsource/big-shoulders/files/big-shoulders-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/big-shoulders/files/big-shoulders-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../../node_modules/@fontsource/big-shoulders/files/big-shoulders-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-big-shoulders",
  display: "swap",
  // next/font's automatic Arial fallback only matches Big Shoulders' height,
  // not its very condensed width, so the header logo rendered ~50% wider
  // before the font arrived, wrapped the nav onto a second row and shifted
  // the page. "Big Shoulders Fallback" (globals.css) is width-matched instead.
  adjustFontFallback: false,
  fallback: ["Big Shoulders Fallback"],
  // With a width-matched fallback the swap no longer moves anything, so
  // preloading (three extra high-priority requests competing with the HTML
  // and Inter on slow connections) would only delay LCP.
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Electronic CPH — Copenhagen Electronic Music Events",
    template: "%s — Electronic CPH",
  },
  description:
    "Techno, house, trance, drum & bass and more — a fast, curated index of electronic music events in Copenhagen.",
  openGraph: {
    type: "website",
    siteName: "Electronic CPH",
    locale: "en_GB",
  },
  twitter: {
    card: "summary",
  },
  // No site-wide `robots` here: "index, follow" is already the default when
  // no robots tag exists, and an explicit layout value was also inherited
  // by the 404 page, contradicting the `noindex` Next.js injects there.
  // Pages that must not be indexed set their own `robots` metadata.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${bigShoulders.variable} h-full`}>
      <body className="min-h-full flex flex-col relative">
        <Header />
        <main className="flex-1 relative z-[1]">{children}</main>
        <Footer />
        <PrivacyAwareAnalytics />
      </body>
    </html>
  );
}
