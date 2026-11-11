
import { nameSimilarity } from '@/lib/reconciliation/normalize';
import type { DayBookVoucher } from '@/lib/outstanding/engine';

// Import Settlement — one independent settlement sheet per Bill of Entry.
// Invoice details are shared through invoiceId; allocations and calculations are BOE-specific.

export type Invoice = {
  id: string;
  invNo: string;
  invQty: number | null;
  ratePerTon: number | null;
  invValueUsd: number | null;
  advPaidUsd: number | null;
  boeNo: string | null;
  boeDate: string | null;
  assessableValue: number | null;
};

export type Boe = {
  id: string;
  invoiceId: string;
  invNo: string;
  boeNo: string | null;
  boeDate: string | null;
  invQty: number | null;
  ratePerTon: number | null;
  invValueUsd: number | null;
  advPaidUsd: number | null;
  assessableValue: number | null;
};

export type ContractLite = {
  contractNumber: string;
  supplierName: string;
  product: string;
  quantity: number | null;
  uom: string | null;
  unitPrice: number | null;
  currency: string | null;
  contractDate: string | null;
  shipmentEnd: string | null;
  erpSupplier: string | null;
  erpProduct: string | null;
};

export type VoucherRow = { vkey: string; voucher: DayBookVoucher };

export type Receipt = {
  rnNo: string;
  rnDate: string;
  vehicleNo: string;
  supplier: string;
  product: string;
  qty: number;
  freightAmt: number;
  billValue: number;
  poNo: string;
};

export type Link = {
  kind: 'tally' | 'erp';
  refKey: string;
  colKey: string | null;
  status: 'confirmed' | 'excluded';
  boeId: string | null;
};

export type Override = {
  boeId: string | null;
  colKey: string;
  value: number | null;
};

export type ColKey =
  | 'insurance'
  | 'bankChgs'
  | 'duty'
  | 'igst'
  | 'dutyInterest'
  | 'linerFees'
  | 'pqFees'
  | 'cfs'
  | 'chaFees'
  | 'fssai'
  | 'handCharges'
  | 'surveyor'
  | 'demurrage'
  | 'freight'
  | 'comFees';

export const EXPENSE_COLS: {
  key: ColKey;
  no: number;
  label: string;
  re: RegExp;
}[] = [
  { key: 'insurance', no: 9, label: 'Insurance', re: /insurance/i },
  {
    key: 'bankChgs',
    no: 11,
    label: 'Bank charges',
    re: /bank\s*(charges|chgs?)|\blc\s*(charges|commission|opening)|bill\s*collection|swift|forex\s*(commission|charges)/i,
  },
  {
    key: 'duty',
    no: 13,
    label: 'Duty',
    re: /(customs?|import)\s*duty|\bbcd\b|basic\s*customs|\bsws\b|duty\s*a\/c|customs/i,
  },
  { key: 'igst', no: 14, label: 'IGST', re: /igst/i },
  {
    key: 'dutyInterest',
    no: 15,
    label: 'Duty interest',
    re: /(duty|customs)\s*interest|interest\s*on\s*(duty|customs)/i,
  },
  {
    key: 'linerFees',
    no: 16,
    label: 'Liner fees',
    re: /liner|shipping\s*line|\bthc\b|\bd\.?o\.?\s*charges|delivery\s*order/i,
  },
  { key: 'pqFees', no: 17, label: 'PQ fees', re: /\bpq\b|plant\s*quarantine|quarantine/i },
  { key: 'cfs', no: 18, label: 'CFS', re: /\bcfs\b|container\s*freight\s*station/i },
  {
    key: 'chaFees',
    no: 19,
    label: 'CHA fees',
    re: /\bcha\b|clearing|custom\s*house\s*agent|forwarding/i,
  },
  { key: 'fssai', no: 20, label: 'FSSAI', re: /fssai/i },
  {
    key: 'handCharges',
    no: 21,
    label: 'Hand charges',
    re: /hand(l)?ing|hamali|loading\s*charges|unloading/i,
  },
  { key: 'surveyor', no: 22, label: 'Surveyor', re: /survey/i },
  { key: 'demurrage', no: 23, label: 'Demurrage', re: /demurr?age|detention/i },
  { key: 'freight', no: 24, label: 'Freight', re: /freight|transport|lorry|logistics/i },
  { key: 'comFees', no: 25, label: 'Commission', re: /commission|brokerage/i },
];

