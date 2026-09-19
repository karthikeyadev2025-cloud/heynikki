/**
 * Backup — a copy of the business data that is not inside Supabase.
 *
 * WHY THIS EXISTS
 * There is no backup of our own. Everything a customer has ever bought lives
 * in one Supabase project: which businesses exist, which phone number belongs
 * to whom, every appointment and lead a caller produced, and the credit
 * ledger that says what has been paid for. The plan's own backup policy is
 * unverified, and "the provider probably has one" is not a restore — it is a
 * support ticket opened on the worst day of the year.
 *
 * A dropped table, a bad migration or an `update ... ` with the where clause
 * lost is a ten-second event. Without this file the only recovery is asking
 * the customers what their appointments were.
 *
 * WHAT IT WRITES
 * Newline-delimited JSON, one file per table, gzipped, to R2 under
 * backups/YYYY-MM-DD/. NDJSON on purpose: a single `[` ... `]` array has to
 * parse whole before anything can be read out of it, and the one time you
 * open a backup is the time something is already corrupt. NDJSON restores
 * line by line and survives a truncated object at the end of the file.
 *
 * TRANSCRIPTS ARE INCLUDED, deliberately. They are the bulky column and the
 * obvious thing to drop — but a call row without its transcript is a row that
 * says a call happened and nothing about what was agreed, which is the part a
 * business would actually be hurt by losing. The entire database is ~250 rows
 * and the whole gzipped export is a few hundred kilobytes; there is nothing
 * to save yet. BACKUP_MAX_TABLE_MB guards the day that stops being true — it
 * logs loudly rather than silently truncating, because a backup that quietly
 * drops rows is worse than no backup, since you believe in it.
 *
 * SECRETS ARE NOT INCLUDED. platform_config holds the Razorpay keys and
 * assorted tokens. An object store full of business data is one exposure; an
 * object store that also hands over the payment gateway is a different
 * incident entirely, and re-entering a key after a restore takes a minute.
 *
 * NO NEW DEPENDENCIES. R2 is S3, so the requests are signed here with
 * SigV4 out of node:crypto rather than pulling in the AWS SDK. boto3 exists
 * in the voice-pipeline container, but reaching R2 through an HTTP call to
 * the pipeline would make the backup depend on the process most likely to be
 * down during an incident.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { sendOwnerEmail } from "./owner-alerts";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const log = (...a: unknown[]) => console.log("[backup]", ...a);

/** The platform's own tenant; its owner hears about a failed backup. */
const PLATFORM_TENANT_ID = "fe11adc0-0b4a-4e2a-9232-008caa650dff";

/** Idempotency marker. platform_config already carries the scheduler lease,
 *  so a day-stamp lives happily beside it and needs no migration. */
const MARKER_KEY = "backup_last_run";

/**
 * 02:30 IST, and the hour after it.
 *
 * The window rather than an instant because the scheduler ticks every 15
 * minutes and a tick can be missed — a container restart, a slow run, a host
 * that was rebooted at 02:28. An hour of catch-up means one skipped tick does
 * not cost a day's backup. The day marker stops the extra ticks doing
 * anything.
 *
 * 02:30 IST is the quietest point of the day on this stack: no business is
 * taking calls, the retention purge has finished, and the export's Supabase
 * reads are not competing with a live conversation.
 */
const WINDOW_FROM_MIN = 2 * 60 + 30;
const WINDOW_TO_MIN   = 3 * 60 + 30;

/** Days of backups kept in R2. Thirty is the point where a mistake made on a
 *  Friday and noticed at the next month-end close is still recoverable. */
const RETAIN_DAYS = 30;

/** Rows per PostgREST page. Its hard ceiling is 1000; a page that asks for
 *  more silently gets 1000 back, which is how an export convinces itself it
 *  finished. */
const PAGE = 1000;

/** Shout if one table's gzipped export passes this. Not a truncation — a
 *  signal that this file's "just gzip it in memory" assumption has expired. */
const MAX_TABLE_MB = Number(process.env.BACKUP_MAX_TABLE_MB || 256);

