#!/usr/bin/env node
// Compare every object declared in supabase/*.sql against the live schema.
//
// Written the day two silent gaps surfaced within an hour: migration 013's
// voice_profiles columns had never been applied (breaking the setup wizard
// and website lead capture for every customer, for weeks), and the
// kyc-documents bucket had RLS with no policy. Both were invisible because
// nothing ever compared what the repo declares to what the database has.
//
// It could only ever have caught the first of those. Reaching the database
// over PostgREST, all it could ask was "does this table have this column",
// so it checked 46 tables and 106 columns and was blind to 440 further
// columns (any declared inline in a CREATE TABLE body rather than added by a
// later ALTER), 102 RLS policies, 102 functions and 142 indexes. Policies
// being unchecked is exactly why the kyc-documents case was invisible.
//
// Now it asks the database for a full inventory through the RPC added in
// migration 051, and parses the migrations properly instead of line by line.
//
// Usage: node scripts/schema-drift.mjs      (needs SUPABASE_URL + SERVICE_KEY)
// Exits 1 when drift is found, so CI or a scheduler can act on it.
//
// PRECISION OVER RECALL, deliberately. A report that is never empty is a
// report nobody reads, which defeats the purpose of having one. Where the
// parser cannot be certain what a statement declares, it stays quiet rather
// than guessing — an object silently missed is recoverable, a hundred false
// alarms are not.
import { readFileSync, readdirSync } from "node:fs";

// ── Reading SQL ──────────────────────────────────────────────────────────
/**
 * Strip comments, and blank out FUNCTION bodies.
 *
 * Function bodies are dollar-quoted and full of SQL that must not be read as
 * declarations. `do $$ ... $$` blocks are NOT blanked: the guarded
 * ADD CONSTRAINT blocks in 003, 012, 023, 028 and 042 live inside them and
 * declare real objects.
 */
export function clean(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {                       // line comment
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (two === "/*") {                       // block comment
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (sql[i] === "'") {                     // string literal, kept verbatim
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    const dq = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
    if (dq) {                                 // dollar-quoted block
      const tag = dq[0];
      const end = sql.indexOf(tag, i + tag.length);
      const body = end === -1 ? sql.slice(i + tag.length) : sql.slice(i + tag.length, end);
      // Is this a FUNCTION body? Look back past `as`/whitespace for `function`.
      const before = out.slice(-400).toLowerCase();
      const isFunctionBody = /\bfunction\b[\s\S]*$/.test(before) && !/\bdo\s*$/.test(before.trimEnd() + " ");
      const isDoBlock = /\bdo\s*$/.test(out.slice(-8).toLowerCase());
      out += isDoBlock || !isFunctionBody ? body : " ";
      i = end === -1 ? sql.length : end + tag.length;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/** Split a parenthesised CREATE TABLE body on top-level commas. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0, cur = "", inStr = false;
  for (const ch of body) {
    if (ch === "'") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Take the balanced-paren body that starts at `open`. */
function balanced(s, open) {
  let depth = 0, inStr = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return s.slice(open + 1, i); }
  }
  return null;
}

// A table-level clause, not a column.
const NOT_A_COLUMN = /^(primary|unique|foreign|check|constraint|exclude|like|partition)\b/;

/**
 * Every object the migrations declare, as `kind:name` identifiers matching
 * what schema_inventory() returns. Later statements win, so a DROP followed
 * by a CREATE (the idempotency guard pattern) leaves the object declared.
 */
export function parseMigrations(dir) {
  const declared = new Map();   // ident -> migration file
  const add = (ident, f) => declared.set(ident, f);
  const del = (ident) => declared.delete(ident);

  for (const f of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    const raw = readFileSync(dir + "/" + f, "utf8");
    // A file may declare itself retired. Migrations are history, but an
    // object from a path we have since removed would otherwise sit in this
    // report forever.
    if (/--\s*drift:ignore/i.test(raw)) continue;
    const sql = clean(raw);
    const low = sql.toLowerCase();

    // CREATE TABLE [IF NOT EXISTS] name ( … ) — table plus its inline columns.
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      const table = m[1].toLowerCase();
      add(`table:${table}`, f);
      const body = balanced(sql, m.index + m[0].length - 1);
      if (!body) continue;
      for (const part of topLevelParts(body)) {
        const t = part.trim();
        if (!t || NOT_A_COLUMN.test(t.toLowerCase())) continue;
        const col = /^"?(\w+)"?/.exec(t);
        if (col) add(`column:${table}.${col[1].toLowerCase()}`, f);
      }
    }

    // ALTER TABLE name … ADD COLUMN / DROP COLUMN / ADD CONSTRAINT / RLS.
    // One ALTER can carry several clauses, so the table is tracked as a
    // cursor across the statement the way the original parser did.
    for (const stmt of sql.split(";")) {
      const at = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt);
      if (!at) continue;
      const table = at[1].toLowerCase();
      for (const m of stmt.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi))
        add(`column:${table}.${m[1].toLowerCase()}`, f);
      for (const m of stmt.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi))
        del(`column:${table}.${m[1].toLowerCase()}`);
      for (const m of stmt.matchAll(/add\s+constraint\s+"?(\w+)"?/gi))
        add(`constraint:${m[1].toLowerCase()}`, f);
      for (const m of stmt.matchAll(/drop\s+constraint\s+(?:if\s+exists\s+)?"?(\w+)"?/gi))
        del(`constraint:${m[1].toLowerCase()}`);
      if (/enable\s+row\s+level\s+security/i.test(stmt)) add(`rls:${table}`, f);
      if (/disable\s+row\s+level\s+security/i.test(stmt)) del(`rls:${table}`);
    }

    // Policies. storage.* policies are skipped: the inventory covers the
    // public schema, and storage is Supabase's.
    for (const m of sql.matchAll(/create\s+policy\s+"?(.+?)"?\s*\n?\s*on\s+(?:public\.)?"?([\w.]+)"?/gis)) {
      const table = m[2].toLowerCase();
      if (table.includes(".")) continue;
      add(`policy:${table}.${m[1].trim().toLowerCase()}`, f);
    }
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"?(.+?)"?\s+on\s+(?:public\.)?"?([\w.]+)"?/gis)) {
      const table = m[2].toLowerCase();
      if (table.includes(".")) continue;
      // Only a DROP with no CREATE after it in this file should remove the
      // policy; the loop order handles that, since both run in file order.
      del(`policy:${table}.${m[1].trim().toLowerCase()}`);
    }
    // Re-add creates after the drops above, so the drop-then-create guard
    // pattern nets out to "declared".
    for (const m of sql.matchAll(/create\s+policy\s+"?(.+?)"?\s*\n?\s*on\s+(?:public\.)?"?([\w.]+)"?/gis)) {
      const table = m[2].toLowerCase();
      if (table.includes(".")) continue;
      add(`policy:${table}.${m[1].trim().toLowerCase()}`, f);
    }

    for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+on/gi))
      add(`index:${m[1].toLowerCase()}`, f);
    for (const m of sql.matchAll(/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi))
      del(`index:${m[1].toLowerCase()}`);

    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi))
      add(`function:${m[1].toLowerCase()}`, f);
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi))
      del(`function:${m[1].toLowerCase()}`);

    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+"?(\w+)"?/gi))
      add(`trigger:${m[1].toLowerCase()}`, f);
    for (const m of sql.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?/gi))
      del(`trigger:${m[1].toLowerCase()}`);

    for (const m of low.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/g)) {
      del(`table:${m[1]}`);
      for (const k of [...declared.keys()]) if (k.startsWith(`column:${m[1]}.`)) del(k);
    }
  }
  return declared;
}

