# Current-source structural validation

This is a parser/mapping smoke check against the source files included in `reference-samples/`. It is **not** an accounting sign-off or the final operational-window reconciliation.

- Weighment Register: 55 physical rows detected in the supplied 01-Sep-2026 register.
- Gate In: 66 rows detected in the supplied export.
- Gate Out: 48 rows detected in the supplied export.
- 53 of the 55 Weighment vehicle rows have a normalized vehicle number present in at least one supplied Gate In/Gate Out row before one-to-one/time-window resolution.
- Two raw vehicle values did not have a direct normalized vehicle presence in the supplied Gate exports during this structural smoke check: `TN28AF3575` and `TRACTOR`.
- Gate In contains 38 non-empty PO/reference values; 24 have an exact normalized `Vch No.` occurrence among Tally Day Book `Purchase Order...` voucher types before AI/party/date logic.
- Gate Out contains 48 non-empty SO/reference values; 24 have an exact normalized `Vch No.` occurrence among Tally Day Book `Sales Order...` voucher types before removing internal Job Work and applying the operational window.

The application performs the actual process in stages: operational-window filtering, vehicle matching, business classification, Tally register + Day Book matching, exception creation and AI-assisted review for uncertain candidates.
