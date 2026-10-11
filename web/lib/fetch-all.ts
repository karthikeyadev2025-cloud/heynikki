// lib/fetch-all.ts — every row of a query, not the first thousand.
//
// Supabase returns at most 1,000 rows per request and says nothing when it
// stops there. Analytics asked for "all calls in the last 90 days" in one
// request; on 11 Oct the busiest account had more than that, so its 90-day
// totals had quietly stopped growing. A count that is silently capped looks
// exactly like a business that has gone quiet.
//
// `build` must return a FRESH query each time (a query can be awaited once)
// and must have a stable order, or pages can overlap.
const PAGE = 1000;

export async function fetchAll<T = any>(
  build: () => any, maxRows = 50000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}
