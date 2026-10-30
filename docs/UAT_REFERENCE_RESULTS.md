# V2.1 UAT Reference Results

These values are **not hardcoded application outputs**. They are acceptance expectations calculated independently from the exact files shipped in `reference-samples/`.

## Transaction reconciliation – 01-Sep-2026 Weighment master

Expected from the supplied source files:

- Weighment rows: **55**
- One-to-one Weighment → Gate matches: **52**
- Weighment rows requiring Gate review: **3**
- Purchases: **15**
  - Found in Tally Day Book Purchase Order `Vch No.`: **14**
  - Not found: **1** – `CO-PO/108/25-26`
- Sales: **18**
  - Found in Tally Day Book Sales Order `Vch No.`: **14**
  - Not found within Tally coverage: **3**
  - Not verifiable because Gate date is beyond uploaded Tally coverage: **1** – `OIL-SO/00502/26-27` dated 02-Sep-2026
- Internal Job Work: **7**
- Supplies: **12**
- External Job Work: **0**

Expected unmatched Weighment rows:

1. `0141473` – `TN52A6589` – SHANTHI – DORB
2. `0141478` – `TN28AF3575` – SVMA SOYA FOODS – PK SHIPS
3. `0141532` – `TRACTOR` – SVMA INNER SHIFITING – WAX

Important behavior: extra Gate rows are ignored for this reconciliation. A Gate row may only be allocated to one Weighment occurrence.

## Vendor payment reconciliation

Expected from the supplied Credit/Debit Note and Tally Day Book using the V2.3.1 SVMA rule:

- Valid Credit/Debit purchase detail rows: **72**
- Payment vouchers matched by **Lot sequence + Vendor + Vch Type Payment**: **12**
- No matching Payment for that Lot + Vendor in the uploaded Tally period: **60**
- Source payable formula: **AJ + 5% GST - (AK + AL) - AB - AC**
- With the supplied test files and this exact formula, the 12 located payments resolve to **10 SHORT PAID** and **2 EXCESS PAID** at a ₹1 tolerance.

This benchmark is not hardcoded. It is included to catch parser regressions. The result differs from the older NetValue/Tally-liability method because V2.3.1 intentionally follows the revised SVMA formula supplied for UAT.

For multi-reference Payment vouchers (for example one voucher covering several Lot sequences), the parent Debit Amount is retained as the voucher total and the matched `Agst Ref` child allocation is used for the individual Lot amount comparison.

