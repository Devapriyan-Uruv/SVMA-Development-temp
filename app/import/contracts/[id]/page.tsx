
'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { DayBookUpload } from '../../DayBookUpload';
import type {
  Cell,
  Settlement,
  Suggestion,
  LoadSuggestion,
  Invoice,
} from '@/lib/importSettlement/engine';

type Payload = {
  contract: any;
  record: { id: string; refCode: string } | null;
  invoices: Invoice[];
  settlement: Settlement;
  dayBook: {
    from: string | null;
    to: string | null;
    vouchers: number;
    searched: { from: string; to: string };
  };
  keyDates: Record<string, string | null>;
  canEdit: boolean;
};

const BLOCKS: {
  title: string;
  cols: [string, number, string][];
}[] = [
  {
    title: 'Invoice & expense details',
    cols: [
      ['invNo', 6, 'Inv. no'],
      ['invQty', 7, 'Inv. qty'],
      ['ratePerTon', 8, 'R.P. ton'],
      ['insurance', 9, 'Insurance'],
      ['invValueInr', 10, 'Inv. value INR'],
      ['bankChgs', 11, 'Bank chgs'],
      ['boeNo', 12, 'BOE no'],
      ['duty', 13, 'Duty'],
      ['igst', 14, 'IGST'],
      ['dutyInterest', 15, 'Duty interest'],
      ['linerFees', 16, 'Liner fees'],
      ['pqFees', 17, 'PQ fees'],
      ['cfs', 18, 'CFS'],
      ['chaFees', 19, 'CHA fees'],
      ['fssai', 20, 'FSSAI'],
      ['handCharges', 21, 'Hand charges'],
      ['surveyor', 22, 'Surveyor'],
      ['demurrage', 23, 'Demurrage'],
      ['freight', 24, 'Freight'],
      ['comFees', 25, 'Com. fees'],
      ['totValue', 26, 'Tot. value'],
    ],
  },
  {
    title: 'Settlement & debit / credit note details',
    cols: [
      ['invNo', 27, 'Inv. no'],
      ['invQty', 28, 'Inv. qty'],
      ['ratePerTon', 29, 'R.P. ton'],
      ['invValueUsd', 30, 'Inv. value USD'],
      ['advPaidUsd', 31, 'Adv. paid USD'],
      ['balanceUsd', 32, 'Balance USD'],
      ['advPaidInr', 33, 'Adv. paid INR'],
      ['balanceInr', 34, 'Balance INR'],
      ['assValue', 35, 'Assessable value'],
      ['purchaseValue', 36, 'Purchase value'],
      ['setValue', 37, 'Set value'],
      ['diffValue', 38, 'Diff value'],
    ],
  },
];

const TEXT_KEYS = new Set(['invNo', 'boeNo']);

const DOT: Record<string, { c: string; t: string }> = {
  contract: { c: '#2b6fec', t: 'Contract / invoice' },
  tally: { c: '#1f9d6b', t: 'Tally Day Book / ERP' },
  boe: { c: '#7b5cc4', t: 'Bill of Entry' },
  formula: { c: '#9aa3b2', t: 'Calculated' },
  manual: { c: '#d98c1f', t: 'Typed over' },
  blank: { c: 'transparent', t: '' },
};

const inr = (n: unknown, d = 2) =>
  n == null || n === ''
    ? '—'
    : Number(n).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: d,
      });

