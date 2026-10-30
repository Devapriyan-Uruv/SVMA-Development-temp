import type { DaySummary, Row } from './build';
import type { LoadsSummary } from './loads';

// The same bills must give the same numbers wherever they are shown: the headline, the by-category tables, the sheets and the Loads sheets.
// This lists each figure from each place side by side and says whether they tie.

const r2 = (n: number) => Math.round(n * 100) / 100;
const total = (rows: Row[], key: string) => r2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
const near = (xs: (number | null)[], tol: number) => { const v = xs.filter((x): x is number => x != null); return v.every(x => Math.abs(x - v[0]) <= tol); };

export type TieRow = { Figure: string; Summary: number | null; 'By category / purpose': number | null; 'Sheet': number | null; 'Loads sheets': number | null; Status: string };

export function buildTieOut(sum: DaySummary, loads: LoadsSummary | null): TieRow[] {
  const h = sum.headline, rows: TieRow[] = [];
  const add = (Figure: string, a: number | null, b: number | null, c: number | null, d: number | null, tol: number) => rows.push({ Figure, Summary: a, 'By category / purpose': b, Sheet: c, 'Loads sheets': d, Status: near([a, b, c, d], tol) ? 'Ties' : 'DOES NOT TIE' });
  const cat = (xs: { n: number; amount: number }[], k: 'n' | 'amount') => r2(xs.reduce((s, x) => s + x[k], 0));
  const lp = loads ? loads.tie.purchase : null, ls = loads ? loads.tie.sales : null;
  const lsum = (t: NonNullable<typeof lp> | null, k: 'n' | 'amount') => t ? r2(t.lines[k] + t.dc[k] + t.others[k]) : null;
  const fwRow = (rows: Row[] | undefined, name: string, col: string) => { const r = rows?.find(x => String(x.Particulars) === name); return r ? Number(r[col]) || 0 : null; };
  add('Purchase bills (count)', h.purchases.n, cat(sum.byCategory.purchases, 'n'), sum.purchases.length, lsum(lp, 'n'), 0);
  add('Purchase bills (amount)', h.purchases.amount, cat(sum.byCategory.purchases, 'amount'), total(sum.purchases, 'Amount'), lsum(lp, 'amount'), 1);
  add('Sales invoices (count)', h.sales.n, cat(sum.byCategory.sales, 'n'), sum.sales.length, lsum(ls, 'n'), 0);
  add('Sales invoices (amount)', h.sales.amount, cat(sum.byCategory.sales, 'amount'), total(sum.sales, 'Amount'), lsum(ls, 'amount'), 1);
  const fw = (sec: string) => sum.firewood.filter(r => r.Section === sec);
  add('Firewood purchases (count)', h.firewoodPurchases.n, sum.byCategory.purchases.find(c => c.category === 'Firewood')?.n ?? 0, fw('Purchase').length, loads ? fwRow(loads.purchase, 'Firewood', 'Tally bills') : null, 0);
  add('Firewood sales (count)', h.firewoodSales.n, sum.byCategory.sales.find(c => c.category === 'Firewood')?.n ?? 0, fw('Sale').length, loads ? fwRow(loads.others, 'Firewood sales', 'Tally bills') : null, 0);
  add('Firewood payments (count)', h.firewoodPayments.n, null, fw('Payment').length, null, 0);
  add('Receipts (count)', h.received.n, null, sum.receipts.length, null, 0);
  add('Receipts (amount)', h.received.amount, null, total(sum.receipts, 'Amount'), null, 1);
  add('Payments from the bank (count)', h.sent.n, cat(sum.byCategory.payments, 'n'), sum.payments.length, null, 0);
  add('Payments from the bank (amount)', h.sent.amount, cat(sum.byCategory.payments, 'amount'), total(sum.payments, 'Amount'), null, 1);
  return rows;
}
