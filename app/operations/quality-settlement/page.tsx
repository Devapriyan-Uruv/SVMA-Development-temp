'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {OperationsInsight} from '@/components/ops/OperationsInsight';
import {OperationsNav} from '@/components/ops/OperationsNav';

function today(){return new Date().toISOString().slice(0,10)}

const STATUS_LABEL:Record<string,string>={matched:'Matched',deviation:'Deviation',no_settlement:'No settlement yet'};
const STATUS_TONE:Record<string,string>={matched:'ok',deviation:'danger',no_settlement:'neutral'};

export default function QualitySettlementPage(){
 const [date,setDate]=useState(today());
 const [dateInitialized,setDateInitialized]=useState(false);
 const [rows,setRows]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [qcPendingLots,setQcPendingLots]=useState<any[]>([]);

 useEffect(()=>{
  fetch('/api/ops/batches').then(r=>r.json()).then(j=>{
   const latest=(j.batches||[]).map((b:any)=>b.report_date).filter(Boolean).sort().pop();
   if(latest)setDate(latest);
  }).catch(()=>{}).finally(()=>setDateInitialized(true));
  fetch('/api/ops/quality-settlement/extras').then(r=>r.json()).then(j=>setQcPendingLots(j.qcPendingLots||[])).catch(()=>{});
 },[]);

 useEffect(()=>{
  if(!dateInitialized)return;
  const c=new AbortController();setBusy(true);setError('');
  fetch(`/api/ops/reconciliation/qc-settlement?date=${date}`,{signal:c.signal})
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
   .then(j=>setRows(j.rows||[])).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
  return()=>c.abort();
 },[date,dateInitialized]);

 const deviations=rows.filter(r=>r.status==='deviation').length;

 return <>
  <PageHeader title="Quality &amp; Settlement Intelligence" subtitle="Inward QC lab results vs commercial Settlement OIL, per lot — reads uploaded ERP data only, never the Quality module's own parameter entries." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <OperationsInsight module="quality_settlement"/>
  <div className="card" style={{marginTop:14,padding:'12px 14px',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
   <div className="field" style={{marginBottom:0}}><label htmlFor="qc-date">As of date</label><input id="qc-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
   {rows.length?<div className="sub">{deviations} of {rows.length} lots outside tolerance</div>:null}
  </div>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  <section className="card" style={{marginTop:14,padding:0}}>
   {busy?<div className="empty">Loading…</div>:!rows.length?<div className="empty">No Inward QC data found for this date — upload Inward QC Report and SettlementPending Lot first.</div>:
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Lot No</th><th>Lab OIL (avg)</th><th>Settlement OIL</th><th>Variance</th><th>Status</th></tr></thead><tbody>
    {rows.map((r:any)=><tr key={r.lotNo}><td>{r.lotNo}</td><td>{r.labOilAvg.toFixed(2)}</td><td>{r.settlementOil===null?'—':r.settlementOil.toFixed(2)}</td><td>{r.variance===null?'—':r.variance.toFixed(2)}</td><td><StatusBadge status={STATUS_TONE[r.status]||'neutral'} label={STATUS_LABEL[r.status]||r.status}/></td></tr>)}
   </tbody></table></div>}
  </section>

  <section className="card" style={{marginTop:14}}>
   <div className="section-title">QC Pending Lots (recent)</div>
   <div className="sub" style={{marginTop:2}}>Lots the ERP's own QC Pending Lots report still shows as awaiting QC — a complementary log, not merged into the reconciliation above.</div>
   <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Reference No</th><th>Pending Date</th><th>Party</th><th>Product</th><th>Lot No</th><th>Codes</th><th>Quantity</th></tr></thead><tbody>
    {qcPendingLots.map((r:any,i:number)=><tr key={i}><td>{r.referenceNo||'—'}</td><td>{r.pendingDate||'—'}</td><td>{r.partyName||'—'}</td><td>{r.productRaw||'—'}</td><td>{r.lotNo}</td><td>{r.codes||'—'}</td><td>{r.quantity!=null?r.quantity.toFixed(2):'—'}</td></tr>)}
    {!qcPendingLots.length?<tr><td colSpan={7} className="sub">No QC Pending Lots upload found yet.</td></tr>:null}
   </tbody></table></div>
  </section>
 </>;
}
