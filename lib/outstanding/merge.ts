// A newer Day Book is authoritative for the dates it covers: a voucher saved earlier for one of those dates that the new file no
// longer contains was deleted or cancelled in Tally (for example the first debit note of a lot that was re-settled), and keeping it
// would deduct an amount Tally no longer deducts. The one safeguard is a partial export: if, on a date, the file holds far fewer
// bill-bearing vouchers than were saved, the file is treated as filtered (not as a record of deletions) and nothing is removed.

export const REMOVAL_MIN_SHARE = 0.8;

export function planRemovals(existing: { row_key: string; vch_date: string }[], fileKeys: Set<string>, fileCountByDate: Map<string, number>): { remove: string[]; keptDates: string[] } {
  const storedByDate = new Map<string, string[]>();
  for (const r of existing) (storedByDate.get(r.vch_date) || storedByDate.set(r.vch_date, []).get(r.vch_date)!).push(r.row_key);
  const remove: string[] = [], keptDates: string[] = [];
  for (const [date, keys] of storedByDate) {
    const missing = keys.filter(k => !fileKeys.has(k));
    if (!missing.length) continue;
    if ((fileCountByDate.get(date) || 0) >= REMOVAL_MIN_SHARE * keys.length) remove.push(...missing); else keptDates.push(date);
  }
  return { remove, keptDates: keptDates.sort() };
}
