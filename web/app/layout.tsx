import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bricolage_Grotesque, Manrope, JetBrains_Mono, Noto_Sans_Telugu } from "next/font/google";
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
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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

// Real Telugu glyphs. The site previously had none — Telugu copy fell
// back to whatever the OS happened to ship, which on most Windows
// machines is nothing at all (tofu boxes). The call console renders
// actual Telugu script, so this is load-bearing now, not decorative.
const notoTelugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-telugu",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://heynikki.in"),
  title: "HeyNikki — Telugu AI Receptionist for Indian Businesses",
  description: "Your business never misses a call. HeyNikki answers in Telugu, Hindi and English — switching language mid-call, 24/7.",
  keywords: "Telugu AI, voice agent, AI receptionist, India, SMB, call answering, HeyNikki",
  authors: [{ name: "Nikki Technologies" }],
  alternates: {
    canonical: "https://heynikki.in",
  },
  openGraph: {
    title: "HeyNikki — Telugu AI Receptionist",
    description: "Your business never misses a call. 24/7 Telugu AI receptionist for Indian SMBs.",
    url: "https://heynikki.in",
    siteName: "HeyNikki",
    locale: "en_IN",
    type: "website",
    images: [{
      url: "/og-image.png",
      width: 1200,
      height: 630,
      alt: "HeyNikki — Telugu AI Receptionist",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HeyNikki — Telugu AI Receptionist",
    description: "Your business never misses a call.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
  // Search Console and Bing Webmaster verification.
  //
  // Read from env rather than hardcoded: these are per-property tokens, and
  // committing them puts a permanent claim on the domain into a public repo.
  // Set GOOGLE_SITE_VERIFICATION and BING_SITE_VERIFICATION in Vercel and
  // redeploy — the meta tags appear only when a value exists, so an unset
  // variable renders nothing rather than an empty tag that fails validation.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } }
      : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1220",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Sprint 5 asked for JSON-LD and it was never added — the page had OG
  // and Twitter tags only. Structured data is what puts the price, the
  // languages and the local-business signals into Google's rich results,
  // which for a Hyderabad SMB product is most of the organic traffic
  // that matters. Kept as one graph so there's a single source to edit.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://heynikki.in/#org",
        name: "HeyNikki",
        url: "https://heynikki.in",
        logo: "https://heynikki.in/icon-512.png",
        areaServed: { "@type": "Country", name: "India" },
        address: {
          "@type": "PostalAddress",
          addressLocality: "Hyderabad",
          addressRegion: "Telangana",
          addressCountry: "IN",
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://heynikki.in/#app",
        name: "HeyNikki — Telugu AI Receptionist",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Android, iOS",
        description:
          "AI receptionist that answers your business calls in Telugu, Hindi and English, books appointments and confirms on WhatsApp.",
        inLanguage: ["te", "hi", "en"],
        publisher: { "@id": "https://heynikki.in/#org" },
        offers: [
          {
            "@type": "Offer",
            name: "AI Telecaller",
            price: "5999",
            priceCurrency: "INR",
            url: "https://heynikki.in/#pricing",
          },
          {
            "@type": "Offer",
            name: "Human CRM Seat",
            price: "1999",
            priceCurrency: "INR",
            url: "https://heynikki.in/#pricing",
          },
          {
            "@type": "Offer",
            name: "Dedicated Business Number",
            price: "1999",
            priceCurrency: "INR",
            url: "https://heynikki.in/#pricing",
          },
        ],
      },
      {
        // Mirrors the on-page FAQ section verbatim. If the copy on the
        // homepage changes, change it here too — Google penalises
        // structured data that doesn't match visible content.
        "@type": "FAQPage",
        "@id": "https://heynikki.in/#faq",
        mainEntity: [
          {
            "@type": "Question",
            name: "Is it really Telugu, or English with a Telugu accent?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Really Telugu. The speech model is trained on Telugu, not on English text spelled out phonetically. It handles Telangana and coastal Andhra differences, and switches to Hindi or English the moment your caller does.",
            },
          },
          {
            "@type": "Question",
            name: "Do I have to change my number?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "No. Forward your existing number to HeyNikki, or port it fully — both work. Your board, cards and Google listing stay exactly as they are.",
            },
          },
          {
            "@type": "Question",
            name: "Do my callers know it's an AI?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. TRAI requires disclosure at the start of every automated call, and HeyNikki does it.",
            },
          },
        ],
      },
    ],
  };

  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${manrope.variable} ${jetbrainsMono.variable} ${notoTelugu.variable}`}>
        <Script
          id="heynikki-jsonld"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <CookieBanner />
        {/* Razorpay checkout. Until 2026-07-24 this was never loaded, so the
            billing page always fell through to an alert reading "Razorpay not
            loaded" -- payment was impossible for every customer. Razorpay
            requires their hosted script (it can't be bundled), so it's loaded
            site-wide here; the widget only renders when checkout is opened. */}
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
