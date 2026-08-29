#!/usr/bin/env node
// Compare every object declared in supabase/*.sql against the live schema.
//
// Written the day two silent gaps surfaced within an hour: migration 013's
// voice_profiles columns had never been applied (breaking the setup wizard
// and website lead capture for every customer, for weeks), and the
// kyc-documents bucket had RLS with no policy. Both were invisible because
// nothing ever compared what the repo declares to what the database has.
//
// Usage: node scripts/schema-drift.mjs      (needs SUPABASE_URL + SERVICE_KEY)
// Exits 1 when drift is found, so CI or a scheduler can act on it.
import { readFileSync, readdirSync } from "node:fs";

const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required"); process.exit(2); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const DIR = new global.URL("../supabase/", import.meta.url).pathname;
const declared = new Map();   // "table.column" | "table:" -> migration file

for (const f of readdirSync(DIR).filter(n => n.endsWith(".sql")).sort()) {
  let cur = null;
  for (const raw of readFileSync(DIR + f, "utf8").split("\n")) {
    const l = raw.trim().toLowerCase().replace(/"/g, "");
    if (l.startsWith("--")) continue;
    const t = l.match(/^alter table (?:if exists )?(?:public\.)?([a-z_]+)/);
    if (t) cur = t[1];
    const ct = l.match(/^create table if not exists (?:public\.)?([a-z_]+)/);
    if (ct && ct[1] !== "public") declared.set(`${ct[1]}:`, f);
    const c = l.match(/add column if not exists ([a-z_][a-z0-9_]*)/);
    // Single-char captures are parser noise from wrapped lines, not columns.
    if (c && cur && c[1].length > 1) declared.set(`${cur}.${c[1]}`, f);
  }
}

const missing = [];
for (const [obj, file] of declared) {
  const [tbl, col] = obj.split(/[.:]/);
  const q = col ? `${tbl}?select=${col}&limit=1` : `${tbl}?select=*&limit=1`;
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H });
  if (r.status !== 200) missing.push(`${col ? `${tbl}.${col}` : `table ${tbl}`}  declared in ${file}`);
}

console.log(`schema-drift: checked ${declared.size} declared objects`);
if (!missing.length) { console.log("schema-drift: no drift"); process.exit(0); }
console.error(`schema-drift: ${missing.length} DECLARED BUT MISSING:`);
for (const m of missing) console.error("  " + m);
process.exit(1);
