import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeExceptions, type NewException } from './exceptions';

// Confirmed with the user during ERP Intelligence Phase 1 (same tolerance
// discipline as Production/RM): a fixed default, stored as a constant here
// rather than hardcoded inline, so it's one place to change later without
// hunting through the reconciliation logic. Matches spec section 16's
// suggested starting rule.
export const QC_OIL_TOLERANCE = 0.20;

export type QcSettlementRow = { lotNo: string; labOilAvg: number; settlementOil: number | null; variance: number | null; status: 'matched' | 'deviation' | 'no_settlement' };

/** Per lot: average OIL across every random QC sample vs the OIL value
 * recorded at settlement — never a single sample compared alone, since a
 * lot's accepted quality is the average of its random draws, not any one
 * of them. Pure/read-only, like the Production/RM reconciliation compute
 * functions. */
export async function computeQcSettlementRows(reportDate: string): Promise<QcSettlementRow[]> {
  const db = supabaseAdmin();
  const [{ data: qc }, { data: settlements }] = await Promise.all([
    db.from('ops_qc_results').select('lot_no,oil').eq('report_date', reportDate),
    db.from('ops_settlements').select('lot_no,oil').eq('inward_date', reportDate),
  ]);
  const byLot = new Map<string, number[]>();
  for (const r of qc || []) { const lot = (r as any).lot_no; if (!lot || (r as any).oil == null) continue; byLot.set(lot, [...(byLot.get(lot) || []), Number((r as any).oil)]); }
  const settlementByLot = new Map((settlements || []).map((r: any) => [r.lot_no, r.oil != null ? Number(r.oil) : null]));

  const rows: QcSettlementRow[] = [];
  for (const [lotNo, samples] of byLot) {
    const labOilAvg = samples.reduce((s, v) => s + v, 0) / samples.length;
    const settlementOil = settlementByLot.get(lotNo) ?? null;
    const variance = settlementOil === null ? null : Number((settlementOil - labOilAvg).toFixed(4));
    const status = settlementOil === null ? 'no_settlement' : Math.abs(variance!) > QC_OIL_TOLERANCE ? 'deviation' : 'matched';
    rows.push({ lotNo, labOilAvg, settlementOil, variance, status });
  }
  return rows.sort((a, b) => Math.abs(b.variance || 0) - Math.abs(a.variance || 0));
}

export async function reconcileQcSettlement(reportDate: string): Promise<{ rows: QcSettlementRow[]; exceptionsCreated: number; ticketsCreated: number }> {
  const rows = await computeQcSettlementRows(reportDate);
  const exceptions: NewException[] = rows.filter(r => r.status === 'deviation').map(r => ({
    exceptionType: 'qc_commercial_deviation', severity: Math.abs(r.variance!) > QC_OIL_TOLERANCE * 3 ? 'critical' : 'warning',
    reportDate, module: 'ops_qc', referenceIds: { lotNo: r.lotNo },
    expectedValue: r.labOilAvg, actualValue: r.settlementOil, variance: r.variance, toleranceUsed: QC_OIL_TOLERANCE,
    description: `Lot ${r.lotNo}: average lab OIL ${r.labOilAvg.toFixed(2)} vs settlement OIL ${r.settlementOil!.toFixed(2)} — a ${r.variance!.toFixed(2)} point difference (tolerance ${QC_OIL_TOLERANCE}).`,
  }));
  const { created, ticketsCreated } = await writeExceptions(exceptions);
  return { rows, exceptionsCreated: created, ticketsCreated };
}
