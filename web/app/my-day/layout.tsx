// Server layout whose only job is the noindex tag: the page is a client
// component and cannot export metadata.
import { NOINDEX } from "../../lib/seo";

export const metadata = NOINDEX;

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
