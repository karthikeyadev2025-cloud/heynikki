import FetchResilience from "../components/FetchResilience";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from "next/font/google";

// The control room's type: Plex Sans for the interface, Plex Sans Condensed
// for page titles and the big numbers, Plex Mono for phone numbers, IDs and
// times — an engineered family for an operator's console. Self-hosted by
// next/font, so nothing is fetched from Google at runtime.
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-ui", display: "swap" });
const plexCond = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-cond", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata = {
  title: "HeyNikki · Control room",
  robots: { index: false, follow: false },
};

// The voice assistant is NOT mounted here.
//
// It used to be, which put a floating "ask Nikki about your business data"
// button on the super-admin LOGIN screen — before anyone had signed in,
// before the panel knew who was asking, and with no tenant context for it to
// answer about. Every question it took there came back 401 from
// /api/admin/voice-query, and the button itself told anyone who found the
// URL that there was data behind it.
//
// It lives inside the authenticated area now: app/page.tsx renders it after
// the super_admin role check passes. Do not move it back up here.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexCond.variable} ${plexMono.variable}`}>
      <body>
        <FetchResilience />
        {children}
      </body>
    </html>
  );
}
