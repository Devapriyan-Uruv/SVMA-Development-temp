'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {FileUp,Paperclip,CheckCircle ,Trash2 } from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {Drawer} from '@/components/Drawer';


// Every signed-in user lands here to see the tickets routed to them (sql/077): Solvent and Quality are kept apart, and each ticket shows
// the person's own role on it — closer, MD Office or intimated. Only the closer can move or close a ticket.
type Ticket={id:string;ticketNo:string;status:string;dueAt:string|null;createdAt:string;closedAt:string|null;overdue:boolean;severity:string;parameter:string;target:string|null;actual:string|null;occurrences:number;section:string;area:string|null;scope:string;rootCause:string|null;correctiveAction:string|null;closureComments:string|null;closers:string[];myRoles:string[];canAct:boolean;canMd:boolean;reopened:boolean;followup:any;history:{event:string;to_status:string|null;note:string|null;at:string}[];evidence:{id:string;name:string;mime:string|null;at:string;url:string|null}[]};
type Counts={total:number;open:number;inProgress:number;reopened:number;overdue:number;closed:number};
type Stats=Counts&{byArea:(Counts&{name:string})[];byPerson:(Counts&{name:string})[]};
const STATUS_LABEL:Record<string,string>={open:'Open',acknowledged:'Acknowledged',in_progress:'In progress',waiting:'Waiting',resolved:'Resolved',closed:'Closed',overdue:'Overdue'};
const TONE:Record<string,string>={open:'danger',acknowledged:'warn',in_progress:'warn',waiting:'neutral',resolved:'ok',closed:'ok',overdue:'danger'};
const ROLE_LABEL:Record<string,string>={closer:'You close it',md:'MD Office',intimate:'Intimated'};
const when=(v:string|null)=>v?new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const isClosed=(s:string)=>s==='closed'||s==='resolved';

function StatTiles({c}:{c:Counts}){
 const tiles:[string,number][]=[['Raised',c.total],['Open',c.open],['In progress',c.inProgress],['Reopened',c.reopened],['Overdue',c.overdue],['Closed',c.closed]];
 return <div className="ticket-counts">{tiles.map(([k,v])=><div key={k}><span>{k}</span><b style={k==='Overdue'&&v?{color:'#c0392b'}:undefined}>{v}</b></div>)}</div>;
}
function Breakdown({title,rows}:{title:string;rows:(Counts&{name:string})[]}){
 if(!rows.length)return null;
 return <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>{title}</th><th>Raised</th><th>Open</th><th>In progress</th><th>Reopened</th><th>Overdue</th><th>Closed</th></tr></thead><tbody>
  {rows.map(r=><tr key={r.name}><td>{r.name}</td><td>{r.total}</td><td>{r.open}</td><td>{r.inProgress}</td><td>{r.reopened}</td><td style={r.overdue?{color:'#c0392b',fontWeight:600}:undefined}>{r.overdue}</td><td>{r.closed}</td></tr>)}
 </tbody></table></div>;
}

export default function TicketsPage(){
  const [scope,setScope]=useState<'solvent'|'quality'>('solvent'),
      [view,setView]=useState('open'),
      [role,setRole]=useState('all'),
      [text,setText]=useState(''),
      [severityFilter,setSeverityFilter]=useState('all'),
      [statusFilter,setStatusFilter]=useState('all');
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [sel,setSel]=useState<Ticket|null>(null),[saving,setSaving]=useState(false),[msg,setMsg]=useState('');
 const [rootCause,setRootCause]=useState(''),[action,setAction]=useState(''),[remark,setRemark]=useState(''),[fu,setFu]=useState({reportedToJmd:false,jmdReportDate:'',targetClosure:'',mdRemarks:''});
useEffect(() => {
  if (!msg) return;

  const timer = setTimeout(() => {
    setMsg('');
  }, 3000);

  return () => clearTimeout(timer);
}, [msg]);
 const load=useCallback(async()=>{
  setBusy(true);setError('');
  try{const r=await fetch(`/api/ticket-desk?scope=${scope}&view=${view}`,{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error);setData(j);setSel(s=>s?(j.tickets||[]).find((t:Ticket)=>t.id===s.id)||null:s)}
  catch(e){setError(e instanceof Error?e.message:'Unable to load tickets.')}finally{setBusy(false)}
 },[scope,view]);
 useEffect(()=>{void load()},[load]);

 function open(t:Ticket){setSel(t);setMsg('');setRootCause(t.rootCause||'');setAction(t.correctiveAction||'');setRemark(t.closureComments||'');const f=t.followup;setFu({reportedToJmd:!!f?.reported_to_jmd,jmdReportDate:f?.jmd_report_date||'',targetClosure:f?.target_closure||'',mdRemarks:f?.md_remarks||''})}
 async function patch(body:Record<string,unknown>,ok:string){
  if(!sel)return;setSaving(true);setMsg('');
  try{const r=await fetch('/api/ticket-desk',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:sel.id,...body})}),j=await r.json();if(!r.ok)throw new Error(j.error);setMsg(ok);await load()}
  catch(e){setMsg(e instanceof Error?e.message:'Unable to save.')}finally{setSaving(false)}
 }
 

