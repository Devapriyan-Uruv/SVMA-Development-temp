// PostgREST (Supabase's query layer) silently caps a single select() at
// 1000 rows unless the caller pages through with .range() — it does NOT
// error or truncate visibly, it just returns the first 1000 matching rows.
// Ordered queries over a real date range or id list (production entries,
// weighments, gate movements, ...) can easily exceed that once the table
// has more than a few weeks of data, which quietly drops the tail of the
// result (the most recent rows, if ordered ascending) with no sign anything
// is wrong — exactly the "the numbers don't look right" failure mode.
//
// Use this instead of a bare `await query` whenever the row count for the
// query's actual filters isn't provably small (a real report_date/date
// range, an unbounded id list, "all rows for this run", etc). A route that
// already sets its own .limit() for a deliberately-capped list (e.g. "last
// 300 exceptions") does not need this.
export async function fetchAllRows<T>(
  queryFactory: (rangeFrom: number, rangeTo: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await queryFactory(offset, offset + pageSize - 1);
    if (error) return { data: out, error };
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return { data: out, error: null };
}
