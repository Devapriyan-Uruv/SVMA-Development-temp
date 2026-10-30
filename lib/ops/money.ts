import { money } from './normalize';

// Integer-paise money arithmetic — same pattern as lib/paymentReconciliationV82.ts's
// paise()/rs(), kept as an independent pair here rather than importing a
// finance-module-specific file into an unrelated ERP domain.
export const paise = (x: unknown): number => Math.round((money(x) ?? 0) * 100);
export const rs = (x: number): number => x / 100;
