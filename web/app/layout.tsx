import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import CookieBanner from "../components/CookieBanner";

// Typography system — replaces the previous system-font fallback stack,
// which had zero distinctive character. Fraunces (warm, characterful
// serif) for display headlines contrasts against the dark tech
// background instead of the generic cold-SaaS-grotesk look. Manrope for
// body — clean and legible without being the overused Inter default.
// JetBrains Mono for data/utility text (timestamps, call IDs, code-like
// content). Real Telugu copy still renders via the system's Noto Sans
// Telugu fallback — none of these three families include Telugu glyphs.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://jovio.in"),
  title: "Jovio — Telugu AI Receptionist for Indian Businesses",
  description: "Your business never misses a call. Jovio answers in Telugu, books appointments, sends WhatsApp confirmations — 24/7.",
  keywords: "Telugu AI, voice agent, receptionist, India, SMB, automation, WhatsApp, AI",
  authors: [{ name: "Jovio Global Technologies" }],
  alternates: {
    canonical: "https://jovio.in",
  },
  openGraph: {
    title: "Jovio — Telugu AI Receptionist",
    description: "Your business never misses a call. 24/7 Telugu AI receptionist for Indian SMBs.",
    url: "https://jovio.in",
    siteName: "Jovio",
    locale: "en_IN",
    type: "website",
    images: [{
      url: "/og-image.png",
      width: 1200,
      height: 630,
      alt: "Jovio — Telugu AI Receptionist",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Jovio — Telugu AI Receptionist",
    description: "Your business never misses a call.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#070B19",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${manrope.variable} ${jetbrainsMono.variable}`}>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
