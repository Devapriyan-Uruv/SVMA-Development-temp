import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, moduleEditAuthorization, IMPORT_VIEW_ROLES, IMPORT_EDIT_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { loadSettlement, CONTRACT_DATE_FIELDS } from '@/lib/importSettlement/load';
import { ensureImportEntry } from '@/lib/importMaster/fromContract';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MODULE = 'import';
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const numOrNull = (v: unknown) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const textOrNull = (v: unknown, n = 120) => { const s = String(v ?? '').trim().slice(0, n); return s || null; };

/** GET — the Settlement sheet of one contract, built live from the saved Day Book and the ERP receipts. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const az = await moduleAuthorization(MODULE, IMPORT_VIEW_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Authentication required.' : 'Import access is required.' }, { status: az.status });
    const { id } = await ctx.params;
    const [loaded, ed] = await Promise.all([loadSettlement(supabaseAdmin(), id), moduleEditAuthorization(MODULE, IMPORT_EDIT_ROLES)]);
    if (!loaded) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
    const c = loaded.contract;
    return NextResponse.json({
      contract: { id: c.id, importId: c.import_id, status: c.status, contractNumber: c.contract_number, contractDate: c.contract_date, supplierName: c.supplier_name, product: c.product_material_name, quantity: c.quantity, uom: c.uom, unitPrice: c.unit_price, currency: c.currency, shipmentPeriod: c.shipment_date_period, paymentTerms: c.payment_terms, erpSupplier: c.erp_supplier, erpProduct: c.erp_product },
      invoices: loaded.invoices, record: loaded.record, settlement: loaded.settlement, dayBook: loaded.dayBook, keyDates: loaded.keyDates, canEdit: IMPORT_EDIT_ROLES.some(r => az.roles.includes(r)) || az.roles.includes('super_admin'),
    });
  } catch (e) {
    logServerError('import-contracts/settlement:get', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to build the settlement sheet.') }, { status: 500 });
  }
}

/** PATCH — any of: invoices (upsert / delete), key dates, ERP names, link decisions, typed-over figures. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const az = await moduleEditAuthorization(MODULE, IMPORT_EDIT_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Authentication required.' : 'Import edit access is required.' }, { status: az.status });
    const { id } = await ctx.params, b = await req.json(), db = supabaseAdmin(), uid = az.user?.id ?? null;
    const { data: exists } = await db.from('import_contracts').select('id').eq('id', id).maybeSingle();
    if (!exists) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });

    if (b.createRecord === true) {
      const r = await ensureImportEntry(db, id, uid);
      if (!r) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
      return NextResponse.json({ ok: true, importRecord: r.refCode, created: r.created });
    }
    if (Array.isArray(b.invoices)) {
      for (const [i, x] of (b.invoices as any[]).entries()) {
        if (x.delete && x.id && x.id !== 'new') { await db.from('import_contract_invoices').delete().eq('id', x.id).eq('contract_id', id); continue; }
        const invNo = textOrNull(x.invNo); if (!invNo) continue;
        const row = { contract_id: id, inv_no: invNo, inv_qty: numOrNull(x.invQty), rate_per_ton: numOrNull(x.ratePerTon), inv_value_usd: numOrNull(x.invValueUsd), adv_paid_usd: numOrNull(x.advPaidUsd), boe_no: textOrNull(x.boeNo, 40), boe_date: isDate(x.boeDate) ? x.boeDate : null, assessable_value: numOrNull(x.assessableValue), sort_order: i, updated_at: new Date().toISOString() };
        const { error } = x.id && x.id !== 'new' ? await db.from('import_contract_invoices').update(row).eq('id', x.id).eq('contract_id', id) : await db.from('import_contract_invoices').upsert(row, { onConflict: 'contract_id,inv_no' });
        if (error) { if (error.code === '23505') return NextResponse.json({ error: `Invoice ${invNo} is already on this contract.` }, { status: 409 }); throw error; }
      }
    }
    if (b.dates && typeof b.dates === 'object') {
      const upd: Record<string, unknown> = { updated_by: uid, updated_at: new Date().toISOString() };
      for (const k of CONTRACT_DATE_FIELDS) if (k in b.dates) upd[k] = isDate(b.dates[k]) ? b.dates[k] : null;
      if ('erpSupplier' in b.dates) upd.erp_supplier = textOrNull(b.dates.erpSupplier, 120);
      if ('erpProduct' in b.dates) upd.erp_product = textOrNull(b.dates.erpProduct, 120);
      const { error } = await db.from('import_contracts').update(upd).eq('id', id); if (error) throw error;
    }
    if (Array.isArray(b.links)) {
  for (const l of b.links as any[]) {
    if (!['tally', 'erp'].includes(l.kind) || !l.refKey) continue;

    if (l.status == null) {
      const { error } = await db
        .from('import_contract_links')
        .delete()
        .eq('contract_id', id)
        .eq('kind', l.kind)
        .eq('ref_key', String(l.refKey));

      if (error) throw error;
      continue;
    }

    let invoiceId: string | null = null;

    // Only Tally links can be assigned to an invoice.
    if (l.kind === 'tally' && l.invoiceId && l.invoiceId !== 'new') {
      invoiceId = String(l.invoiceId);

      // Ensure the selected invoice belongs to this contract.
      const { data: invoice, error: invoiceError } = await db
        .from('import_contract_invoices')
        .select('id')
        .eq('id', invoiceId)
        .eq('contract_id', id)
        .maybeSingle();

      if (invoiceError) throw invoiceError;

      if (!invoice) {
        return NextResponse.json(
          { error: 'The selected invoice does not belong to this contract.' },
          { status: 400 }
        );
      }
    }

    const { error } = await db
      .from('import_contract_links')
      .upsert(
        {
          contract_id: id,
          kind: l.kind,
          ref_key: String(l.refKey),
          col_key: textOrNull(l.colKey, 40),
          invoice_id: invoiceId,
          status: l.status === 'excluded' ? 'excluded' : 'confirmed',
          decided_by: uid,
          decided_at: new Date().toISOString(),
        },
        { onConflict: 'contract_id,kind,ref_key' }
      );

    if (error) {
  if (error.code === '23505') {
    return NextResponse.json(
      {
        error: 'This Tally voucher is already confirmed against another contract.',
      },
      { status: 409 }
    );
  }

  throw error;
}
  }
}
    if (Array.isArray(b.overrides)) {
      for (const o of b.overrides as any[]) {
        const invoiceId = o.invoiceId && o.invoiceId !== 'new' ? String(o.invoiceId) : null, colKey = textOrNull(o.colKey, 80); if (!colKey) continue;
        let q = db.from('import_contract_cells').delete().eq('contract_id', id).eq('col_key', colKey);
        q = invoiceId ? q.eq('invoice_id', invoiceId) : q.is('invoice_id', null); await q;
        if (numOrNull(o.value) != null) { const { error } = await db.from('import_contract_cells').insert({ contract_id: id, invoice_id: invoiceId, col_key: colKey, value: numOrNull(o.value), note: textOrNull(o.note, 200), updated_by: uid }); if (error) throw error; }
      }
    }
    await db.from('import_contract_audit').insert({ contract_id: id, action: 'SETTLEMENT_UPDATED', changed_by: uid, details: { invoices: !!b.invoices, dates: !!b.dates, links: Array.isArray(b.links) ? b.links.length : 0, overrides: Array.isArray(b.overrides) ? b.overrides.length : 0 } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logServerError('import-contracts/settlement:patch', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to save the settlement changes.') }, { status: 500 });
  }
}
