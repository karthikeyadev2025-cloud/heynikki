import type { MetadataRoute } from "next";

/**
 * Sitemap — public pages only.
 *
 * Every app route returns HTTP 200 to a crawler. Auth is enforced client-side
 * (the page redirects after React mounts), so /dashboard, /leads, /setup and
 * the rest are fetchable and indexable by anything that does not run
 * JavaScript. They are excluded here AND disallowed in robots.ts: a sitemap
 * is an invitation, and inviting Google into a customer's CRM is not a
 * ranking strategy.
 *
 * changeFrequency and priority are hints Google largely ignores, but Bing
 * still reads them and they cost nothing to state honestly.
 */
const BASE = "https://heynikki.in";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`,              lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/pricing`,       lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/telugu-ai-receptionist`,       lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/ai-telecaller`,       lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/for/clinics`,       lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/for/real-estate`,       lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/contact`,       lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/signup`,        lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/login`,         lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/privacy`,       lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/terms`,         lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/refund-policy`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