/**
 * The tables whose loss would actually hurt, and the column each is paged by.
 *
 * Paging needs a stable total order or rows move between pages while the
 * export runs and some are copied twice while others are missed. Every table
 * here has a uuid primary key except platform_config, which is keyed by its
 * text key.
 *
 * Deliberately NOT here: wa_dispatch_log, audit_log, call_quality,
 * outbound_recipients and the rest of the derived or replayable tables. They
 * are large, they are logs, and none of them is something a customer would
 * notice missing after a restore. Backing up everything is how a backup
 * becomes too slow to run and too big to read.
 */
const TABLES: { name: string; order: string }[] = [
  { name: "tenants",           order: "id" },
  { name: "tenant_users",      order: "id" },
  { name: "voice_profiles",    order: "id" },
  { name: "dids",              order: "id" },
  { name: "calls",             order: "id" },
  { name: "appointments",      order: "id" },
  { name: "leads",             order: "id" },
  { name: "orders",            order: "id" },
  { name: "credit_ledger",     order: "id" },
  { name: "outbound_opt_outs", order: "id" },
  { name: "tenant_whatsapp",   order: "id" },
  { name: "platform_config",   order: "key" },
];

/**
 * platform_config keys whose VALUE never leaves the database.
 *
 * Matched on the key name rather than a hand-kept list, because the list is
 * what goes stale: the next person to add `razorpay_webhook_secret` will not
 * come back and edit an array in a backup job.
 */
const SECRET_KEY_RE = /^razorpay_|secret|token|password|api_?key|private/i;

export type BackupResult = {
  ran: boolean;
  date: string;
  /** table -> rows exported */
  rows: Record<string, number>;
  bytes: number;
  deletedOldDays: number;
  error?: string;
};

/* ── IST helpers ────────────────────────────────────────────── */

