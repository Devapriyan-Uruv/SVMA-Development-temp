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
}
