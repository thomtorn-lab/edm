import type { Metadata } from "next";
import { Inter, Big_Shoulders } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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
    <html lang="en" className={`${inter.variable} ${bigShoulders.variable} h-full`}>
      <body className="min-h-full flex flex-col relative">
        <Header />
        <main className="flex-1 relative z-[1]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
