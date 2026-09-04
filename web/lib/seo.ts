// lib/seo.ts — metadata shared by every route that must stay out of search.
//
// The root layout sets robots index:true site-wide, and the signed-in pages
// answer 200 to a crawler because the auth redirect happens after React
// mounts. Those pages are "use client" components and cannot export metadata
// themselves, so each signed-in directory carries a tiny server layout.tsx
// that exports this object. Keep the list of directories that use it in step
// with the disallow list in app/robots.ts.
import type { Metadata } from "next";

export const NOINDEX: Metadata = {
  robots: { index: false, follow: false },
};