/** Total expenses exclude IGST because it is recoverable credit. */
export const TOTAL_EXP_KEYS = EXPENSE_COLS
  .filter(c => c.key !== 'igst')
  .map(c => c.key);

export const SETTLE_COLS = [
  { key: 'purchaseValue', label: 'Purchase value (col 36)' },
  { key: 'advPaidInr', label: 'Advance paid INR (col 33)' },
  { key: 'balanceInr', label: 'Balance paid INR (col 34)' },
] as const;

export const ASSIGNABLE = [
  ...EXPENSE_COLS.map(c => ({ key: c.key as string, label: c.label })),
  ...SETTLE_COLS.map(c => ({ key: c.key as string, label: c.label })),
];

export type Suggestion = {
  key: string;
  vkey: string;
  date: string;
  vchType: string;
  vchNo: string;
  ledger: string;
  amount: number;
  narration: string;
  colKey: string | null;
  section: 'expense' | 'purchase' | 'payment';
  evidence: string[];
  status: 'auto' | 'candidate' | 'confirmed' | 'excluded';
  invoiceId: string | null;
  boeId: string | null;
};

export type Cell = {
  value: number | string | null;
  source: 'contract' | 'tally' | 'boe' | 'formula' | 'manual' | 'blank';
  refs?: string[];
};

export type SheetRow = {
  boeId: string;
  invoiceId: string;
  invNo: string;
  cells: Record<string, Cell>;
};

export type LoadRow = {
  boeId: string;
  rnNo: string;
  date: string;
  vehicleNo: string;
  loadingTon: Cell;
  lfPerTon: Cell;
  totFreight: Cell;
  purValue: Cell;
};

export type LoadSuggestion = {
  rnNo: string;
  date: string;
  vehicleNo: string;
  supplier: string;
  product: string;
  qty: number;
  poNo: string;
  status: 'suggested' | 'confirmed' | 'excluded';
  score: number;
  boeId: string | null;
};

const round = (n: number, d = 2) =>
  Math.round(n * 10 ** d) / 10 ** d;

const norm = (s: unknown) =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const BANK_OR_CASH =
  /\bbank\b|\bcash\b|\bcc\s*a\/?c\b|hdfc|sbi\b|icici|axis|canara|\bcc\b|petty/i;

const dayMs = 86400000;

const t = (d: string | null | undefined) =>
  d ? Date.parse(d) : NaN;

const textOf = (v: DayBookVoucher) =>
  [
    ...v.lines.map(l => l.name),
    ...v.lines.flatMap(l => l.refs.map(r => r.ref)),
    ...v.narration,
  ].join(' | ');

export type EngineInput = {
  contract: ContractLite;
  invoices: Invoice[];
  boes: Boe[];
  vouchers: VoucherRow[];
  receipts: Receipt[];
  links: Link[];
  overrides: Override[];
  today?: string;
};

export type Settlement = {
  header: {
    contractNo: string;
    party: string;
    commodity: string;
    contractQty: string;
    ratePerTon: string;
  };
  rows: SheetRow[];
  totals: Record<string, number>;
  /** Per-ton summary calculated independently for every BOE. */
  perTonByBoe: Record<string, {
    partyAmount: Cell;
    totalExp: Cell;
    receivedTons: Cell;
    perTonCost: Cell;
  }>;
  /** Backward-compatible summary for the first BOE. Prefer perTonByBoe. */
  perTon: {
    partyAmount: Cell;
    totalExp: Cell;
    receivedTons: Cell;
    perTonCost: Cell;
  };
  loads: LoadRow[];
  loadTotals: { tons: number; freight: number; purValue: number };
  suggestions: Suggestion[];
  loadSuggestions: LoadSuggestion[];
  notes: string[];
};

