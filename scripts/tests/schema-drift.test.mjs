/**
 * Parser tests for scripts/schema-drift.mjs.
 *
 * The parser decides what the report says. Two failure modes, and the one
 * that matters is not the obvious one:
 *
 *   - a missed object means drift goes unreported — bad, but recoverable
 *   - a PHANTOM (declared by the parser, absent from any correct database)
 *     means the report is never empty, and a report that is never empty is
 *     a report nobody reads, which defeats the purpose of having one
 *
 * So most of these are precision tests. The end-to-end proof — parsing all
 * 53 migrations and comparing against a real PostgreSQL built from those
 * same files — was run by hand and produced 847 declared objects with zero
 * phantoms; it needs a database, so it cannot live here.
 *
 *   node --test "scripts/tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clean, parseMigrations, compare } from "../schema-drift.mjs";

function withMigrations(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const idents = (dir) => new Set(parseMigrations(dir).keys());

// ── clean() ──────────────────────────────────────────────────────────────
test("line and block comments are stripped", () => {
  assert.equal(clean("select 1; -- drop table x\n").includes("drop table"), false);
  assert.equal(clean("/* create policy p on t */ select 1").includes("create policy"), false);
});

test("a FUNCTION body is not read as declarations", () => {
  // Function bodies are full of SQL that declares nothing.
  const sql = `create or replace function f() returns void language plpgsql as $$
begin
  create table if not exists not_a_real_migration (id int);
end $$;`;
  const out = clean(sql);
  assert.equal(out.includes("not_a_real_migration"), false,
    "a table named inside a function body is not a declared table");
});

test("a do $$ block IS read — guarded ADD CONSTRAINT lives there", () => {
  const sql = `do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'c_real') then
    alter table t add constraint c_real check (x > 0);
  end if;
end $$;`;
  assert.ok(clean(sql).includes("c_real"), "guarded constraints must survive cleaning");
});

// ── the gap this work closed ─────────────────────────────────────────────
test("columns declared INLINE in a create table are picked up", () => {
  // The old parser saw only `add column if not exists`, so 440 of 546
  // columns were invisible.
  const got = withMigrations({
    "001_x.sql": `create table if not exists widgets (
      id uuid primary key default uuid_generate_v4(),
      tenant_id uuid not null references tenants(id),
      label text,
      price numeric(10,2),
      unique (tenant_id, label),
      constraint widgets_label_len check (length(label) < 80)
    );`,
  }, idents);
  assert.ok(got.has("table:widgets"));
  for (const c of ["id", "tenant_id", "label", "price"]) assert.ok(got.has(`column:widgets.${c}`), c);
  // Table-level clauses are not columns.
  assert.equal(got.has("column:widgets.unique"), false);
  assert.equal(got.has("column:widgets.constraint"), false);
  // numeric(10,2)'s comma must not split a column in two.
  assert.equal(got.has("column:widgets.2"), false);
});

test("policies, indexes, functions, triggers and RLS are declared", () => {
  const got = withMigrations({
    "001_x.sql": `
      create table if not exists t (id uuid);
      alter table t enable row level security;
      create policy "t: tenant read" on t for select using (true);
      create index if not exists idx_t_id on t(id);
      create or replace function public.helper(a int) returns int language sql as $$ select 1 $$;
      create trigger t_touch before update on t for each row execute function helper(1);`,
  }, idents);
  assert.ok(got.has("rls:t"));
  assert.ok(got.has("policy:t.t: tenant read"));
  assert.ok(got.has("index:idx_t_id"));
  assert.ok(got.has("function:helper"));
  assert.ok(got.has("trigger:t_touch"));
});

// ── precision: later statements win ──────────────────────────────────────
test("drop-then-create nets out to declared (the idempotency guard shape)", () => {
  const got = withMigrations({
    "001_x.sql": `create table if not exists t (id uuid);
      drop policy if exists "p" on t;
      create policy "p" on t for select using (true);`,
  }, idents);
  assert.ok(got.has("policy:t.p"), "the guard must not make the policy look undeclared");
});

test("a dropped column is not reported as declared", () => {
  const got = withMigrations({
    "001_x.sql": `create table if not exists t (id uuid, gone text);`,
    "002_y.sql": `alter table t drop column if exists gone;`,
  }, idents);
  assert.ok(got.has("column:t.id"));
  assert.equal(got.has("column:t.gone"), false, "dropping it later means it is not declared");
});

test("a dropped table takes its columns with it", () => {
  const got = withMigrations({
    "001_x.sql": `create table if not exists t (id uuid, name text);`,
    "002_y.sql": `drop table if exists t;`,
  }, idents);
  assert.equal(got.has("table:t"), false);
  assert.equal(got.has("column:t.name"), false);
});

test("drift:ignore retires a whole file", () => {
  const got = withMigrations({
    "001_x.sql": `-- drift:ignore\ncreate table if not exists retired_thing (id uuid);`,
  }, idents);
  assert.equal(got.has("table:retired_thing"), false);
});

test("storage.* policies are left to Supabase", () => {
  const got = withMigrations({
    "001_x.sql": `create policy "recordings_tenant_access" on storage.objects for select using (true);`,
  }, idents);
  assert.equal([...got].some(i => i.startsWith("policy:")), false,
    "schema_inventory() covers public; a storage policy would be a permanent false positive");
});

// ── compare() ────────────────────────────────────────────────────────────
test("compare reports only what is declared and absent", () => {
  const declared = new Map([["table:a", "001.sql"], ["column:a.x", "001.sql"]]);
  const live = new Set(["table:a", "table:extra"]);
  const missing = compare(declared, live);
  assert.deepEqual(missing.map(m => m.ident), ["column:a.x"]);
  // An object the database has but no migration declares is NOT drift here:
  // Supabase adds its own, and reporting them would never let the report
  // reach empty.
  assert.equal(missing.some(m => m.ident === "table:extra"), false);
});

// ── against the real migration set ───────────────────────────────────────
test("the repo's own migrations parse into a sane inventory", () => {
  const dir = new URL("../../supabase", import.meta.url).pathname;
  const declared = parseMigrations(dir);
  const got = new Set(declared.keys());
  assert.ok(declared.size > 700, `expected the full schema, got ${declared.size}`);

  // Spot-checks across every kind, each from a different migration.
  assert.ok(got.has("table:tenants"), "001");
  assert.ok(got.has("column:tenants.id"), "an inline column");
  assert.ok(got.has("table:dnd_scrub_results"), "050");
  assert.ok(got.has("column:dnd_scrub_results.expires_at"), "050 inline column");
  assert.ok(got.has("column:outbound_opt_outs.source"), "050 ALTER-added column");
  assert.ok(got.has("function:schema_inventory"), "051 — the script's own dependency");
  assert.ok(got.has("function:match_knowledge"), "the RPC nothing calls at runtime");
  assert.ok(got.has("rls:audit_log"), "RLS enablement");
  assert.ok(got.has("index:idx_dnd_scrub_phone_fresh"), "050 index");

  // No identifier should be malformed — a stray one becomes a phantom.
  for (const i of got) {
    assert.match(i, /^(table|column|policy|index|function|trigger|constraint|rls):\S/,
      `malformed identifier: ${i}`);
    assert.equal(i.includes("  "), false, `whitespace noise in: ${i}`);
  }
});
