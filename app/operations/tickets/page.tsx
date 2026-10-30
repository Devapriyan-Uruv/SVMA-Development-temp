'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {ExternalLink} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {Drawer} from '@/components/Drawer';
import {OperationsNav} from '@/components/ops/OperationsNav';

// Operations tickets share deviation_tickets.status (a fixed Postgres enum
// also used by Quality/Solvent tickets) — rather than a DB migration to add
// Operations-specific enum values, the existing values are given
// Operations-appropriate labels here. The underlying value never changes.
const STATUS_LABEL:Record<string,string>={open:'Open',acknowledged:'Assigned',in_progress:'Under Investigation',waiting:'Awaiting Correction',resolved:'Resolved',closed:'Closed',overdue:'Overdue'};
const STATUS_TONE:Record<string,string>={open:'danger',acknowledged:'warn',in_progress:'warn',waiting:'neutral',resolved:'ok',closed:'ok',overdue:'danger'};
const STATUS_ORDER=['open','acknowledged','in_progress','waiting','resolved','closed'];

const MODULE_LABEL:Record<string,string>={ops_production:'Production → Stock',ops_raw_material:'Raw Material',ops_qc:'QC & Settlement',ops_sales:'Sales & Fulfilment'};
const MODULE_RECON_TAB:Record<string,string>={ops_production:'production_stock',ops_raw_material:'raw_material'};

function fmt(n:number|null|undefined,digits=3){return n===null||n===undefined?'—':Number(n).toFixed(digits)}

export default function OpsTicketsPage(){
 const [tickets,setTickets]=useState<any[]>([]);
 const [counts,setCounts]=useState({total:0,open:0,closed:0});
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [selected,setSelected]=useState<any>(null);
 const [status,setStatus]=useState('open');
 const [rootCause,setRootCause]=useState('');
 const [correctiveAction,setCorrectiveAction]=useState('');
 const [closureComments,setClosureComments]=useState('');
 const [saving,setSaving]=useState(false);

 function load(){
  setBusy(true);setError('');
  fetch('/api/ops/tickets').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(j=>{setTickets(j.tickets||[]);setCounts(j.counts||{total:0,open:0,closed:0})}).catch(e=>setError(e.message)).finally(()=>setBusy(false));
 }
 useEffect(load,[]);

 function openTicket(t:any){setSelected(t);setStatus(t.status);setRootCause(t.root_cause||'');setCorrectiveAction(t.corrective_action||'');setClosureComments(t.closure_comments||'')}

 async function save(){
  if(!selected)return;
  setSaving(true);
  try{const r=await fetch('/api/ops/tickets',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:selected.id,status,rootCause,correctiveAction,closureComments})});if(!r.ok)throw new Error((await r.json()).error);setSelected(null);load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update')}finally{setSaving(false)}
 }

 const ex=selected?.ops_exceptions;
 const reconTab=ex?.module?MODULE_RECON_TAB[ex.module]:null;

 return <>
  <PageHeader title="Operations Tickets" subtitle="Tickets auto-created from critical and warning Operations exceptions." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <div className="ticket-counts" style={{marginTop:14}}><div><span>Total</span><b>{counts.total}</b></div><div><span>Open</span><b>{counts.open}</b></div><div><span>Closed</span><b>{counts.closed}</b></div></div>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  <section className="card" style={{marginTop:14,padding:0}}>
   {busy?<div className="empty">Loading…</div>:!tickets.length?<div className="empty">No tickets yet.</div>:
    <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Ticket</th><th>Module</th><th>Product</th><th>Severity</th><th>Report Date</th><th>Variance</th><th>Status</th><th>Action</th></tr></thead><tbody>
     {tickets.map((t:any)=><tr key={t.id}>
      <td>{t.ticket_no}</td>
      <td>{MODULE_LABEL[t.ops_exceptions?.module]||t.ops_exceptions?.exception_type||'—'}</td>
      <td>{t.ops_exceptions?.ops_product_master?.display_name||'—'}</td>
      <td><StatusBadge status={t.ops_exceptions?.severity==='critical'?'danger':'warn'} label={t.ops_exceptions?.severity||'—'}/></td>
      <td>{t.ops_exceptions?.report_date||'—'}</td>
      <td>{fmt(t.ops_exceptions?.variance)} MT</td>
      <td><StatusBadge status={STATUS_TONE[t.status]||'neutral'} label={STATUS_LABEL[t.status]||t.status}/></td>
      <td><button className="btn btn-outline" onClick={()=>openTicket(t)}>Open</button></td>
     </tr>)}
    </tbody></table></div>}
  </section>
  <Drawer open={!!selected} onClose={()=>setSelected(null)} title={selected?.ticket_no||'Ticket'} subtitle={ex?MODULE_LABEL[ex.module]||ex.module:undefined}
   footer={<>
    <button className="btn btn-outline" onClick={()=>setSelected(null)}>Cancel</button>
    <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save'}</button>
   </>}>
   {selected?<>
    <p className="sub">{ex?.ai_narrative||ex?.description}</p>

    <div className="field-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 16px',margin:'14px 0'}}>
     <div><span className="sub">Module</span><div>{MODULE_LABEL[ex?.module]||ex?.module||'—'}</div></div>
     <div><span className="sub">Product</span><div>{ex?.ops_product_master?.display_name||'—'}</div></div>
     <div><span className="sub">Report date</span><div>{ex?.report_date||'—'}</div></div>
     <div><span className="sub">Severity</span><div><StatusBadge status={ex?.severity==='critical'?'danger':'warn'} label={ex?.severity||'—'}/></div></div>
     <div><span className="sub">Expected</span><div>{fmt(ex?.expected_value)} MT</div></div>
     <div><span className="sub">Actual</span><div>{fmt(ex?.actual_value)} MT</div></div>
     <div><span className="sub">Variance</span><div>{fmt(ex?.variance)} MT{ex?.variance_pct!==null&&ex?.variance_pct!==undefined?` (${fmt(ex.variance_pct,1)}%)`:''}</div></div>
     <div><span className="sub">Tolerance used</span><div>{fmt(ex?.tolerance_used)} MT</div></div>
    </div>

    {reconTab?<Link className="btn btn-outline" href={`/operations/reconciliation?tab=${reconTab}&date=${ex.report_date}`} target="_blank" style={{display:'inline-flex',alignItems:'center',gap:6,marginBottom:14}}>View in Reconciliation <ExternalLink size={13}/></Link>:null}

    <div className="field"><label>Root cause</label><textarea value={rootCause} onChange={e=>setRootCause(e.target.value)} rows={3}/></div>
    <div className="field"><label>Corrective action</label><textarea value={correctiveAction} onChange={e=>setCorrectiveAction(e.target.value)} rows={3}/></div>
    <div className="field"><label>Closure comments</label><textarea value={closureComments} onChange={e=>setClosureComments(e.target.value)} rows={2}/></div>
    <div className="field"><label>Status</label>
     <select value={status} onChange={e=>setStatus(e.target.value)}>
      {STATUS_ORDER.map(s=><option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
     </select>
    </div>
   </>:null}
  </Drawer>
 </>;
}
