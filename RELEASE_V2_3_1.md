# SVMA Intelligent AI Operations v2.3.1

This UAT build combines the V2.3 Quality split with the revised SVMA Vendor Payment reconciliation rule.

## Finance – Vendor Payment Reconciliation

The process uses only two source files:

1. Credit / Debit Note List (purchase information only)
2. Tally Day Book

The Credit / Debit Note is the master population. `LotNumber` in Excel column H is reduced to its six-digit sequence, e.g. `RB-R/082205/26-27` -> `082205`. That sequence is searched in Tally Day Book column C under an `Agst Ref` belonging to a voucher whose **Vch Type is exactly Payment**.

Payment is confirmed only when the Lot sequence and vendor agree. The Payment header Debit Amount (Tally column I) is retained as the voucher total. Where one Payment voucher contains several `Agst Ref` lots, the matched child allocation is used for the individual Lot comparison so the total is not duplicated across every Lot.

### SVMA source payable formula

`AJ + 5% GST - (AK + AL) - AB - AC`

Equivalent calculation:

`BillValue * 1.05 - (Rebate Value + Rebate IGST Amount) - Weightment - Unloading`

The reconciliation output shows every formula component, the calculated payable, matched Tally column-C reference, Vch Type, Vch No., Payment Debit total, Lot allocation, paid amount, difference and status.

Statuses: `RECONCILED`, `SHORT PAID`, `EXCESS PAID`, `NOT PAID`.

## Quality / Solvent source structure

- `E) LAB ANALYSING REPORT` is moved into **Quality Data Entry**.
- Quality Head receives **Quality** Dashboard, metric Analytics, AI Inference, Reports, Deviations and Action Tickets.
- Solvent source categories and repeated source S.No. values are retained from the PDF.
- Thermic Fluid Boiler source rows now continue through S.No. 18 across pages 25–26.
- Solvent Head and Quality Head can download completed shift data to Excel.

## Database

If upgrading from V2.2/V2.2.1, run `sql/000_RUN_THIS_NOW_V2_3.sql` once. The vendor-payment code change itself needs no additional database migration.
