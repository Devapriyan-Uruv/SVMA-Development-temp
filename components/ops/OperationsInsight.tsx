'use client';
import { useState } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';

type Insight = { summary: string; needsAttention: string[] };

// The Operations Intelligence equivalent of components/trade/TradeInsights.tsx
// — its own fetch, its own loading/error state, embedded right after
// PageHeader on each Operations page. Deliberately manual, not
// auto-fetched on mount: the user asked for no auto-refresh, so this only
// calls GET /api/ops/insight?module=X when the button is clicked. That
// route is still cached per (module, day) server-side, so a click never
// forces a fresh AIX3 call once today's insight already exists.
export function OperationsInsight({ module }: { module: 'supply' | 'production' | 'quality_settlement' | 'sales' | 'exceptions' }) {
 const [data, setData] = useState<Insight | null>(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);

 function generate() {
  setBusy(true); setError('');
  fetch(`/api/ops/insight?module=${module}`, { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; }).then(setData).catch(e => setError(e instanceof Error ? e.message : 'Unable to load insight')).finally(() => setBusy(false));
 }

 return <div className="card" style={{ marginTop: 14 }}>
  <div className="split-header">
   <div className="section-title" style={{ marginBottom: 0 }}><Sparkles size={15} style={{ verticalAlign: -2, marginRight: 5 }} />AIX3 Insight</div>
   <button className="btn btn-outline btn-sm" onClick={generate} disabled={busy}>{busy ? 'Generating…' : data ? 'Refresh summary' : 'Generate AI summary'}</button>
  </div>
  {error ? <div className="notice danger" style={{ marginTop: 10 }}>{error}</div> : null}
  {!data && !busy && !error ? <p className="sub" style={{ marginTop: 8 }}>Click "Generate AI summary" for URUV.AI's read on this page — it's never fetched automatically.</p> : null}
  {data ? <>
   <p className="sub" style={{ marginTop: 8, lineHeight: 1.5 }}>{data.summary}</p>
   {data.needsAttention?.length ? <div style={{ marginTop: 10 }}>
    <b style={{ fontSize: 12.5 }}><AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Needs attention</b>
    <ul style={{ marginTop: 6, paddingLeft: 18, display: 'grid', gap: 4 }}>{data.needsAttention.map((t, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.4 }}>{t}</li>)}</ul>
   </div> : null}
  </> : null}
 </div>;
}
