/**
 * Super-admin extras: Broadcast with a real delivery channel, the demo-tenant
 * lifecycle, and the 9am platform health board.
 *
 * Mounted from index.ts (one line, see mountAdminExtras below) so none of this
 * touches the 7,600-line file it extends.
 *
 *   POST /api/admin/broadcast/preview          → who would receive it, by name
 *   POST /api/admin/broadcast/send             → Resend, per-recipient outcome
 *   GET  /api/admin/broadcast/history          → what was actually delivered
 *
 *   GET  /api/admin/demo-tenants               → live demos, expiry, call usage
 *   POST /api/admin/demo-tenants/:id/extend    → push the expiry out
 *   POST /api/admin/demo-tenants/:id/expire    → retire one now
 *   (creation stays on the existing POST /api/admin/demo-tenants in index.ts)
 *
 *   GET  /api/admin/platform-health            → the board
 *   POST /api/admin/platform-health/close-stuck-calls → the one safe repair
 *
 * WHY THESE PATHS. index.ts already registers POST /api/admin/broadcast (the
 * honest 501) and POST /api/admin/demo-tenants. Express matches in
 * registration order, so a second handler on an identical method+path would
 * be dead code that silently never runs. Every route here is either a new
 * path or a different verb on an existing one.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAID_PLANS, istMonthStart, planMinutes } from "./usage";

/**
 * What index.ts hands over.
 *
 *   sb                the SERVICE-KEY Supabase client. Everything here reads
 *                     across tenants and writes admin_audit_log, neither of
 *                     which an anon or JWT client may do.
 *   verifySuperAdmin  the existing middleware (index.ts, "SUPER ADMIN APIS").
 *                     Passed in rather than re-implemented so there is exactly
 *                     one definition of who is a super admin — a second copy
 *                     is a second thing to forget to tighten.
 */
export type AdminExtrasDeps = {
  sb: SupabaseClient;
  verifySuperAdmin: (req: Request, res: Response, next: NextFunction) => any;
};

/* ── IST ──────────────────────────────────────────────────────
 * Every boundary on this page is a day or month boundary an Indian operator
 * recognises. new Date().toISOString().slice(0,10) is UTC, which means
 * "today" starts at 5:30am IST — so a 9am board would report the previous
 * night's failures as today's and this morning's as nothing at all. */
const IST_MS = 5.5 * 3600_000;

/** First instant of today in IST, as an ISO string with the offset. */
function istDayStart(now = Date.now()): string {
  return `${new Date(now + IST_MS).toISOString().slice(0, 10)}T00:00:00+05:30`;
}

/** "19 Sep, 2:40 pm" — the format an operator reads a timestamp in. */
function istStamp(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  });
}

/** "3h 20m ago" / "in 2d 4h". The "since when" every health row has to carry. */
function ago(iso?: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = now - t;
  const fwd = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);
  const part = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return fwd ? `in ${part}` : `${part} ago`;
}

/** Runs `fn` over `items` at most `n` at a time. */
async function pooled<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Pages a PostgREST select. Supabase caps a response at 1000 rows, and every
 * total computed from an unpaged read here (minutes used, demo call counts)
 * would quietly stop growing at the thousandth row — under-reporting exactly
 * the tenants and demos that matter most.
 */
