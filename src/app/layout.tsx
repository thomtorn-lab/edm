import type { Metadata } from "next";
import { Inter } from "next/font/google";
// Self-hosted via @fontsource instead of next/font/google: Big Shoulders'
// dynamic Google Fonts CSS response was serving the same (stale/broken)
// asset URL for all three weights, 404ing at build time. Fontsource
// vendors the actual font files through npm, so the build no longer
// depends on fetching anything from fonts.googleapis.com/gstatic.com.
import "@fontsource/big-shoulders/latin-600.css";
import "@fontsource/big-shoulders/latin-700.css";
import "@fontsource/big-shoulders/latin-800.css";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://cph-electronic.events";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Nattefrekvens — Copenhagen Electronic Music Events",
    template: "%s — Nattefrekvens",
  },
  description:
    "Techno, house, trance, drum & bass and more — a fast, curated index of electronic music events in Copenhagen and Frederiksberg.",
  openGraph: {
    type: "website",
    siteName: "Nattefrekvens",
    locale: "en_GB",
  },
  twitter: {
    card: "summary",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col relative">
        <Header />
        <main className="flex-1 relative z-[1]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
