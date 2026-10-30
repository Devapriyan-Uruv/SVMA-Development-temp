// Centralised API error handling (Section: "Unable to save entry" must never
// hide its cause). Supabase/Postgrest throws plain objects — {message,code,
// details,hint} — not Error instances, so `e instanceof Error` is false for
// every database failure and silently falls through to a generic fallback.
// This helper extracts the real message from any thrown shape so a caller
// always gets an actionable reason, while logServerError keeps the full
// object (code/details/hint) in server logs for support/admin diagnosis
// without exposing internals the operator screen doesn't need.
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback;
  if (e && typeof e === 'object') {
    const anyE = e as Record<string, unknown>;
    if (typeof anyE.message === 'string' && anyE.message) return anyE.message;
  }
  if (typeof e === 'string' && e) return e;
  return fallback;
}

export function logServerError(scope: string, e: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${scope}]`, e);
}
