// Generic normalization primitives shared by every matching stage. Nothing
// here encodes a sample-day value — only formatting rules (case, punctuation,
// legal-suffix stripping) that hold for any day's content. Verified aliases
// (party/material) are looked up from the persisted profile tables by the
// caller (lib/reconciliation/profile.ts), not hardcoded here.

export const text = (v: unknown): string => (v == null ? '' : String(v).trim());
export const alnum = (v: unknown): string => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Vehicle registration numbers: strip spaces/hyphens/punctuation, uppercase. */
export function normalizeVehicle(raw: unknown): string {
  return alnum(raw);
}

const LEGAL_SUFFIXES = /\b(PRIVATE\s+LIMITED|PVT\.?\s*LTD\.?|PVT\.?\s*LIMITED|LIMITED|LTD\.?|PRIVATE|P\s*LTD)\b/g;
const COMMON_ABBREVIATIONS: Record<string, string> = {
  'T/R': ' TRADERS ', 'TR.': ' TRADERS ', 'TR ': ' TRADERS ',
  'P/F': ' POULTRY FARM ', 'F/W': ' FIREWOOD ',
};

/** Party/vendor/customer name key used for similarity comparison — case,
 * punctuation and common legal-suffix normalization only. This intentionally
 * does NOT decide identity by itself; identity is decided by the verified
 * alias table (exact) or by similarity score used as supporting evidence
 * (lib/reconciliation/scoring.ts), never fuzzy match alone. */
export function partyKey(raw: unknown): string {
  let s = text(raw).toUpperCase();
  for (const [from, to] of Object.entries(COMMON_ABBREVIATIONS)) s = s.split(from).join(to);
  s = s.replace(LEGAL_SUFFIXES, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
/** Collapsed (no-space) form for fast exact/substring comparisons. */
export function partyKeyCollapsed(raw: unknown): string {
  return partyKey(raw).replace(/\s/g, '');
}

/** Longest-common-contiguous-block similarity ratio in [0,1]. Deterministic,
 * no external library — same algorithm the live engine already validated
 * against real reviewer output (originally lib/transactionPresence.ts). */
export function sequenceRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  function matches(alo: number, ahi: number, blo: number, bhi: number): number {
    let best = 0, ai = alo, bj = blo, prev = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (let j = blo; j < bhi; j++) if (a[i] === b[j]) {
        const size = (prev.get(j - 1) || 0) + 1;
        next.set(j, size);
        if (size > best) { best = size; ai = i - size + 1; bj = j - size + 1; }
      }
      prev = next;
    }
    if (!best) return 0;
    return best + (ai > alo && bj > blo ? matches(alo, ai, blo, bj) : 0) + (ai + best < ahi && bj + best < bhi ? matches(ai + best, ahi, bj + best, bhi) : 0);
  }
  return 2 * matches(0, a.length, 0, b.length) / (a.length + b.length);
}

/** Pure string-similarity score in [0,1] — a SUPPORTING signal only. Callers
 * must combine this with structured evidence (reference/PO/SO/invoice,
 * vehicle, date) before deciding identity; see scoring.ts. */
export function nameSimilarity(a: unknown, b: unknown): number {
  const ka = partyKey(a), kb = partyKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  const shortC = short.replace(/\s/g, ''), longC = long.replace(/\s/g, '');
  if (shortC.length >= 3 && longC.startsWith(shortC)) return 0.96;
  if (shortC.length >= 5 && longC.slice(1).startsWith(shortC)) return 0.9;
  let score = sequenceRatio(shortC, longC);
  if (shortC.length >= 5) for (let n = Math.max(1, shortC.length - 2); n < shortC.length + 3; n++) score = Math.max(score, sequenceRatio(shortC, longC.slice(0, n)) * 0.94);
  return score;
}

/** Material description token key — order-independent token normalization,
 * no fixed vocabulary. Two spellings that reduce to the same token set are
 * considered candidates for family grouping; the actual canonical FAMILY a
 * material belongs to comes from the learned/verified alias table, with this
 * key as the fallback bucket for anything not yet aliased. */
export function materialTokenKey(raw: unknown): string {
  return alnum(raw)
    .replace(/\b(NORMAL|GRADE|QUALITY|TYPE)\b/g, '')
    .replace(/[()]/g, '');
}

export function materialSimilarity(a: unknown, b: unknown): number {
  const ka = materialTokenKey(a), kb = materialTokenKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.includes(kb) || kb.includes(ka)) return 0.85;
  return sequenceRatio(ka, kb);
}

export function toNumber(value: unknown): number | null {
  if (!text(value)) return null;
  const n = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a), db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.abs(da - db) / 86400000;
}