async function pageAll(sb: SupabaseClient, build: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ════════════════════════════════════════════════════════════
// BROADCAST
// ════════════════════════════════════════════════════════════
/**
 * Email is the only channel this platform can honestly broadcast on.
 *
 * WhatsApp templates are approved by Meta per template NAME, and there is no
 * approved operator-announcement template — sending free text outside a
 * 24-hour service window is rejected by the API, and repeated attempts put the
 * business number's quality rating at risk. FCM is not configured. That left
 * Resend, which already sends this platform's billing and usage mail.
 *
 * So the audience is not "tenants" but "tenant owners with an email address",
 * and the difference is reported rather than hidden: a tenant whose owner_id
 * is null, or whose auth user has no email, comes back as `no_email` and is
 * counted separately from a send that failed.
 */
const FROM_ADDRESS = () => `Nikki <noreply@${process.env.FROM_EMAIL || "heynikki.in"}>`;

/** Resend's documented limit is 2 requests/second. One batch is one request. */
const RESEND_BATCH_SIZE = 25;
const RESEND_GAP_MS     = 600;

/**
 * A hard ceiling on one broadcast. Not a performance guard — a blast radius
 * guard. An audience filter typed wrong is the difference between mailing one
 * plan and mailing the entire customer base, and that mistake cannot be
 * un-sent.
 */
const MAX_RECIPIENTS = 500;

const MAX_SUBJECT = 150;
const MAX_MESSAGE = 4000;

type Audience = {
  plan?: string | null;
  status?: string | null;
  has_did?: "yes" | "no" | "any" | null;
  include_demo?: boolean;
  tenant_ids?: string[] | null;
};

type Target = {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  status: string;
  has_did: boolean;
  email: string | null;
  /**
   * `no_email` is decided BEFORE anything is sent — a tenant with no owner is
   * a data problem, not a delivery failure, and merging the two hides both.
   *
   * `sent` means Resend ACCEPTED the message and gave it an id. It is not a
   * confirmation that the inbox received it: a later bounce arrives on
   * Resend's webhook, which nothing here subscribes to. Said plainly rather
   * than dressed up, because this screen exists to stop the panel claiming
   * more than the server knows.
   */
  state: "ready" | "sent" | "failed" | "no_email";
  error?: string;
  provider_id?: string;
};

const PLANS    = ["trial", "starter", "growth", "scale", "demo"];
const STATUSES = ["trial", "active", "suspended", "cancelled"];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text in, safe HTML out. Blank lines become paragraphs. */
function messageHtml(tenantName: string, message: string): string {
  const paras = escapeHtml(message).split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:15px;color:#1f2937">
<p style="margin:0 0 14px">Hi ${escapeHtml(tenantName)},</p>
${paras}
<p style="margin:18px 0 0;font-size:13px;color:#6b7280">— The Hey Nikki team<br>
<a href="https://heynikki.in" style="color:#12457a">heynikki.in</a></p>
</div>`;
}

/**
 * Who this broadcast reaches, resolved exactly the way the send will resolve
 * it — the preview and the send call this same function, so a dry run that
 * lists eleven names cannot be followed by a send that reaches fourteen.
 */
async function resolveAudience(sb: SupabaseClient, a: Audience): Promise<Target[]> {
  let q = sb.from("tenants").select("id, name, plan, status, owner_id, is_demo").order("name");
  if (a.plan   && PLANS.includes(a.plan))       q = q.eq("plan", a.plan);
  if (a.status && STATUSES.includes(a.status))  q = q.eq("status", a.status);
  // Demo tenants are disposable sandboxes, not customers. Announcing a price
  // change to one is at best noise and at worst a mail to a throwaway address.
  if (!a.include_demo) q = q.eq("is_demo", false);
  if (a.tenant_ids?.length) q = q.in("id", a.tenant_ids.slice(0, MAX_RECIPIENTS));

  const { data: tenants, error } = await q;
  if (error) throw new Error(`tenant read failed: ${error.message}`);

  // "has a number" is the dids table, not tenants — a tenant row says nothing
  // about whether the business is actually reachable on a phone.
  const { data: dids, error: didErr } = await sb.from("dids")
    .select("tenant_id").eq("status", "assigned").not("tenant_id", "is", null);
  if (didErr) throw new Error(`did read failed: ${didErr.message}`);
  const withDid = new Set((dids || []).map((d: any) => String(d.tenant_id)));

  const filtered = (tenants || []).filter((t: any) => {
    if (a.has_did === "yes") return withDid.has(String(t.id));
    if (a.has_did === "no")  return !withDid.has(String(t.id));
    return true;
  });

  // One auth lookup per owner, five at a time. tenants has no email column;
  // the owner's address lives in auth.users and only the service key can read
  // it. Pooled rather than serial so a hundred tenants is a second, not a
  // minute, and bounded so it is not a hundred simultaneous auth calls.
  const emails = await pooled(filtered, 5, async (t: any) => {
    if (!t.owner_id) return null;
    try {
      const { data, error: e } = await sb.auth.admin.getUserById(String(t.owner_id));
      if (e) return null;
      return data?.user?.email || null;
    } catch { return null; }
  });

  return filtered.map((t: any, i: number) => ({
    tenant_id:   String(t.id),
    tenant_name: String(t.name || "").trim() || String(t.id).slice(0, 8),
    plan:        String(t.plan || ""),
    status:      String(t.status || ""),
    has_did:     withDid.has(String(t.id)),
    email:       emails[i],
    state:       emails[i] ? "ready" : "no_email",
  }));
}

type ResendReply = { ok: boolean; status: number; body: any; error?: string };

async function resendPost(path: string, key: string, payload: any): Promise<ResendReply> {
  try {
    const r = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 300) }; }
    return {
      ok: r.ok, status: r.status, body,
      error: r.ok ? undefined : (body?.message || body?.error?.message || `HTTP ${r.status}`),
    };
  } catch (e: any) {
    // A DNS or socket failure is NOT a delivered email. Reported as the
    // failure it is, per recipient, rather than swallowed into a total.
    return { ok: false, status: 0, body: null, error: `network: ${e?.message || e}` };
  }
}

/**
 * Sends, and tells the truth about each address.
 *
 * Batched 25 at a time because Resend's rate limit is per REQUEST: a hundred
 * individual sends spaced to respect it takes fifty seconds and an HTTP
 * request that may not survive it. When a batch is rejected as a whole —
 * which is what Resend does when one address in it fails validation — each
 * address in that batch is retried on its own, so one bad address is reported
 * as one failure and not as twenty-five.
 */
async function deliver(targets: Target[], subject: string, message: string, key: string): Promise<void> {
  const mail = (t: Target) => ({
    from: FROM_ADDRESS(), to: [t.email], subject,
    html: messageHtml(t.tenant_name, message),
  });
  const deliverable = targets.filter(t => t.state === "ready");
  const batches = chunk(deliverable, RESEND_BATCH_SIZE);

  for (let b = 0; b < batches.length; b++) {
    const group = batches[b];
    if (b > 0) await sleep(RESEND_GAP_MS);

    const payload = group.map(mail);
    let reply = await resendPost("/emails/batch", key, payload);
    if (reply.status === 429) {                 // the documented backoff, once
      await sleep(1500);
      reply = await resendPost("/emails/batch", key, payload);
    }

    const ids = Array.isArray(reply.body?.data) ? reply.body.data : null;
    if (reply.ok && ids && ids.length === group.length) {
      group.forEach((t, i) => { t.state = "sent"; t.provider_id = ids[i]?.id; });
      continue;
    }

    for (const t of group) {
      await sleep(RESEND_GAP_MS);
      let one = await resendPost("/emails", key, mail(t));
      if (one.status === 429) { await sleep(1500); one = await resendPost("/emails", key, mail(t)); }
      if (one.ok) { t.state = "sent"; t.provider_id = one.body?.id; }
      else        { t.state = "failed"; t.error = one.error || "rejected"; }
    }
  }
}

/**
 * Double-submit guard, in memory.
 *
 * The Send button is one click away from mailing every customer. A second
 * click while the first request is still running — or a refresh-and-retry
 * thirty seconds later — sends the same announcement twice to people who
 * cannot un-receive it. Keyed on admin + subject + message + audience, held
 * for two minutes, overridable with force:true for the rare genuine resend.
 *
 * In memory is honest about what it is: one API process. It stops the
 * accident it was written for (the same operator, the same minute). It is not
 * a distributed lock, and the audit log remains the record of what was sent.
 */
const recentSends = new Map<string, number>();
const RESEND_LOCK_MS = 120_000;

function sendKey(adminId: string, subject: string, message: string, a: Audience): string {
  return [adminId, subject, message, a.plan, a.status, a.has_did, a.include_demo,
          (a.tenant_ids || []).join(",")].join("|");
}

function mountBroadcast(app: Express, d: AdminExtrasDeps) {
  const { sb, verifySuperAdmin } = d;

  const readAudience = (body: any): Audience => ({
    plan:         body?.plan && body.plan !== "all" ? String(body.plan) : null,
    status:       body?.status && body.status !== "all" ? String(body.status) : null,
    has_did:      ["yes", "no"].includes(body?.has_did) ? body.has_did : "any",
    include_demo: !!body?.include_demo,
    tenant_ids:   Array.isArray(body?.tenant_ids) ? body.tenant_ids.map(String) : null,
  });

  // Dry run. Names, plans, and the address each one would be mailed at —
  // "would reach 14 tenants" was never enough to catch a wrong filter.
  app.post("/api/admin/broadcast/preview", verifySuperAdmin, async (req: any, res: Response) => {
    try {
      const targets = await resolveAudience(sb, readAudience(req.body || {}));
      res.json({
        dry_run: true,
        channel: "email",
        sender: FROM_ADDRESS(),
        channel_ready: !!process.env.RESEND_API_KEY,
        recipients: targets,
        counts: {
          total:    targets.length,
          reachable: targets.filter(t => t.state === "ready").length,
          no_email:  targets.filter(t => t.state === "no_email").length,
        },
        over_limit: targets.length > MAX_RECIPIENTS ? MAX_RECIPIENTS : null,
      });
    } catch (e: any) {
      console.error("[broadcast preview]", e?.message || e);
      res.status(500).json({ error: e?.message || "preview failed" });
    }
  });

  app.post("/api/admin/broadcast/send", verifySuperAdmin, async (req: any, res: Response) => {
    const key = process.env.RESEND_API_KEY;
    const subject = String(req.body?.subject || "").trim().slice(0, MAX_SUBJECT);
    const message = String(req.body?.message || "").trim().slice(0, MAX_MESSAGE);
    const dryRun  = !!req.body?.dry_run;
    const force   = !!req.body?.force;
    const audience = readAudience(req.body || {});

    if (message.length < 10) return res.status(400).json({ error: "message required (10+ characters)" });
    if (!subject)            return res.status(400).json({ error: "subject required" });
    if (!key && !dryRun) {
      // Same honesty as the 501 this replaces: no key, no channel, no claim.
      return res.status(503).json({ error: "RESEND_API_KEY is not set on the API server — nothing was sent." });
    }

    const lockKey = sendKey(req.user?.id || "?", subject, message, audience);
    const now = Date.now();
    for (const [k, t] of recentSends) if (now - t > RESEND_LOCK_MS) recentSends.delete(k);
    if (!dryRun && !force && recentSends.has(lockKey)) {
      return res.status(409).json({
        error: "This exact broadcast was sent in the last two minutes. Re-send with force:true if that was deliberate.",
      });
    }

    try {
      const targets = await resolveAudience(sb, audience);
      if (targets.length > MAX_RECIPIENTS) {
        return res.status(400).json({
          error: `${targets.length} recipients exceeds the ${MAX_RECIPIENTS} ceiling for one broadcast. Narrow the audience.`,
        });
      }
      if (dryRun) {
        return res.json({
          dry_run: true, channel: "email", sender: FROM_ADDRESS(), subject,
          recipients: targets,
          counts: { total: targets.length, reachable: targets.filter(t => t.state === "ready").length,
                    no_email: targets.filter(t => t.state === "no_email").length },
        });
      }
      if (!targets.some(t => t.state === "ready")) {
        return res.status(400).json({ error: "No tenant in this audience has an owner email — nothing was sent." });
      }

      recentSends.set(lockKey, Date.now());
      const startedAt = new Date().toISOString();
      await deliver(targets, subject, message, key!);

      const counts = {
        sent:     targets.filter(t => t.state === "sent").length,
        failed:   targets.filter(t => t.state === "failed").length,
        no_email: targets.filter(t => t.state === "no_email").length,
        total:    targets.length,
      };
      console.log(`[broadcast] "${subject}" sent=${counts.sent} failed=${counts.failed} no_email=${counts.no_email}`);

      // The audit row records what was DELIVERED, per tenant — the old one
      // recorded an intention. Capped at 200 entries so one broadcast cannot
      // write a megabyte of jsonb; the counts stay exact either way.
      const audit = {
        admin_user_id: req.user?.id,
        action: "broadcast_sent",
        metadata: {
          channel: "email", subject, message,
          audience, counts, started_at: startedAt,
          recipients: targets.slice(0, 200).map(t => ({
            tenant_id: t.tenant_id, tenant: t.tenant_name, email: t.email,
            state: t.state, error: t.error || null,
          })),
          recipients_truncated: Math.max(0, targets.length - 200),
        },
        ip_address: req.ip,
      };
      const { data: auditRow, error: auditErr } = await sb.from("admin_audit_log")
        .insert(audit).select("id").maybeSingle();
      if (auditErr) console.error("[broadcast] audit:", auditErr.message);

      await persistBroadcast(sb, {
        admin_user_id: req.user?.id, subject, message, audience, counts,
        audit_id: auditRow?.id || null, targets,
      });

      res.json({
        ok: counts.failed === 0,
        channel: "email", subject, counts,
        recipients: targets.map(t => ({
          tenant_id: t.tenant_id, tenant: t.tenant_name, email: t.email,
          state: t.state, error: t.error || null,
        })),
      });
    } catch (e: any) {
      console.error("[broadcast send]", e?.message || e);
      res.status(500).json({ error: e?.message || "broadcast failed" });
    }
  });

  /**
   * What was actually sent, and to whom.
   *
   * Reads the broadcasts tables (migration 057) when they exist and falls
   * back to the admin_audit_log rows when they do not — the send writes both,
   * so a database missing the migration still has a readable history rather
   * than an empty screen.
   */
  app.get("/api/admin/broadcast/history", verifySuperAdmin, async (_req: Request, res: Response) => {
    try {
      const { data, error } = await sb.from("broadcasts")
        .select("id, subject, message, audience, sent_count, failed_count, no_email_count, created_at")
        .order("created_at", { ascending: false }).limit(25);
      if (!error) {
        const ids = (data || []).map((b: any) => b.id);
        const { data: recips } = ids.length
          ? await sb.from("broadcast_recipients")
              .select("broadcast_id, tenant_id, tenant_name, email, state, error")
              .in("broadcast_id", ids)
          : { data: [] as any[] };
        return res.json({
          source: "broadcasts",
          broadcasts: (data || []).map((b: any) => ({
            ...b,
            recipients: (recips || []).filter((r: any) => r.broadcast_id === b.id),
          })),
        });
      }
      const { data: rows, error: auditErr } = await sb.from("admin_audit_log")
        .select("id, action, metadata, created_at")
        .eq("action", "broadcast_sent")
        .order("created_at", { ascending: false }).limit(25);
      if (auditErr) return res.status(500).json({ error: auditErr.message });
      res.json({
        source: "audit_log",
        note: "supabase/057_broadcasts.sql is not applied — history comes from admin_audit_log, capped at 200 recipients per send.",
        broadcasts: (rows || []).map((r: any) => ({
          id: r.id,
          subject: r.metadata?.subject, message: r.metadata?.message,
          audience: r.metadata?.audience,
          sent_count:     r.metadata?.counts?.sent ?? null,
          failed_count:   r.metadata?.counts?.failed ?? null,
          no_email_count: r.metadata?.counts?.no_email ?? null,
          created_at: r.created_at,
          recipients: (r.metadata?.recipients || []).map((x: any) => ({
            tenant_id: x.tenant_id, tenant_name: x.tenant, email: x.email,
            state: x.state, error: x.error,
          })),
        })),
      });
    } catch (e: any) {
      console.error("[broadcast history]", e?.message || e);
      res.status(500).json({ error: "history failed" });
    }
  });
}

/**
 * Second home for the per-recipient record, in its own tables.
 *
 * Best effort by design: the audit row is already written by the time this
 * runs, so a database without migration 057 loses the searchable history and
 * nothing else. A failure here must never turn a broadcast that was delivered
 * into a request that looks like it failed.
 */
async function persistBroadcast(sb: SupabaseClient, b: {
  admin_user_id: string; subject: string; message: string; audience: Audience;
  counts: { sent: number; failed: number; no_email: number; total: number };
  audit_id: string | null; targets: Target[];
}): Promise<void> {
  try {
    const { data, error } = await sb.from("broadcasts").insert({
      admin_user_id: b.admin_user_id, channel: "email",
      subject: b.subject, message: b.message, audience: b.audience,
      sent_count: b.counts.sent, failed_count: b.counts.failed,
      no_email_count: b.counts.no_email, audit_id: b.audit_id,
    }).select("id").single();
    if (error || !data) {
      if (error && !/does not exist|schema cache|relation/i.test(error.message)) {
        console.error("[broadcast] persist:", error.message);
      }
      return;
    }
    const rows = b.targets.map(t => ({
      broadcast_id: data.id, tenant_id: t.tenant_id, tenant_name: t.tenant_name,
      email: t.email, state: t.state, error: t.error || null,
      provider_message_id: t.provider_id || null,
    }));
    for (const part of chunk(rows, 200)) {
      const { error: rErr } = await sb.from("broadcast_recipients").insert(part);
      if (rErr) { console.error("[broadcast] persist recipients:", rErr.message); return; }
    }
  } catch (e: any) {
    console.error("[broadcast] persist threw:", e?.message || e);
  }
}

// ════════════════════════════════════════════════════════════
// DEMO TENANTS
// ════════════════════════════════════════════════════════════
/**
 * A demo is a tenant with a stamped expiry, and the scheduler enforces it:
 * runExpireDemos (jobs/scheduler.ts) suspends rows where is_demo = true AND
 * status = 'trial' AND demo_expires_at < now(). Two consequences drive this
 * screen:
 *
 *   1. A demo whose status is anything but 'trial' is invisible to the
 *      sweeper and will live forever. That is reported, not hidden.
 *   2. Extending an already-suspended demo has to put status back to 'trial',
 *      or the extension grants a date the sweeper will never look at again
 *      and the tenant stays switched off — an extension that does nothing.
 *
 * Every write here refuses a tenant with is_demo = false. These routes take a
 * tenant id from a URL and set expiry and status; pointed at a paying
 * customer that is a suspension.
 */
const DEMO_MAX_DAYS = 30;

function mountDemoTenants(app: Express, d: AdminExtrasDeps) {
  const { sb, verifySuperAdmin } = d;

  app.get("/api/admin/demo-tenants", verifySuperAdmin, async (_req: Request, res: Response) => {
    try {
      const { data: tenants, error } = await sb.from("tenants")
        .select("id, name, plan, status, is_demo, demo_phone, demo_expires_at, credit_minutes, created_at")
        .eq("is_demo", true).order("demo_expires_at", { ascending: true });
      if (error) return res.status(500).json({ error: error.message });

      const ids = (tenants || []).map((t: any) => String(t.id));
      let calls: any[] = [];
      if (ids.length) {
        calls = await pageAll(sb, (from, to) => sb.from("calls")
          .select("tenant_id, duration_seconds, created_at")
          .in("tenant_id", ids).order("id").range(from, to));
      }

      const now = Date.now();
      const rows = (tenants || []).map((t: any) => {
        const mine = calls.filter(c => String(c.tenant_id) === String(t.id));
        const seconds = mine.reduce((s, c) => s + (Number(c.duration_seconds) || 0), 0);
        const last = mine.reduce<string | null>(
          (a, c) => (!a || String(c.created_at) > a ? String(c.created_at) : a), null);
        const expiresAt = t.demo_expires_at ? Date.parse(t.demo_expires_at) : NaN;
        const expired = Number.isFinite(expiresAt) && expiresAt < now;
        return {
          id: String(t.id),
          name: t.name,
          plan: t.plan,
          status: t.status,
          demo_phone: t.demo_phone,
          created_at: t.created_at,
          expires_at: t.demo_expires_at,
          expires_at_ist: istStamp(t.demo_expires_at),
          expires_in: ago(t.demo_expires_at, now),
          expired,
          // The sweeper only ever looks at status = 'trial'. Anything else is
          // a demo that has quietly become permanent.
          swept_by_scheduler: t.status === "trial",
          calls_total: mine.length,
          minutes_used: Math.ceil(seconds / 60),
          last_call_at: last,
          last_call_ist: istStamp(last),
          credit_minutes: Math.max(0, Math.round(Number(t.credit_minutes ?? 0))),
        };
      });

      res.json({
        demos: rows,
        counts: {
          total:   rows.length,
          live:    rows.filter(r => !r.expired && r.status !== "suspended").length,
          expired: rows.filter(r => r.expired).length,
          unswept: rows.filter(r => r.expired && !r.swept_by_scheduler).length,
        },
      });
    } catch (e: any) {
      console.error("[demo list]", e?.message || e);
      res.status(500).json({ error: e?.message || "demo list failed" });
    }
  });

  app.post("/api/admin/demo-tenants/:id/extend", verifySuperAdmin, async (req: any, res: Response) => {
    const days = Math.min(Math.max(Number(req.body?.days) || 7, 1), DEMO_MAX_DAYS);
    try {
      const { data: t, error } = await sb.from("tenants")
        .select("id, name, is_demo, status, demo_expires_at").eq("id", req.params.id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!t) return res.status(404).json({ error: "Tenant not found" });
      if (!t.is_demo) return res.status(400).json({ error: "Not a demo tenant — refusing to change its expiry" });

      // Extend from whichever is later: now, or an expiry still in the future.
      // Extending from a date that has already passed hands out a shorter
      // demo than the number of days the operator typed.
      const base = Math.max(Date.now(), Date.parse(t.demo_expires_at || "") || 0);
      const capped = Math.min(base + days * 86400_000, Date.now() + DEMO_MAX_DAYS * 86400_000);
      const expires = new Date(capped).toISOString();

      const patch: Record<string, any> = { demo_expires_at: expires };
      // Without this the extension is cosmetic: the sweeper ignores anything
      // that is not 'trial', so a suspended demo stays off with a future date.
      if (t.status === "suspended") patch.status = "trial";

      const { error: upErr } = await sb.from("tenants").update(patch).eq("id", t.id).eq("is_demo", true);
      if (upErr) return res.status(500).json({ error: upErr.message });

      await sb.from("admin_audit_log").insert({
        admin_user_id: req.user?.id, action: "demo_tenant_extended",
        target_tenant_id: t.id,
        metadata: { days, from: t.demo_expires_at, to: expires, reactivated: patch.status === "trial" },
        ip_address: req.ip,
      }).then((r: any) => r.error && console.error("[demo] audit:", r.error.message));

      res.json({ ok: true, expires_at: expires, expires_at_ist: istStamp(expires),
                 reactivated: patch.status === "trial" });
    } catch (e: any) {
      console.error("[demo extend]", e?.message || e);
      res.status(500).json({ error: e?.message || "extend failed" });
    }
  });

  app.post("/api/admin/demo-tenants/:id/expire", verifySuperAdmin, async (req: any, res: Response) => {
    try {
      const { data: t, error } = await sb.from("tenants")
        .select("id, name, is_demo, status").eq("id", req.params.id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!t) return res.status(404).json({ error: "Tenant not found" });
      if (!t.is_demo) return res.status(400).json({ error: "Not a demo tenant — refusing to suspend it" });

      const stamp = new Date().toISOString();
      const { error: upErr } = await sb.from("tenants")
        .update({ demo_expires_at: stamp, status: "suspended" })
        .eq("id", t.id).eq("is_demo", true);
      if (upErr) return res.status(500).json({ error: upErr.message });

      await sb.from("admin_audit_log").insert({
        admin_user_id: req.user?.id, action: "demo_tenant_expired",
        target_tenant_id: t.id, metadata: { name: t.name, was_status: t.status },
        ip_address: req.ip,
      }).then((r: any) => r.error && console.error("[demo] audit:", r.error.message));

      res.json({ ok: true, expires_at: stamp, status: "suspended" });
    } catch (e: any) {
      console.error("[demo expire]", e?.message || e);
      res.status(500).json({ error: e?.message || "expire failed" });
    }
  });
}

// ════════════════════════════════════════════════════════════
// PLATFORM HEALTH
// ════════════════════════════════════════════════════════════
/**
 * The 9am page.
 *
 * Operations answers "did the automations run". This answers the other
 * question an operator has at the start of the day: "is anything stuck, and
 * for how long". Every row carries three things and nothing else matters:
 * WHAT is wrong, SINCE WHEN, and THE ONE ACTION that fixes it.
 *
 * A check whose own query fails is "unknown", never "ok" — a broken check
 * that reads green is how a fault survives a morning review.
 *
 * Read-only except for one repair (close-stuck-calls). Requeueing a stuck
 * campaign recipient is deliberately NOT a button here: it makes the
 * dispatcher dial a real person's phone, which is not a thing a health board
 * should do on one click.
 */
type HealthRow = {
  id: string;
  group: string;
  title: string;
  severity: "ok" | "warn" | "critical" | "unknown";
  count: number | null;
  /** What is wrong, in a sentence an operator can act on. */
  detail: string;
  /** Since when — ISO, plus the human form the panel prints. */
  since: string | null;
  since_label: string | null;
  /** The one action that fixes it. */
  action: string;
  /** Present only when the action is safe enough to be a button. */
  action_endpoint?: string;
  items?: any[];
};

/** Six hours: the window voice-pipeline trusts a trunk fault for. */
const TRUNK_TRUST_MS = 6 * 3600_000;
const CALL_STUCK_MS  = 3600_000;        // reported
const CALL_CLOSE_MS  = 2 * 3600_000;    // safe to close
const RECIPIENT_STUCK_MS = 3600_000;
const LEASE_TTL_MS = 30 * 60_000;       // matches jobs/scheduler.ts

function mountPlatformHealth(app: Express, d: AdminExtrasDeps) {
  const { sb, verifySuperAdmin } = d;

  app.get("/api/admin/platform-health", verifySuperAdmin, async (_req: Request, res: Response) => {
    const now = Date.now();
    const dayStart = istDayStart(now);
    const rows: HealthRow[] = [];

    /** Wraps one check so a single broken query cannot blank the whole board. */
    const guard = async (id: string, fn: () => Promise<HealthRow | HealthRow[]>, group: string, title: string) => {
      try {
        const r = await fn();
        for (const x of Array.isArray(r) ? r : [r]) rows.push(x);
      } catch (e: any) {
        console.error(`[health] ${id}:`, e?.message || e);
        rows.push({
          id, group, title, severity: "unknown", count: null,
          detail: `This check could not run: ${e?.message || e}`,
          since: null, since_label: null,
          action: "Read the API server log for this check id; it is not reporting on the platform, only on itself.",
        });
      }
    };

    await Promise.all([
      // ── Trunk ────────────────────────────────────────────
      guard("trunk", async () => {
        const { data, error } = await sb.from("platform_config")
          .select("value, updated_at").eq("key", "trunk_outbound_state").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          // The dispatcher writes this only when the state CHANGES, so a
          // missing row means no outbound call has been attempted since the
          // check shipped — not that the trunk is healthy.
          return {
            id: "trunk", group: "Telephony", title: "Jio outbound trunk",
            severity: "unknown" as const, count: null,
            detail: "The dispatcher has never recorded a trunk state. It writes this key only when outbound health changes, so this means no outbound call has been attempted — not that the trunk is good.",
            since: null, since_label: null,
            action: "Start any campaign, or wait for the next dispatcher cycle, then re-check.",
          };
        }
        let parsed: any = {};
        try { parsed = JSON.parse(data.value); } catch { parsed = {}; }
        const at = parsed.at || data.updated_at || null;
        const stale = at ? now - Date.parse(at) > TRUNK_TRUST_MS : true;
        const ok = parsed.ok === true;
        return {
          id: "trunk", group: "Telephony", title: "Jio outbound trunk",
          severity: ok ? (stale ? "warn" : "ok") : "critical",
          count: null,
          detail: ok
            ? (stale
               ? `Last reported healthy ${ago(at, now)}. The voice pipeline only trusts this reading for 6 hours, so it is now back to offering transfers blind.`
               : `Healthy as of ${istStamp(at)}.`)
            : `Outbound is refusing calls — cause ${parsed.cause || "unknown"}. Nikki stops offering callers a transfer to staff while this stands${stale ? ", and the reading is now older than the 6-hour window the pipeline trusts" : ""}.`,
          since: at, since_label: ago(at, now),
          action: ok
            ? "Nothing. The dispatcher rewrites this key the moment outbound health changes."
            : "Check the Jio SBC is accepting INVITEs from the FreeSWITCH IP, then run one outbound call to clear the flag.",
        };
      }, "Telephony", "Jio outbound trunk"),

      // ── Calls stuck 'active' ─────────────────────────────
      guard("calls_stuck", async () => {
        const cutoff = new Date(now - CALL_STUCK_MS).toISOString();
        const { data, error } = await sb.from("calls")
          .select("id, tenant_id, caller_number, direction, created_at")
          .eq("status", "active").lt("created_at", cutoff)
          .order("created_at", { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        const oldest = data?.[0]?.created_at || null;
        const closable = (data || []).filter((c: any) => now - Date.parse(c.created_at) > CALL_CLOSE_MS).length;
        return {
          id: "calls_stuck", group: "Telephony", title: "Calls still 'active' after an hour",
          severity: (data?.length || 0) ? "warn" : "ok", count: data?.length || 0,
          detail: (data?.length || 0)
            ? `${data!.length} call row(s) never received a hangup. Nothing answers on them; they are rows the pipeline lost track of. ${closable} are older than two hours and safe to close.`
            : "Every call row has an ending.",
          since: oldest, since_label: ago(oldest, now),
          action: "Close them — a stuck row holds no channel, only a wrong number on the live-calls board.",
          action_endpoint: closable ? "POST /api/admin/platform-health/close-stuck-calls" : undefined,
          items: (data || []).slice(0, 25).map((c: any) => ({
            id: c.id, tenant_id: c.tenant_id, caller: c.caller_number,
            direction: c.direction, since: c.created_at, since_label: ago(c.created_at, now),
          })),
        };
      }, "Telephony", "Calls still 'active' after an hour"),

      // ── Recipients stuck mid-dispatch ────────────────────
      guard("recipients_stuck", async () => {
        const cutoff = new Date(now - RECIPIENT_STUCK_MS).toISOString();
        const out: HealthRow[] = [];
        for (const [state, label, why, fix] of [
          ["in_progress", "Campaign recipients stuck dialling",
           "picked up by the dispatcher and never resolved — the process died mid-dial",
           "Reset these rows to 'queued' in Supabase once the dispatcher is confirmed running. Not a button here: it makes the dispatcher ring a real phone."],
          ["scrubbing", "Campaign recipients stuck in DND scrub",
           "handed to the DND scrub and never answered — the scrub provider timed out or the job died",
           "Reset these rows to 'pending' in Supabase; the next cycle re-scrubs them."],
        ] as const) {
          // last_attempt_at is null for a row that stuck before its first
          // dial, so age falls back to created_at — otherwise the rows that
          // never got anywhere are the ones this check cannot see.
          const { data, error } = await sb.from("outbound_recipients")
            .select("id, campaign_id, tenant_id, phone, attempts, last_attempt_at, created_at")
            .eq("status", state).or(`last_attempt_at.lt.${cutoff},and(last_attempt_at.is.null,created_at.lt.${cutoff})`)
            .order("created_at", { ascending: true }).limit(200);
          if (error) throw new Error(error.message);
          const oldest = data?.[0] ? (data[0].last_attempt_at || data[0].created_at) : null;
          out.push({
            id: `recipients_${state}`, group: "Outreach", title: label,
            severity: (data?.length || 0) ? "warn" : "ok", count: data?.length || 0,
            detail: (data?.length || 0)
              ? `${data!.length} recipient(s) ${why}. They will never be called and never be reported as failed.`
              : "No recipient has been sitting in this state for over an hour.",
            since: oldest, since_label: ago(oldest, now),
            action: fix,
            items: (data || []).slice(0, 25).map((r: any) => ({
              id: r.id, campaign_id: r.campaign_id, tenant_id: r.tenant_id,
              phone: r.phone, attempts: r.attempts,
              since: r.last_attempt_at || r.created_at,
              since_label: ago(r.last_attempt_at || r.created_at, now),
            })),
          });
        }
        return out;
      }, "Outreach", "Campaign recipients stuck"),

      // ── Running campaigns that have not dialled today ────
      guard("campaigns_idle", async () => {
        const { data: running, error } = await sb.from("outbound_campaigns")
          .select("id, tenant_id, name, status, started_at, window_start, window_end")
          .eq("status", "running");
        if (error) throw new Error(error.message);
        if (!running?.length) {
          return {
            id: "campaigns_idle", group: "Outreach", title: "Running campaigns that have not dialled today",
            severity: "ok" as const, count: 0,
            detail: "No campaign is in the running state.",
            since: null, since_label: null,
            action: "Nothing.",
          };
        }
        const ids = running.map((c: any) => String(c.id));
        // IST midnight, not UTC: a campaign that dialled at 7am IST would look
        // idle until 5:30am the next morning if this used a UTC day.
        const { data: today, error: tErr } = await sb.from("outbound_recipients")
          .select("campaign_id, last_attempt_at")
          .in("campaign_id", ids).gte("last_attempt_at", dayStart);
        if (tErr) throw new Error(tErr.message);
        const dialled = new Set((today || []).map((r: any) => String(r.campaign_id)));
        const idle = running.filter((c: any) => !dialled.has(String(c.id)));

        // "Nothing left to dial" is not the same fault as "nothing is
        // dialling": a campaign with no pending recipients is simply finished
        // and should be marked completed, not investigated as stuck.
        const { data: pending } = await sb.from("outbound_recipients")
          .select("campaign_id").in("campaign_id", idle.map((c: any) => String(c.id)))
          .in("status", ["pending", "scrubbing", "queued"]);
        const hasWork = new Set((pending || []).map((r: any) => String(r.campaign_id)));
        const oldest = idle.reduce<string | null>(
          (a, c) => (!a || (c.started_at && String(c.started_at) < a) ? c.started_at || a : a), null);

        return {
          id: "campaigns_idle", group: "Outreach", title: "Running campaigns that have not dialled today",
          severity: idle.some((c: any) => hasWork.has(String(c.id))) ? "warn" : "ok",
          count: idle.length,
          detail: idle.length
            ? `${idle.length} campaign(s) are 'running' with no dial attempt since midnight IST. ${idle.filter((c: any) => hasWork.has(String(c.id))).length} still have recipients waiting.`
            : "Every running campaign has dialled today.",
          since: oldest, since_label: ago(oldest, now),
          action: "For one with recipients waiting: check the dispatcher is alive and the calling window covers the current hour. For one with none: mark it completed so it stops showing as running.",
          items: idle.map((c: any) => ({
            id: c.id, tenant_id: c.tenant_id, name: c.name,
            window: `${String(c.window_start || "").slice(0, 5)}–${String(c.window_end || "").slice(0, 5)}`,
            has_recipients_waiting: hasWork.has(String(c.id)),
            since: c.started_at, since_label: ago(c.started_at, now),
          })),
        };
      }, "Outreach", "Running campaigns that have not dialled today"),

      // ── Scheduler lease ──────────────────────────────────
      guard("scheduler", async () => {
        const { data, error } = await sb.from("platform_config")
          .select("value, updated_at").eq("key", "scheduler_lease").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          return {
            id: "scheduler", group: "Platform", title: "Scheduler",
            severity: "critical" as const, count: null,
            detail: "No scheduler has ever taken the lease. Reminders, embeddings, demo expiry, plan expiry and onboarding email are all not running.",
            since: null, since_label: null,
            action: "Start the scheduler container (its compose profile keeps it off by default).",
          };
        }
        let held: any = {};
        try { held = JSON.parse(data.value); } catch { held = {}; }
        // updated_at is stamped on every renew, which happens at the START of
        // each run — so it is the last run, not just the last heartbeat.
        const lastRun = data.updated_at || null;
        const age = lastRun ? now - Date.parse(lastRun) : Infinity;
        const late = age > LEASE_TTL_MS;
        return {
          id: "scheduler", group: "Platform", title: "Scheduler",
          severity: late ? "critical" : "ok", count: null,
          detail: late
            ? `Lease held by ${held.holder || "unknown"} but the last run was ${ago(lastRun, now)} — past the 30-minute lease TTL, so nothing is renewing it. Every scheduled job is stopped.`
            : `Held by ${held.holder || "unknown"}; last run ${ago(lastRun, now)} (cycle is 15 minutes).`,
          since: lastRun, since_label: ago(lastRun, now),
          action: late
            ? `Restart the scheduler on ${held.holder || "the scheduler host"}. A second host may take the lease once it expires at ${istStamp(held.expires_at) || "its TTL"}.`
            : "Nothing.",
        };
      }, "Platform", "Scheduler"),

      // ── WhatsApp failures today ──────────────────────────
      guard("wa_failed", async () => {
        // sent_at, not created_at — wa_dispatch_log has no created_at column
        // and filtering on one 400s, which would read as an empty board.
        const { data, error } = await sb.from("wa_dispatch_log")
          .select("id, tenant_id, to_number, message_type, sent_at")
          .eq("status", "failed").gte("sent_at", dayStart)
          .order("sent_at", { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        return {
          id: "wa_failed", group: "Messaging", title: "WhatsApp dispatches failed today",
          severity: (data?.length || 0) ? "warn" : "ok", count: data?.length || 0,
          detail: (data?.length || 0)
            ? `${data!.length} message(s) failed since midnight IST. Each one is a customer who was told nothing — confirmations and reminders both go this way.`
            : "No WhatsApp failure since midnight IST.",
          since: data?.[0]?.sent_at || null, since_label: ago(data?.[0]?.sent_at, now),
          action: "Operations → Failed WhatsApp messages has a Resend for each. If they all fail again, the template is unapproved or META_WA_TOKEN has expired.",
          items: (data || []).slice(0, 25).map((r: any) => ({
            id: r.id, tenant_id: r.tenant_id, to: r.to_number,
            type: r.message_type, since: r.sent_at, since_label: ago(r.sent_at, now),
          })),
        };
      }, "Messaging", "WhatsApp dispatches failed today"),

      // ── Plan minutes ─────────────────────────────────────
      guard("plan_minutes", async () => {
        const { data: tenants, error } = await sb.from("tenants")
          .select("id, name, plan, status, credit_minutes")
          .neq("status", "cancelled");
        if (error) throw new Error(error.message);

        // One paged read of the month's calls for every tenant, instead of
        // usage.ts's per-tenant paging — the rule is identical (IST month
        // start, seconds rounded UP to minutes), the query count is not.
        const monthStart = istMonthStart(now);
        const calls = await pageAll(sb, (from, to) => sb.from("calls")
          .select("tenant_id, duration_seconds").gte("created_at", monthStart)
          .order("id").range(from, to));
        const secondsBy = new Map<string, number>();
        for (const c of calls) {
          const k = String(c.tenant_id);
          secondsBy.set(k, (secondsBy.get(k) || 0) + (Number(c.duration_seconds) || 0));
        }

        const limitCache = new Map<string, number>();
        const items: any[] = [];
        for (const t of tenants || []) {
          const plan = String(t.plan || "").toLowerCase();
          if (!PAID_PLANS.includes(plan)) continue;      // trial runs on credit, not an allowance
          if (!limitCache.has(plan)) limitCache.set(plan, await planMinutes(sb, plan));
          const limit = limitCache.get(plan) || 0;
          if (limit <= 0) continue;
          const used = Math.ceil((secondsBy.get(String(t.id)) || 0) / 60);
          const pct = Math.round((used / limit) * 100);
          if (pct < 80) continue;
          const credits = Math.max(0, Math.round(Number(t.credit_minutes ?? 0)));
          items.push({
            tenant_id: String(t.id), name: t.name, plan, used, limit, pct, credits,
            // usage.ts lets a paid tenant keep calling on top-up credit past
            // the allowance. At 100% with no credit the number stops answering.
            blocked: used >= limit && credits <= 0,
          });
        }
        items.sort((a, b) => b.pct - a.pct);
        const blocked = items.filter(i => i.blocked).length;
        return {
          id: "plan_minutes", group: "Customers", title: "Tenants at or near their plan minutes",
          severity: blocked ? "critical" : items.length ? "warn" : "ok",
          count: items.length,
          detail: items.length
            ? `${items.length} paid tenant(s) are past 80% of this IST month's minutes; ${blocked} are out and have no top-up credit, so their number is not answering.`
            : "Every paid tenant is under 80% of this month's allowance.",
          since: istMonthStart(now), since_label: "this IST month",
          action: blocked
            ? "Add top-up credit (Billing → Credits) or move them up a plan; calls are being refused at the gate right now."
            : "Nothing yet — the 80% warning email goes out automatically once per month per threshold.",
          items,
        };
      }, "Customers", "Tenants at or near their plan minutes"),

      // ── Tenants with no DID ──────────────────────────────
      guard("no_did", async () => {
        const { data: tenants, error } = await sb.from("tenants")
          .select("id, name, plan, status, created_at, is_demo")
          .in("status", ["trial", "active"]).eq("is_demo", false);
        if (error) throw new Error(error.message);
        const { data: dids, error: dErr } = await sb.from("dids")
          .select("tenant_id").eq("status", "assigned").not("tenant_id", "is", null);
        if (dErr) throw new Error(dErr.message);
        const withDid = new Set((dids || []).map((d: any) => String(d.tenant_id)));
        const items = (tenants || []).filter((t: any) => !withDid.has(String(t.id)))
          .map((t: any) => ({ tenant_id: String(t.id), name: t.name, plan: t.plan,
                              status: t.status, since: t.created_at, since_label: ago(t.created_at, now) }))
          .sort((a, b) => String(a.since).localeCompare(String(b.since)));
        return {
          id: "no_did", group: "Customers", title: "Live tenants with no phone number",
          severity: items.some(i => i.status === "active") ? "critical" : items.length ? "warn" : "ok",
          count: items.length,
          detail: items.length
            ? `${items.length} tenant(s) are trial or active with no assigned DID. Nikki cannot answer for them and the dispatcher cannot dial out as them — there is no caller ID to originate with.`
            : "Every live tenant has an assigned number.",
          since: items[0]?.since || null, since_label: items[0]?.since_label || null,
          action: "Numbers → assign an available DID. If inventory is empty, add one from Jio first.",
          items,
        };
      }, "Customers", "Live tenants with no phone number"),

      // ── KYC pending ──────────────────────────────────────
      guard("kyc_pending", async () => {
        const { data, error } = await sb.from("kyc_documents")
          .select("id, tenant_id, doc_type, file_name, created_at")
          .eq("status", "pending").order("created_at", { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        const oldest = data?.[0]?.created_at || null;
        const overDay = (data || []).filter((k: any) => now - Date.parse(k.created_at) > 86400_000).length;
        return {
          id: "kyc_pending", group: "Customers", title: "KYC documents awaiting review",
          severity: overDay ? "warn" : "ok",
          count: data?.length || 0,
          detail: (data?.length || 0)
            ? `${data!.length} document(s) pending, ${overDay} waiting over 24 hours. A business cannot be given a number until these are approved, so this is an onboarding queue, not a filing task.`
            : "Nothing waiting.",
          since: oldest, since_label: ago(oldest, now),
          action: "KYC Review → approve or reject. Each row opens the document in a signed, short-lived URL.",
          items: (data || []).slice(0, 25).map((k: any) => ({
            id: k.id, tenant_id: k.tenant_id, doc_type: k.doc_type,
            file_name: k.file_name, since: k.created_at, since_label: ago(k.created_at, now),
          })),
        };
      }, "Customers", "KYC documents awaiting review"),
    ]);

    const rank = { critical: 0, warn: 1, unknown: 2, ok: 3 } as const;
    rows.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));

    res.json({
      generated_at: new Date(now).toISOString(),
      generated_at_ist: istStamp(new Date(now).toISOString()),
      ist_day_start: dayStart,
      summary: {
        critical: rows.filter(r => r.severity === "critical").length,
        warn:     rows.filter(r => r.severity === "warn").length,
        unknown:  rows.filter(r => r.severity === "unknown").length,
        ok:       rows.filter(r => r.severity === "ok").length,
      },
      rows,
    });
  });

  /**
   * The one repair on this board.
   *
   * A call row left 'active' holds nothing — no channel, no media, no cost.
   * It is a row the pipeline lost before it could write the hangup, and it
   * sits on the live-calls board forever claiming a call is in progress.
   *
   * The two-hour floor is the safety: the longest real call this platform has
   * ever carried is well under it, so this cannot close a conversation that
   * is actually happening. Marked 'failed' rather than 'completed' because
   * that is what it was — the call has no duration and no transcript, and
   * calling it completed would put a zero-second success into every count.
   * duration_seconds is untouched, so nothing here moves a minute meter.
   */
  app.post("/api/admin/platform-health/close-stuck-calls", verifySuperAdmin, async (req: any, res: Response) => {
    const minutes = Math.max(120, Math.min(Number(req.body?.older_than_minutes) || 120, 10080));
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    try {
      const { data, error } = await sb.from("calls")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("status", "active").lt("created_at", cutoff)
        .select("id, tenant_id, created_at");
      if (error) return res.status(500).json({ error: error.message });
      const closed = data || [];
      if (closed.length) {
        await sb.from("admin_audit_log").insert({
          admin_user_id: req.user?.id, action: "stuck_calls_closed",
          metadata: { older_than_minutes: minutes, count: closed.length,
                      call_ids: closed.slice(0, 100).map((c: any) => c.id) },
          ip_address: req.ip,
        }).then((r: any) => r.error && console.error("[health] audit:", r.error.message));
      }
      res.json({ ok: true, closed: closed.length, cutoff,
                 calls: closed.map((c: any) => ({ id: c.id, tenant_id: c.tenant_id, started: c.created_at })) });
    } catch (e: any) {
      console.error("[health close-stuck]", e?.message || e);
      res.status(500).json({ error: e?.message || "close failed" });
    }
  });
}

/**
 * Mount point. One line in index.ts, after verifySuperAdmin is defined:
 *
 *   mountAdminExtras(app, { sb, verifySuperAdmin });
 */
export function mountAdminExtras(app: Express, deps: AdminExtrasDeps): void {
  mountBroadcast(app, deps);
  mountDemoTenants(app, deps);
  mountPlatformHealth(app, deps);
}
