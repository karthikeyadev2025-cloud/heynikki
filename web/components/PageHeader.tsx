// The one heading every dashboard screen opens with: the name the menu uses,
// one line saying what the screen is for, and the screen's own controls on
// the right. Five screens had no heading or their own smaller one, so moving
// between them the page seemed to change product.
import { NIKKI } from "../lib/brand";

export default function PageHeader({ title, sub, children }: {
  title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700,
          letterSpacing: "-0.02em", color: NIKKI.text, margin: "0 0 4px" }}>{title}</h1>
        {sub && <p style={{ color: NIKKI.textMid, fontSize: 14, margin: 0, lineHeight: 1.55, maxWidth: "72ch" }}>{sub}</p>}
      </div>
      {children && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}