export function buildSettlement(inp: EngineInput): Settlement {
  const {
    contract,
    invoices,
    boes,
    vouchers,
    receipts,
    links,
    overrides,
  } = inp;

  const notes: string[] = [];

  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  const boeById = new Map(boes.map(b => [b.id, b]));

  const linkOf = new Map(
    links.map(l => [`${l.kind}|${l.refKey}`, l]),
  );

  const ovr = (boeId: string | null, key: string) =>
    overrides.find(
      o => o.boeId === boeId && o.colKey === key,
    );

  const boeNeedles = boes.map(b => ({
    id: b.id,
    invoiceId: b.invoiceId,
    boe: (b.boeNo || '').replace(/\D/g, ''),
    inv: norm(b.invNo || invoiceById.get(b.invoiceId)?.invNo),
  }));

  const contractNeedle = norm(contract.contractNumber);

  const boeDates = boes
    .map(b => t(b.boeDate))
    .filter(Number.isFinite);

  const windowFrom = Math.min(
    ...[
      t(contract.contractDate),
      ...boeDates.map(d => d - 45 * dayMs),
    ].filter(Number.isFinite),
    Date.now(),
  );

  // Match a voucher to a BOE only when the evidence identifies one BOE.
  // An invoice number shared by multiple BOEs is deliberately ambiguous.
  const resolveBoe = (searchText: string) => {
    const digits = searchText.replace(/\D/g, '');
    const normalized = norm(searchText);

    const boeMatches = boeNeedles.filter(
      n => n.boe.length >= 6 && digits.includes(n.boe),
    );

    if (boeMatches.length === 1) {
      return {
        boeId: boeMatches[0].id,
        invoiceId: boeMatches[0].invoiceId,
        evidence: [`BOE ${boeMatches[0].boe}`],
        strong: true,
      };
    }

    if (boeMatches.length > 1) {
      return {
        boeId: null,
        invoiceId: null,
        evidence: ['Multiple BOE numbers found in voucher'],
        strong: false,
      };
    }

    const invoiceMatches = boeNeedles.filter(
      n => n.inv.length >= 4 && normalized.includes(n.inv),
    );

    if (invoiceMatches.length === 1) {
      return {
        boeId: invoiceMatches[0].id,
        invoiceId: invoiceMatches[0].invoiceId,
        evidence: [`invoice ${invoiceMatches[0].inv}`],
        strong: true,
      };
    }

    if (invoiceMatches.length > 1) {
      return {
        boeId: null,
        invoiceId: null,
        evidence: ['Invoice reference matches multiple BOEs'],
        strong: false,
      };
    }

    if (contractNeedle.length >= 5 && normalized.includes(contractNeedle)) {
      return {
        boeId: null,
        invoiceId: null,
        evidence: [`contract ${contract.contractNumber}`],
        strong: false,
      };
    }

    return {
      boeId: null,
      invoiceId: null,
      evidence: [],
      strong: false,
    };
  };

  // ---- 1. Tally Day Book suggestions

  const suggestions: Suggestion[] = [];

  const supplierNames = [
    contract.supplierName,
    contract.erpSupplier,
  ].filter(Boolean) as string[];

  const partyScore = (name: string) =>
    Math.max(0, ...supplierNames.map(s => nameSimilarity(s, name)));

  for (const { vkey, voucher: v } of vouchers) {
    const text = textOf(v);
    const match = resolveBoe(text);
    const dateMs = t(v.date);

    const inWindow =
      Number.isFinite(dateMs) &&
      dateMs >= windowFrom - 30 * dayMs &&
      (!boeDates.length ||
        dateMs <= Math.max(...boeDates) + 60 * dayMs);

    const type = v.vchType.toLowerCase();

    v.lines.forEach((l, idx) => {
      const key = `${vkey}|${idx}`;

      const amountOf = (n: number | null) =>
        n && n > 0 ? n : 0;

      const push = (
        section: Suggestion['section'],
        colKey: string | null,
        amount: number,
        evidence: string[],
        base: Suggestion['status'],
      ) => {
        const link = linkOf.get(`tally|${key}`);

        const status: Suggestion['status'] = link
          ? link.status === 'excluded'
            ? 'excluded'
            : 'confirmed'
          : base;

        // A saved link is authoritative, including an explicit null BOE
        // assignment. Do not silently fall back to inferred matching when
        // the user has deliberately left the voucher unallocated.
        const linkedBoeId = link ? link.boeId : match.boeId;
        const selectedBoe = linkedBoeId
          ? boeById.get(linkedBoeId)
          : null;

        suggestions.push({
          key,
          vkey,
          date: v.date,
          vchType: v.vchType,
          vchNo: v.vchNo,
          ledger: l.name,
          amount,
          narration: v.narration.join(' ').slice(0, 160),
          colKey: link?.colKey || colKey,
          section,
          evidence,
          status,
          invoiceId: selectedBoe
            ? selectedBoe.invoiceId
            : link
              ? null
              : match.invoiceId,
          boeId: linkedBoeId,
        });
      };

      // Purchase voucher
      if (
        /purchase/i.test(type) &&
        partyScore(l.name) >= 0.7 &&
        amountOf(l.cr)
      ) {
        if (match.strong || inWindow) {
          push(
            'purchase',
            'purchaseValue',
            amountOf(l.cr),
            [`supplier ${l.name}`, ...match.evidence],
            match.strong ? 'auto' : 'candidate',
          );
        }
        return;
      }

      // Payment voucher
      if (
        /payment/i.test(type) &&
        partyScore(l.name) >= 0.7 &&
        amountOf(l.dr)
      ) {
        if (match.strong || inWindow) {
          push(
            'payment',
            null,
            amountOf(l.dr),
            [`supplier ${l.name}`, ...match.evidence],
            match.strong ? 'auto' : 'candidate',
          );
        }
        return;
      }

      // Expense entries
      const debitAmount = amountOf(l.dr);
      const creditAmount = amountOf(l.cr);

      const expenseAmount =
        debitAmount > 0
          ? debitAmount
          : creditAmount > 0
            ? -creditAmount
            : 0;

      if (expenseAmount !== 0) {
        const col = EXPENSE_COLS.find(
          c =>
            c.re.test(l.name) &&
            !(c.key === 'duty' && /interest/i.test(l.name)),
        );

        const linked = linkOf.get(`tally|${key}`);
        const sideEvidence =
          debitAmount > 0
            ? 'debit entry'
            : 'credit entry — adjustment / reversal';

        if (col && (match.strong || inWindow || linked)) {
          push(
            'expense',
            col.key,
            expenseAmount,
            [
              ...(match.evidence.length
                ? match.evidence
                : ['within shipment window — no BOE / invoice reference']),
              sideEvidence,
            ],
            match.strong ? 'auto' : 'candidate',
          );
        } else if (
          !col &&
          !BANK_OR_CASH.test(l.name) &&
          match.evidence.length > 0 &&
          /duty|igst|charges|fees|freight/i.test(l.name)
        ) {
          push(
            'expense',
            null,
            expenseAmount,
            [...match.evidence, sideEvidence],
            'candidate',
          );
        }
      }
    });
  }

  // Determine advance / balance separately for each BOE.
  for (const boe of boes) {
    const boeSuggestions = suggestions.filter(
      s => s.boeId === boe.id && s.section === 'purchase',
    );

    const purchaseDates = boeSuggestions
      .filter(s => s.status !== 'excluded')
      .map(s => t(s.date))
      .filter(Number.isFinite);

    const cutoff = purchaseDates.length
      ? Math.min(...purchaseDates)
      : t(boe.boeDate);

    for (const s of suggestions) {
      if (
        s.boeId === boe.id &&
        s.section === 'payment' &&
        !linkOf.get(`tally|${s.key}`)?.colKey
      ) {
        s.colKey =
          Number.isFinite(cutoff) && t(s.date) < cutoff
            ? 'advPaidInr'
            : 'balanceInr';
      }
    }
  }

  const counted = (s: Suggestion) =>
    s.status === 'auto' || s.status === 'confirmed';

  // ---- 2. Independent BOE settlement rows

  const rows: SheetRow[] = boes.map(boe => {
    const cells: Record<string, Cell> = {};

    const manual = (key: string, cell: Cell): Cell => {
      const override = ovr(boe.id, key);

      return override && override.value != null
        ? { value: override.value, source: 'manual' }
        : cell;
    };

    const num = (
      key: string,
      value: number | null,
      source: Cell['source'],
    ) => {
      cells[key] = manual(
        key,
        value == null
          ? { value: null, source: 'blank' }
          : { value, source },
      );
    };

    const sum = (key: string) => {
      const matched = suggestions.filter(
        s =>
          counted(s) &&
          s.colKey === key &&
          s.boeId === boe.id,
      );

      return {
        value: matched.length
          ? round(matched.reduce((a, s) => a + s.amount, 0))
          : null,
        refs: matched.map(s => s.key),
      };
    };

    const tally = (key: string) => {
      const result = sum(key);

      cells[key] = manual(
        key,
        result.value == null
          ? { value: null, source: 'blank' }
          : {
              value: result.value,
              source: 'tally',
              refs: result.refs,
            },
      );

      return cells[key].value as number | null;
    };

    const invoice = invoiceById.get(boe.invoiceId);

    const invNo = boe.invNo || invoice?.invNo || '';

    cells.invNo = {
      value: invNo,
      source: 'contract',
    };

    num('invQty', boe.invQty, 'contract');

    num(
      'ratePerTon',
      boe.ratePerTon ?? contract.unitPrice,
      'contract',
    );

    for (const expense of EXPENSE_COLS) {
      tally(expense.key);
    }

    const purchase = tally('purchaseValue');

    cells.invValueInr = manual(
      'invValueInr',
      purchase == null
        ? { value: null, source: 'blank' }
        : {
            value: purchase,
            source: 'tally',
            refs: cells.purchaseValue.refs,
          },
    );

    cells.boeNo = {
      value: boe.boeNo,
      source: boe.boeNo ? 'boe' : 'blank',
    };

    const totalExpense = round(
      TOTAL_EXP_KEYS.reduce(
        (total, key) => total + Number(cells[key]?.value ?? 0),
        0,
      ),
    );

    cells.totValue = manual('totValue', {
      value: totalExpense,
      source: 'formula',
    });

    const usd =
      boe.invValueUsd ??
      (boe.invQty != null &&
      (boe.ratePerTon ?? contract.unitPrice) != null
        ? round(
            boe.invQty *
              Number(boe.ratePerTon ?? contract.unitPrice),
          )
        : null);

    num('invValueUsd', usd, 'contract');
    num('advPaidUsd', boe.advPaidUsd, 'contract');

    cells.balanceUsd = manual(
      'balanceUsd',
      usd == null
        ? { value: null, source: 'blank' }
        : {
            value: round(usd - Number(boe.advPaidUsd ?? 0)),
            source: 'formula',
          },
    );

    tally('advPaidInr');
    tally('balanceInr');

    num('assValue', boe.assessableValue, 'boe');

    const settlementValue = round(
      Number(cells.advPaidInr.value ?? 0) +
        Number(cells.balanceInr.value ?? 0),
    );

    cells.setValue = manual(
      'setValue',
      cells.advPaidInr.value == null &&
      cells.balanceInr.value == null
        ? { value: null, source: 'blank' }
        : {
            value: settlementValue,
            source: 'formula',
          },
    );

    cells.diffValue = manual(
      'diffValue',
      cells.purchaseValue.value == null ||
      cells.setValue.value == null
        ? { value: null, source: 'blank' }
        : {
            value: round(
              Number(cells.purchaseValue.value) -
                Number(cells.setValue.value),
            ),
            source: 'formula',
          },
    );

    return {
      boeId: boe.id,
      invoiceId: boe.invoiceId,
      invNo,
      cells,
    };
  });

  const totalKeys = [
    'invQty',
    ...EXPENSE_COLS.map(c => c.key),
    'totValue',
    'invValueUsd',
    'advPaidUsd',
    'balanceUsd',
    'advPaidInr',
    'balanceInr',
    'assValue',
    'purchaseValue',
    'setValue',
    'diffValue',
  ];

  const totals: Record<string, number> = {};

  for (const key of totalKeys) {
    totals[key] = round(
      rows.reduce(
        (total, row) =>
          total + Number(row.cells[key]?.value ?? 0),
        0,
      ),
      key === 'invQty' ? 3 : 2,
    );
  }

  // ---- 3. ERP receipts
  // A receipt is included in a BOE only after it has an explicit confirmed BOE link.
  // No contract-wide receipt distribution is performed.

  const loadSuggestions: LoadSuggestion[] = [];

  const prodNames = [
    contract.product,
    contract.erpProduct,
  ].filter(Boolean) as string[];

  const from = Math.min(
    t(contract.contractDate) || Date.now(),
    ...boeDates.map(d => d - 60 * dayMs),
  );

  for (const receipt of receipts) {
    const link = linkOf.get(`erp|${receipt.rnNo}`);
    const linkedBoeId = link?.boeId ?? null;

    const supplierScore = Math.max(
      0,
      ...supplierNames.map(s =>
        nameSimilarity(s, receipt.supplier),
      ),
    );

    const productScore = prodNames.length
      ? Math.max(
          0,
          ...prodNames.map(p =>
            nameSimilarity(p, receipt.product),
          ),
        )
      : 0.5;

    const dateOk =
      Number.isFinite(t(receipt.rnDate)) &&
      t(receipt.rnDate) >= from - 15 * dayMs;

    if (
      !link &&
      !(supplierScore >= 0.6 && productScore >= 0.5 && dateOk)
    ) {
      continue;
    }

    loadSuggestions.push({
      rnNo: receipt.rnNo,
      date: receipt.rnDate,
      vehicleNo: receipt.vehicleNo,
      supplier: receipt.supplier,
      product: receipt.product,
      qty: receipt.qty,
      poNo: receipt.poNo,
      status: link
        ? link.status === 'excluded'
          ? 'excluded'
          : 'confirmed'
        : 'suggested',
      score: round((supplierScore + productScore) / 2, 2),
      boeId: linkedBoeId,
    });
  }

  loadSuggestions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.rnNo.localeCompare(b.rnNo),
  );

  const loads: LoadRow[] = [];

  for (const boe of boes) {
    const boeReceipts = receipts
      .filter(receipt => {
        const suggestion = loadSuggestions.find(
          s => s.rnNo === receipt.rnNo,
        );

        return (
          suggestion?.status === 'confirmed' &&
          suggestion.boeId === boe.id
        );
      })
      .sort((a, b) => a.rnDate.localeCompare(b.rnDate));

    const receivedTons = round(
      boeReceipts.reduce((total, receipt) => total + receipt.qty, 0),
      3,
    );

    const boePurchaseValue =
      rows.find(row => row.boeId === boe.id)?.cells.purchaseValue
        ?.value;

    for (const receipt of boeReceipts) {
      const pick = (field: string, auto: Cell): Cell => {
        const override = ovr(
          boe.id,
          `load:${receipt.rnNo}:${field}`,
        );

        return override && override.value != null
          ? { value: override.value, source: 'manual' }
          : auto;
      };

      const freightPerTon =
        receipt.qty > 0 && receipt.freightAmt > 0
          ? round(receipt.freightAmt / receipt.qty)
          : null;

      const freightPerTonCell = pick(
        'lfPerTon',
        freightPerTon == null
          ? { value: null, source: 'blank' }
          : { value: freightPerTon, source: 'tally' },
      );

      const freightCell = pick(
        'totFreight',
        freightPerTonCell.value != null
          ? {
              value: round(
                Number(freightPerTonCell.value) * receipt.qty,
                0,
              ),
              source: 'formula',
            }
          : receipt.freightAmt > 0
            ? {
                value: receipt.freightAmt,
                source: 'tally',
              }
            : { value: null, source: 'blank' },
      );

      // Purchase value is not spread across receipts.
      // It is populated only when the receipt itself provides a bill value.
      const purchaseValueCell = pick(
        'purValue',
        receipt.billValue > 0
          ? { value: receipt.billValue, source: 'tally' }
          : { value: null, source: 'blank' },
      );

      loads.push({
        boeId: boe.id,
        rnNo: receipt.rnNo,
        date: receipt.rnDate,
        vehicleNo: receipt.vehicleNo,
        loadingTon: {
          value: round(receipt.qty, 3),
          source: 'tally',
        },
        lfPerTon: freightPerTonCell,
        totFreight: freightCell,
        purValue: purchaseValueCell,
      });
    }

    if (receivedTons > 0) {
      const invoicedQty = boe.invQty;

      if (
        invoicedQty != null &&
        Math.abs(receivedTons - invoicedQty) > 0.0005
      ) {
        notes.push(
          `BOE ${boe.boeNo || boe.id}: received ${receivedTons} MT against ${invoicedQty} MT invoiced.`,
        );
      }
    }

    if (
      boePurchaseValue != null &&
      receivedTons > 0 &&
      !loads.some(l => l.boeId === boe.id)
    ) {
      notes.push(
        `BOE ${boe.boeNo || boe.id}: no confirmed ERP receipt is allocated yet.`,
      );
    }
  }

  const loadTotals = {
    tons: round(
      loads.reduce(
        (total, load) =>
          total + Number(load.loadingTon.value ?? 0),
        0,
      ),
      3,
    ),
    freight: round(
      loads.reduce(
        (total, load) =>
          total + Number(load.totFreight.value ?? 0),
        0,
      ),
    ),
    purValue: round(
      loads.reduce(
        (total, load) =>
          total + Number(load.purValue.value ?? 0),
        0,
      ),
    ),
  };

  // ---- 4. Per-ton calculations are independent for each BOE.
  // Each BOE uses only its own settlement row, confirmed receipts and
  // BOE-scoped manual overrides. No contract-level values are distributed.

  const perTonByBoe: Settlement['perTonByBoe'] = {};

  for (const boe of boes) {
    const boeRow = rows.find(row => row.boeId === boe.id);
    const boeLoads = loads.filter(load => load.boeId === boe.id);

    const receivedTons = round(
      boeLoads.reduce(
        (total, load) =>
          total + Number(load.loadingTon.value ?? 0),
        0,
      ),
      3,
    );

    const applyOverride = (key: string, cell: Cell): Cell => {
      const override = ovr(boe.id, key);

      return override && override.value != null
        ? { value: override.value, source: 'manual' }
        : cell;
    };

    const partyAmount = applyOverride(
      'partyAmount',
      boeRow?.cells.setValue?.value != null
        ? {
            value: boeRow.cells.setValue.value,
            source: 'formula',
          }
        : { value: null, source: 'blank' },
    );

    const totalExp = applyOverride(
      'totalExp',
      boeRow?.cells.totValue ?? {
        value: null,
        source: 'blank',
      },
    );

    const receivedTonsCell = applyOverride(
      'receivedTons',
      receivedTons > 0
        ? { value: receivedTons, source: 'tally' }
        : { value: null, source: 'blank' },
    );

    const perTonCost = applyOverride(
      'perTonCost',
      partyAmount.value != null &&
      Number(receivedTonsCell.value ?? 0) > 0
        ? {
            value: round(
              (Number(partyAmount.value) +
                Number(totalExp.value ?? 0)) /
                Number(receivedTonsCell.value),
            ),
            source: 'formula',
          }
        : { value: null, source: 'blank' },
    );

    perTonByBoe[boe.id] = {
      partyAmount,
      totalExp,
      receivedTons: receivedTonsCell,
      perTonCost,
    };
  }

  const emptyPerTon: Settlement['perTon'] = {
    partyAmount: { value: null, source: 'blank' },
    totalExp: { value: null, source: 'blank' },
    receivedTons: { value: null, source: 'blank' },
    perTonCost: { value: null, source: 'blank' },
  };

  // Keep the old property temporarily so existing consumers continue to
  // compile while the page is migrated to select perTonByBoe[boeId].
  const perTon = boes.length
    ? perTonByBoe[boes[0].id] ?? emptyPerTon
    : emptyPerTon;

  const openSuggestions = suggestions.filter(
    s => s.status === 'candidate',
  ).length;

  if (openSuggestions) {
    notes.push(
      `${openSuggestions} Day Book line(s) need review. Confirm or exclude them, and assign a BOE where applicable.`,
    );
  }

  if (boes.length === 0) {
    notes.push(
      'No BOEs are configured for this contract yet. Add at least one BOE to generate settlement sheets.',
    );
  }

  if (boes.some(boe => !boe.boeNo)) {
    notes.push(
      'Enter the BOE number for each BOE. Day Book matching uses BOE and invoice references.',
    );
  }

  const unallocatedTally = suggestions.filter(
    s =>
      s.status !== 'excluded' &&
      !s.boeId,
  ).length;

  if (unallocatedTally) {
    notes.push(
      `${unallocatedTally} Tally line(s) are not allocated to a BOE. They are not included in any BOE settlement totals.`,
    );
  }

  const unallocatedReceipts = loadSuggestions.filter(
    s => s.status === 'confirmed' && !s.boeId,
  ).length;

  if (unallocatedReceipts) {
    notes.push(
      `${unallocatedReceipts} confirmed ERP receipt(s) have no BOE allocation and are excluded from BOE load totals.`,
    );
  }

  const sheetQty =
    contract.quantity != null
      ? `${contract.quantity}${contract.uom ? ` ${contract.uom}` : ''}`
      : '';

  return {
    header: {
      contractNo: contract.contractNumber,
      party: contract.supplierName,
      commodity: contract.product,
      contractQty: sheetQty,
      ratePerTon:
        contract.unitPrice != null
          ? `${contract.unitPrice}${contract.currency ? ` ${contract.currency}` : ''}`
          : '',
    },
    rows,
    totals,
    perTonByBoe,
    perTon,
    loads,
    loadTotals,
    suggestions: suggestions.sort(
      (a, b) => a.date.localeCompare(b.date),
    ),
    loadSuggestions,
    notes,
  };
}

/** Best-effort end date of a free-text shipment period. */
export function parseShipmentEnd(
  text: string | null | undefined,
): string | null {
  const s = String(text || '');

  if (!s.trim()) return null;

  const ymd = [...s.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].pop();

  if (ymd) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }

  const dmy = [
    ...s.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g),
  ].pop();

  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];

  const year = (s.match(/\b(20\d{2})\b/) || [])[1];

  if (!year) return null;

  const hits = [
    ...s.toLowerCase().matchAll(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g,
    ),
  ].map(m => months.indexOf(m[1]));

  if (!hits.length) return null;

  const month = hits[hits.length - 1];

  const day = (
    s.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–]|to)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+[A-Za-z]{3}/,
    ) || []
  )[2];

  const lastDay = new Date(
    Date.UTC(Number(year), month + 1, 0),
  ).getUTCDate();

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(
    Math.min(Number(day) || lastDay, lastDay),
  ).padStart(2, '0')}`;
}