/** What is declared but not present. */
export function compare(declared, live) {
  const missing = [];
  for (const [ident, file] of declared) if (!live.has(ident)) missing.push({ ident, file });
  return missing;
}

// ── Talking to the database ──────────────────────────────────────────────
async function fetchInventory(url, key) {
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const r = await fetch(`${url}/rest/v1/rpc/schema_inventory`, { method: "POST", headers: H, body: "{}" });
  if (r.status === 404) {
    throw new Error(
      "schema_inventory() not found. Apply supabase/051_schema_inventory.sql, " +
      "then re-run. (If you just applied it, PostgREST may still be caching its " +
      "function list — the migration ends with NOTIFY pgrst to refresh it.)");
  }
  if (!r.ok) throw new Error(`schema_inventory() returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error("schema_inventory() did not return an array");
  return new Set(rows.map(String));
}

async function main() {
  const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL_ || !KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required");
    process.exit(2);
  }
  const DIR = new global.URL("../supabase", import.meta.url).pathname;
  const declared = parseMigrations(DIR);
  const live = await fetchInventory(URL_.replace(/\/+$/, ""), KEY);

  const missing = compare(declared, live);
  const byKind = {};
  for (const ident of declared.keys()) {
    const k = ident.split(":")[0];
    byKind[k] = (byKind[k] || 0) + 1;
  }
  console.log(`schema-drift: checked ${declared.size} declared objects ` +
    `(${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})`);

  if (!missing.length) { console.log("schema-drift: no drift"); process.exit(0); }

  console.error(`\nschema-drift: ${missing.length} DECLARED BUT MISSING:`);
  const groups = new Map();
  for (const m of missing) {
    if (!groups.has(m.file)) groups.set(m.file, []);
    groups.get(m.file).push(m.ident);
  }
  for (const [file, idents] of [...groups].sort()) {
    console.error(`\n  ${file}`);
    for (const i of idents.sort()) console.error(`    ${i}`);
  }
  console.error(`\nApply the migrations above, or mark a retired one with "-- drift:ignore".`);
  process.exit(1);
}

// Only run when invoked directly, so the parser can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) await main();
