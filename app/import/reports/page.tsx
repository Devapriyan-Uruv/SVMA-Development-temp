'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';

function inr(n:number){return `₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`}

export default function ImportReportsPage(){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/import/reports',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.error)setError(j.error);else setData(j)}).catch(()=>setError('Unable to load report'))},[]);
 return <>
  <PageHeader title="Import Reports" subtitle="LC expiry watchlist, Buyer's Credit ageing, customs outgo and cost per ton — straight off the CFO review checklist." backHref="/import" backLabel="Import"/>
  {error?<div className="notice danger">{error}</div>:null}
  {!data?<div className="empty">Loading…</div>:<>
   <div className="grid four" style={{marginBottom:16}}>
    <div className="card"><span className="kpi-label">Total Contract Value</span><div className="kpi-value">{data.totals.contractValue.toLocaleString('en-IN')}</div></div>
    <div className="card"><span className="kpi-label">Advance Paid</span><div className="kpi-value">{inr(data.totals.advanceValueInr)}</div></div>
    <div className="card"><span className="kpi-label">Customs Outgo</span><div className="kpi-value">{inr(data.totals.customsOutgoInr)}</div></div>
    <div className="card"><span className="kpi-label">BC Outstanding</span><div className="kpi-value">{inr(data.totals.bcOutstandingInr)}</div></div>
   </div>

   <div className="card" style={{marginBottom:16}}>
    <div className="section-title">LC expiry watchlist (≤ 21 days)</div>
    <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>Ref Code</th><th>Supplier</th><th>LC Expiry</th><th>Days Left</th></tr></thead><tbody>
     {data.lcExpiryWatchlist.map((r:any)=><tr key={r.id}><td><a href={`/import/${r.id}`}>{r.refCode}</a></td><td>{r.party}</td><td>{r.lcExpiryDate}</td><td><span className={`pill ${r.daysLeft<0?'danger':r.daysLeft<=7?'warn':'info'}`}>{r.daysLeft}d</span></td></tr>)}
     {!data.lcExpiryWatchlist.length?<tr><td colSpan={4} className="sub">Nothing expiring soon.</td></tr>:null}
    </tbody></table></div>
   </div>

   <div className="card" style={{marginBottom:16}}>
    <div className="section-title">Buyer's Credit ageing</div>
    <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>Ref Code</th><th>Supplier</th><th>BC No.</th><th>Due Date</th><th>Principal</th><th>Days</th></tr></thead><tbody>
     {data.bcAgeing.map((r:any)=><tr key={r.id}><td><a href={`/import/${r.id}`}>{r.refCode}</a></td><td>{r.party}</td><td>{r.bcNo||'—'}</td><td>{r.bcDueDate}</td><td>{inr(r.principalInr)}</td><td><span className={`pill ${r.daysLeft<0?'danger':r.daysLeft<=7?'warn':'info'}`}>{r.daysLeft}d</span></td></tr>)}
     {!data.bcAgeing.length?<tr><td colSpan={6} className="sub">No open Buyer's Credit.</td></tr>:null}
    </tbody></table></div>
   </div>

   <div className="grid two" style={{gap:16}}>
    <div className="card">
     <div className="section-title">Document exceptions</div>
     <div style={{display:'grid',gap:10,marginTop:10}}>
      {data.documentExceptions.map((r:any)=><div key={r.id} className="card tight"><a href={`/import/${r.id}`}><b>{r.refCode}</b></a> — {r.party}{r.note?<p className="sub" style={{marginTop:2}}>{r.note}</p>:null}</div>)}
      {!data.documentExceptions.length?<p className="sub">Nothing outstanding.</p>:null}
     </div>
    </div>
    <div className="card">
     <div className="section-title">Cost per ton by commodity</div>
     <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>Commodity</th><th>Qty</th><th>Value (₹)</th></tr></thead><tbody>
      {data.byCommodity.map((c:any)=><tr key={c.commodity}><td>{c.commodity}</td><td>{c.qty.toLocaleString('en-IN')}</td><td>{inr(c.valueInr)}</td></tr>)}
     </tbody></table></div>
    </div>
   </div>
  </>}
 </>;
}
