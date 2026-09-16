#!/usr/bin/env node
// Fail if a migration cannot be run twice.
//
// Written after eight of the fifty-two files in supabase/ turned out to
// error on a second apply — all of them on CREATE POLICY or ADD CONSTRAINT,
// neither of which has an IF NOT EXISTS form.
//
// Why that matters here specifically: these files are applied by pasting
// them into the Supabase SQL editor. When nobody is certain whether a file
// was applied, the natural check is to paste it again — and migration 033
// exists precisely because 013 had never been applied and no one noticed
// for weeks. A file that errors halfway through a second run makes that
// check dangerous, because it stops after doing part of its work.
//
// Static, so it needs no database and runs in a second. It cannot prove a
// migration is idempotent; it catches the two shapes that actually broke.
//
//   node scripts/check-migrations.mjs        (exit 1 on any finding)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");
const findings = [];

// ── Two files may not claim the same number ──
//
// 016 and 017 each had two files for months. Nothing broke, because the
// apply order happened to fall out of the filenames alphabetically and the
// dependencies happened to agree with that — but "happened to" is the
// whole problem: the order was luck, not a decision, and any runner
// written against these files would have had to guess. Prose in the code
// that said "migration 017" could not say which one it meant.
//
// Where a number genuinely covers two files, suffix them (016a, 016b) so
// the pair stays visible and the order is explicit.
{
  const byNumber = new Map();
  for (const f of readdirSync(DIR).filter(n => n.endsWith(".sql"))) {
    const m = /^(\d+)([a-z]?)_/.exec(f);
    if (!m) { findings.push(`${f}: name must start with NNN_ or NNNx_`); continue; }
    const key = m[1] + m[2];              // "016a" and "016b" are distinct
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(f);
  }
  for (const [key, files] of byNumber) {
    if (files.length > 1) {
      findings.push(`duplicate migration number ${key}: ${files.sort().join(", ")} — ` +
        `suffix them (${key}a, ${key}b) so the apply order is explicit`);
    }
  }
}

for (const file of readdirSync(DIR).filter(n => n.endsWith(".sql")).sort()) {
  const body = readFileSync(join(DIR, file), "utf8");

  // Strip line comments so a policy name quoted inside prose does not count
  // as a guard, and a commented-out CREATE does not count as a violation.
  const sql = body.replace(/--[^\n]*/g, "");

  // ── CREATE POLICY needs a matching DROP POLICY IF EXISTS ──
  const dropped = new Set(
    [...sql.matchAll(/drop\s+policy\s+if\s+exists\s+"?(.+?)"?\s+on\b/gis)]
      .map(m => m[1].trim().toLowerCase()));
  for (const m of sql.matchAll(/create\s+policy\s+"?(.+?)"?\s*\n?\s*on\s+([\w."]+)/gis)) {
    const name = m[1].trim().toLowerCase();
    if (!dropped.has(name)) {
      findings.push(`${file}: policy "${m[1].trim()}" on ${m[2]} — ` +
        `add: drop policy if exists "${m[1].trim()}" on ${m[2]};`);
    }
  }

  // ── ADD CONSTRAINT needs either a DROP ... IF EXISTS or a
  //    do $$ ... if not exists (select 1 from pg_constraint ...) guard ──
  const droppedCons = new Set(
    [...sql.matchAll(/drop\s+constraint\s+if\s+exists\s+"?(\w+)"?/gi)]
      .map(m => m[1].toLowerCase()));
  const guarded = new Set(
    [...sql.matchAll(/pg_constraint\s+where\s+conname\s*=\s*'(\w+)'/gi)]
      .map(m => m[1].toLowerCase()));
  for (const m of sql.matchAll(/add\s+constraint\s+"?(\w+)"?/gi)) {
    const name = m[1].toLowerCase();
    if (!droppedCons.has(name) && !guarded.has(name)) {
      findings.push(`${file}: constraint ${m[1]} — wrap in ` +
        `do $$ begin if not exists (select 1 from pg_constraint where conname = '${m[1]}') then ... end if; end $$;`);
    }
  }

  // ── CREATE TABLE / INDEX / TRIGGER / TYPE without a guard ──
  for (const m of sql.matchAll(/create\s+table\s+(?!if\s+not\s+exists)"?([\w."]+)/gi))
    findings.push(`${file}: create table ${m[1]} — needs IF NOT EXISTS`);
  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?!if\s+not\s+exists)"?([\w."]+)/gi))
    findings.push(`${file}: create index ${m[1]} — needs IF NOT EXISTS`);
  for (const m of sql.matchAll(/create\s+trigger\s+"?(\w+)"?/gi)) {
    const re = new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+"?${m[1]}"?`, "i");
    if (!re.test(sql)) findings.push(`${file}: trigger ${m[1]} — needs a preceding DROP TRIGGER IF EXISTS`);
  }
}

if (findings.length) {
  console.error(`Migrations that would fail on a second apply (${findings.length}):\n`);
  for (const f of findings) console.error("  " + f);
  console.error("\nEvery file in supabase/ must survive being applied twice.");
  process.exit(1);
}
console.log("All migrations look safe to re-apply.");
