'use client';
import {useEffect,useState} from 'react';
import {Eye,Square,UserCog} from 'lucide-react';
import {Modal} from '@/components/Modal';
import {EmptyState} from '@/components/EmptyState';

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}

function liveSessionText(s:any){
 const handoffPart=s.handoff?` • handed off to ${s.handoff.toName} at ${new Date(s.handoff.handedOffAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}`:'';
 const started=s.actual_start?new Date(s.actual_start):null,mins=started?Math.max(0,Math.round((Date.now()-started.getTime())/60000)):0,h=Math.floor(mins/60),m=mins%60;
 return `${s.shift_master?.name||'Shift'}${Array.isArray(s.active_products)&&s.active_products.length?` • ${s.active_products.join(', ')}`:''} • entered by ${s.entry_person_name||'—'}${s.status==='paused'?' • PAUSED':started?` • started ${started.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})} • running ${h}h ${m}m`:''}${handoffPart}`;
}

// Every currently active/paused shift, both scopes, live — shared by the
// Super Admin "Shift Control" tab (full control: View As + Stop) and the
// Management dashboard's own read-only panel (canStop/canViewAs=false —
// Management gets real-time visibility into what's being entered on both
// floors without ever gaining the ability to interrupt a shift; the Stop
// action stays gated server-side regardless, this just keeps the UI from
// offering a control that would 403 anyway).
export function ShiftControlList({canStop=true,canViewAs=true,canReassign=true,pollMs}:{canStop?:boolean;canViewAs?:boolean;canReassign?:boolean;pollMs?:number}){
 const [sessions,setSessions]=useState<any[]>([]),[recentlyClosed,setRecentlyClosed]=useState<any[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [stopping,setStopping]=useState<any>(null),[stopReason,setStopReason]=useState(''),[stopBusy,setStopBusy]=useState(false);
 const [reassigning,setReassigning]=useState<any>(null),[reopenMode,setReopenMode]=useState(false),[operators,setOperators]=useState<any[]>([]),[toOperatorId,setToOperatorId]=useState(''),[reassignReason,setReassignReason]=useState(''),[reassignBusy,setReassignBusy]=useState(false),[reassignError,setReassignError]=useState(''),[reassignNote,setReassignNote]=useState('');
 function load(){fetch('/api/admin/shift-control',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.error)throw new Error(j.error);setSessions(j.sessions||[]);setRecentlyClosed(j.recentlyClosed||[])}).catch(e=>setError(e instanceof Error?e.message:'Unable to load live shifts')).finally(()=>setLoading(false))}
 useEffect(()=>{load();if(pollMs){const t=setInterval(load,pollMs);return()=>clearInterval(t)}},[pollMs]);
 async function confirmStop(){
  if(!stopping)return;setStopBusy(true);
  try{
   const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:stopping.scope,shiftSessionId:stopping.id,force:true,reason:stopReason.trim()||'Stopped from Shift Control'})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setStopping(null);setStopReason('');load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to stop shift')}finally{setStopBusy(false)}
 }
 function openReassign(s:any,reopen:boolean){
  setReassigning(s);setReopenMode(reopen);setToOperatorId('');setReassignReason('');setReassignError('');setReassignNote('');setOperators([]);
  fetch(`/api/shift/session/operators?scope=${s.scope}`,{cache:'no-store'}).then(r=>r.json()).then(j=>setOperators(j.operators||[])).catch(()=>setReassignError('Unable to load operator list'));
 }
 async function confirmReassign(){
  if(!reassigning||!toOperatorId)return;setReassignBusy(true);setReassignError('');setReassignNote('');
  try{
   const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:reassigning.scope,shiftSessionId:reassigning.id,action:'handoff',toOperatorId,reopen:reopenMode,reason:reassignReason.trim()||(reopenMode?'Reopened and reassigned from Shift Control':'Reassigned from Shift Control')})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   if(Array.isArray(j.closedDuplicates)&&j.closedDuplicates.length){
    setReassignNote(`Also closed ${j.closedDuplicates.length} empty duplicate session${j.closedDuplicates.length===1?'':'s'} for this same shift slot.`);
    setTimeout(()=>{setReassigning(null);load()},1800);
   }else{setReassigning(null);load()}
  }catch(e){setReassignError(e instanceof Error?e.message:'Unable to reassign shift')}finally{setReassignBusy(false)}
 }
 return <>
  <div className="table-toolbar"><span className="table-count">{sessions.length} live shift{sessions.length===1?'':'s'}</span><button type="button" className="btn btn-outline" onClick={load}>Refresh</button></div>
  {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  {loading?null:sessions.length?<div className="row-list">{sessions.map(s=><div key={s.id} className="row-list-item as-div">
    <span className={`pill ${s.scope==='quality'?'info':'ok'}`}>{s.scope.toUpperCase()}</span>
    <span className="row-list-main">
     <span className="row-list-title">{s.operatorName}</span>
     <span className="row-list-sub">{liveSessionText(s)}</span>
    </span>
    {canStop||canViewAs||canReassign?<span className="row-list-actions">
     {canViewAs?<a className="row-action-btn" href={`${s.scope==='quality'?'/quality-input':'/input'}?viewAs=${s.operator_id}`}><Eye size={13}/> View as</a>:null}
     {canReassign?<button className="row-action-btn" onClick={()=>openReassign(s,false)}><UserCog size={13}/> Reassign</button>:null}
     {canStop?<button className="row-action-btn" onClick={()=>{setStopping(s);setStopReason('')}}><Square size={13}/> Stop</button>:null}
    </span>:null}
   </div>)}</div>
   :<div className="card"><EmptyState title="No shifts are currently live" description="Every Solvent and Quality shift is closed right now."/></div>}

  {canReassign&&recentlyClosed.length?<>
   <div className="table-toolbar" style={{marginTop:20}}><span className="table-count">Closed in the last 24h — reopen if the wrong session got handed off</span></div>
   <div className="row-list">{recentlyClosed.map(s=><div key={s.id} className="row-list-item as-div">
     <span className={`pill ${s.scope==='quality'?'info':'ok'}`}>{s.scope.toUpperCase()}</span>
     <span className="row-list-main">
      <span className="row-list-title">{s.operatorName}</span>
      <span className="row-list-sub">{s.shift_master?.name||'Shift'} • {s.operational_date} • {s.entryCount} entr{s.entryCount===1?'y':'ies'} • closed {s.actual_end?new Date(s.actual_end).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}):''}</span>
     </span>
     <span className="row-list-actions">
      <button className="row-action-btn" onClick={()=>openReassign(s,true)}><UserCog size={13}/> Reopen &amp; reassign</button>
     </span>
    </div>)}</div>
  </>:null}

  {canStop?<Modal open={!!stopping} onClose={()=>setStopping(null)} title={stopping?`Stop the ${stopping.scope==='quality'?'Quality':'Solvent'} shift?`:''} tone="danger" description={stopping?`Force-closes ${stopping.operatorName}'s shift immediately, same as their own "Close Shift". Any mandatory entries still missing stay missing.`:''} confirmLabel="Confirm stop" busy={stopBusy} onConfirm={confirmStop}>
   <Field label="Reason (optional)"><input value={stopReason} onChange={e=>setStopReason(e.target.value)} placeholder="e.g. Operator unreachable"/></Field>
  </Modal>:null}

  {canReassign?<Modal open={!!reassigning} onClose={()=>setReassigning(null)} title={reassigning?`${reopenMode?'Reopen and reassign':'Reassign'} the ${reassigning.scope==='quality'?'Quality':'Solvent'} shift`:''} description={reassigning?(reopenMode?`This session is closed with ${reassigning.entryCount} entr${reassigning.entryCount===1?'y':'ies'} already saved under ${reassigning.operatorName}. Reopening hands the SAME session (same entries, same history — nothing moves or gets rewritten) to another operator so they can continue it. Any empty duplicate session still open for this same shift slot gets closed automatically.`:`Moves ${reassigning.operatorName}'s open shift to another operator — same session, same entries already saved, same "hand off" the operators use themselves. Use this when the outgoing operator can't complete the hand-off from their own device.`):''} confirmLabel={reopenMode?'Reopen & reassign':'Reassign'} busy={reassignBusy} onConfirm={confirmReassign} confirmDisabled={!toOperatorId}>
   <Field label="Hand off to"><select value={toOperatorId} onChange={e=>setToOperatorId(e.target.value)}><option value="">Select operator…</option>{operators.map(o=><option key={o.id} value={o.id}>{o.full_name||o.email}</option>)}</select></Field>
   <Field label="Reason (optional)"><input value={reassignReason} onChange={e=>setReassignReason(e.target.value)} placeholder="e.g. Operator unreachable"/></Field>
   {reassignError?<div className="notice danger">{reassignError}</div>:null}
   {reassignNote?<div className="notice">{reassignNote}</div>:null}
  </Modal>:null}
 </>;
}