const day = (d?: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

export default function SettlementPage() {
  const { id } = useParams<{ id: string }>();

  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [inv, setInv] = useState<Invoice[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [erp, setErp] = useState({
    supplier: '',
    product: '',
  });

  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState<Record<string, string>>({});

  const [invoicePick, setInvoicePick] = useState<Record<string, string>>({});

  // Load settlement information
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/import-contracts/${id}/settlement`,
        { cache: 'no-store' }
      );

      const j = await r.json();

      if (!r.ok) throw new Error(j.error);

      setD(j);

      setInv(
        j.invoices.map((x: Invoice) => ({ ...x }))
      );

      setDates(
        Object.fromEntries(
          [
            'shipment_end_date',
            'eta_date',
            'delivery_date',
            'settlement_due_date',
            'settled_at',
          ].map(k => [k, j.keyDates[k] || ''])
        )
      );

      setErp({
        supplier: j.contract.erpSupplier || '',
        product: j.contract.erpProduct || '',
      });

      setErr('');
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : 'Unable to load the settlement sheet.'
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
    fetch('/api/import-contracts/alerts').catch(() => {});
  }, [load]);

  // Save data
  async function save(
    body: Record<string, unknown>,
    ok: string
  ) {
    setBusy(true);
    setMsg('');
    setErr('');

    try {
      const r = await fetch(
        `/api/import-contracts/${id}/settlement`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      const j = await r.json();

      if (!r.ok) throw new Error(j.error);

      setMsg(ok);
      await load();
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : 'Unable to save.'
      );
    } finally {
      setBusy(false);
    }
  }

  // Tally and ERP linking
  // Tally and ERP linking
const setLink = (
  kind: 'tally' | 'erp',
  refKey: string,
  status: 'confirmed' | 'excluded' | null,
  colKey?: string | null,
  invoiceId?: string | null
) =>
  save(
    {
      links: [
        {
          kind,
          refKey,
          status,
          colKey: colKey || null,
          invoiceId: kind === 'tally' ? invoiceId || null : null,
        },
      ],
    },
    status == null
      ? 'Reset.'
      : status === 'confirmed'
        ? 'Confirmed.'
        : 'Excluded.'
  );

  // Manual cell override
  const saveCell = (
    invoiceId: string | null,
    colKey: string
  ) => {
    const v = draft.trim().replace(/,/g, '');

    setEditing(null);

    void save(
      {
        overrides: [
          {
            invoiceId,
            colKey,
            value: v === '' ? null : Number(v),
          },
        ],
      },
      v === '' ? 'Typed value removed.' : 'Saved.'
    );
  };

  const s = d?.settlement;
  const saved =
    !!d && d.invoices.every(x => x.id !== 'new');
  const canEdit = !!d?.canEdit;

  // Editable settlement cell
  const cellEl = (
    c: Cell | undefined,
    invoiceId: string | null,
    key: string,
    text?: boolean
  ) => {
    const k = `${invoiceId}|${key}`;
    const dot = DOT[c?.source || 'blank'];

    if (editing === k) {
      return (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => saveCell(invoiceId, key)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }

            if (e.key === 'Escape') {
              setEditing(null);
            }
          }}
          style={{ width: 96 }}
        />
      );
    }

    const val = c?.value;

    return (
      <span
        title={dot.t}
        onClick={() => {
          if (text || !canEdit) return;

          setEditing(k);
          setDraft(val == null ? '' : String(val));
        }}
        style={{
          cursor: text || !canEdit ? 'default' : 'text',
          whiteSpace: 'nowrap',
        }}
      >
        {dot.t ? (
          <i
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dot.c,
              marginRight: 5,
              verticalAlign: 1,
            }}
          />
        ) : null}

        {text ? val ?? '—' : inr(val)}
      </span>
    );
  };

  // Day Book filtering
  const rows = s?.suggestions || [];

  const shown = useMemo(
    () =>
      rows.filter(
        x =>
          !filter ||
          `${x.ledger} ${x.vchNo} ${x.narration} ${x.vchType}`
            .toLowerCase()
            .includes(filter.toLowerCase())
      ),
    [rows, filter]
  );

  const candidates = shown.filter(
    x => x.status === 'candidate'
  );

  const matched = shown.filter(
    x =>
      x.status === 'auto' ||
      x.status === 'confirmed'
  );

  const excluded = shown.filter(
    x => x.status === 'excluded'
  );

  // Excel export - preserve existing worksheets
  async function excel() {
    if (!d || !s) return;

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const c = d.contract;

    const head = [
      ['SETTLEMENT SHEET — ' + c.supplierName],
      [
        `Contract ${s.header.contractNo} • ${s.header.commodity} • ${s.header.contractQty} • rate ${s.header.ratePerTon}`,
      ],
      [],
    ];

    const expenseCols = BLOCKS[0].cols;
    const settlementCols = BLOCKS[1].cols;

    const aoa: any[][] = [
      ...head,

      ['CONTRACT INFORMATION'],
      [
        '01 Contract No',
        s.header.contractNo,
        '02 Party',
        s.header.party,
      ],
      [
        '03 Commodity',
        s.header.commodity,
        '04 Contract Qty',
        s.header.contractQty,
        '05 Rate per ton',
        s.header.ratePerTon,
      ],

      [],
      ['EXPENSE DETAILS'],
      ['Column no.', ...expenseCols.map(x => x[1])],
      ['Description', ...expenseCols.map(x => x[2])],

      ...s.rows.map(r => [
        '',
        ...expenseCols.map(([k]) => r.cells[k]?.value ?? ''),
      ]),

      [
        'TOTAL',
        ...expenseCols.map(([k]) =>
          TEXT_KEYS.has(k) ? '' : s.totals[k] ?? ''
        ),
      ],

      [],
      ['SETTLEMENT & DEBIT / CREDIT NOTE DETAILS'],
      ['Column no.', ...settlementCols.map(x => x[1])],
      ['Description', ...settlementCols.map(x => x[2])],

      ...s.rows.map(r => [
        '',
        ...settlementCols.map(([k]) => r.cells[k]?.value ?? ''),
      ]),

      [
        'TOTAL',
        ...settlementCols.map(([k]) =>
          TEXT_KEYS.has(k) ? '' : s.totals[k] ?? ''
        ),
      ],

      [],
      ['PER TON COST'],
      ['Column no.', 39, 40, 41, 42],
      [
        'Description',
        'Party amount',
        'Total expenses',
        'Received tons',
        'Per ton cost',
      ],
      [
        '',
        s.perTon.partyAmount.value ?? '',
        s.perTon.totalExp.value ?? '',
        s.perTon.receivedTons.value ?? '',
        s.perTon.perTonCost.value ?? '',
      ],
    ];

    const w1 = XLSX.utils.aoa_to_sheet(aoa);

    w1['!cols'] = [
      { wch: 18 },
      ...Array.from({ length: 21 }, () => ({ wch: 16 })),
    ];

    XLSX.utils.book_append_sheet(wb, w1, 'Settlement');

    // Received loads worksheet
    const w2 = XLSX.utils.aoa_to_sheet([
      ['RECEIVED QTY LOAD-WISE DETAILS (from the ERP)'],
      [],
      [
        'Date',
        'RN no',
        'Vehicle no',
        'Loading ton',
        'LF per ton',
        'Tot. freight',
        'Pur. value',
      ],

      ...s.loads.map(l => [
        l.date,
        l.rnNo,
        l.vehicleNo,
        l.loadingTon.value,
        l.lfPerTon.value ?? '',
        l.totFreight.value ?? '',
        l.purValue.value ?? '',
      ]),

      [
        'Total',
        '',
        '',
        s.loadTotals.tons,
        '',
        s.loadTotals.freight,
        s.loadTotals.purValue,
      ],
    ]);

    w2['!cols'] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(wb, w2, 'Received loads');

    // Day Book evidence worksheet
    const w3 = XLSX.utils.aoa_to_sheet([
      ['DAY BOOK LINES BEHIND THE FIGURES'],
      [],
      [
        'Date',
        'Voucher type',
        'Voucher no',
        'Ledger',
        'Amount',
        'Counted as',
        'Status',
        'Evidence',
        'Narration',
      ],

      ...s.suggestions.map(x => [
        x.date,
        x.vchType,
        x.vchNo,
        x.ledger,
        x.amount,
        x.colKey || '',
        x.status,
        x.evidence.join('; '),
        x.narration,
      ]),
    ]);

    w3['!cols'] = [
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 34 },
      { wch: 14 },
      { wch: 14 },
      { wch: 11 },
      { wch: 30 },
      { wch: 50 },
    ];

    XLSX.utils.book_append_sheet(wb, w3, 'Day Book lines');

    XLSX.writeFile(
      wb,
      `Import_Settlement_${String(c.contractNumber).replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`
    );
  }

  // Loading state
  if (!d) {
    return (
      <>
        <PageHeader
          title="Settlement sheet"
          subtitle=""
          backHref="/import/contracts"
          backLabel="Import contracts"
        />

        {err ? (
          <div className="notice danger">{err}</div>
        ) : (
          <div className="empty">Loading…</div>
        )}
      </>
    );
  }

  const c = d.contract;

  const dateField = (k: string, label: string) => (
    <div className="field" key={k}>
      <label>{label}</label>
      <input
        type="date"
        disabled={!canEdit}
        value={dates[k] || ''}
        onChange={e =>
          setDates({ ...dates, [k]: e.target.value })
        }
      />
    </div>
  );

  const th: React.CSSProperties = {
    fontSize: 11,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  };

  return (
    <>
      <PageHeader
        title={`Settlement — ${c.contractNumber}`}
        subtitle=""
        backHref="/import/contracts"
        backLabel="Import contracts"
        action={
          <div className="action-row">
            <StatusBadge
              status={c.status === 'Confirmed' ? 'ok' : 'warn'}
              label={c.status}
            />
            <button className="btn btn-outline" onClick={excel}>
              <Download size={15} /> Excel
            </button>
          </div>
        }
      />

      {err ? (
        <div className="notice danger" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}

      {msg ? (
        <div className="notice" role="status" style={{ marginTop: 10 }}>
          {msg}
        </div>
      ) : null}

      {/* Import record */}
      {d.record ? (
        <div className="notice" style={{ marginTop: 10 }}>
          Invoice, advance, Bill of Entry and assessable value are read
          from import record{' '}
          <a href={`/import/${d.record.id}`}>
            <b>{d.record.refCode}</b>
          </a>{' '}
          — fill them there once.
        </div>
      ) : c.status === 'Confirmed' ? (
        <div className="notice warn" style={{ marginTop: 10 }}>
          No import record is linked to this contract yet.{' '}
          {canEdit ? (
            <button
              className="btn btn-outline"
              style={{ marginLeft: 8 }}
              disabled={busy}
              onClick={() =>
                save(
                  { createRecord: true },
                  'Import record created.'
                )
              }
            >
              Create import record
            </button>
          ) : null}
        </div>
      ) : null}

      {c.status !== 'Confirmed' ? (
        <div className="notice warn" style={{ marginTop: 10 }}>
          This contract is still <b>{c.status}</b> — confirm it on the
          Contracts page so its alerts start.
        </div>
      ) : null}

      
      {/* Key dates */}
      <section className="card" style={{ marginTop: 14 }}>
        <div className="section-title">
          Key dates — the alerts run on these
        </div>

        <div className="grid two" style={{ marginTop: 8 }}>
          {dateField('shipment_end_date', 'Shipment period ends')}
          {dateField('eta_date', 'Arrival (ETA at port)')}
          {dateField('delivery_date', 'Contract delivery date')}
          {dateField('settlement_due_date', 'Settlement due date')}
          {dateField('settled_at', 'Settled on (stops the alerts)')}
        </div>

        {d.keyDates.suggestedShipmentEnd && !dates.shipment_end_date ? (
          <p className="sub" style={{ margin: '4px 0' }}>
            Contract shipment period “{c.shipmentPeriod}” suggests{' '}
            {day(d.keyDates.suggestedShipmentEnd)} —{' '}
            <button
              className="btn btn-outline"
              style={{ padding: '2px 8px' }}
              onClick={() =>
                setDates({
                  ...dates,
                  shipment_end_date: d.keyDates.suggestedShipmentEnd!,
                })
              }
            >
              use it
            </button>
          </p>
        ) : null}

        <div className="grid two" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Name of the supplier in the ERP (if different)</label>
            <input
              disabled={!canEdit}
              value={erp.supplier}
              onChange={e =>
                setErp({ ...erp, supplier: e.target.value })
              }
              placeholder={c.supplierName}
            />
          </div>

          <div className="field">
            <label>Name of the product in the ERP (if different)</label>
            <input
              disabled={!canEdit}
              value={erp.product}
              onChange={e =>
                setErp({ ...erp, product: e.target.value })
              }
              placeholder={c.product || ''}
            />
          </div>
        </div>

        {canEdit ? (
          <button
            className="btn btn-primary"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={() =>
              save(
                {
                  dates: {
                    ...dates,
                    erpSupplier: erp.supplier,
                    erpProduct: erp.product,
                  },
                },
                'Dates saved.'
              )
            }
          >
            Save dates and ERP names
          </button>
        ) : null}
      </section>

      {/* Invoices and BOE */}
      <section className="card" style={{ marginTop: 14 }}>
        <div className="section-title">
          Invoices and Bills of Entry
        </div>

        <div
          className="table-wrap"
          style={{ border: 0, marginTop: 8 }}
        >
          <table>
            <thead>
              <tr>
                <th>Invoice no</th>
                <th>Qty (MT)</th>
                <th>Rate / MT</th>
                <th>Adv. paid USD</th>
                <th>BOE no</th>
                <th>BOE date</th>
                <th>Assessable value (BOE)</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {inv.map((x, i) => (
                <tr key={x.id + i}>
                  <td>
                    <input
                      value={x.invNo}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? { ...y, invNo: e.target.value }
                              : y
                          )
                        )
                      }
                      style={{ width: 130 }}
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      step="any"
                      value={x.invQty ?? ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? {
                                  ...y,
                                  invQty:
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value),
                                }
                              : y
                          )
                        )
                      }
                      style={{ width: 90 }}
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      step="any"
                      value={x.ratePerTon ?? ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? {
                                  ...y,
                                  ratePerTon:
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value),
                                }
                              : y
                          )
                        )
                      }
                      style={{ width: 90 }}
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      step="any"
                      value={x.advPaidUsd ?? ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? {
                                  ...y,
                                  advPaidUsd:
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value),
                                }
                              : y
                          )
                        )
                      }
                      style={{ width: 100 }}
                    />
                  </td>

                  <td>
                    <input
                      value={x.boeNo || ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? { ...y, boeNo: e.target.value }
                              : y
                          )
                        )
                      }
                      style={{ width: 110 }}
                    />
                  </td>

                  <td>
                    <input
                      type="date"
                      value={x.boeDate || ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? { ...y, boeDate: e.target.value }
                              : y
                          )
                        )
                      }
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      step="any"
                      value={x.assessableValue ?? ''}
                      disabled={!canEdit}
                      onChange={e =>
                        setInv(
                          inv.map((y, j) =>
                            j === i
                              ? {
                                  ...y,
                                  assessableValue:
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value),
                                }
                              : y
                          )
                        )
                      }
                      style={{ width: 130 }}
                    />
                  </td>

                  <td>
                    {canEdit ? (
                      <button
                        className="btn btn-outline"
                        title="Remove"
                        onClick={() =>
                          x.id === 'new' || !x.id
                            ? setInv(
                                inv.filter((_, j) => j !== i)
                              )
                            : void save(
                                {
                                  invoices: [
                                    { id: x.id, delete: true },
                                  ],
                                },
                                'Invoice removed.'
                              )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit ? (
          <div className="action-row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-outline"
              onClick={() =>
                setInv([
                  ...inv,
                  {
                    id: 'new',
                    invNo: '',
                    invQty: null,
                    ratePerTon:
                      c.unitPrice == null
                        ? null
                        : Number(c.unitPrice),
                    invValueUsd: null,
                    advPaidUsd: null,
                    boeNo: null,
                    boeDate: null,
                    assessableValue: null,
                  },
                ])
              }
            >
              <Plus size={14} /> Add invoice
            </button>

            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                save(
                  { invoices: inv.map(x => ({ ...x })) },
                  'Invoices saved.'
                )
              }
            >
              Save invoices
            </button>
          </div>
        ) : null}
      </section>

      {/* =================================================
          SETTLEMENT SHEET - BOX LAYOUT
      ================================================= */}

      <section className="card svma-sheet-card">

        {/* Header */}
        <div className="svma-sheet-title">
          <div>
            <h2>SETTLEMENT SHEET</h2>
            <p>Import Contract Settlement & Expense Statement</p>
          </div>

          <span className="svma-sheet-contract">
            {c.contractNumber}
          </span>
        </div>

        {!saved ? (
          <div className="notice warn" style={{ margin: 14 }}>
            Save the invoice row first — then the sheet fills from the
            Day Book and figures can be typed over.
          </div>
        ) : null}

        {s!.notes.map((n, i) => (
          <div
            key={i}
            className="notice"
            style={{ margin: '10px 14px' }}
          >
            {n}
          </div>
        ))}

        {/* Contract information */}
        <div className="svma-sheet-section">
          <div className="svma-section-heading">
            CONTRACT INFORMATION
            
          </div>

          <div className="svma-contract-grid">
            {[
              ['01 · CONTRACT NO', s!.header.contractNo],
              ['02 · PARTY NAME', s!.header.party],
              ['03 · COMMODITY', s!.header.commodity],
              ['04 · CONTRACT QTY', s!.header.contractQty],
              ['05 · RATE PER TON USD', s!.header.ratePerTon],
            ].map(([label, value]) => (
              <div className="svma-info-box" key={label}>
                <span>{label}</span>
                <strong>{value || '—'}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Expense and settlement tables */}
        {BLOCKS.map((b, bi) => (
          <div className="svma-sheet-section" key={b.title}>
            <div className="svma-section-heading">
              <span>
                {bi === 0
                  ? 'EXPENSE DETAILS'
                  : 'SETTLEMENT & DEBIT / CREDIT NOTE DETAILS'}
              </span>

             
            </div>

            <div className="svma-table-scroll">
              <table
                className={`svma-grid-table ${
                  bi === 0
                    ? 'svma-expense-table'
                    : 'svma-settlement-table'
                }`}
              >
                <thead>
                  <tr className="svma-number-row">
                    {b.cols.map(([k, no]) => (
                      <th key={k}>{no}</th>
                    ))}
                  </tr>

                  <tr className="svma-label-row">
                    {b.cols.map(([k, no, label]) => (
                      <th key={k} title={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {s!.rows.map(r => (
                    <tr key={r.invoiceId}>
                      {b.cols.map(([k]) => (
                        <td
                          key={k}
                          className={
                            TEXT_KEYS.has(k)
                              ? 'svma-text-cell'
                              : 'svma-number-cell'
                          }
                        >
                          {cellEl(
                            r.cells[k],
                            r.invoiceId,
                            k,
                            TEXT_KEYS.has(k)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {s!.rows.length > 0 ? (
                    <tr className="svma-total-row">
                      {b.cols.map(([k], i) => (
                        <td key={k}>
                          {i === 0
                            ? 'TOTAL'
                            : TEXT_KEYS.has(k)
                              ? ''
                              : inr(s!.totals[k])}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Per Ton Cost */}
        <div className="svma-sheet-section">
          <div className="svma-section-heading">
            <span>PER TON COST</span>
            
          </div>

          <div className="svma-table-scroll">
            <table className="svma-grid-table svma-per-ton-table">
              <thead>
                <tr className="svma-number-row">
                  <th>39</th>
                  <th>40</th>
                  <th>41</th>
                  <th>42</th>
                </tr>

                <tr className="svma-label-row">
                  <th>PARTY AMOUNT</th>
                  <th>TOTAL EXPENSE</th>
                  <th>RECEIVED TONS</th>
                  <th>PER TON COST</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  {(
                    [
                      'partyAmount',
                      'totalExp',
                      'receivedTons',
                      'perTonCost',
                    ] as const
                  ).map(k => (
                    <td key={k} className="svma-number-cell">
                      {cellEl(s!.perTon[k], null, k)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <p className="svma-formula-note">
            <b>Calculation:</b> Per Ton Cost = (Party Amount + Total
            Expenses) ÷ Received Tons. Total expenses exclude IGST
            (recoverable).
          </p>
        </div>

        {/* Received quantity load-wise */}
        <div className="svma-sheet-section">
          <div className="svma-section-heading">
            <span>RECEIVED QTY LOAD-WISE DETAILS</span>
            <span>SOURCE: ERP</span>
          </div>

          <div className="svma-table-scroll">
            <table className="svma-grid-table svma-load-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>VEHICLE NO</th>
                  <th>LOADING TON</th>
                  <th>LF PER TON</th>
                  <th>TOTAL FREIGHT</th>
                  <th>PURCHASE VALUE</th>
                </tr>
              </thead>

              <tbody>
                {!s!.loads.length ? (
                  <tr>
                    <td colSpan={6} className="svma-empty-cell">
                      No ERP receipts confirmed yet — confirm them below.
                    </td>
                  </tr>
                ) : (
                  s!.loads.map(l => (
                    <tr key={l.rnNo}>
                      <td>{day(l.date)}</td>
                      <td>{l.vehicleNo}</td>

                      <td className="svma-number-cell">
                        {inr(l.loadingTon.value, 3)}
                      </td>

                      {(
                        [
                          'lfPerTon',
                          'totFreight',
                          'purValue',
                        ] as const
                      ).map(f => (
                        <td
                          key={f}
                          className="svma-number-cell"
                        >
                          {cellEl(
                            l[f],
                            null,
                            `load:${l.rnNo}:${f}`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}

                {s!.loads.length > 0 ? (
                  <tr className="svma-total-row">
                    <td>TOTAL</td>
                    <td />

                    <td className="svma-number-cell">
                      {inr(s!.loadTotals.tons, 3)}
                    </td>

                    <td />

                    <td className="svma-number-cell">
                      {inr(s!.loadTotals.freight, 0)}
                    </td>

                    <td className="svma-number-cell">
                      {inr(s!.loadTotals.purValue, 0)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* ERP receipts confirmation - original functionality */}
        <div className="svma-sheet-section svma-erp-confirm-section">
          <div className="svma-section-heading">
            ERP RECEIPTS TO CONFIRM
          </div>

          <div className="svma-section-content">
            <p className="sub" style={{ margin: '0 0 10px' }}>
              Matched on supplier, product and arrival window. Only
              confirmed receipts count.
            </p>

            {!s!.loadSuggestions.length ? (
              <p className="sub">
                No matching ERP receipts found. Set the supplier /
                product name as it appears in the ERP above.
              </p>
            ) : (
              <>
                {canEdit &&
                s!.loadSuggestions.some(
                  x => x.status === 'suggested'
                ) ? (
                  <button
                    className="btn btn-outline"
                    disabled={busy}
                    style={{ marginBottom: 8 }}
                    onClick={() =>
                      save(
                        {
                          links: s!.loadSuggestions
                            .filter(
                              x => x.status === 'suggested'
                            )
                            .map(x => ({
                              kind: 'erp',
                              refKey: x.rnNo,
                              status: 'confirmed',
                            })),
                        },
                        'All suggested receipts confirmed.'
                      )
                    }
                  >
                    Confirm all{' '}
                    {
                      s!.loadSuggestions.filter(
                        x => x.status === 'suggested'
                      ).length
                    }{' '}
                    suggested
                  </button>
                ) : null}

                <div className="table-wrap" style={{ border: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>RN no</th>
                        <th>Vehicle no</th>
                        <th>Supplier</th>
                        <th>Product</th>
                        <th style={th}>MT</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>

                    <tbody>
                      {s!.loadSuggestions.map(
                        (x: LoadSuggestion) => (
                          <tr key={x.rnNo}>
                            <td>{day(x.date)}</td>
                            <td>{x.rnNo}</td>
                            <td>{x.vehicleNo}</td>
                            <td>{x.supplier}</td>
                            <td>{x.product}</td>

                            <td style={{ textAlign: 'right' }}>
                              {inr(x.qty, 3)}
                            </td>

                            <td>
                              <StatusBadge
                                status={
                                  x.status === 'confirmed'
                                    ? 'ok'
                                    : x.status === 'excluded'
                                      ? 'danger'
                                      : 'warn'
                                }
                                label={x.status}
                              />
                            </td>

                            <td>
                              {canEdit ? (
                                <span className="action-row">
                                  {x.status !== 'confirmed' ? (
                                    <button
                                      className="btn btn-outline"
                                      disabled={busy}
                                      onClick={() =>
                                        setLink(
                                          'erp',
                                          x.rnNo,
                                          'confirmed'
                                        )
                                      }
                                    >
                                      Confirm
                                    </button>
                                  ) : null}

                                  {x.status !== 'excluded' ? (
                                    <button
                                      className="btn btn-outline"
                                      disabled={busy}
                                      onClick={() =>
                                        setLink(
                                          'erp',
                                          x.rnNo,
                                          'excluded'
                                        )
                                      }
                                    >
                                      Exclude
                                    </button>
                                  ) : null}

                                  {x.status !== 'suggested' ? (
                                    <button
                                      className="btn btn-outline"
                                      disabled={busy}
                                      onClick={() =>
                                        setLink(
                                          'erp',
                                          x.rnNo,
                                          null
                                        )
                                      }
                                    >
                                      Reset
                                    </button>
                                  ) : null}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Source legend */}
        <div className="svma-sheet-footer">
          {Object.entries(DOT)
            .filter(([k]) => k !== 'blank')
            .map(([k, v]) => (
              <span key={k}>
                <i style={{ background: v.c }} />
                {v.t}
              </span>
            ))}

          {canEdit && saved ? (
            <em>Click a figure to type over it.</em>
          ) : null}
        </div>
      </section>

      {/* =================================================
          DAY BOOK EVIDENCE - ORIGINAL FUNCTIONALITY
      ================================================= */}

      <section className="card" style={{ marginTop: 14, padding: 0 }}>
        <div style={{ padding: '14px 16px 0' }}>
          <div className="section-title">
            Day Book lines behind the figures
          </div>

          <p className="sub" style={{ margin: '4px 0 8px' }}>
            Lines carrying this contract's BOE, invoice or contract
            number are counted automatically. Lines inside the
            shipment window without such a number are only{' '}
            <b>candidates</b> — pick the column and confirm, or exclude
            them.
          </p>

          <input
            placeholder="Filter by ledger, voucher no or narration"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ minWidth: 280, marginBottom: 8 }}
          />
        </div>

        {(
          [
            ['To confirm', candidates, true],
            ['Counted', matched, false],
            ['Excluded', excluded, false],
          ] as [string, Suggestion[], boolean][]
        ).map(([title, list, open]) => (
          <Fragment key={title}>
            <details
              open={open || undefined}
              style={{ padding: '0 16px 12px' }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {title} ({list.length})
              </summary>

              {!list.length ? (
                <p className="sub">None.</p>
              ) : (
                <div
                  className="table-wrap"
                  style={{ border: 0, marginTop: 6 }}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Voucher</th>
                        <th>Ledger</th>
                        <th style={th}>Amount</th>
                        <th>Counted as</th>
                         <th>Invoice</th>
                        <th>Why</th>
                        <th />
                      </tr>
                    </thead>

                    <tbody>
                      {list.slice(0, 300).map(x => (
                        <tr key={x.key}>
                          <td>{day(x.date)}</td>

                          <td>
                            {x.vchType} {x.vchNo}

                            <div
                              className="sub"
                              style={{
                                maxWidth: 260,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {x.narration}
                            </div>
                          </td>

                          <td>{x.ledger}</td>

                          <td style={{ textAlign: 'right' }}>
                            {inr(x.amount)}
                          </td>

                          <td>
                            {canEdit && x.status !== 'excluded' ? (
                              <select
                                value={pick[x.key] ?? x.colKey ?? ''}
                                onChange={e =>
                                  setPick({
                                    ...pick,
                                    [x.key]: e.target.value,
                                  })
                                }
                              >
                                <option value="">— choose —</option>

                                {[
                                  ...BLOCKS[0].cols
                                    .filter(c =>
                                      [
                                        'insurance',
                                        'bankChgs',
                                        'duty',
                                        'igst',
                                        'dutyInterest',
                                        'linerFees',
                                        'pqFees',
                                        'cfs',
                                        'chaFees',
                                        'fssai',
                                        'handCharges',
                                        'surveyor',
                                        'demurrage',
                                        'freight',
                                        'comFees',
                                      ].includes(c[0])
                                    )
                                    .map(c => [c[0], c[2]]),

                                  ['purchaseValue', 'Purchase value (36)'],
                                  ['advPaidInr', 'Adv. paid INR (33)'],
                                  ['balanceInr', 'Balance INR (34)'],
                                ].map(([k, l]) => (
                                  <option key={k} value={k}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              x.colKey || '—'
                            )}
                          </td>

                          {/* Invoice selection */}
<td>
  {canEdit && x.status !== 'excluded' &&
  inv.filter(i => i.id !== 'new').length > 1 ? (
    <select
      value={invoicePick[x.key] ?? x.invoiceId ?? ''}
      onChange={e =>
        setInvoicePick({
          ...invoicePick,
          [x.key]: e.target.value,
        })
      }
    >
      <option value="">— choose invoice —</option>

      {inv
        .filter(i => i.id !== 'new')
        .map(i => (
          <option key={i.id} value={i.id}>
            {i.invNo || 'Unnamed invoice'}
            {i.boeNo ? ` • BOE ${i.boeNo}` : ''}
          </option>
        ))}
    </select>
  ) : (
    inv.find(i => i.id === x.invoiceId)?.invNo ||
    (inv.filter(i => i.id !== 'new').length === 1
      ? inv.find(i => i.id !== 'new')?.invNo
      : '—')
  )}
</td>

{/* Existing evidence */}
<td className="sub">
  {x.evidence.join('; ')}
</td>

                          <td>
                            {canEdit ? (
                              <span className="action-row">
                                {x.status !== 'excluded' ? (
                                  <button
                                    className="btn btn-outline"
                                    disabled={
  busy ||
  !(pick[x.key] ?? x.colKey) ||
  (
    inv.filter(i => i.id !== 'new').length > 1 &&
    !(invoicePick[x.key] ?? x.invoiceId)
  )
}
                                    onClick={() =>
                                      setLink(
                                        'tally',
                                        x.key,
                                        'confirmed',
                                        pick[x.key] ?? x.colKey
                                      )
                                    }
                                  >
                                    Confirm
                                  </button>
                                ) : null}

                                {x.status !== 'excluded' ? (
                                  <button
                                    className="btn btn-outline"
                                    disabled={busy}
                                    onClick={() =>
                                      setLink(
                                        'tally',
                                        x.key,
                                        'excluded'
                                      )
                                    }
                                  >
                                    Exclude
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-outline"
                                    disabled={busy}
                                    onClick={() =>
                                      setLink('tally', x.key, null)
                                    }
                                  >
                                    Reset
                                  </button>
                                )}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {list.length > 300 ? (
                    <p className="sub">
                      Showing the first 300 — use the filter.
                    </p>
                  ) : null}
                </div>
              )}
            </details>
          </Fragment>
        ))}
      </section>

      {/* =================================================
          SETTLEMENT SHEET STYLES
      ================================================= */}

      <style jsx global>{`
        .svma-sheet-card {
          padding: 0 !important;
          overflow: hidden;
          border: 1px solid #dbe2ea;
          border-radius: 12px;
          background: #fff;
          color: #172033;
        }

        .svma-sheet-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 20px 22px;
          background: #172b4d;
          color: #fff;
        }

        .svma-sheet-title h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 750;
          letter-spacing: 0.7px;
        }

        .svma-sheet-title p {
          margin: 5px 0 0;
          color: #cbd5e1;
          font-size: 12px;
        }

        .svma-sheet-contract {
          padding: 7px 11px;
          border: 1px solid #64748b;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }

        .svma-sheet-section {
          margin: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          overflow: hidden;
          background: #fff;
        }

        .svma-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 11px 14px;
          background: #eaf0f8;
          border-bottom: 1px solid #cbd5e1;
          color: #172b4d;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }

        .svma-section-heading span {
          color: #64748b;
          font-size: 10px;
          white-space: nowrap;
        }

        .svma-contract-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .svma-info-box {
          min-height: 72px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 8px;
          border-right: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
        }

        .svma-info-box:nth-child(3n) {
          border-right: 0;
        }

        .svma-info-box span {
          font-size: 10px;
          color: #64748b;
          font-weight: 750;
          letter-spacing: 0.35px;
        }

        .svma-info-box strong {
          font-size: 13px;
          color: #172033;
          overflow-wrap: anywhere;
        }

        .svma-table-scroll {
          width: 100%;
          overflow-x: auto;
          scrollbar-width: thin;
          scrollbar-color: #aab6c5 #f1f5f9;
        }

        .svma-table-scroll::-webkit-scrollbar {
          height: 8px;
        }

        .svma-table-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        .svma-table-scroll::-webkit-scrollbar-thumb {
          background: #aab6c5;
          border-radius: 8px;
        }

        .svma-grid-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          table-layout: auto;
        }

        .svma-grid-table th,
        .svma-grid-table td {
          border: 1px solid #d6dde7;
          padding: 9px 8px;
          vertical-align: middle;
        }

        .svma-grid-table th {
          text-align: center;
          font-weight: 750;
        }

        .svma-number-row th {
          background: #e2e8f0;
          color: #334155;
          font-size: 10px;
          padding: 7px 6px;
        }

        .svma-label-row th {
          background: #f1f5f9;
          color: #172b4d;
          font-size: 10px;
          line-height: 1.35;
          min-width: 88px;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .svma-expense-table {
          min-width: 1850px;
        }

        .svma-expense-table th,
        .svma-expense-table td {
          min-width: 88px;
        }

        .svma-settlement-table {
          min-width: 1250px;
        }

        .svma-settlement-table th,
        .svma-settlement-table td {
          min-width: 96px;
        }

        .svma-per-ton-table {
          min-width: 640px;
        }

        .svma-per-ton-table th {
          min-width: 145px;
        }

        .svma-load-table {
          min-width: 760px;
        }

        .svma-load-table th {
          background: #f1f5f9;
          color: #172b4d;
          font-size: 10px;
          white-space: nowrap;
        }

        .svma-grid-table td {
          background: #fff;
        }

        .svma-text-cell {
          text-align: left;
          white-space: nowrap;
        }

        .svma-number-cell {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .svma-grid-table tbody tr:hover td {
          background: #f8fafc;
        }

        .svma-grid-table tbody tr.svma-total-row td {
          background: #eaf0f8;
          color: #172b4d;
          font-weight: 800;
          border-top: 2px solid #94a3b8;
        }

        .svma-formula-note {
          margin: 0;
          padding: 10px 13px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.6;
        }

        .svma-empty-cell {
          text-align: center;
          padding: 22px !important;
          color: #94a3b8;
        }

        .svma-section-content {
          padding: 12px 14px;
        }

        .svma-sheet-footer {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 13px;
          padding: 13px 18px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #64748b;
          font-size: 10px;
        }

        .svma-sheet-footer span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .svma-sheet-footer i {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .svma-sheet-footer em {
          font-style: normal;
          margin-left: auto;
        }

        @media (max-width: 700px) {
          .svma-sheet-title {
            padding: 16px;
            align-items: flex-start;
          }

          .svma-sheet-title h2 {
            font-size: 15px;
          }

          .svma-sheet-section {
            margin: 9px;
          }

          .svma-contract-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .svma-info-box:nth-child(3n) {
            border-right: 1px solid #e2e8f0;
          }

          .svma-info-box:nth-child(2n) {
            border-right: 0;
          }

          .svma-section-heading {
            font-size: 10px;
          }
        }

        @media (max-width: 420px) {
          .svma-contract-grid {
            grid-template-columns: 1fr;
          }

          .svma-info-box,
          .svma-info-box:nth-child(3n) {
            border-right: 0;
          }
        }
      `}</style>
    </>
  );
}
