# Implementation notes

## Reconciliation design

The matching order is intentionally deterministic-first:

1. Normalize source values.
2. Exact normalized physical match by vehicle.
3. Classify movement by PO/JW/material/internal-party rules.
4. Match accounting candidates by PO/SO/voucher/reference/party evidence.
5. AI reviews uncertain candidates only.
6. Human review remains required for ambiguous matches.

## Source-specific initial business rules

- `RB-PO` => Rice Bran Purchase.
- `JW` reference => Job Work.
- `SVMA SOYA FOODS PRIVATE LIMITED` and `MAXI BIO OLEOS PVT LTD` => Internal Job Work parties.
- Water, Firewood, Store Material and Jute/Gunny are supply categories.
- Other identifiable PO/raw materials including Soya Bean and Copra are other raw material purchase.

## Shift and safety

The supplied Solvent/Boiler sheet mixes hourly numeric readings, shift checks, condition checks, conditional entries and `NO ENTRY` blocks. Therefore the database stores frequency and input type per parameter instead of forcing all rows into an hourly numeric grid.
