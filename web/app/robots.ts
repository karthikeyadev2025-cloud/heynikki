import type { MetadataRoute } from "next";

/**
 * robots.txt
 *
 * The site had none of its own — the file being served is Cloudflare's
 * managed content-signals default, which is fine as far as it goes but names
 * no sitemap and disallows nothing. Meanwhile every signed-in route answers
 * 200 to a crawler, because auth is enforced after React mounts. Without the
 * rules below, a customer's leads page is a candidate for the index.
 *
 * NOTE: if Cloudflare's managed robots.txt is enabled it overrides this file
 * at the edge. Check the Cloudflare dashboard if /robots.txt does not change
 * after deploy — see the commit message.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Signed-in surfaces. Indexable today purely because the redirect
          // is client-side.
          "/dashboard", "/leads", "/calls", "/appointments", "/campaigns",
          "/analytics", "/whatsapp", "/knowledge", "/verification", "/setup",
          "/billing", "/api-keys", "/admin", "/quality",
          // Password flows carry single-use tokens in the URL.
          "/reset-password", "/forgot-password",
          // Not a page anyone should land on from search.
          "/landing-preview.html",
        ],
      },
    ],
    // www, matching the canonical and the host that actually serves.
    // The apex 308-redirects here, so pointing a crawler at it costs a
    // hop and muddies which host is the real one.
    sitemap: "https://www.heynikki.in/sitemap.xml",
    host: "https://www.heynikki.in",
  };
}
