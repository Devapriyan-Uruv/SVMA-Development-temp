'use client';
import {useEffect,useRef,useState} from 'react';
import {CalendarClock,Filter,Radio,Square} from 'lucide-react';

export type Period={date:string;shiftId:string;product:string};

function liveShiftText(shift:any){
 // entry_person_name is fixed at shift start and never changes, so it's
 // always "who started it" — even after a Hand off changes the session's
 // real operator_id. shift.handoff (see lib/shiftHandoff.ts, attached by
 // every dashboard API that surfaces a live shift) is the only place "and
 // now handed off to who, when" shows up.
 const handoffPart=shift.handoff?` • handed off to ${shift.handoff.toName} at ${new Date(shift.handoff.handedOffAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}`:'';
 return `${shift.shift_master?.name||'Shift'}${Array.isArray(shift.active_products)&&shift.active_products.length?` • ${shift.active_products.join(', ')}`:''}${shift.entry_person_name?` • entered by ${shift.entry_person_name}`:''}${shift.status==='paused'?' • PAUSED':shift.actual_start?(()=>{const started=new Date(shift.actual_start),mins=Math.max(0,Math.round((Date.now()-started.getTime())/60000)),h=Math.floor(mins/60),m=mins%60;return ` • started ${started.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})} • running ${h}h ${m}m`})():''}${handoffPart}`;
}

