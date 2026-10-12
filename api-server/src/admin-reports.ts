/**
 * Reports for the control room: one period, the whole platform and each
 * business, in numbers that can be exported.
 *
 * WHY THIS EXISTS
 * The console could say what is happening now (Command Center), who is near a
 * limit (Usage) and what was paid (Billing), but not "what did October look
 * like, and which business drove it". Answering that meant opening five
 * screens and a spreadsheet.
 *
 * Everything is derived from the rows the rest of the product already writes:
 * calls (Nikki's minutes vs the team's, by intent 'transfer' — the same split
 * usage.ts meters), appointments, leads, invoices and tenants. Days are IST
 * days, since that is the day every customer and every bill is counted in.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONVERSATION_SECS } from "./attendance";

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
export const istDay = (iso: string | number) =>
  new Date((typeof iso === "number" ? iso : Date.parse(iso)) + IST_MS).toISOString().slice(0, 10);

/** The longest period one report may cover. */
export const REPORT_MAX_DAYS = 92;

/**
 * A from/to pair of IST days, both inclusive, defaulting to the last 30 days
 * and clamped so a typed year cannot ask for every call ever made.
 */
export function reportRange(from: unknown, to: unknown, now = Date.now()):
  { from: string; to: string; startIso: string; endIso: string; days: string[] } {
  const ok = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  let t = ok(to) ? to : istDay(now);
  let f = ok(from) ? from : istDay(Date.parse(`${t}T00:00:00+05:30`) - 29 * DAY_MS);
  if (f > t) [f, t] = [t, f];
  const span = Math.round((Date.parse(t) - Date.parse(f)) / DAY_MS) + 1;
  if (span > REPORT_MAX_DAYS) f = new Date(Date.parse(t) - (REPORT_MAX_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let d = Date.parse(f); d <= Date.parse(t); d += DAY_MS) days.push(new Date(d).toISOString().slice(0, 10));
  return {
    from: f, to: t, days,
    startIso: `${f}T00:00:00+05:30`,
    endIso: new Date(Date.parse(`${t}T00:00:00+05:30`) + DAY_MS).toISOString(),
  };
}

type CallRow = { tenant_id: string | null; created_at: string; direction: string | null; intent: string | null;
                 status: string | null; duration_seconds: number | null };
type Stamp = { tenant_id: string | null; created_at: string };
type Invoice = { tenant_id: string | null; created_at: string; amount_paise: number | null; status: string | null };
type Tenant = { id: string; name: string; plan: string | null; status: string | null; created_at: string };

const blank = () => ({
  calls: 0, connected: 0, inbound: 0, outbound: 0, missed: 0,
  ai_seconds: 0, desk_seconds: 0, appointments: 0, leads: 0, revenue_paise: 0,
});
type Bucket = ReturnType<typeof blank>;

const round = (b: Bucket) => ({
  calls: b.calls, connected: b.connected, inbound: b.inbound, outbound: b.outbound, missed: b.missed,
  ai_minutes: Math.ceil(b.ai_seconds / 60), desk_minutes: Math.ceil(b.desk_seconds / 60),
  appointments: b.appointments, leads: b.leads, revenue_paise: b.revenue_paise,
  // Of the calls placed or received, how many became a conversation.
  connect_rate: b.calls > 0 ? b.connected / b.calls : null,
});

/** Pure: rows in, the report out. Tested without a database. */
export function buildReport(input: {
  days: string[]; calls: CallRow[]; appointments: Stamp[]; leads: Stamp[];
  invoices: Invoice[]; tenants: Tenant[]; planNames?: Record<string, string>;
}) {
  const { days, tenants } = input;
  const inRange = new Set(days);
  const total = blank();
  const byDay = new Map(days.map(d => [d, blank()]));
  const byTenant = new Map<string, Bucket>();
  const bucket = (tid: string | null) => {
    const k = tid || "unknown";
    let b = byTenant.get(k); if (!b) byTenant.set(k, b = blank());
    return b;
  };
  const each = (iso: string, tid: string | null, fn: (b: Bucket) => void) => {
    const d = istDay(iso);
    if (!inRange.has(d)) return;
    fn(total); fn(byDay.get(d)!); fn(bucket(tid));
  };

  for (const c of input.calls) {
    const secs = Math.max(0, Number(c.duration_seconds) || 0);
    const desk = c.intent === "transfer";
    each(c.created_at, c.tenant_id, b => {
      b.calls++;
      if (c.direction === "outbound") b.outbound++; else b.inbound++;
      // A conversation, by the Desk's own rule. "Any duration" would count a
      // phone that rang out: a Desk call's seconds include the ringing.
      if (secs >= CONVERSATION_SECS) b.connected++;
      if (c.status === "missed") b.missed++;
      if (desk) b.desk_seconds += secs; else b.ai_seconds += secs;
    });
  }
  for (const a of input.appointments) each(a.created_at, a.tenant_id, b => { b.appointments++; });
  for (const l of input.leads) each(l.created_at, l.tenant_id, b => { b.leads++; });
  for (const i of input.invoices) {
    if (i.status !== "paid") continue;
    each(i.created_at, i.tenant_id, b => { b.revenue_paise += Number(i.amount_paise) || 0; });
  }

  const signups = tenants.filter(t => inRange.has(istDay(t.created_at)));
  const paidPlans = new Set(["starter", "growth", "scale"]);
  const nameOf = new Map(tenants.map(t => [t.id, t]));
  const rows = [...byTenant.entries()].map(([id, b]) => {
    const t = nameOf.get(id);
    return {
      tenant_id: id, name: t?.name || (id === "unknown" ? "No business on the row" : "Deleted business"),
      plan: t?.plan || null, plan_name: (t?.plan && input.planNames?.[t.plan]) || t?.plan || "—",
      status: t?.status || null, ...round(b),
    };
  }).sort((a, b) => (b.ai_minutes + b.desk_minutes) - (a.ai_minutes + a.desk_minutes) || b.calls - a.calls);
  // Businesses with nothing in the period still belong in the report: a
  // paying account that made no calls is the row someone should ring.
  for (const t of tenants) {
    if (byTenant.has(t.id)) continue;
    rows.push({ tenant_id: t.id, name: t.name, plan: t.plan, plan_name: (t.plan && input.planNames?.[t.plan]) || t.plan || "—",
                status: t.status, ...round(blank()) });
  }

  return {
    totals: {
      ...round(total),
      signups: signups.length,
      tenants: tenants.length,
      paying: tenants.filter(t => paidPlans.has(String(t.plan)) && t.status === "active").length,
      active_tenants: [...byTenant.entries()].filter(([id, b]) => id !== "unknown" && b.calls > 0).length,
      quiet_paying: rows.filter(r => paidPlans.has(String(r.plan)) && r.status === "active" && r.calls === 0).length,
    },
    daily: days.map(d => ({ day: d, ...round(byDay.get(d)!) })),
    tenants: rows,
  };
}

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const PAGE = 1000, out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

export function mountAdminReports(app: Express, { sb, verifySuperAdmin }: {
  sb: SupabaseClient; verifySuperAdmin: (req: Request, res: Response, next: NextFunction) => any;
}): void {
  app.get("/api/admin/reports", verifySuperAdmin, async (req: Request, res: Response) => {
    try {
      const r = reportRange(req.query.from, req.query.to);
      const span = (table: string, cols: string) => pageAll<any>((a, b) =>
        sb.from(table).select(cols).gte("created_at", r.startIso).lt("created_at", r.endIso).order("id").range(a, b));
      const [calls, appointments, leads, invoices, tenants, plans] = await Promise.all([
        span("calls", "id, tenant_id, created_at, direction, intent, status, duration_seconds"),
        span("appointments", "id, tenant_id, created_at"),
        span("leads", "id, tenant_id, created_at"),
        span("invoices", "id, tenant_id, created_at, amount_paise, status"),
        sb.from("tenants").select("id, name, plan, status, created_at").then(x => { if (x.error) throw new Error(x.error.message); return x.data || []; }),
        sb.from("plans").select("id, display_name").then(x => x.data || []),
      ]);
      const planNames = Object.fromEntries((plans as any[]).map(p => [p.id, p.display_name]));
      res.json({ from: r.from, to: r.to, max_days: REPORT_MAX_DAYS,
                 ...buildReport({ days: r.days, calls, appointments, leads, invoices, tenants: tenants as any, planNames }) });
    } catch (e: any) {
      console.error("[admin-reports]", e?.message || e);
      res.status(500).json({ error: "Could not build the report" });
    }
  });
}
