import { createHash } from 'crypto';
import { text } from '@/lib/reconciliation/normalize';

/** ERP export cells sometimes carry a stray "$" prefix ("$0.075","$367686.00")
 * alongside plain numeric text in the same column — confirmed in real sample
 * files (Feeding Details' oil-recovery columns, RawMaterialBatchWiseStock's
 * Value column). Strip currency symbols/commas before coercing. */
export function money(value: unknown): number | null {
  const s = text(value).replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A blank cell in these exports can be null, undefined, or an empty/whitespace
 * string — never coalesce these three checks differently across parsers. */
export function isBlank(value: unknown): boolean {
  return value == null || text(value) === '';
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Deterministic fingerprint of a parsed row's business-relevant fields —
 * used to tell "the exact same transaction re-uploaded" apart from "the same
 * business key with a genuinely changed value" (see lib/ops/dedupe.ts). */
export function rowFingerprint(fields: Record<string, unknown>): string {
  const normalized = Object.keys(fields).sort().map(k => `${k}=${text(fields[k])}`).join('|');
  return sha256Hex(normalized);
}
