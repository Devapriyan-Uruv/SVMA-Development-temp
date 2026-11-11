
import type { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import type { DayBookVoucher } from '@/lib/outstanding/engine';

import {
  buildSettlement,
  parseShipmentEnd,
  type Boe,
  type Invoice,
  type Link,
  type Override,
  type Receipt,
  type Settlement,
  type VoucherRow,
} from './engine';

type Db = ReturnType<typeof supabaseAdmin>;

const DAY = 86400000;

const iso = (ms: number) =>
  new Date(ms).toISOString().slice(0, 10);

export const CONTRACT_DATE_FIELDS = [
  'shipment_end_date',
  'eta_date',
  'delivery_date',
  'settlement_due_date',
  'settled_at',
] as const;

export type ContractRow = Record<string, any> & {
  id: string;
};

export type Loaded = {
  contract: ContractRow;
  invoices: Invoice[];
  boes: Boe[];
  settlement: Settlement;
  dayBook: {
    from: string | null;
    to: string | null;
    vouchers: number;
    searched: {
      from: string;
      to: string;
    };
  };
  keyDates: Record<
    (typeof CONTRACT_DATE_FIELDS)[number],
    string | null
  > & {
    suggestedShipmentEnd: string | null;
  };
  record: {
    id: string;
    refCode: string;
  } | null;
};

const firstWord = (s: string | null | undefined) =>
  (
    String(s || '')
      .split(/[^A-Za-z0-9]+/)
      .find(w => w.length >= 4) || ''
  ).slice(0, 12);

const nullableNumber = (value: unknown): number | null =>
  value == null || value === ''
    ? null
    : Number(value);

export const toInvoice = (r: any): Invoice => ({
  id: r.id,
  invNo: r.inv_no || '',
  invQty: nullableNumber(r.inv_qty),
  ratePerTon: nullableNumber(r.rate_per_ton),
  invValueUsd: nullableNumber(r.inv_value_usd),
  advPaidUsd: nullableNumber(r.adv_paid_usd),

  // Legacy fields retained for compatibility with existing invoice data.
  // New BOE-specific calculations use import_contract_boes.
  boeNo: r.boe_no || null,
  boeDate: r.boe_date || null,
  assessableValue: nullableNumber(r.assessable_value),
});

const toBoe = (r: any, invoice?: Invoice): Boe => ({
  id: r.id,
  invoiceId: r.invoice_id,
  invNo: invoice?.invNo || '',
  boeNo: r.boe_no || null,
  boeDate: r.boe_date || null,
  invQty: nullableNumber(r.inv_qty),
  ratePerTon: nullableNumber(r.rate_per_ton),
  invValueUsd: nullableNumber(r.inv_value_usd),
  advPaidUsd: nullableNumber(r.adv_paid_usd),
  assessableValue: nullableNumber(r.assessable_value),
});

// Only purchase / payment / journal / contra vouchers can carry an
// import's cost, so sales and receipts are not read.
export async function loadSettlement(
  db: Db,
  contractId: string,
): Promise<Loaded | null> {
  const {
    data: contract,
    error: contractError,
  } = await db
    .from('import_contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();

  if (contractError) throw contractError;
  if (!contract) return null;

  // Load the invoice, BOE, link and override records independently.
  const [inv, boeResult, linkResult, cellResult] =
    await Promise.all([
      db
        .from('import_contract_invoices')
        .select('*')
        .eq('contract_id', contractId)
        .order('sort_order')
        .order('created_at'),

      db
        .from('import_contract_boes')
        .select('*')
        .eq('contract_id', contractId)
        .order('sort_order')
        .order('created_at'),

      db
        .from('import_contract_links')
        .select('kind,ref_key,col_key,status,invoice_id,boe_id')
        .eq('contract_id', contractId),

      db
        .from('import_contract_cells')
        .select('invoice_id,boe_id,col_key,value')
        .eq('contract_id', contractId),
    ]);

  for (const result of [
    inv,
    boeResult,
    linkResult,
    cellResult,
  ]) {
    if (result.error) throw result.error;
  }

  const invoiceRows = inv.data || [];
  const boeRows = boeResult.data || [];

  let invoices: Invoice[] = invoiceRows.map(toInvoice);

  // Preserve the empty invoice editor state when a contract has
  // no invoice records. This is not persisted as a database invoice.
  if (!invoices.length) {
    invoices = [
      {
        id: 'new',
        invNo: '',
        invQty: nullableNumber(contract.quantity),
        ratePerTon: nullableNumber(contract.unit_price),
        invValueUsd: null,
        advPaidUsd: null,
        boeNo: null,
        boeDate: null,
        assessableValue: null,
      },
    ];
  }

  // Read linked Import records to fill invoice metadata.
  const recordIds = Array.from(
    new Set(
      [
        contract.import_entry_id,
        ...invoiceRows.map((r: any) => r.import_entry_id),
      ].filter(Boolean),
    ),
  );

  const recs = recordIds.length
    ? await db
        .from('import_entries')
        .select(
          'id,ref_code,invoice_no,invoice_qty,invoice_value_fcy,currency,advance_amount_fcy,boe_no,boe_date,assessable_value_inr',
        )
        .in('id', recordIds)
    : { data: [] as any[], error: null };

  if (recs.error) throw recs.error;

  const recordMap = new Map(
    (recs.data || []).map((r: any) => [r.id, r]),
  );

  const fillInvoice = (
    invoice: Invoice,
    rowEntryId: string | null | undefined,
  ): Invoice => {
    const entryId =
      rowEntryId ||
      (invoiceRows.length <= 1
        ? contract.import_entry_id
        : null);

    const entry = recordMap.get(entryId || '');

    if (!entry) return invoice;

    const usd =
      !entry.currency || entry.currency === 'USD';

    return {
      ...invoice,
      invNo: invoice.invNo || entry.invoice_no || '',
      invQty:
        invoice.invQty ??
        nullableNumber(entry.invoice_qty),
      invValueUsd:
        invoice.invValueUsd ??
        (usd
          ? nullableNumber(entry.invoice_value_fcy)
          : null),
      advPaidUsd:
        invoice.advPaidUsd ??
        (usd
          ? nullableNumber(entry.advance_amount_fcy)
          : null),
    };
  };

  invoices = invoices.map((invoice, index) =>
    fillInvoice(
      invoice,
      invoiceRows[index]?.import_entry_id,
    ),
  );

  const invoiceMap = new Map(
    invoices.map(invoice => [invoice.id, invoice]),
  );

  // BOE records are the sole source of BOE-specific values.
  // Never copy BOE metadata or assessable value from an Import Entry
  // into every BOE attached to an invoice: one invoice may have
  // multiple BOEs, each with its own independently allocated values.
  const boes: Boe[] = boeRows.map((row: any) =>
    toBoe(row, invoiceMap.get(row.invoice_id)),
  );

  const record = contract.import_entry_id
    ? {
        id: contract.import_entry_id as string,
        refCode:
          (recordMap.get(contract.import_entry_id)?.ref_code as
            | string
            | undefined) || '',
      }
    : null;

  // Links and overrides are now scoped to a BOE.
  const links: Link[] = (linkResult.data || []).map(
    (row: any) => ({
      kind: row.kind,
      refKey: row.ref_key,
      colKey: row.col_key,
      status: row.status,
      boeId: row.boe_id || null,
    }),
  );

  const overrides: Override[] = (
    cellResult.data || []
  ).map((row: any) => ({
    boeId: row.boe_id || null,
    colKey: row.col_key,
    value: nullableNumber(row.value),
  }));

  // Day Book search window.
  const contractDate = Date.parse(
    String(contract.contract_date || ''),
  );

  const boeDates = boes
    .map(boe => Date.parse(String(boe.boeDate || '')))
    .filter(Number.isFinite);

  const from = iso(
    (
      Number.isFinite(contractDate)
        ? contractDate
        : Math.min(
            Date.now() - 365 * DAY,
            ...boeDates,
          )
    ) - 30 * DAY,
  );

  const to = iso(Date.now() + DAY);

  const rows = await fetchAllRows<{
    vkey: string;
    payload: DayBookVoucher;
  }>((a, b) =>
    db
      .from('daybook_day_vouchers')
      .select('vkey,payload')
      .gte('vch_date', from)
      .lte('vch_date', to)
      .or(
        'vch_type.ilike.%payment%,vch_type.ilike.%purchase%,vch_type.ilike.%journal%,vch_type.ilike.%contra%',
      )
      .order('vch_date')
      .order('vkey')
      .range(a, b),
  );

  if (rows.error) throw rows.error;

  const vouchers: VoucherRow[] = rows.data.map(row => ({
    vkey: row.vkey,
    voucher: row.payload,
  }));

  const [lowDate, highDate, count] = await Promise.all([
    db
      .from('daybook_day_vouchers')
      .select('vch_date')
      .order('vch_date')
      .limit(1),

    db
      .from('daybook_day_vouchers')
      .select('vch_date')
      .order('vch_date', { ascending: false })
      .limit(1),

    db
      .from('daybook_day_vouchers')
      .select('vkey', { count: 'exact', head: true }),
  ]);

  for (const result of [
    lowDate,
    highDate,
    count,
  ]) {
    if (result.error) throw result.error;
  }

  // ERP receipt lookup.
  const words = [
    firstWord(contract.supplier_name),
    firstWord(contract.erp_supplier),
  ].filter(Boolean);

  let receipts: Receipt[] = [];

  if (words.length) {
    const receiptResult = await fetchAllRows<any>(
      (a, b) =>
        db
          .from('ops_purchase_receipts')
          .select(
            'rn_no,rn_date,supplier_name,product_raw,vehicle_no,weight,bill_qty,freight_amt,bill_value,po_no',
          )
          .gte(
            'rn_date',
            iso(
              (
                Number.isFinite(contractDate)
                  ? contractDate
                  : Date.now() - 365 * DAY
              ) - 15 * DAY,
            ),
          )
          .or(
            words
              .map(word => `supplier_name.ilike.%${word}%`)
              .join(','),
          )
          .order('rn_date')
          .range(a, b),
    );

    if (receiptResult.error) throw receiptResult.error;

    receipts = receiptResult.data.map(row => ({
      rnNo: row.rn_no,
      rnDate: row.rn_date,
      vehicleNo: row.vehicle_no || '',
      supplier: row.supplier_name || '',
      product: row.product_raw || '',
      qty: Number(row.weight ?? row.bill_qty ?? 0),
      freightAmt: Number(row.freight_amt || 0),
      billValue: Number(row.bill_value || 0),
      poNo: row.po_no || '',
    }));
  }

  const settlement = buildSettlement({
    contract: {
      contractNumber: contract.contract_number,
      supplierName: contract.supplier_name,
      product: contract.product_material_name || '',
      quantity: nullableNumber(contract.quantity),
      uom: contract.uom,
      unitPrice: nullableNumber(contract.unit_price),
      currency: contract.currency,
      contractDate: Number.isFinite(contractDate)
        ? iso(contractDate)
        : null,
      shipmentEnd: contract.shipment_end_date,
      erpSupplier: contract.erp_supplier,
      erpProduct: contract.erp_product,
    },
    invoices,
    boes,
    vouchers,
    receipts,
    links,
    overrides,
  });

  const keyDates = Object.fromEntries(
    CONTRACT_DATE_FIELDS.map(key => [
      key,
      contract[key] ?? null,
    ]),
  ) as Loaded['keyDates'];

  keyDates.suggestedShipmentEnd = parseShipmentEnd(
    contract.shipment_date_period,
  );

  return {
    contract,
    invoices,
    boes,
    settlement,
    record,
    dayBook: {
      from: lowDate.data?.[0]?.vch_date ?? null,
      to: highDate.data?.[0]?.vch_date ?? null,
      vouchers: count.count ?? 0,
      searched: {
        from,
        to,
      },
    },
    keyDates,
  };
}
