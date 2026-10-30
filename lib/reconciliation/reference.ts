// Structured business-document reference parsing. Never assumes a specific
// prefix exists — extracts whatever structure is actually present so the
// document-family learner (documentFamily.ts) can reason about "prefix"
// generically, and so hallucination checks always compare against `raw`.

export type ParsedReference = {
  raw: string;
  prefix: string; // e.g. "RB-PO", "DORB-SO", "PO", "" if none detected
  serial: string; // e.g. "1072", "" if none detected
  fy: string; // e.g. "26-27", "" if not present
  serialNumeric: number | null;
};

const FY = /^\d{2}-\d{2}$/;

export function parseReference(rawInput: unknown): ParsedReference {
  const raw = String(rawInput ?? '').trim();
  if (!raw) return { raw: '', prefix: '', serial: '', fy: '', serialNumeric: null };
  const segments = raw.split('/').map(s => s.trim()).filter(s => s.length);
  let fy = '';
  if (segments.length && FY.test(segments[segments.length - 1])) fy = segments.pop() as string;
  if (segments.length >= 2) {
    const serial = segments[segments.length - 1];
    const prefix = segments.slice(0, -1).join('/');
    return { raw, prefix: prefix.toUpperCase(), serial, fy, serialNumeric: /^\d+$/.test(serial) ? Number(serial) : null };
  }
  if (segments.length === 1) {
    const only = segments[0];
    const m = only.match(/^([A-Za-z][A-Za-z\-]*)?(\d+)$/);
    if (m && m[1]) return { raw, prefix: m[1].toUpperCase(), serial: m[2], fy, serialNumeric: Number(m[2]) };
    if (/^\d+$/.test(only)) return { raw, prefix: '', serial: only, fy, serialNumeric: Number(only) };
    return { raw, prefix: only.toUpperCase(), serial: '', fy, serialNumeric: null };
  }
  return { raw, prefix: '', serial: '', fy: '', serialNumeric: null };
}

/** Two references are "the same document" only on an exact raw or
 * prefix+serial match — never on fuzzy similarity. */
export function referenceEquals(a: unknown, b: unknown): boolean {
  const ra = parseReference(a), rb = parseReference(b);
  if (!ra.raw || !rb.raw) return false;
  if (ra.raw.toUpperCase() === rb.raw.toUpperCase()) return true;
  return !!ra.prefix && !!ra.serial && ra.prefix === rb.prefix && ra.serial === rb.serial;
}

/** Same document FAMILY (prefix), different serial — e.g. two different
 * Sales Orders under the same "DORB-SO" family. Used to recognize a
 * consolidated voucher scenario, never to assert two different transactions
 * are the same one. */
export function sameFamily(a: unknown, b: unknown): boolean {
  const ra = parseReference(a), rb = parseReference(b);
  return !!ra.prefix && ra.prefix === rb.prefix;
}
