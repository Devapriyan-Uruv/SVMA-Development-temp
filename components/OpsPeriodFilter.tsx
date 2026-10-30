'use client';
import {useState} from 'react';

export type OpsPeriod = { from: string; to: string; label: string };

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function today() { return new Date(); }

const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
  { key: 'today', label: 'Today', range: () => { const d = today(); return { from: iso(d), to: iso(d) }; } },
  { key: 'yesterday', label: 'Yesterday', range: () => { const d = today(); d.setDate(d.getDate() - 1); return { from: iso(d), to: iso(d) }; } },
  { key: 'this_week', label: 'This Week', range: () => { const d = today(); const day = (d.getDay() + 6) % 7; const start = new Date(d); start.setDate(d.getDate() - day); return { from: iso(start), to: iso(d) }; } },
  { key: 'last_week', label: 'Last Week', range: () => { const d = today(); const day = (d.getDay() + 6) % 7; const end = new Date(d); end.setDate(d.getDate() - day - 1); const start = new Date(end); start.setDate(end.getDate() - 6); return { from: iso(start), to: iso(end) }; } },
  { key: 'last_7', label: 'Last 7 Days', range: () => { const d = today(); const start = new Date(d); start.setDate(d.getDate() - 6); return { from: iso(start), to: iso(d) }; } },
  { key: 'this_month', label: 'This Month', range: () => { const d = today(); const start = new Date(d.getFullYear(), d.getMonth(), 1); return { from: iso(start), to: iso(d) }; } },
  { key: 'last_month', label: 'Last Month', range: () => { const d = today(); const start = new Date(d.getFullYear(), d.getMonth() - 1, 1); const end = new Date(d.getFullYear(), d.getMonth(), 0); return { from: iso(start), to: iso(end) }; } },
  { key: 'last_30', label: 'Last 30 Days', range: () => { const d = today(); const start = new Date(d); start.setDate(d.getDate() - 29); return { from: iso(start), to: iso(d) }; } },
  { key: 'this_quarter', label: 'This Quarter', range: () => { const d = today(); const q = Math.floor(d.getMonth() / 3); const start = new Date(d.getFullYear(), q * 3, 1); return { from: iso(start), to: iso(d) }; } },
];

/** Reusable date-range filter for every Operations Intelligence page —
 * presets + a custom From/To range. Unlike components/PeriodFilter.tsx
 * (single date + shift + product, no presets), this is a plain controlled
 * component the parent wires to its own fetch query params; it doesn't know
 * about shifts, products, or live shift sessions. */
export function OpsPeriodFilter({ period, onChange }: { period: OpsPeriod; onChange: (next: OpsPeriod) => void }) {
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);
  const [showCustom, setShowCustom] = useState(false);
  return <div className="ops-period-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    {PRESETS.map(p => <button key={p.key} className={`tab ${period.label === p.label ? 'active' : ''}`} onClick={() => { const r = p.range(); onChange({ ...r, label: p.label }); setShowCustom(false); }}>{p.label}</button>)}
    <button className={`tab ${showCustom || period.label === 'Custom' ? 'active' : ''}`} onClick={() => setShowCustom(s => !s)}>Custom Range</button>
    {showCustom ? <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}/>
      <span>→</span>
      <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}/>
      <button className="btn btn-outline" disabled={!customFrom || !customTo} onClick={() => onChange({ from: customFrom, to: customTo, label: 'Custom' })}>Apply</button>
    </span> : null}
  </div>;
}

// Defaults to Last 30 Days, not Today — confirmed via real usage that
// "Today" as a default silently hides data uploaded for a recent-but-not-
// today date (e.g. a report processed a day or two late) with no
// indication of why the page looks empty. A 30-day window nearly always
// contains something, and every page still lets a user narrow to Today.
export function defaultOpsPeriod(): OpsPeriod { const d = today(); const start = new Date(d); start.setDate(d.getDate() - 29); return { from: iso(start), to: iso(d), label: 'Last 30 Days' }; }