async function upload(file: File, evidenceId?: string) {
  if (!sel) return;

  setSaving(true);
  setMsg('');

  try {
    const fd = new FormData();
    fd.append('ticketId', sel.id);
    fd.append('file', file);
    fd.append('mode', evidenceId ? 'replace' : 'add');

    if (evidenceId) {
      fd.append('evidenceId', evidenceId);
    }

    const r = await fetch('/api/ticket-desk/evidence', {
      method: 'POST',
      body: fd
    });

    const j = await r.json();

    if (!r.ok) throw new Error(j.error);

    if (evidenceId && j.replaced !== true) {
      throw new Error('Evidence was not replaced. Please try again.');
    }

    if (!evidenceId && j.replaced === true) {
      throw new Error('Unexpected replacement response.');
    }

    setMsg(evidenceId
      ? 'Evidence updated successfully.'
      : 'Evidence added successfully.'
    );

    await load();
  } catch (e) {
    setMsg(e instanceof Error ? e.message : 'Upload failed.');
  } finally {
    setSaving(false);
  }
}
async function deleteEvidence(evidenceId: string) {
  if (!sel) return;

  const confirmed = window.confirm(
    'Are you sure you want to delete this evidence?'
  );

  if (!confirmed) return;

  setSaving(true);
  setMsg('');

  try {
    const r = await fetch('/api/ticket-desk/evidence', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: sel.id,
        evidenceId
      })
    });

    const j = await r.json();

    if (!r.ok) throw new Error(j.error);

    setMsg('Evidence deleted successfully.');
    await load();

  } catch (e) {
    setMsg(e instanceof Error ? e.message : 'Evidence deletion failed.');
  } finally {
    setSaving(false);
  }
}

 const tickets:Ticket[]=data?.tickets||[];
 const shown = useMemo(() => tickets.filter(t => (role === 'all' || t.myRoles.includes(role)) && (severityFilter === 'all' || t.severity === severityFilter) && (statusFilter === 'all' || t.status === statusFilter) && (!text || `${t.ticketNo} ${t.parameter} ${t.section} ${t.area || ''}`.toLowerCase().includes(text.toLowerCase()))), [tickets, role, text, severityFilter, statusFilter]);
 const mine:Counts=useMemo(()=>({total:tickets.length,open:tickets.filter(t=>!isClosed(t.status)).length,inProgress:tickets.filter(t=>t.status==='in_progress').length,reopened:tickets.filter(t=>t.reopened&&!isClosed(t.status)).length,overdue:tickets.filter(t=>t.overdue).length,closed:tickets.filter(t=>isClosed(t.status)).length}),[tickets]);
 const stats:Stats|null=data?.stats||null;

 return <>
  <PageHeader title="Tickets" subtitle="" backHref="/" backLabel="Home" action={<div className="action-row"><button className={`btn ${scope==='solvent'?'btn-primary':'btn-outline'}`} onClick={()=>setScope('solvent')}>Solvent</button><button className={`btn ${scope==='quality'?'btn-primary':'btn-outline'}`} onClick={()=>setScope('quality')}>Quality</button></div>}/>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  {data&&!data.routingReady?<div className="notice warn" style={{marginTop:12}}>Ticket routing is not set up yet. Ask the Super Admin to run <b>sql/077_ticket_routing.sql</b> in Supabase.</div>:null}

  {stats?<section className="card" style={{marginTop:14}}>
   <div className="section-title">MD Office — {scope==='quality'?'Quality':'Solvent'} tickets</div>
   <StatTiles c={stats}/>
   <Breakdown title="Section" rows={stats.byArea}/>
   <Breakdown title="Responsible person (closer)" rows={stats.byPerson}/>
  </section>:null}

  <section className="card" style={{marginTop:14,padding:0}}>
   <div style={{padding:'14px 16px 0'}}><StatTiles c={mine}/></div>
   <div className="action-row" style={{padding:'12px 16px',flexWrap:'wrap',gap:8}}>
    <select value={view} onChange={e=>setView(e.target.value)} aria-label="Status"><option value="open">Open tickets</option><option value="closed">Closed tickets</option><option value="all">All tickets</option></select>
    <select value={role} onChange={e => { const nextRole = e.target.value; setRole(nextRole); if (nextRole === 'closer') setView('all'); }} aria-label="My role"><option value="all">All my tickets</option><option value="closer">Tickets I close</option><option value="md">MD Office</option><option value="intimate">Intimated to me</option></select>
    <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} aria-label="Filter by severity"><option value="all">All Severities</option>{[...new Set(tickets.map(t => t.severity).filter(Boolean))].sort().map(s => (<option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>))}</select>
    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status"><option value="all">All Statuses</option>{Object.entries(STATUS_LABEL).filter(([key]) => ['open', 'acknowledged', 'in_progress', 'waiting', 'resolved', 'closed'].includes(key)).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}</select>
    <input placeholder="Search ticket, parameter or area" value={text} onChange={e=>setText(e.target.value)} style={{minWidth:240}}/>
   </div>
   {busy?<div className="empty">Loading…</div>:!shown.length?<div className="empty">{data&&!data.hasRouting&&!data.canSeeAll?'No tickets are routed to you.':`No ${view==='all'?'':view+' '}${scope} tickets.`}</div>:
    <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Ticket</th><th>Area</th><th>Parameter</th><th>Severity</th><th>Raised</th><th>Due</th><th>Status</th><th>You</th><th/></tr></thead><tbody>
     {shown.map(t=><tr key={t.id}>
      <td>{t.ticketNo}</td><td>{t.area||t.section}</td><td>{t.parameter}{t.occurrences>1?<span className="sub"> ×{t.occurrences}</span>:null}</td>
      <td><StatusBadge status={t.severity==='critical'?'danger':'warn'} label={t.severity}/></td>
      <td>{when(t.createdAt)}</td><td style={t.overdue?{color:'#c0392b',fontWeight:600}:undefined}>{when(t.dueAt)}</td>
      <td><StatusBadge status={TONE[t.status]||'neutral'} label={STATUS_LABEL[t.status]||t.status}/>{t.reopened&&!isClosed(t.status)?<span className="pill warn" style={{marginLeft:6}}>Reopened</span>:null}</td>
      <td>{t.myRoles.map(r=>ROLE_LABEL[r]).join(', ')||'—'}</td>
      <td><button className="btn btn-outline" onClick={()=>open(t)}>Open</button></td>
     </tr>)}
    </tbody></table></div>}
  </section>

  <Drawer open={!!sel} onClose={()=>setSel(null)} title={sel?.ticketNo||'Ticket'} subtitle={sel?`${sel.area||sel.section} • ${sel.parameter}`:undefined} wide>
   {sel?<>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 16px',margin:'4px 0 14px'}}>
     <div><span className="sub">Status</span><div><StatusBadge status={TONE[sel.status]||'neutral'} label={STATUS_LABEL[sel.status]||sel.status}/></div></div>
     <div><span className="sub">Severity</span><div><StatusBadge status={sel.severity==='critical'?'danger':'warn'} label={sel.severity}/></div></div>
     <div><span className="sub">Reading</span><div>{sel.actual||'—'}</div></div><div><span className="sub">Target</span><div>{sel.target||'—'}</div></div>
     <div><span className="sub">Raised</span><div>{when(sel.createdAt)}</div></div><div><span className="sub">Due</span><div>{when(sel.dueAt)}</div></div>
     <div><span className="sub">Closed by (designated)</span><div>{sel.closers.join(' / ')||'Not assigned'}</div></div><div><span className="sub">Seen as</span><div>{sel.myRoles.map(r=>ROLE_LABEL[r]).join(', ')||'Management'}</div></div>
    </div>

    
    {sel.canAct?<>
     <div className="section-title">Corrective action</div>
     <div className="field"><label>Root cause</label><textarea rows={2} value={rootCause} onChange={e=>setRootCause(e.target.value)}/></div>
     <div className="field"><label>Corrective action taken</label><textarea rows={3} value={action} onChange={e=>setAction(e.target.value)}/></div>
     <div className="field"><label>Closing remark (or add a photograph below)</label><textarea rows={2} value={remark} onChange={e=>setRemark(e.target.value)}/></div>
     <label className="btn btn-outline" style={{display:'inline-flex',gap:6,cursor:'pointer',marginBottom:12}}><FileUp size={14}/>Add photograph / file<input type="file" style={{display:'none'}} disabled={saving} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value=''}}/></label>
     <div className="action-row" style={{flexWrap:'wrap',gap:8}}>
      {isClosed(sel.status)?<button className="btn btn-outline" disabled={saving} onClick={()=>patch({action:'reopen',rootCause,correctiveAction:action,closureComments:remark},'Ticket reopened.')}>Reopen</button>:<>
       {sel.status==='open'?<button className="btn btn-outline" disabled={saving} onClick={()=>patch({action:'acknowledge'},'Acknowledged.')}>Acknowledge</button>:null}
       <button className="btn btn-outline" disabled={saving} onClick={()=>patch({action:'start',rootCause,correctiveAction:action,closureComments:remark},'Marked in progress.')}>Start work</button>
       <button className="btn btn-outline" disabled={saving} onClick={()=>patch({action:'wait',rootCause,correctiveAction:action,closureComments:remark},'Marked waiting.')}>Waiting</button>
       <button className="btn btn-primary" disabled={saving} onClick={()=>patch({action:'close',rootCause,correctiveAction:action,closureComments:remark},'Ticket closed.')}>Close ticket</button></>}
     </div>
    </>:<>
     <div className="section-title">Corrective action</div>
     <p className="sub" style={{margin:'6px 0'}}>Root cause: {sel.rootCause||'—'}<br/>Action: {sel.correctiveAction||'—'}<br/>Closing remark: {sel.closureComments||'—'}</p>
     <p className="sub">Only {sel.closers.join(' / ')||'the designated closer'} can update this ticket.</p>
    </>}

    
