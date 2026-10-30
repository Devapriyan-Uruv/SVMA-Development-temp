# SVMA AI Intelligence Platform V2.4.1

Build-stability patch for V2.4.

## Fixed
- Shift-session product typing now uses the canonical `ProductCode` union.
- Mandatory-entry calculation safely handles Supabase nested `parameter_sections` relation shapes.
- Quality AI Inference now resolves product labels with `productName()` instead of indexing the product array as an object.
- Solvent AI Inference now resolves product labels with `productName()` instead of indexing the product array as an object.

## Scope
- No Finance reconciliation logic was changed in this patch.
- No database/schema change is required when upgrading from V2.4.
