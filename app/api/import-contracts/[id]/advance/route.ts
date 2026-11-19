import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { moduleAuthorization, IMPORT_VIEW_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { loadSettlement } from '@/lib/importSettlement/load';

export const runtime = 'nodejs';
export const maxDuration = 60;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNumber = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};
const dateOnly = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

async function historicalInrPerUsd(date: string): Promise<{ rate: number; source: string } | null> {
  try {
    // Frankfurter returns USD per INR; invert to obtain INR per USD.
    const response = await fetch(`https://api.frankfurter.dev/v1/${date}?base=INR&symbols=USD`, {
      cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const usdPerInr = Number(json?.rates?.USD);
    if (!Number.isFinite(usdPerInr) || usdPerInr <= 0) return null;
    return { rate: round2(1 / usdPerInr), source: 'Frankfurter reference rate (ECB)' };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await moduleAuthorization('import', IMPORT_VIEW_ROLES);
    if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Authentication required.' : 'Import access is required.' }, { status: auth.status });

    const { id } = await ctx.params;
    const db = supabaseAdmin();
    const loaded = await loadSettlement(db, id);
    if (!loaded) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });

    const contractNo = String(loaded.contract.contract_number ?? '').trim();
    const contractValue = asNumber(loaded.contract.total_contract_value);
    const currency = String(loaded.contract.currency ?? '').trim().toUpperCase();

    // Suggestions are already constrained to this contract by loadSettlement.
    const suggestions = loaded.settlement.suggestions ?? [];
    const payments = suggestions.filter((s: any) =>
      s.section === 'payment' && s.colKey === 'advPaidInr' &&
      ['auto', 'confirmed'].includes(s.status) && Number(s.amount) > 0 && dateOnly(s.date),
    );
    const insurance = suggestions.filter((s: any) =>
      s.section === 'expense' && s.colKey === 'insurance' &&
      ['auto', 'confirmed'].includes(s.status) && Number(s.amount) > 0,
    );

    const paymentRows = payments.map((s: any) => {
      const date = dateOnly(s.date)!;
      const identity = [s.vkey, s.key, date, s.vchType, s.vchNo, s.ledger, s.amount].join('|');
      return {
        contract_id: id,
        payment_key: createHash('sha256').update(identity).digest('hex'),
        payment_date: date,
        voucher_key: String(s.vkey ?? ''),
        voucher_type: String(s.vchType ?? ''),
        voucher_number: String(s.vchNo ?? ''),
        ledger_name: String(s.ledger ?? ''),
        amount_inr: round2(Number(s.amount)),
        evidence: s.evidence ?? [],
      };
    });

    const existingResult = await db.from('import_contract_advance_fx')
      .select('payment_key,payment_date,amount_inr,inr_per_usd,amount_usd,rate_source,rate_fetched_at')
      .eq('contract_id', id);
    if (existingResult.error) throw existingResult.error;
    const existing = new Map((existingResult.data ?? []).map((r: any) => [r.payment_key, r]));

    for (const row of paymentRows) {
      const old: any = existing.get(row.payment_key);
      if (old && old.payment_date === row.payment_date && Number(old.amount_inr) === row.amount_inr && Number(old.inr_per_usd) > 0) continue;
      const fx = await historicalInrPerUsd(row.payment_date);
      const update: any = {
        ...row,
        inr_per_usd: fx?.rate ?? null,
        amount_usd: fx ? round2(row.amount_inr / fx.rate) : null,
        rate_source: fx?.source ?? null,
        rate_fetched_at: fx ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      const saved = await db.from('import_contract_advance_fx').upsert(update, { onConflict: 'contract_id,payment_key' });
      if (saved.error) throw saved.error;
    }

    const refreshed = await db.from('import_contract_advance_fx')
      .select('payment_key,payment_date,amount_inr,inr_per_usd,amount_usd,rate_source,rate_fetched_at,voucher_type,voucher_number,ledger_name')
      .eq('contract_id', id).order('payment_date', { ascending: true });
    if (refreshed.error) throw refreshed.error;
    const stored = refreshed.data ?? [];
    const advanceInr = round2(stored.reduce((sum: number, r: any) => sum + Number(r.amount_inr || 0), 0));
    const allRatesAvailable = stored.length > 0 && stored.every((r: any) => Number(r.inr_per_usd) > 0 && Number.isFinite(Number(r.amount_usd)));
    const advanceUsd = allRatesAvailable ? round2(stored.reduce((sum: number, r: any) => sum + Number(r.amount_usd || 0), 0)) : null;
    const advancePercentage = advanceUsd != null && currency === 'USD' && contractValue != null && contractValue > 0
      ? round2((advanceUsd / contractValue) * 100) : null;
    const insuranceInr = insurance.length ? round2(insurance.reduce((sum: number, s: any) => sum + Number(s.amount || 0), 0)) : null;
    const pendingRates = stored.filter((r: any) => !(Number(r.inr_per_usd) > 0));
    const fxStatus = !stored.length ? 'no_advance_found' : pendingRates.length ? (pendingRates.length === stored.length ? 'pending' : 'partial') : 'complete';
    const lastUpdated = stored.reduce((latest: string | null, r: any) => !latest || String(r.rate_fetched_at ?? '') > latest ? (r.rate_fetched_at ?? latest) : latest, null);

    return NextResponse.json({ summary: {
      contractNumber: contractNo,
      contractValueUsd: currency === 'USD' ? contractValue : null,
      currency,
      advanceInr,
      advanceUsd,
      insuranceInr,
      insuranceStatus: insuranceInr == null ? 'not_found' : 'found',
      advancePercentage,
      paymentCount: stored.length,
      fxStatus,
      lastUpdated,
      payments: stored,
    }});
  } catch (error) {
    logServerError('import-contracts/advance:get', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to calculate contract advance summary.') }, { status: 500 });
  }
}