<div className="section-title">Evidence</div>

{sel.evidence.length ? (
  <ul style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
    {sel.evidence.map(e => (
      <li key={e.id} style={{ marginBottom: 12 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8
        }}>
          <div>
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer">
                <Paperclip size={12} /> {e.name}
              </a>
            ) : e.name}

            <span className="sub"> {when(e.at)}</span>
          </div>

          {sel.canAct && ['open', 'in_progress'].includes(
  String(sel.status || '').toLowerCase()
) ? (
  <div className="flex items-center gap-2">

    <label className="btn btn-outline cursor-pointer">
      <FileUp size={14} /> Edit / Replace

      <input
        type="file"
        accept="image/*,.pdf"
        hidden
        disabled={saving}
        onChange={ev => {
          const file = ev.target.files?.[0];
          if (file) void upload(file, e.id);
          ev.target.value = '';
        }}
      />
    </label>

    <button
      type="button"
      className="btn btn-outline"
      disabled={saving}
      onClick={() => void deleteEvidence(e.id)}
      title="Delete evidence"
    >
      <Trash2 size={14} />
      Delete
    </button>

  </div>
) : null}
        </div>
      </li>
    ))}
  </ul>
) : (
  <p className="sub" style={{ margin: '6px 0 10px' }}>
    No photographs or files yet.
  </p>
)}

    {sel.canMd?<>
     <div className="section-title" style={{marginTop:18}}>MD Office follow-up</div>
     <label style={{display:'flex',gap:8,alignItems:'center',margin:'8px 0'}}><input type="checkbox" checked={fu.reportedToJmd} onChange={e=>setFu({...fu,reportedToJmd:e.target.checked})}/> Reported to JMD</label>
     <div className="grid two"><div className="field"><label>JMD report date</label><input type="date" value={fu.jmdReportDate} onChange={e=>setFu({...fu,jmdReportDate:e.target.value})}/></div><div className="field"><label>Target closure</label><input type="date" value={fu.targetClosure} onChange={e=>setFu({...fu,targetClosure:e.target.value})}/></div></div>
     <div className="field"><label>MD Office remarks</label><textarea rows={2} value={fu.mdRemarks} onChange={e=>setFu({...fu,mdRemarks:e.target.value})}/></div>
     <button className="btn btn-outline" disabled={saving} onClick={()=>patch({followup:fu},'Follow-up saved.')}>Save follow-up</button>
    </>:null}

    {sel.history.length?<><div className="section-title" style={{marginTop:18}}>History</div><ul style={{margin:'6px 0',paddingLeft:18}}>{sel.history.map((h,i)=><li key={i}>{h.event.replaceAll('_',' ')} <span className="sub">{when(h.at)}{h.note?` — ${h.note}`:''}</span></li>)}</ul></>:null}
   </>:null}
  </Drawer>
  {msg ? (
     <div
  role="status"
  style={{
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '18px 24px',
    background: '#fff',
    border: '1px solid #bbf7d0',
    borderRadius: 14,
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    color: '#166534',
    fontWeight: 600
  }}
>
  <CheckCircle size={23} color="#15803d" />
  {msg}
</div>
   ) : null}
 </>;
}