function istMinutesNow(now = Date.now()): number {
  const d = new Date(now + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The IST calendar day a backup is filed under. */
function istDate(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/* ── R2, signed with SigV4 from node:crypto ─────────────────── */

type R2 = { endpoint: string; bucket: string; access: string; secret: string };

function r2Config(): R2 | null {
  const account = process.env.CF_ACCOUNT_ID || "";
  const access  = process.env.R2_ACCESS_KEY_ID || "";
  const secret  = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket  = process.env.R2_BUCKET || "heynikki-recordings";
  if (!account || !access || !secret) return null;
  return { endpoint: `https://${account}.r2.cloudflarestorage.com`, bucket, access, secret };
}

const sha256hex = (b: crypto.BinaryLike) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k: crypto.BinaryLike | crypto.KeyObject, d: string) =>
  crypto.createHmac("sha256", k as any).update(d).digest();

/** RFC 3986, which is stricter than encodeURIComponent about ! * ' ( ) — a
 *  mismatch between what we sign and what we send is a 403 that looks like
 *  bad credentials. */
function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * One signed S3 request against R2.
 *
 * Path-style (`/<bucket>/<key>`), which Cloudflare documents for its S3 API
 * and which avoids depending on a DNS name per bucket. Region is literally
 * "auto" for R2; it is part of the signing scope, not a location.
 *
 * Returns the raw body so the caller can parse ListObjectsV2's XML, and
 * throws on a non-2xx with the body included — an S3 error is XML with the
 * actual reason in it, and swallowing it leaves "backup failed: 403".
 */
async function r2Request(
  cfg: R2, method: "PUT" | "GET" | "DELETE", key: string,
  opts: { body?: Buffer; query?: Record<string, string>; contentType?: string } = {},
): Promise<string> {
  const body = opts.body ?? Buffer.alloc(0);
  const now  = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20260919T103000Z
  const dateStamp = amzDate.slice(0, 8);
  const host      = new URL(cfg.endpoint).host;
  const payloadHash = sha256hex(body);

  const canonicalUri = "/" + [cfg.bucket, ...key.split("/")].filter(Boolean).map(uriEncode).join("/");
  const canonicalQuery = Object.entries(opts.query || {})
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (opts.contentType) headers["content-type"] = opts.contentType;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map(h => `${h}:${headers[h].trim()}\n`).join("");

  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  const kDate    = hmac(`AWS4${cfg.secret}`, dateStamp);
  const kRegion  = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${cfg.access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${cfg.endpoint}${canonicalUri}${canonicalQuery ? "?" + canonicalQuery : ""}`;
  const res = await fetch(url, {
    method,
    headers,
    body: method === "PUT" ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 ${method} ${key} -> ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

async function r2Put(cfg: R2, key: string, body: Buffer, contentType: string): Promise<void> {
  await r2Request(cfg, "PUT", key, { body, contentType });
}

/** Every key under a prefix, following continuation tokens. XML parsed with
 *  a regex rather than a dependency: the two elements we need are simple and
 *  never contain nested markup. */
async function r2List(cfg: R2, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const xml = await r2Request(cfg, "GET", "", { query });
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(m[1]);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    if (!next || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = next[1];
  }
  return keys;
}

/* ── The export ─────────────────────────────────────────────── */

/**
 * Every row of one table as NDJSON, paged.
 *
 * `select("*")` on purpose: a column list here would quietly stop backing up
 * every column added after this file was written, and the failure would only
 * show up during a restore.
 */
async function exportTable(t: { name: string; order: string }): Promise<{ ndjson: string; rows: number }> {
  const lines: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(t.name).select("*")
      .order(t.order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${t.name}: ${error.message}`);
    for (const row of data || []) lines.push(JSON.stringify(redact(t.name, row)));
    if (!data || data.length < PAGE) break;
  }
  return { ndjson: lines.length ? lines.join("\n") + "\n" : "", rows: lines.length };
}

function redact(table: string, row: any): any {
  if (table !== "platform_config") return row;
  if (!SECRET_KEY_RE.test(String(row?.key || ""))) return row;
  return { ...row, value: "[redacted by backup]" };
}

/* ── Marker ─────────────────────────────────────────────────── */

async function lastRunDate(): Promise<string | null> {
  const { data, error } = await sb.from("platform_config")
    .select("value").eq("key", MARKER_KEY).maybeSingle();
  if (error) throw new Error(`marker read failed: ${error.message}`);
  if (!data) return null;
  try { return JSON.parse(data.value)?.date || null; } catch { return null; }
}

async function writeMarker(payload: object): Promise<void> {
  const { error } = await sb.from("platform_config").upsert(
    { key: MARKER_KEY, value: JSON.stringify(payload), label: "Last completed R2 backup", updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) log("marker write failed (the day's objects are already in R2):", error.message);
}

async function platformOwnerEmail(): Promise<string | null> {
  if (process.env.WATCHDOG_EMAIL_TO) return process.env.WATCHDOG_EMAIL_TO;
  try {
    const { data: t } = await sb.from("tenants")
      .select("owner_id").eq("id", PLATFORM_TENANT_ID).maybeSingle();
    if (!t?.owner_id) return null;
    const { data } = await sb.auth.admin.getUserById(String(t.owner_id));
    return data?.user?.email || null;
  } catch { return null; }
}

/* ── Retention ──────────────────────────────────────────────── */

/**
 * Delete day folders older than RETAIN_DAYS.
 *
 * Only keys that match backups/YYYY-MM-DD/ exactly. R2 holds the call
 * recordings in the same bucket, and a retention sweep that decides what to
 * delete by "anything old" is how a backup job destroys a year of audio.
 */
async function pruneOldDays(cfg: R2, today: string): Promise<number> {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RETAIN_DAYS * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  const keys = await r2List(cfg, "backups/");
  const doomed = keys.filter(k => {
    const m = /^backups\/(\d{4}-\d{2}-\d{2})\//.exec(k);
    return !!m && m[1] < cutoff;
  });
  let deleted = 0;
  const days = new Set<string>();
  for (const k of doomed) {
    try {
      await r2Request(cfg, "DELETE", k);
      deleted++;
      days.add(k.slice(8, 18));
    } catch (e: any) {
      // One undeletable object must not stop the day's backup being recorded
      // as done — it will be retried tomorrow.
      log("retention delete failed:", e?.message || e);
    }
  }
  if (deleted) log(`retention: deleted ${deleted} object(s) across ${days.size} day(s) older than ${cutoff}`);
  return days.size;
}

/* ── The run ────────────────────────────────────────────────── */

/**
 * Called on every scheduler tick; does nothing but read a clock and a marker
 * unless it is the 02:30 IST window and today has not been backed up.
 *
 * Never throws. The scheduler wraps this, but a backup job that can abort the
 * run also stops the appointment reminders — and losing a customer's reminder
 * to protect a backup is the wrong trade in both directions.
 *
 * opts.force runs it now, for testing and for the first run after a deploy.
 */
export async function runBackup(opts: { force?: boolean; date?: string } = {}): Promise<BackupResult> {
  const date = opts.date || istDate();
  const empty: BackupResult = { ran: false, date, rows: {}, bytes: 0, deletedOldDays: 0 };

  if (!opts.force) {
    const min = istMinutesNow();
    if (min < WINDOW_FROM_MIN || min >= WINDOW_TO_MIN) return empty;
    try {
      if (await lastRunDate() === date) return empty;
    } catch (e: any) {
      // The marker is the only thing stopping this running four times in the
      // window. Unreadable marker = do not run; a missed night is cheaper
      // than four full exports in an hour.
      log("skipping:", e?.message || e);
      return empty;
    }
  }

  const cfg = r2Config();
  if (!cfg) {
    log("R2 is not configured (CF_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) — nothing written");
    return { ...empty, error: "R2 not configured" };
  }

  const started = Date.now();
  const rows: Record<string, number> = {};
  let bytes = 0;

  try {
    for (const t of TABLES) {
      const { ndjson, rows: n } = await exportTable(t);
      const gz = zlib.gzipSync(Buffer.from(ndjson, "utf8"), { level: 9 });
      if (gz.length > MAX_TABLE_MB * 1024 * 1024) {
        // Everything here is held in memory before it is compressed. Past a
        // few hundred megabytes that stops being reasonable and this needs a
        // streamed export — said out loud now rather than discovered as an
        // OOM kill of the scheduler container.
        throw new Error(`${t.name} exported ${(gz.length / 1048576).toFixed(0)} MB gzipped, over BACKUP_MAX_TABLE_MB=${MAX_TABLE_MB}` +
                        ` — this job must be rewritten to stream before it can back up a table this size`);
      }
      await r2Put(cfg, `backups/${date}/${t.name}.ndjson.gz`, gz, "application/gzip");
      rows[t.name] = n;
      bytes += gz.length;
      log(`${t.name}: ${n} row(s), ${gz.length} bytes gzipped`);
    }

    // The manifest is what makes a restore checkable: it says how many rows
    // each file should yield, so `zcat calls.ndjson.gz | wc -l` either agrees
    // or tells you the object is truncated.
    const manifest = {
      date, taken_at: new Date().toISOString(), source: SUPABASE_URL,
      retain_days: RETAIN_DAYS, rows, bytes_gzipped: bytes,
      redacted: "platform_config values matching /^razorpay_|secret|token|password|api_key|private/i",
      format: "one gzipped newline-delimited JSON file per table; restore with: zcat <table>.ndjson.gz | while read l; do ... done",
    };
    await r2Put(cfg, `backups/${date}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");

    const deletedOldDays = await pruneOldDays(cfg, date);
    await writeMarker({ date, at: new Date().toISOString(), rows, bytes, seconds: Math.round((Date.now() - started) / 1000) });

    const total = Object.values(rows).reduce((a, b) => a + b, 0);
    log(`backups/${date}/ written — ${total} rows across ${TABLES.length} tables, ${bytes} bytes, ${Math.round((Date.now() - started) / 1000)}s`);
    return { ran: true, date, rows, bytes, deletedOldDays };
  } catch (e: any) {
    const msg = e?.message || String(e);
    log("FAILED:", msg);
    // Only failures are emailed. A nightly "backup succeeded" mail is read
    // for a week and filtered for a year, and then the silence when it stops
    // means nothing.
    const to = await platformOwnerEmail();
    if (to) {
      await sendOwnerEmail(to, "[Hey Nikki] Nightly backup FAILED",
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
<p><strong>The ${date} backup did not complete.</strong> There is no copy of today's data outside Supabase.</p>
<p style="color:#666">Tables written before the failure</p>
<pre style="background:#f6f6f6;padding:10px;border-radius:6px">${Object.entries(rows).map(([k, v]) => `${k}: ${v} rows`).join("\n") || "none"}</pre>
<p style="color:#666">Error</p>
<pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap">${String(msg).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</pre>
<p>First thing to check: <code>docker logs --tail 200 heynikki-scheduler | grep backup</code>, and that R2_ACCESS_KEY_ID still has write access to the bucket.</p>
</div>`);
    } else {
      log("no platform owner email — the failure was not reported to anyone");
    }
    // No marker is written, so the next tick inside the window retries.
    return { ran: false, date, rows, bytes, deletedOldDays: 0, error: msg };
  }
}
