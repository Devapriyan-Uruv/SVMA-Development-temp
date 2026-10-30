// Quality sampling-frequency and result-SLA text parsing (Sections U, V, X, Y).
//
// The source workbook's "TIME FOR PROVIDING SAMPLE" and "RESULTS WHEN
// AVAILABLE" columns are free text with real-world typos and inconsistent
// spacing/casing (confirmed by direct inspection of LAB REPORTS AI 1.xlsx):
//   "Every 4 hr.", "Every  4 Hr." (double space), "EVERY-2 hrs.",
//   "Every 4 hr. Hour" (duplicated word), "ONCE IN A SHIFT SHIFT"
//   (duplicated word), "ONCE FOR SHIFT", "EVERY HOUR"
//   "AFTER 1.5 hr. From the sample collection"
//   "AFTER 1.5 hr. From the nsample collection" (stray "n")
//   "5 mts.", "AFTER 45 mts.", "AFTER 30 mts."
// This module normalises all of that deterministically. Nothing here
// touches Finance/reconciliation code.

export type SampleFrequency = { everyMinutes: number | null; oncePerShift: boolean };

export function parseSampleFrequency(raw?: string | null): SampleFrequency {
  const t = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t) return { everyMinutes: null, oncePerShift: false };
  if (/ONCE\s*(IN|FOR)?\s*A?\s*SHIFT/.test(t)) return { everyMinutes: null, oncePerShift: true };
  const hourMatch = t.match(/EVERY[\s-]*(\d+(?:\.\d+)?)\s*HR/);
  if (hourMatch) return { everyMinutes: Math.round(Number(hourMatch[1]) * 60), oncePerShift: false };
  if (/EVERY\s*HOUR/.test(t)) return { everyMinutes: 60, oncePerShift: false };
  const twoHour = t.match(/EVERY[\s-]*(\d+)\s*HOUR/);
  if (twoHour) return { everyMinutes: Number(twoHour[1]) * 60, oncePerShift: false };
  return { everyMinutes: null, oncePerShift: false };
}

// "AFTER 1.5 hr. From the sample collection" / "AFTER 1.5 hr. From the
// nsample collection" (typo) / "AFTER 45 mts." / "5 mts." -> minutes.
export function parseResultSlaMinutes(raw?: string | null): number | null {
  const t = String(raw || '')
    .toUpperCase()
    .replace(/NSAMPLE/g, 'SAMPLE') // tolerate the recurring "nsample" typo
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const hr = t.match(/(\d+(?:\.\d+)?)\s*HR/);
  if (hr) return Math.round(Number(hr[1]) * 60);
  const min = t.match(/(\d+(?:\.\d+)?)\s*M(?:T|IN)/);
  if (min) return Math.round(Number(min[1]));
  const bare = t.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(Number(bare[1]));
  return null;
}

// Expected sample slot start times within a shift window, in shift-local
// order, given a frequency ("Every Hour" -> hourly slots, "Every 4 hr." ->
// every 4 hours, once-per-shift -> a single slot at shift start).
export function generateSlotStarts(freq: SampleFrequency, shiftStart: Date, shiftEnd: Date): Date[] {
  if (freq.oncePerShift || !freq.everyMinutes) return [new Date(shiftStart)];
  const slots: Date[] = [];
  let t = new Date(shiftStart);
  const stepMs = freq.everyMinutes * 60000;
  while (t.getTime() < shiftEnd.getTime()) {
    slots.push(new Date(t));
    t = new Date(t.getTime() + stepMs);
  }
  return slots.length ? slots : [new Date(shiftStart)];
}
