// app/analytics/layout.tsx — server layout whose only job is the noindex tag.
// The page itself is a client component and cannot export metadata.
import { NOINDEX } from "../../lib/seo";

export const metadata = NOINDEX;

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