// One consistent date/shift/product filter for every management dashboard
// (Solvent, Quality, CEO Cockpit) — a small icon that opens a popover to
// pick and apply, instead of a permanently-open filter bar taking up page
// space. The live-shift chips stay always visible outside the popover so
// "what is running right now" is never hidden behind a click.
//
// `liveSessions` is EVERY currently active/paused session for the scope(s)
// this page cares about — not just one. A single "most recent" session
// used to be all that was shown, which silently hid a second concurrent
// one (the exact shape a hand-off followed by the sender starting a fresh
// shift of their own takes) — including whichever one had just been
// handed off, entries and all. Each dashboard API route now returns this
// full list (see the matching comment in each `.../dashboard/route.ts`).
//
// Stop Shift: a Super Admin can force-close whatever shift is shown live,
// right from here — no more asking someone to run a script for a stuck/
// abandoned session. Visibility is decided by fetching the viewer's own
// roles once (self-contained, so every page using this component gets it
// for free); the actual authorisation is still enforced server-side by
// PATCH /api/shift/session's own canOverride check.
export function PeriodFilter({period,onChange,liveSessions,products,onStopped}:{period:Period;onChange:(next:Period)=>void;liveSessions?:{scope:'solvent'|'quality';shift:any}[];products?:{code:string;name:string}[];onStopped?:()=>void}){
 const [open,setOpen]=useState(false);
 const [draft,setDraft]=useState(period);
 const [roles,setRoles]=useState<string[]>([]);
 const [stopping,setStopping]=useState<{scope:string;id:string;label:string}|null>(null);
 const [stopReason,setStopReason]=useState(''),[stopBusy,setStopBusy]=useState(false),[stopError,setStopError]=useState('');
 const ref=useRef<HTMLDivElement>(null);
 const viewingLive=!period.date;
 useEffect(()=>{setDraft(period)},[period]);
 useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.roles)setRoles(j.roles)}).catch(()=>{})},[]);
 useEffect(()=>{function onDoc(e:MouseEvent){if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)}document.addEventListener('mousedown',onDoc);return()=>document.removeEventListener('mousedown',onDoc)},[]);
 function apply(){onChange(draft);setOpen(false)}
 function backToLive(){onChange({date:'',shiftId:'',product:period.product});setOpen(false)}
 // Deliberately Super Admin only — this stops someone ELSE's shift outright,
 // which is a different, bigger authority than a Head's existing ability to
 // force-close their own shift early or extend/hand off their own team's.
 function canStop(){return roles.includes('super_admin')}
 async function confirmStop(){
  if(!stopping)return;setStopBusy(true);setStopError('');
  try{
   const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:stopping.scope,shiftSessionId:stopping.id,force:true,reason:stopReason.trim()||'Stopped by admin'})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setStopping(null);setStopReason('');onStopped?.();
  }catch(e){setStopError(e instanceof Error?e.message:'Unable to stop shift')}finally{setStopBusy(false)}
 }
 
 const entries=(liveSessions||[]).filter(x=>x.shift);

 return <div className="period-filter-bar-sleek" ref={ref}>
  <div className="period-filter-status">
   <span className={`pill ${viewingLive?'ok':'info'}`}>
    <CalendarClock size={12}/> {viewingLive?'Live shift':`${period.date}${period.shiftId?` • Shift ${period.shiftId}`:' • all shifts'}`}
   </span>
   {entries.length?entries.map((e,i)=>
    <span key={i} className="pill ok live-now-chip">
     <i className="live-dot"/> {e.scope.toUpperCase()} LIVE: {liveShiftText(e.shift)}
     {canStop()?<button type="button" className="live-stop-btn" title="Stop this shift" onClick={()=>{setStopping({scope:e.scope,id:e.shift.id,label:e.scope});setStopError('')}}><Square size={10}/> Stop</button>:null}
    </span>
   ):<span className="pill neutral">No shift currently live</span>}
  </div>

  <div style={{position:'absolute',top:0,right:0}}>
   <button type="button" className="filter-icon-btn" onClick={()=>setOpen(x=>!x)} aria-label="Filters">
    <Filter size={15}/><span>Filters</span>
   </button>
   {open?<div className="filter-popover">
    <label className="field compact-field">
     <span>Date</span>
     <input type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/>
    </label>
    <label className="field compact-field">
     <span>Shift</span>
     <select value={draft.shiftId} onChange={e=>setDraft({...draft,shiftId:e.target.value})}>
      <option value="">All shifts</option>
      <option value="1">Shift 1</option>
      <option value="2">Shift 2</option>
      <option value="3">Shift 3</option>
     </select>
    </label>
    {products?.length?<label className="field compact-field">
     <span>Product</span>
     <select value={draft.product} onChange={e=>setDraft({...draft,product:e.target.value})}>
      <option value="">All products</option>
      {products.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}
     </select>
    </label>:null}
    <div style={{display:'flex',gap:8,marginTop:10}}>
     <button type="button" className="btn btn-primary" style={{flex:1}} onClick={apply}>Apply</button>
     {!viewingLive?<button type="button" className="btn btn-outline" onClick={backToLive}><Radio size={13}/></button>:null}
    </div>
   </div>:null}
  </div>

  {stopping?<div className="stop-shift-overlay" onClick={()=>setStopping(null)}>
   <div className="stop-shift-modal" onClick={e=>e.stopPropagation()}>
    <b>Stop the {stopping.label==='quality'?'Quality':'Solvent'} shift?</b>
    <p className="sub" style={{marginTop:4}}>This force-closes it immediately, same as the operator's own "Close Shift" — any mandatory entries still missing stay missing.</p>
    {stopError?<div className="notice danger" style={{marginTop:8}}>{stopError}</div>:null}
    <label className="field compact-field" style={{marginTop:10}}>
     <span>Reason (optional)</span>
     <input value={stopReason} onChange={e=>setStopReason(e.target.value)} placeholder="e.g. Operator unreachable"/>
    </label>
    <div style={{display:'flex',gap:8,marginTop:10}}>
     <button type="button" className="btn btn-danger" disabled={stopBusy} onClick={confirmStop}>{stopBusy?'Stopping…':'Confirm stop'}</button>
     <button type="button" className="btn btn-outline" onClick={()=>setStopping(null)}>Cancel</button>
    </div>
   </div>
  </div>:null}
 </div>;
}


