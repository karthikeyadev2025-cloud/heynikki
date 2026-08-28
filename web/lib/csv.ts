/**
 * RFC 4180 CSV, for the import preview.
 *
 * Deliberately a copy of the server's parser in api-server/src/campaign-import.ts
 * rather than a shared package — the two run in different builds with no
 * common module boundary. If one changes the other must, and the tests that
 * matter live server-side.
 *
 * Splitting on commas is what this exists to avoid: the first row with an
 * address in it shifts every later column by one, silently, and the name
 * column starts arriving as half a street.
 */
export function parseCsvClient(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Excel writes a UTF-8 BOM; without stripping it the first header arrives
  // as "﻿phone" and no column matcher will ever see "phone".
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"')  { inQuotes = true; continue; }
    if (c === ",")  { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
