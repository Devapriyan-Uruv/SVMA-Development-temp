import { supabaseAdmin } from '@/lib/supabase/admin';
import { FOREIGN_NAME, partyKey, type OpenBill, type PartyOutstanding, type Scope, type Side } from './engine';
import { tallyToOutstanding, type TallyReport } from './tally';
import { loadResettlements } from './resettlement';

export type Source = { kind: 'tally_bills' | 'tally_summary' | 'daybook' | 'none'; asOf: string; fileName: string };
export type OutstandingView = {
  id?: string; fileName?: string | null; createdAt?: string; periodFrom: string; periodTo: string; vouchers: number; warnings: string[];
  parties: PartyOutstanding[]; bills: OpenBill[]; lastUpload?: unknown; ranges?: { from: string; to: string }[];
  sources: Record<Side, Source>;
  /** Re-settled lots and credit notes per party (supplier side), from the ERP Credit/Debit Note report. */
  resettlement?: Record<string, { lots: number; change: number; creditNotes: number; creditNoteAmount: number }>;
};

/** What the screen shows. For each side (creditors / debtors) the newest Tally pending-bills export wins, then the newest Tally
 * group summary, then the figures worked out from the uploaded Day Books. */
export async function buildView(): Promise<OutstandingView | null> {
  const db = supabaseAdmin();
  const { data: snap, error } = await db.from('outstanding_snapshots').select('id,file_name,period_from,period_to,voucher_count,summary,warnings,parties,bills,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const { data: reports, error: repErr } = await db.from('outstanding_tally_reports').select('side,kind,as_of,file_name,rows,created_at').order('created_at', { ascending: false }).limit(12);
  // The table may not exist yet (migration not run): behave as if no Tally report had been uploaded.
  const tally = repErr ? [] : reports || [];
  if (!snap && !tally.length) return null;

  const dayBookParties: PartyOutstanding[] = (snap?.parties as PartyOutstanding[]) || [];
  const dayBookBills: OpenBill[] = (snap?.bills as OpenBill[]) || [];
  // A party's Local / International label comes from what the Day Book showed about it; a name that looks foreign is the fallback.
  const known = new Map(dayBookParties.map(p => [partyKey(p.party), p.scope]));
  const scopeOf = (name: string): Scope => known.get(partyKey(name)) || (FOREIGN_NAME.test(name) ? 'international' : 'local');

  const parties: PartyOutstanding[] = [];
  const bills: OpenBill[] = [];
  const sources = {} as Record<Side, Source>;
  for (const side of ['creditor', 'debtor'] as Side[]) {
    const pick = (kind: 'bills' | 'summary') => tally.find(t => t.side === side && t.kind === kind);
    const t = pick('bills') || pick('summary');
    if (t) {
      const r = { kind: t.kind, side, asOf: t.as_of, rows: t.rows } as TallyReport;
      const v = tallyToOutstanding(r, scopeOf);
      parties.push(...v.parties); bills.push(...v.bills);
      sources[side] = { kind: t.kind === 'bills' ? 'tally_bills' : 'tally_summary', asOf: t.as_of, fileName: t.file_name || '' };
    } else if (snap) {
      parties.push(...dayBookParties.filter(p => p.side === side)); bills.push(...dayBookBills.filter(b => b.side === side));
      sources[side] = { kind: 'daybook', asOf: snap.period_to, fileName: snap.file_name || '' };
    } else sources[side] = { kind: 'none', asOf: '', fileName: '' };
  }
  const asOfs = Object.values(sources).map(s => s.asOf).filter(Boolean).sort();
  const usesDayBook = Object.values(sources).some(s => s.kind === 'daybook');
  const resettlement = await loadResettlements(bills).then(d => d.byParty).catch(() => ({}));
  return {
    id: snap?.id, fileName: snap?.file_name, createdAt: snap?.created_at,
    periodFrom: snap?.period_from || asOfs[0] || '', periodTo: asOfs[asOfs.length - 1] || snap?.period_to || '',
    vouchers: snap?.voucher_count || 0, warnings: usesDayBook ? ((snap?.warnings as string[]) || []) : [],
    parties, bills, lastUpload: snap?.summary?.lastUpload || null, ranges: snap?.summary?.ranges || [], sources, resettlement,
  };
}
