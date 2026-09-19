"use client";

/**
 * "Download CSV" for any list screen.
 *
 * The old export on /calls built its CSV in the browser out of the rows the
 * page happened to have loaded — a hundred of them. A clinic with 3,000
 * calls downloaded a hundred and had no way to tell. Every export now comes
 * from the API (api-server/src/search-export.ts), which pages through the
 * whole table before it finishes the file.
 *
 * The download cannot be a plain <a href>: these routes need the Supabase
 * access token in an Authorization header, and a link cannot send one. So
 * the file is fetched, held as a blob, and handed to a synthetic anchor —
 * which is also why the button has a busy state. A large export takes a few
 * seconds with nothing else on screen to show for it.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "../lib/supabase";
import { toast } from "./Toast";
import { NIKKI } from "../lib/brand";

/**
 * "heynikki-calls-2026-09-19.csv" — the same shape istToday() builds on the
 * server, so a download named here and one named there are indistinguishable.
 * The day is IST: at 23:00 UTC a Hyderabad shop is already on tomorrow, and a
 * file stamped with yesterday's date is one they will mis-file.
 */
function fallbackName(path: string): string {
  const base = (path.split("/").pop() || "export.csv").replace(/\.csv$/, "");
  const ist = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return `heynikki-${base}-${ist}.csv`;
}

export default function ExportButton({
  path, params, label = "Download CSV", disabled, title,
}: {
  /** Route on the API, e.g. "/api/export/calls.csv". */
  path: string;
  /** The filters the list is showing. Empty values are dropped. */
  params?: Record<string, string | number | null | undefined>;
  label?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  const run = async () => {
    if (busy) return;
    setBusy(true);
    let url = "";
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) { toast.err("Please sign in again to download."); return; }

      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== null && v !== undefined && String(v) !== "") qs.set(k, String(v));
      }
      const r = await fetch(`${API}${path}${qs.toString() ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        toast.err(j.error || "Could not build the download. Please try again.");
        return;
      }

      // The server names the file (heynikki-calls-2026-09-19.csv) in
      // Content-Disposition — but that header is NOT CORS-safelisted, and the
      // API sends cors({origin:"*"}) with no exposedHeaders, so from the
      // browser this reads back null on every real deployment (the dashboard
      // and the API are different origins). Every download therefore landed
      // as a bare "calls.csv", and a shop that exports twice in a week ends
      // up with calls.csv and calls (1).csv and no idea which is which.
      // Build the same name here so the file is dated either way.
      const cd = r.headers.get("content-disposition") || "";
      const named = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName(path);

      const blob = await r.blob();
      // An export of zero rows is still a valid file with a header row, but
      // saying so is friendlier than a spreadsheet that opens empty.
      if (blob.size === 0) { toast.err("Nothing to download for these filters."); return; }

      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.ok("Download started");
    } catch {
      toast.err("Could not reach the server for the download.");
    } finally {
      // Revoking immediately can cancel the save on Safari; a tick is enough.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBusy(false);
    }
  };

  const off = disabled || busy;
  return (
    <button type="button" onClick={run} disabled={off}
      title={title || "Download everything matching these filters, as a CSV for Excel or Sheets"}
      style={{
        padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700,
        background: off ? NIKKI.vault : NIKKI.emerald + "1A",
        color: off ? NIKKI.textDim : NIKKI.emerald,
        border: `1px solid ${off ? NIKKI.border : NIKKI.emerald + "66"}`,
        cursor: off ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      }}>
      <Download size={14} /> {busy ? "Preparing…" : label}
    </button>
  );
}
