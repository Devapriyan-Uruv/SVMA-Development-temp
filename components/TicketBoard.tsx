'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2, Clock3, Download, FileUp, SearchCheck, Ticket as TicketIcon, ChevronRight} from 'lucide-react';
import {TicketSummary} from '@/components/TicketSummary';
import {PageHeader} from '@/components/PageHeader';
import {Drawer} from '@/components/Drawer';
import {EmptyState} from '@/components/EmptyState';
import {StatusBadge, statusTone} from '@/components/StatusBadge';

type Scope='solvent'|'quality';

// Same endpoints and payload shapes as the pre-redesign Solvent/Quality ticket
// pages — only the presentation (row list + detail drawer instead of one long
// card per ticket) has changed.
export function TicketBoard({scope,title,subtitle,backHref,backLabel}:{scope:Scope;title:string;subtitle:string;backHref:string;backLabel:string}){
 const [rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [filter,setFilter]=useState('open');
 const [openId,setOpenId]=useState<string|null>(null);
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('');
 const qs=scope==='quality'?'?scope=quality':'';
 // A failed load keeps the tickets already on screen and says so — it used to turn into an empty "No tickets in this view".
 const load=()=>fetch(`/api/tickets${qs}`,{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Could not load tickets (HTTP ${r.status}).`);setRows(j.tickets||[]);setLoadError('')}).catch(e=>setLoadError(e instanceof Error?e.message:'Could not load tickets.')).finally(()=>setLoading(false));
 useEffect(()=>{const status=new URLSearchParams(window.location.search).get('status');if(status==='closed'||status==='all')setFilter(status);void load();const timer=setInterval(load,10000);return()=>clearInterval(timer)},[scope]);
 const filtered=filter==='all'?rows:filter==='closed'?rows.filter(r=>['closed','resolved'].includes(r.status)):rows.filter(r=>!['closed','resolved'].includes(r.status));
 const active=rows.find(r=>r.id===openId)||null;
 async function download(){
  setDownloading(true);setDownloadError('');
  try{
   const r=await fetch(`/api/tickets/export${qs}`,{cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Unable to download.')}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
   a.href=url;a.download=`SVMA_${scope==='quality'?'Quality':'Solvent'}_Tickets_${new Date().toISOString().slice(0,10)}.xlsx`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setDownloadError(e instanceof Error?e.message:'Unable to download.')}finally{setDownloading(false)}
 }
 return <>
  <PageHeader title={title} subtitle={subtitle} backHref={backHref} backLabel={backLabel} action={<div style={{display:'flex',gap:8,alignItems:'center'}}><div className="field compact-field"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="open">Open actions</option><option value="closed">Resolved / closed</option><option value="all">All tickets</option></select></div><button type="button" className="btn btn-primary" disabled={downloading||!rows.length} onClick={download}><Download size={16}/>{downloading?'Downloading…':'Download Excel'}</button></div>}/>
  {downloadError?<div className="notice danger" style={{marginBottom:12}}>{downloadError}</div>:null}
  {loadError?<div className="notice danger" role="alert" style={{marginBottom:12}}>{loadError} <button type="button" className="btn btn-outline" style={{marginLeft:8}} onClick={()=>{setLoading(true);void load()}}>Retry</button></div>:null}
  <TicketSummary scope={scope}/><p className="sub">Latest 500 tickets shown below. Counts include all tickets.</p>
  {filtered.length?<div className="row-list">{filtered.map(r=>{const tone=statusTone(r.status);return <button key={r.id} type="button" className="row-list-item" onClick={()=>setOpenId(r.id)}>
    <span className={`row-list-icon ${tone}`}><TicketIcon size={17}/></span>
    <span className="row-list-main">
     <span className="row-list-title">{r.ticket_no}</span>
     <span className="row-list-sub">{r.deviations?.parameter_master?.name||'Deviation action'} · {r.deviations?.parameter_master?.parameter_sections?.name||(scope==='quality'?'Quality':'Solvent')}</span>
    </span>
    <span className="row-list-meta">
     <span className="row-list-date">{new Date(r.created_at).toLocaleDateString(undefined,{day:'2-digit',month:'short'})}</span>
     {(r.deviations?.occurrence_count||1)>1?<span className="pill warn" title={`Last recurred ${new Date(r.deviations.last_observed_at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`}>Recurred {r.deviations.occurrence_count}x</span>:null}
     <span className="row-list-evidence">{r.ticket_evidence?.length||0} file{r.ticket_evidence?.length===1?'':'s'}</span>
    </span>
    <StatusBadge status={r.status}/>
    <ChevronRight size={16} className="row-list-chevron"/>
   </button>})}</div>
   :loading?<div className="card"><div className="empty">Loading tickets…</div></div>:loadError?null:<div className="card"><EmptyState icon={<SearchCheck size={20}/>} title="No tickets in this view" description="Switch the filter above, or check back once a deviation raises a new ticket."/></div>}
  <Drawer open={!!active} onClose={()=>setOpenId(null)} title={active?.ticket_no||'Ticket'} subtitle={active?.deviations?.parameter_master?.name||'Deviation action'} wide>
   {active?<TicketDetail ticket={active} scope={scope} onDone={()=>{load()}}/>:null}
  </Drawer>
 </>;
}

function TicketDetail({ticket,scope,onDone}:{ticket:any;scope:Scope;onDone:()=>void}){
 const [root,setRoot]=useState(ticket.root_cause||'');const [action,setAction]=useState(ticket.corrective_action||'');const [comments,setComments]=useState(ticket.closure_comments||'');const [file,setFile]=useState<File>();const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 // Section: "resolved" and "closed" are two distinct stages, not one —
 // resolved means the fix is recorded and applied; closed means it has
 // since been reviewed and finalised. Only "closed" is truly terminal
 // (locked, no further action); a resolved ticket still shows everything
 // that was recorded and offers a separate "Close ticket" step, instead of
 // both statuses being silently treated as the same locked, unreadable
 // end state.
 const isResolved=ticket.status==='resolved';
 const isClosed=ticket.status==='closed';
 const editable=!isResolved&&!isClosed;
 const qs=scope==='quality'?'?scope=quality':'';
 async function save(status:string){
  setMessage('');setBusy(true);
  try{
   if(file){const fd=new FormData();fd.append('ticketId',ticket.id);if(scope==='quality')fd.append('scope','quality');fd.append('file',file);const er=await fetch('/api/tickets/evidence',{method:'POST',body:fd});const ej=await er.json();if(!er.ok)throw new Error(ej.error)}
   const body:any={id:ticket.id,status,rootCause:root,correctiveAction:action,closureComments:comments};if(scope==='quality')body.scope='quality';
   const r=await fetch(`/api/tickets${qs}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setFile(undefined);onDone();
  }catch(e){setMessage(e instanceof Error?e.message:'Update failed')}finally{setBusy(false)}
 }
 return <div className="drawer-form">
  <div className="ticket-flow">
   <span className={ticket.status!=='open'?'done':'current'}><Clock3 size={14}/>Raised</span>
   <span className={['acknowledged','in_progress','waiting','resolved','closed'].includes(ticket.status)?'done':''}><SearchCheck size={14}/>Acknowledged</span>
   <span className={['in_progress','waiting','resolved','closed'].includes(ticket.status)?'done':''}><SearchCheck size={14}/>Action</span>
   <span className={(ticket.ticket_evidence?.length||0)>0?'done':''}><FileUp size={14}/>Evidence</span>
   <span className={isResolved?'current':isClosed?'done':''}><CheckCircle2 size={14}/>{isClosed?'Closed':'Resolved'}</span>
  </div>
  <div className="grid two">
   <div className="mini-stat"><span className="kpi-label">Target</span><b style={{fontSize:15}}>{ticket.deviations?.target_text||'—'}</b></div>
   <div className="mini-stat"><span className="kpi-label">Actual (latest)</span><b style={{fontSize:15}}>{ticket.deviations?.actual_text||'—'}</b></div>
   <div className="mini-stat"><span className="kpi-label">Severity</span><b style={{fontSize:15}}>{ticket.deviations?.severity||'critical'}</b></div>
   <div className="mini-stat"><span className="kpi-label">Evidence</span><b style={{fontSize:15}}>{ticket.ticket_evidence?.length||0} file(s)</b></div>
  </div>
  {(ticket.deviations?.occurrence_count||1)>1?<div className="notice warn" style={{marginTop:10}}>
   Same deviation recurred <b>{ticket.deviations.occurrence_count}</b> time{ticket.deviations.occurrence_count===1?'':'s'} this shift — kept as one ticket rather than raising a new one each time. Last seen {new Date(ticket.deviations.last_observed_at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}.
   {Array.isArray(ticket.deviations.observed_facts)&&ticket.deviations.observed_facts.length>1?<ul className="insight-list" style={{marginTop:8}}>{ticket.deviations.observed_facts.map((f:string,i:number)=><li key={i}>{f}</li>)}</ul>:null}
  </div>:null}
  {editable?<>
   <Field label="Root cause / investigation finding"><textarea value={root} onChange={e=>setRoot(e.target.value)} rows={3}/></Field>
   <Field label="Corrective action"><textarea value={action} onChange={e=>setAction(e.target.value)} rows={3}/></Field>
   <Field label="Closure / review comments"><textarea value={comments} onChange={e=>setComments(e.target.value)} rows={2}/></Field>
   <Field label="Evidence photo / PDF / document"><input type="file" onChange={e=>setFile(e.target.files?.[0])}/></Field>
  </>:<>
   {isClosed?<div className="notice">Closed {ticket.closed_at?new Date(ticket.closed_at).toLocaleString():''}.</div>:<div className="notice">Resolved — review below, then close when confirmed.</div>}
   <Field label="Root cause / investigation finding"><div className="readonly-text">{ticket.root_cause||'—'}</div></Field>
   <Field label="Corrective action"><div className="readonly-text">{ticket.corrective_action||'—'}</div></Field>
   <Field label="Closure / review comments">{isResolved?<textarea value={comments} onChange={e=>setComments(e.target.value)} rows={2} placeholder="Add a final note before closing (optional)"/>:<div className="readonly-text">{ticket.closure_comments||'—'}</div>}</Field>
  </>}
  {message?<div className="notice danger">{message}</div>:null}
  {editable?<div className="action-row">
   {ticket.status==='open'?<button className="btn btn-outline" disabled={busy} onClick={()=>save('acknowledged')}>Acknowledge</button>:null}
   <button className="btn btn-secondary" disabled={busy} onClick={()=>save('in_progress')}>Save In Progress</button>
   <button className="btn btn-outline" disabled={busy} onClick={()=>save('waiting')}>Waiting / Monitor</button>
   <button className="btn btn-success" disabled={busy||!root||!action} onClick={()=>save('resolved')}>Resolve</button>
  </div>:isResolved?<div className="action-row">
   <button className="btn btn-success" disabled={busy} onClick={()=>save('closed')}>Close ticket</button>
  </div>:null}
 </div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
