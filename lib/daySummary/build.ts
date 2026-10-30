import type { DayBookVoucher } from '@/lib/outstanding/engine';
import { FOREIGN_NAME } from '@/lib/outstanding/engine';
import { isGroupName as isGroupParty } from './group';

// Day Summary Ledger: one day of the Tally Day Book split into purchases, sales, receipts, payments (firewood on its own), notes,
// orders and contra, each checked against the ERP (receipts, sales invoices, credit/debit notes) and against itself (is the right
// settlement paid, is the information in Tally complete). Pure: everything it needs is passed in, nothing is read or written here.

export type Row = Record<string, string | number | null>;
export type ErpNote = { ref: string; date: string; settlement: number; deduction: number; advance: number; lot: string };
export type ErpInputs = {
  /** ERP credit/debit notes per lot, oldest first (the last one is the final settlement). */
  notesByLot: Map<string, ErpNote[]>;
  notesByRef: Map<string, ErpNote>;
  receiptByRn: Map<string, { billValue: number | null; supplier: string; lot: string }>;
  invoiceByNo: Map<string, { total: number; party: string }>;
  asOf: { receipts: string; sales: string; notes: string; salesFrom?: string };
};
export type History = { paidByLot: Map<string, number> };
export type Issue = { severity: 'high' | 'medium' | 'info'; area: string; voucher: string; party: string; amount: number | null; issue: string; action: string };
export type Count = { n: number; amount: number };
export type DaySummary = {
  date: string; vouchers: number;
  headline: { sales: Count; purchases: Count; received: Count; sent: Count; netBank: number; firewoodPurchases: Count; firewoodPayments: Count; firewoodSales: Count };
  byCategory: { purchases: (Count & { category: string })[]; sales: (Count & { category: string })[]; payments: (Count & { purpose: string })[] };
  purchases: Row[]; sales: Row[]; receipts: Row[]; payments: Row[]; firewood: Row[]; notes: Row[]; orders: Row[]; contra: Row[];
  settlementCheck: Row[]; erpChecks: Row[]; hygiene: Row[]; issues: Issue[];
  management: { wentWell: string[]; attention: string[] };
  erpAsOf: ErpInputs['asOf'];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const norm = (s: string) => up(s).replace(/\s+/g, '');
const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
const BANK = /\b(bank|cc account|hdfc|kotak|sbi|icici|axis|cash)\b/i;
const FIREWOOD_NAME = /fire\s*wood|\bf\/?w\b|-\s*fw\b/i;
const LOT = /^([A-Z][A-Z0-9-]*\/\d{6,8}\/\d{2}-\d{2})/i;
export const lotOfRef = (ref: string): string | null => { const m = norm(ref).match(LOT); return m ? m[1] : null; };
const tokens = (s: string) => new Set(up(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !/^(PVT|LTD|PRIVATE|LIMITED|TRADERS|TRADING|AGENCY|COMPANY|THE|AND)$/.test(t)));
const nameClose = (a: string, b: string) => { const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return true; let c = 0; for (const t of x) if (y.has(t)) c++; return c / Math.min(x.size, y.size) >= 0.5; };

const head = (v: DayBookVoucher) => v.lines[0];
/** A voucher that belongs to the firewood business (by ledger name, voucher type or a FW/ bill reference): kept apart in the firewood figures but still counted in the purchase / sales totals. */
export const isFirewoodVoucher = (v: DayBookVoucher) => v.lines.some(l => FIREWOOD_NAME.test(l.name)) || /fire\s*wood/i.test(v.vchType) || v.lines.some(l => l.refs.some(r => /^FW\//i.test(r.ref.trim())));
const sumDr = (v: DayBookVoucher, f: (l: DayBookVoucher['lines'][number]) => boolean) => v.lines.filter(f).reduce((s, l) => s + (l.dr ?? 0), 0);
const sumCr = (v: DayBookVoucher, f: (l: DayBookVoucher['lines'][number]) => boolean) => v.lines.filter(f).reduce((s, l) => s + (l.cr ?? 0), 0);
const isBankLine = (l: { name: string }) => BANK.test(l.name);
const add = (c: Count, n: number) => { c.n++; c.amount = r2(c.amount + n); };

export function buildDaySummary(date: string, all: DayBookVoucher[], erp: ErpInputs, history: History, previous?: { sales: number; purchases: number; received: number; sent: number } | null): DaySummary {
  const V = all.filter(v => v.date === date);
  const issues: Issue[] = [];
  const issue = (severity: Issue['severity'], area: string, v: string, party: string, amount: number | null, text: string, action: string) => issues.push({ severity, area, voucher: v, party, amount: amount == null ? null : r2(amount), issue: text, action });
  const out = {
    purchases: [] as Row[], sales: [] as Row[], receipts: [] as Row[], payments: [] as Row[], firewood: [] as Row[], notes: [] as Row[], orders: [] as Row[], contra: [] as Row[],
    settlementCheck: [] as Row[], erpChecks: [] as Row[], hygiene: [] as Row[],
  };
  const head0 = { sales: { n: 0, amount: 0 }, purchases: { n: 0, amount: 0 }, received: { n: 0, amount: 0 }, sent: { n: 0, amount: 0 }, firewoodPurchases: { n: 0, amount: 0 }, firewoodPayments: { n: 0, amount: 0 }, firewoodSales: { n: 0, amount: 0 } };
  const catP = new Map<string, Count>(), catS = new Map<string, Count>(), purp = new Map<string, Count>();
  const bump = (m: Map<string, Count>, k: string, amt: number) => { const c = m.get(k) || m.set(k, { n: 0, amount: 0 }).get(k)!; add(c, amt); };
  const seen = new Map<string, string>();
  let wentOkSales = 0, wentOkPurch = 0, wentOkPay = 0, wentOkReceipt = 0, nSalesChecked = 0, nPurchChecked = 0;

  for (const v of V) {
    const t = v.vchType.trim(), h = head(v);
    const refs = v.lines.flatMap(l => l.refs);
    const hasFw = isFirewoodVoucher(v);
    const dupKey = `${t}|${up(h?.name)}|${r2((h?.cr ?? h?.dr ?? 0))}`;
    if ((h?.cr ?? h?.dr ?? 0) > 0) { if (seen.has(dupKey) && !/order|journal|contra/i.test(t)) out.hygiene.push({ check: 'Possible duplicate voucher', voucher: v.vchNo, type: t, party: h?.name ?? '', amount: h?.cr ?? h?.dr ?? 0, detail: `Same type, party and amount as voucher ${seen.get(dupKey)} on this day` }); seen.set(dupKey, v.vchNo); }
    if (!(h?.cr || h?.dr) && !/cancel/i.test(h?.name ?? '')) out.hygiene.push({ check: 'Voucher with no amount', voucher: v.vchNo, type: t, party: h?.name ?? '', amount: 0, detail: 'The voucher carries no debit or credit amount' });

    // ---- purchases -------------------------------------------------------------------------------------------------------
    if (/^purchase/i.test(t) && !/order/i.test(t)) {
      const amount = h?.cr ?? 0, category = hasFw ? 'Firewood' : t.replace(/[\s-]*ERP\s*$/i, '').replace(/[\s-]+$/, '').trim();
      const ref = h?.refs[0]?.ref ?? '';
      const rcp = erp.receiptByRn.get(norm(v.vchNo));
      let erpStatus = 'Not an ERP receipt (expense / service bill)', diff: number | null = null;
      const isGoods = /bran|coconut|palm|soya|doc|oil|copra|dorb|maize|sal fat|shea|cbs|mango/i.test(t) && !hasFw;
      if (isGoods) {
        nPurchChecked++;
        if (!rcp) { erpStatus = 'No ERP receipt found'; issue('high', 'Purchase', v.vchNo, h?.name ?? '', amount, 'Purchase booked in Tally has no ERP receipt', 'Check the ERP receipt (RN) for this lot or the voucher number'); }
        else {
          diff = rcp.billValue == null ? null : r2(amount - rcp.billValue);
          if (diff == null) erpStatus = 'ERP receipt has no bill value';
          else if (Math.abs(diff) <= 1) { erpStatus = 'Matches ERP receipt'; wentOkPurch++; }
          else { erpStatus = `Differs from ERP receipt by ${inr(diff)}`; issue('high', 'Purchase', v.vchNo, h?.name ?? '', diff, `Tally booking ${inr(amount)} differs from ERP receipt bill value ${inr(rcp.billValue!)}`, 'Correct the Tally booking or the ERP receipt'); }
          if (!nameClose(h?.name ?? '', rcp.supplier)) out.hygiene.push({ check: 'Supplier name differs from ERP', voucher: v.vchNo, type: t, party: h?.name ?? '', amount, detail: `Tally "${h?.name}" vs ERP receipt "${rcp.supplier}"` });
        }
      }
      const row: Row = { Voucher: v.vchNo, Category: category, Supplier: h?.name ?? '', 'Bill / lot reference': ref, Amount: amount, 'ERP receipt value': rcp?.billValue ?? null, 'ERP check': erpStatus, Narration: v.narration.join(' ').slice(0, 120) };
      out.purchases.push(row);
      if (hasFw) { out.firewood.push({ Section: 'Purchase', Voucher: v.vchNo, Party: h?.name ?? '', Reference: ref, Amount: amount, Detail: category }); add(head0.firewoodPurchases, amount); }
      add(head0.purchases, amount); bump(catP, category, amount);
      if (out.erpChecks.length < 5000) out.erpChecks.push({ Area: 'Purchase', Voucher: v.vchNo, Party: h?.name ?? '', 'Tally amount': amount, 'ERP amount': rcp?.billValue ?? null, Difference: diff, Result: erpStatus });
    }

    // ---- sales -----------------------------------------------------------------------------------------------------------
    else if (/^sales/i.test(t) && !/order/i.test(t)) {
      const amount = h?.dr ?? 0, category = hasFw ? 'Firewood' : t.replace(/[\s-]*ERP\s*$/i, '').replace(/[\s-]+$/, '').trim();
      const inv = erp.invoiceByNo.get(norm(v.vchNo));
      let erpStatus = hasFw ? 'Firewood sale (not in the ERP Sales Register)' : 'No ERP invoice found', diff: number | null = null;
      if (!hasFw) {
        nSalesChecked++;
        if (!inv) issue('high', 'Sales', v.vchNo, h?.name ?? '', amount, 'Sales booked in Tally has no ERP invoice', 'Check the ERP Sales Register for this invoice number');
        else {
          diff = r2(amount - inv.total);
          if (Math.abs(diff) <= 1) { erpStatus = 'Matches ERP invoice'; wentOkSales++; }
          else { erpStatus = `Differs from ERP invoice by ${inr(diff)}`; issue('high', 'Sales', v.vchNo, h?.name ?? '', diff, `Tally sales ${inr(amount)} differs from ERP invoice total ${inr(inv.total)}`, 'Correct the Tally voucher or the ERP invoice'); }
          if (!nameClose(h?.name ?? '', inv.party)) out.hygiene.push({ check: 'Customer name differs from ERP', voucher: v.vchNo, type: t, party: h?.name ?? '', amount, detail: `Tally "${h?.name}" vs ERP invoice "${inv.party}"` });
        }
      }
      out.sales.push({ Voucher: v.vchNo, Category: category, Customer: h?.name ?? '', 'Sale type': isGroupParty(h?.name ?? '') ? 'Group company' : 'Direct sale', Amount: amount, 'ERP invoice total': inv?.total ?? null, 'ERP check': erpStatus, Narration: v.narration.join(' ').slice(0, 120) });
      if (hasFw) { out.firewood.push({ Section: 'Sale', Voucher: v.vchNo, Party: h?.name ?? '', Reference: h?.refs[0]?.ref ?? '', Amount: amount, Detail: category }); add(head0.firewoodSales, amount); }
      add(head0.sales, amount); bump(catS, category, amount);
      out.erpChecks.push({ Area: 'Sales', Voucher: v.vchNo, Party: h?.name ?? '', 'Tally amount': amount, 'ERP amount': inv?.total ?? null, Difference: diff, Result: erpStatus });
    }

    // ---- receipts ---------------------------------------------------------------------------------------------------------
    else if (/^receipt/i.test(t)) {
      const party = v.lines.find(l => (l.cr ?? 0) > 0 && !isBankLine(l)) ?? h, bank = v.lines.find(l => (l.dr ?? 0) > 0 && isBankLine(l))?.name ?? '';
      const amount = sumCr(v, l => !isBankLine(l));
      const rrefs = (party?.refs ?? []);
      const kinds = rrefs.length ? [...new Set(rrefs.map(r => (/^adv/i.test(r.ref) || /advance|on account/i.test(r.kind)) ? 'Advance / on account' : 'Against invoice'))].join(' + ') : 'On account (no bill reference)';
      let erpStatus = '—';
      const checks: string[] = [];
      for (const r of rrefs) {
        if (/^adv/i.test(r.ref) || /advance|on account/i.test(r.kind)) continue;
        const inv = erp.invoiceByNo.get(norm(r.ref));
        if (!inv) { checks.push(`${r.ref}: not in the ERP Sales Register loaded${erp.asOf.salesFrom ? ` (from ${erp.asOf.salesFrom})` : ''} — an older invoice or a wrong number`); issue('info', 'Receipt', v.vchNo, party?.name ?? '', r.amount, `Receipt against ${r.ref}, which is not in the ERP Sales Register loaded${erp.asOf.salesFrom ? ` (it starts ${erp.asOf.salesFrom})` : ''}`, 'Check the invoice number if it is a recent invoice'); }
        else if (r.amount > inv.total + 1) { checks.push(`${r.ref}: receipt ${inr(r.amount)} exceeds invoice ${inr(inv.total)}`); issue('high', 'Receipt', v.vchNo, party?.name ?? '', r.amount - inv.total, `Receipt ${inr(r.amount)} is more than ERP invoice ${r.ref} (${inr(inv.total)})`, 'Check for a wrong invoice reference or an advance'); }
      }
      erpStatus = checks.length ? checks.join('; ') : rrefs.some(r => !/^adv/i.test(r.ref)) ? 'Invoice found in ERP' : '—';
      if (!checks.length && rrefs.some(r => !/^adv/i.test(r.ref))) wentOkReceipt++;
      if (!rrefs.length) { out.hygiene.push({ check: 'Receipt without a bill reference', voucher: v.vchNo, type: t, party: party?.name ?? '', amount, detail: 'Received on account — not tied to an invoice' }); }
      out.receipts.push({ Voucher: v.vchNo, Customer: party?.name ?? '', Amount: amount, Bank: bank, Reference: rrefs.map(r => r.ref).join(', '), Kind: kinds, 'ERP check': erpStatus, Narration: v.narration.join(' ').slice(0, 100) });
      add(head0.received, amount);
    }

    // ---- payments (money sent from the bank) -----------------------------------------------------------------------------------
    else if (/^payment/i.test(t)) {
      const bank = v.lines.find(l => (l.cr ?? 0) > 0 && isBankLine(l))?.name ?? '';
      const parties = v.lines.filter(l => (l.dr ?? 0) > 0 && !isBankLine(l));
      const party = parties[0] ?? h, amount = parties.reduce((s, l) => s + (l.dr ?? 0), 0) || (h?.dr ?? 0);
      const prefs = parties.flatMap(l => l.refs);
      const name = party?.name ?? '';
      const lotRefs = prefs.filter(r => lotOfRef(r.ref) && !/^FW\//i.test(r.ref.trim()));
      const purpose = hasFw || FIREWOOD_NAME.test(name) ? 'Firewood supplier' : /duty a\/c|customs/i.test(name) ? 'Import duty (HDFC Duty A/C)' : /\bBC\b|bill collection/i.test(name) ? 'Import / foreign remittance (bank BC)' : isGroupParty(name) ? 'Group company' : FOREIGN_NAME.test(name) ? 'Import / foreign supplier' : lotRefs.length ? 'Goods supplier (lot payment)' : /transport|logistic|cargo|shipping|trans\b|travels|lorry|freight|carriers/i.test(name) ? 'Freight / transport' : /bank|loan|interest|insurance|gst|tds|esi|\bpf\b/i.test(name) ? 'Bank / statutory' : prefs.length ? 'Other supplier / expense bill' : 'Other expense (no bill reference)';
      add(head0.sent, amount); bump(purp, purpose, amount);
      if (hasFw || purpose === 'Firewood supplier') { add(head0.firewoodPayments, amount); out.firewood.push({ Section: 'Payment', Voucher: v.vchNo, Party: name, Reference: prefs.map(r => r.ref).join(', '), Amount: amount, Detail: bank }); }
      // On-account is only a concern for supplier-like payments; expense ledgers (staff welfare, fees) and import duty / remittances never carry bill references.
      if (!prefs.length && !/^(Other expense|Import duty|Import \/ foreign remittance|Bank \/ statutory)/.test(purpose)) out.hygiene.push({ check: 'Payment without a bill reference', voucher: v.vchNo, type: t, party: name, amount, detail: 'Paid on account — not tied to a bill' });
      let status = '—';
      // Is the right settlement paid? Compare what has been paid on each lot (before today + today) with the ERP final settlement.
      const paidToday = new Map<string, number>();
      for (const r of lotRefs) { const k = lotOfRef(r.ref)!; paidToday.set(k, (paidToday.get(k) ?? 0) + r.amount); }
      const verdicts: string[] = [];
      for (const [lot, today] of paidToday) {
        const notes = erp.notesByLot.get(lot) ?? [];
        const before = history.paidByLot.get(lot) ?? 0, total = r2(before + today);
        const last = notes[notes.length - 1], first = notes[0];
        let result: string, diff: number | null = null;
        if (!last) result = 'No ERP settlement note yet (paid before settlement)';
        else if (last.advance > 0) result = 'Advance lot (paid up front)';
        else {
          diff = r2(total - last.settlement);
          if (Math.abs(diff) <= 2) { result = 'Right settlement paid'; wentOkPay++; }
          else if (notes.length > 1 && Math.abs(total - first.settlement) <= 2) result = `Paid on the EARLIER settlement — final ${last.ref} is higher by ${inr(-diff)} (extra to pay)`;
          else if (diff < 0) result = `Part paid / short by ${inr(-diff)}`;
          else result = `Overpaid by ${inr(diff)}`;
        }
        verdicts.push(result);
        out.settlementCheck.push({ Voucher: v.vchNo, Supplier: name, 'Lot': lot, 'Paid today': r2(today), 'Paid earlier': r2(before), 'Paid in total': total, 'ERP final note': last?.ref ?? '', 'ERP note date': last?.date ?? '', 'ERP settlement value': last?.settlement ?? null, 'Difference (paid − settlement)': diff, 'Notes for the lot': notes.length, Result: result });
        if (/EARLIER|Overpaid/.test(result)) issue('high', 'Payment', v.vchNo, name, diff, result + ` on lot ${lot}`, 'Pay / recover the difference against the final settlement');
        else if (/short by/.test(result)) issue('medium', 'Payment', v.vchNo, name, diff, `${result} on lot ${lot}`, 'Confirm whether the balance is still to be paid');
        else if (/No ERP settlement/.test(result)) issue('info', 'Payment', v.vchNo, name, today, `Lot ${lot} paid before an ERP settlement note exists`, 'Settle the lot in the ERP, then recheck');
      }
      if (verdicts.length) status = [...new Set(verdicts)].join('; ');
      out.payments.push({ Voucher: v.vchNo, Paid_to: name, Amount: amount, Bank: bank, Purpose: purpose, Reference: prefs.map(r => r.ref).slice(0, 6).join(', ') + (prefs.length > 6 ? ` +${prefs.length - 6} more` : ''), 'Settlement check': status, Narration: v.narration.join(' ').slice(0, 100) });
    }

    // ---- debit / credit notes ---------------------------------------------------------------------------------------------------
    else if (/(debit|credit) note/i.test(t)) {
      const amount = h?.dr ?? h?.cr ?? 0, ref = h?.refs[0]?.ref ?? '';
      const n = erp.notesByRef.get(norm(v.vchNo));
      let result = /ERP/i.test(t) ? 'Not in the ERP Credit/Debit Note report' : 'Sales-side note (no ERP note to compare)';
      if (n) { const d = r2(amount - n.deduction); result = Math.abs(d) <= 1 ? 'Matches the ERP note' : `Differs from the ERP note by ${inr(d)}`; if (Math.abs(d) > 1) issue('high', 'Note', v.vchNo, h?.name ?? '', d, `Tally ${t} ${inr(amount)} differs from the ERP note ${inr(n.deduction)}`, 'Correct the voucher or the ERP note'); }
      else if (/ERP/i.test(t)) issue('medium', 'Note', v.vchNo, h?.name ?? '', amount, `${t} ${v.vchNo} is not in the ERP Credit/Debit Note report`, 'Upload the latest ERP Credit/Debit Note report, or check the voucher');
      const lot = lotOfRef(ref);
      const notes = lot ? erp.notesByLot.get(lot) ?? [] : [];
      out.notes.push({ Voucher: v.vchNo, Type: t, Party: h?.name ?? '', Amount: amount, Reference: ref, 'ERP check': result, 'Re-settled lot': notes.length > 1 ? `Yes — ${notes.length} notes` : 'No', Narration: v.narration.join(' ').slice(0, 100) });
    }
    else if (/^journal/i.test(t)) {
      out.notes.push({ Voucher: v.vchNo, Type: t, Party: h?.name ?? '', Amount: h?.dr ?? h?.cr ?? 0, Reference: v.lines.flatMap(l => l.refs).map(r => r.ref)[0] ?? '', 'ERP check': /^(CDN|CCN)/i.test(v.vchNo) ? 'Charges journal of a debit / credit note' : '—', 'Re-settled lot': '', Narration: v.narration.join(' ').slice(0, 100) });
    }
    else if (/order/i.test(t)) out.orders.push({ Voucher: v.vchNo, Type: t, Party: h?.name ?? '', Amount: h?.cr ?? h?.dr ?? 0, Narration: v.narration.join(' ').slice(0, 100) });
    else if (/^contra/i.test(t)) out.contra.push({ Voucher: v.vchNo, From: v.lines.find(l => (l.cr ?? 0) > 0)?.name ?? '', To: v.lines.find(l => (l.dr ?? 0) > 0)?.name ?? '', Amount: v.lines.find(l => (l.dr ?? 0) > 0)?.dr ?? 0, Narration: v.narration.join(' ').slice(0, 100) });
  }

  const cats = <T extends string>(m: Map<string, Count>, key: T) => [...m.entries()].map(([k, c]) => ({ [key]: k, ...c }) as Count & Record<T, string>).sort((a, b) => b.amount - a.amount);
  const hl = head0;
  const bankNet = r2(hl.received.amount - hl.sent.amount);
  // ---- management view: facts only ---------------------------------------------------------------------------------------------
  const wentWell: string[] = [], attention: string[] = [];
  if (hl.sales.n) wentWell.push(`${hl.sales.n} sales invoices booked for ${inr(hl.sales.amount)}${nSalesChecked ? `; ${wentOkSales} of ${nSalesChecked} agree with the ERP invoice` : ''}.`);
  if (hl.purchases.n) wentWell.push(`${hl.purchases.n} purchases booked for ${inr(hl.purchases.amount)}${nPurchChecked ? `; ${wentOkPurch} of ${nPurchChecked} goods purchases agree with the ERP receipt` : ''}.`);
  if (hl.received.n) wentWell.push(`${inr(hl.received.amount)} received in ${hl.received.n} receipts (${wentOkReceipt} against ERP invoices); that is ${hl.sales.amount ? Math.round(hl.received.amount / hl.sales.amount * 100) : 0}% of the day's sales booked.`);
  if (wentOkPay) wentWell.push(`${wentOkPay} lot payment${wentOkPay === 1 ? '' : 's'} equal the ERP final settlement.`);
  if (hl.sent.n) wentWell.push(`${inr(hl.sent.amount)} sent from the bank in ${hl.sent.n} payments; net bank movement ${bankNet >= 0 ? '+' : '−'}${inr(bankNet)}.`);
  if (hl.firewoodPurchases.n || hl.firewoodPayments.n) wentWell.push(`Firewood: ${hl.firewoodPurchases.n} purchase${hl.firewoodPurchases.n === 1 ? '' : 's'} (${inr(hl.firewoodPurchases.amount)}) and ${hl.firewoodPayments.n} payment${hl.firewoodPayments.n === 1 ? '' : 's'} (${inr(hl.firewoodPayments.amount)}).`);
  if (previous) { const cmp = (n: number, p: number) => (p ? `${n >= p ? '+' : '−'}${Math.round(Math.abs(n - p) / p * 100)}%` : 'n/a'); wentWell.push(`Compared with the previous day in the ledger: sales ${cmp(hl.sales.amount, previous.sales)}, purchases ${cmp(hl.purchases.amount, previous.purchases)}, received ${cmp(hl.received.amount, previous.received)}, sent ${cmp(hl.sent.amount, previous.sent)}.`); }
  const by = (a: string, sev?: Issue['severity']) => issues.filter(i => i.area === a && (!sev || i.severity === sev));
  const money = (xs: Issue[]) => inr(xs.reduce((s, i) => s + Math.abs(i.amount ?? 0), 0));
  for (const [area, label] of [['Payment', 'payment'], ['Purchase', 'purchase'], ['Sales', 'sales'], ['Receipt', 'receipt'], ['Note', 'debit / credit note']] as const) {
    const xs = by(area).filter(i => i.severity !== 'info'); if (xs.length) attention.push(`${xs.length} ${label} issue${xs.length === 1 ? '' : 's'} (${money(xs)}): ${xs.slice(0, 2).map(i => `${i.voucher} ${i.party.slice(0, 22)} — ${i.issue}`).join(' | ')}${xs.length > 2 ? ' …' : ''}`);
  }
  const infoPay = issues.filter(i => i.severity === 'info' && i.area === 'Payment'); if (infoPay.length) attention.push(`${infoPay.length} lot${infoPay.length === 1 ? '' : 's'} paid before an ERP settlement note exists (${money(infoPay)}).`);
  const infoRcp = issues.filter(i => i.severity === 'info' && i.area === 'Receipt'); if (infoRcp.length) wentWell.push(`${infoRcp.length} receipt${infoRcp.length === 1 ? '' : 's'} (${money(infoRcp)}) are against invoices older than the ERP Sales Register loaded, so they were not checked against the ERP.`);
  const onAcc = out.hygiene.filter(h => /without a bill reference/.test(String(h.check))); if (onAcc.length) attention.push(`${onAcc.length} payment/receipt${onAcc.length === 1 ? '' : 's'} on account with no bill reference (${inr(onAcc.reduce((s, h) => s + Number(h.amount || 0), 0))}).`);
  const dups = out.hygiene.filter(h => /duplicate/i.test(String(h.check))); if (dups.length) attention.push(`${dups.length} possible duplicate voucher${dups.length === 1 ? '' : 's'}.`);
  if (!attention.length) wentWell.push('No exceptions found in today\'s checks.');
  return {
    date, vouchers: V.length, headline: { ...hl, netBank: bankNet }, byCategory: { purchases: cats(catP, 'category') as any, sales: cats(catS, 'category') as any, payments: cats(purp, 'purpose') as any },
    ...out, issues: issues.sort((a, b) => ({ high: 0, medium: 1, info: 2 }[a.severity] - { high: 0, medium: 1, info: 2 }[b.severity]) || (Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))),
    management: { wentWell, attention }, erpAsOf: erp.asOf,
  };
}
