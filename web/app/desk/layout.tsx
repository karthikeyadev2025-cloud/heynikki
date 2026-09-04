// app/desk/layout.tsx — server layout whose only job is the noindex tag.
import { NOINDEX } from "../../lib/seo";

export const metadata = NOINDEX;

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
