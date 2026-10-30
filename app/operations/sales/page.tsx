'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {OperationsInsight} from '@/components/ops/OperationsInsight';
import {OperationsNav} from '@/components/ops/OperationsNav';

function today(){return new Date().toISOString().slice(0,10)}

export default function SalesFulfilmentPage(){
 const [date,setDate]=useState(today());
 const [dateInitialized,setDateInitialized]=useState(false);
 const [rows,setRows]=useState<any[]>([]);
 const [availability,setAvailability]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [extras,setExtras]=useState<any>(null);
 const [tab,setTab]=useState<'freeToSell'|'dispatch'|'brokerage'|'contractPending'|'freight'>('freeToSell');

 useEffect(()=>{
  fetch('/api/ops/batches').then(r=>r.json()).then(j=>{
   const latest=(j.batches||[]).map((b:any)=>b.report_date).filter(Boolean).sort().pop();
   if(latest)setDate(latest);
  }).catch(()=>{}).finally(()=>setDateInitialized(true));
  fetch('/api/ops/sales/extras').then(r=>r.json()).then(setExtras).catch(()=>{});
 },[]);

 useEffect(()=>{
  if(!dateInitialized)return;
  const c=new AbortController();setBusy(true);setError('');
  fetch(`/api/ops/reconciliation/sales?date=${date}`,{signal:c.signal})
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
   .then(j=>{setRows(j.rows||[]);setAvailability(j.availability||[]);}).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
  return()=>c.abort();
 },[date,dateInitialized]);

 return <>
  <PageHeader title="Sales &amp; Fulfilment Intelligence" subtitle="Sale Order dispatch vs Sales Register invoicing, and Free-to-Sell availability computed from current stock and open orders." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <OperationsInsight module="sales"/>

  <div className="tabs" style={{marginTop:14}}>
   <button className={`tab ${tab==='freeToSell'?'active':''}`} onClick={()=>setTab('freeToSell')}>Free to Sell</button>
   <button className={`tab ${tab==='dispatch'?'active':''}`} onClick={()=>setTab('dispatch')}>Dispatch vs Invoicing</button>
   <button className={`tab ${tab==='brokerage'?'active':''}`} onClick={()=>setTab('brokerage')}>Brokerage</button>
   <button className={`tab ${tab==='contractPending'?'active':''}`} onClick={()=>setTab('contractPending')}>Contract Pending</button>
   <button className={`tab ${tab==='freight'?'active':''}`} onClick={()=>setTab('freight')}>Freight</button>
  </div>

  {tab==='freeToSell'?<section className="card" style={{marginTop:14}}>
   <div className="section-title">Free to Sell (current, not date-scoped)</div>
   <p className="sub">Physical closing stock (latest Stock Summary) minus open Sale Order commitment (Open / Partially Completed orders, quantity not yet dispatched). Excludes raw material and packing material — only finished goods can be sold. Always a projection — never shown as physical stock.</p>
   <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Product</th><th>Physical Stock (MT)</th><th>Open Commitment (MT)</th><th>Free to Sell (MT)</th></tr></thead><tbody>
    {availability.map((a:any,i:number)=><tr key={i}><td>{a.productName}</td><td>{a.physicalStockMt.toFixed(3)}</td><td>{a.openCommitmentMt.toFixed(3)}</td><td style={{fontWeight:600,color:a.freeToSellMt<0?'var(--danger,#c0392b)':undefined}}>{a.freeToSellMt.toFixed(3)}</td></tr>)}
    {!availability.length?<tr><td colSpan={4} className="sub">No stock or sales order data uploaded yet.</td></tr>:null}
   </tbody></table></div>
  </section>:null}

  {tab==='dispatch'?<>
   <div className="card" style={{marginTop:14,padding:'12px 14px',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
    <div className="field" style={{marginBottom:0}}><label htmlFor="sales-date">As of date</label><input id="sales-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
   </div>
   {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
   <section className="card" style={{marginTop:14,padding:0}}>
    {busy?<div className="empty">Loading…</div>:!rows.length?<div className="empty">No Sale Order or Sales Register data found for this date.</div>:
    <div className="table-wrap" style={{border:0}}><table><thead><tr><th>SO No</th><th>Product</th><th>Dispatched (MT)</th><th>Invoiced (MT)</th><th>Variance</th><th>Variance %</th><th>Status</th></tr></thead><tbody>
     {rows.map((r:any,i:number)=><tr key={i}><td>{r.soNo}</td><td>{r.productName}</td><td>{r.dispatchedQty.toFixed(3)}</td><td>{r.invoicedQty.toFixed(3)}</td><td>{r.variance.toFixed(3)}</td><td>{r.variancePct===null?'—':`${r.variancePct.toFixed(1)}%`}</td><td><StatusBadge status={r.status==='matched'?'ok':'danger'} label={r.status==='matched'?'Matched':'Deviation'}/></td></tr>)}
    </tbody></table></div>}
   </section>
  </>:null}

  {extras?<>
   {tab==='brokerage'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Brokerage (recent)</div>
    <div className="sub" style={{marginTop:2}}>Con No matches Sale Order's SO No — an enrichment (broker, fee, bag counts) kept as its own log, not merged into Sale Order Details.</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Con No</th><th>Con Date</th><th>Broker</th><th>Party</th><th>Con Qty</th><th>Per Ton</th><th>Total</th></tr></thead><tbody>
     {extras.brokerage.map((r:any,i:number)=><tr key={i}><td>{r.conNo}</td><td>{r.conDate||'—'}</td><td>{r.brokerName||'—'}</td><td>{r.partyName||'—'}</td><td>{r.conQty!=null?r.conQty.toFixed(2):'—'}</td><td>{r.perTon!=null?r.perTon.toLocaleString('en-IN'):'—'}</td><td>{r.total!=null?r.total.toLocaleString('en-IN'):'—'}</td></tr>)}
     {!extras.brokerage.length?<tr><td colSpan={7} className="sub">No Brokerage upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='contractPending'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Contract List Pending{extras.contractAsOf?` (as of ${extras.contractAsOf})`:''}</div>
    <div className="sub" style={{marginTop:2}}>Cont No matches Sale Order's SO No — kept as its own snapshot (pending-contract rollup vs dispatch transaction log), not reconciled against Sale Order Details.</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Cont No</th><th>Cont Date</th><th>Product</th><th>Party</th><th>Con Qty</th><th>Des Qty</th><th>Bal Qty</th></tr></thead><tbody>
     {extras.contractPending.map((r:any,i:number)=><tr key={i}><td>{r.contNo}</td><td>{r.contDate||'—'}</td><td>{r.productRaw||'—'}</td><td>{r.partyName||'—'}</td><td>{r.conQty!=null?r.conQty.toFixed(2):'—'}</td><td>{r.desQty!=null?r.desQty.toFixed(2):'—'}</td><td>{r.balQty!=null?r.balQty.toFixed(2):'—'}</td></tr>)}
     {!extras.contractPending.length?<tr><td colSpan={7} className="sub">No Contract List Pending upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='freight'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Freight Summary (recent)</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Invoice No</th><th>Invoice Date</th><th>Party</th><th>Vehicle</th><th>Product</th><th>Qty</th><th>Freight / Ton</th></tr></thead><tbody>
     {extras.freightSummary.map((r:any,i:number)=><tr key={i}><td>{r.invoiceNo}</td><td>{r.invoiceDate||'—'}</td><td>{r.partyName||'—'}</td><td>{r.vehicleNo||'—'}</td><td>{r.productRaw||'—'}</td><td>{r.invoiceQty!=null?r.invoiceQty.toFixed(2):'—'}</td><td>{r.freightAmtPerTon!=null?r.freightAmtPerTon.toLocaleString('en-IN'):'—'}</td></tr>)}
     {!extras.freightSummary.length?<tr><td colSpan={7} className="sub">No Freight Summary upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}
  </>:null}
 </>;
}
