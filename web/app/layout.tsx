import FetchResilience from "../components/FetchResilience";
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
  // www, not the apex. The apex 308-redirects here, so a canonical
  // pointing at it hands Google a URL that is not the one it can fetch.
  metadataBase: new URL("https://www.heynikki.in"),
  title: "HeyNikki — Telugu AI Receptionist for Indian Businesses",
  description: "Your business never misses a call. HeyNikki is a Telugu AI receptionist and telecaller for Indian small businesses — it answers your phone in Telugu, Hindi or English 24/7, books appointments, captures leads and follows up on WhatsApp. A call answering service without the call centre.",
  keywords: "Telugu AI receptionist, Telugu call answering service, AI telecaller, virtual receptionist Hyderabad, Telugu voice AI, missed call service, AI call centre India, appointment booking bot Telugu, telecaller software, HeyNikki, heynikki.in",
  authors: [{ name: "Nikki Technologies" }],
  alternates: {
    canonical: "https://www.heynikki.in",
    // The site is written for India in English and Telugu and declared
    // neither. languages tells Google which audience each URL is for.
    languages: { "en-IN": "https://www.heynikki.in", "te-IN": "https://www.heynikki.in" },
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
        // WebSite with alternateName is what a brand query leans on: someone
        // typing "hey nikki" or "heynikki.in" should resolve to the same
        // entity as "HeyNikki". It also carries the language targeting, which
        // nothing on the site declared.
        "@type": "WebSite",
        "@id": "https://www.heynikki.in/#website",
        url: "https://www.heynikki.in",
        name: "HeyNikki",
        alternateName: ["Hey Nikki", "heynikki", "heynikki.in", "Nikki Technologies"],
        inLanguage: ["en-IN", "te-IN"],
        publisher: { "@id": "https://heynikki.in/#org" },
      },
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
          // The real plans, from the plans table. This block previously listed
          // an "AI Telecaller" at 5999 and two 1999 modules that no longer
          // exist — Google was being handed a price list we do not charge.
          { "@type": "Offer", name: "Starter", price: "1999", priceCurrency: "INR",
            description: "200 minutes, one business number, appointments and leads" },
          { "@type": "Offer", name: "Growth", price: "4999", priceCurrency: "INR",
            description: "600 minutes, three numbers, outbound campaigns" },
          { "@type": "Offer", name: "Scale", price: "9999", priceCurrency: "INR",
            description: "1500 minutes, ten numbers, API access" },
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
      {
        // FAQPage is the highest-yield structured data for a product like
        // this: Google renders the questions directly under the result, so a
        // search for "does the AI speak real Telugu" can be answered on the
        // results page by our own words. The answers are the ones already on
        // the landing page — structured data that disagrees with the page it
        // describes is a manual action waiting to happen.
        "@type": "FAQPage",
        "@id": "https://www.heynikki.in/#faq",
        mainEntity: [
          {
            "@type": "Question",
            name: "Is it really Telugu, or English with a Telugu accent?",
            acceptedAnswer: { "@type": "Answer", text:
              "Really Telugu. The speech model is trained on Telugu rather than English spelled out phonetically, and it mixes in the English words Hyderabad actually uses." },
          },
          {
            "@type": "Question",
            name: "Do I have to change my business number?",
            acceptedAnswer: { "@type": "Answer", text:
              "No. Forward your existing number to Nikki or port it fully — both work. Your board, your cards and your listings stay exactly as they are." },
          },
          {
            "@type": "Question",
            name: "Do my callers know they are speaking to an AI?",
            acceptedAnswer: { "@type": "Answer", text:
              "Yes. TRAI requires disclosure at the start of every automated call and Nikki gives it. If a caller asks directly, she always says she is an AI assistant." },
          },
          {
            "@type": "Question",
            name: "What happens when Nikki does not understand a caller?",
            acceptedAnswer: { "@type": "Answer", text:
              "She asks once, plainly. If it is still unclear, or the caller asks for a person, the call transfers to your staff — she never pretends to have understood." },
          },
          {
            "@type": "Question",
            name: "How much does a Telugu AI receptionist cost?",
            acceptedAnswer: { "@type": "Answer", text:
              "Plans start at Rs 1,999 a month for 200 minutes, and every new account gets 100 free minutes with no card required. A human receptionist costs around Rs 15,000 a month and goes home at seven." },
          },
          {
            "@type": "Question",
            name: "Can it call customers back, not just answer?",
            acceptedAnswer: { "@type": "Answer", text:
              "Yes. Upload a list and Nikki dials out — old customers, enquiries, festival offers — and reports who was interested. Outbound campaigns are on the Growth plan and above." },
          },
        ],
      },
      {
        // A Service entry carries the words people actually type. Somebody
        // looking for this product searches "Telugu call centre" or "AI
        // telecaller", not "conversational voice agent".
        "@type": "Service",
        "@id": "https://www.heynikki.in/#service",
        name: "Telugu AI call answering and telecalling service",
        serviceType: "AI receptionist, virtual telecaller, call answering service",
        provider: { "@id": "https://heynikki.in/#org" },
        areaServed: [
          { "@type": "State", name: "Telangana" },
          { "@type": "State", name: "Andhra Pradesh" },
          { "@type": "Country", name: "India" },
        ],
        audience: { "@type": "BusinessAudience", audienceType:
          "clinics, real estate offices, jewellery shops, salons and other small businesses" },
        description:
          "A Telugu-speaking AI receptionist and telecaller for Indian small businesses. "
          + "Answers every business call in Telugu, Hindi or English, books appointments, "
          + "captures leads, follows up on WhatsApp, and calls customers back — replacing "
          + "a missed-call log or a small call centre team, 24 hours a day.",
      },

    ],
  };

  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${manrope.variable} ${jetbrainsMono.variable} ${notoTelugu.variable}`}>
        <FetchResilience />
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
