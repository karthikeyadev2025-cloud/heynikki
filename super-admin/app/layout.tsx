import FetchResilience from "../components/FetchResilience";

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
    <html lang="en">
      <body>
        <FetchResilience />
        {children}
      </body>
    </html>
  );
}
