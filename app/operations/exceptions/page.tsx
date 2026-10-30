'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {OpsPeriodFilter,defaultOpsPeriod,type OpsPeriod} from '@/components/OpsPeriodFilter';
import {OperationsInsight} from '@/components/ops/OperationsInsight';
import {OperationsNav} from '@/components/ops/OperationsNav';

const STATUS_TONE:Record<string,string>={open:'danger',acknowledged:'warn',resolved:'ok',ignored:'neutral'};

export default function OpsExceptionsPage(){
 const [period,setPeriod]=useState<OpsPeriod>(defaultOpsPeriod());
 const [status,setStatus]=useState('open');
 const [rows,setRows]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [updating,setUpdating]=useState('');

 function load(){
  setBusy(true);setError('');
  fetch(`/api/ops/exceptions?from=${period.from}&to=${period.to}${status?`&status=${status}`:''}`)
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
   .then(j=>setRows(j.exceptions||[])).catch(e=>setError(e.message)).finally(()=>setBusy(false));
 }
 useEffect(load,[period,status]);

 async function updateStatus(id:string,next:string){
  setUpdating(id);
  try{const r=await fetch('/api/ops/exceptions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,status:next})});if(!r.ok)throw new Error((await r.json()).error);load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update')}finally{setUpdating('')}
 }

 return <>
  <PageHeader title="Exceptions &amp; Actions" subtitle="Deterministic reconciliation deviations. AI never invents these numbers — every value is computed in code." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <OperationsInsight module="exceptions"/>
  <div className="card" style={{marginTop:14,padding:'12px 14px',display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
   <OpsPeriodFilter period={period} onChange={setPeriod}/>
   <select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option><option value="">All</option></select>
  </div>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  <section className="card" style={{marginTop:14,padding:0}}>
   {busy?<div className="empty">Loading…</div>:!rows.length?<div className="empty">No exceptions for this filter.</div>:
    <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Date</th><th>Type</th><th>Severity</th><th>Product</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Description</th><th>Status</th><th>Action</th></tr></thead><tbody>
     {rows.map((r:any)=><tr key={r.id}>
      <td>{r.report_date}</td><td>{r.exception_type}</td>
      <td><StatusBadge status={r.severity==='critical'?'danger':r.severity==='warning'?'warn':'neutral'} label={r.severity}/></td>
      <td>{r.ops_product_master?.display_name||'—'}</td>
      <td>{r.expected_value??'—'}</td><td>{r.actual_value??'—'}</td><td>{r.variance??'—'}</td>
      <td style={{minWidth:280}}>{r.description}</td>
      <td><StatusBadge status={STATUS_TONE[r.status]||'neutral'} label={r.status}/></td>
      <td>{r.status==='open'?<div style={{display:'flex',gap:6}}><button className="btn btn-outline" disabled={updating===r.id} onClick={()=>updateStatus(r.id,'acknowledged')}>Acknowledge</button><button className="btn btn-outline" disabled={updating===r.id} onClick={()=>updateStatus(r.id,'resolved')}>Resolve</button></div>:r.status==='acknowledged'?<button className="btn btn-outline" disabled={updating===r.id} onClick={()=>updateStatus(r.id,'resolved')}>Resolve</button>:'—'}</td>
     </tr>)}
    </tbody></table></div>}
  </section>
 </>;
}
