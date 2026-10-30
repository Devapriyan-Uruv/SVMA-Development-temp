'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Ticket,TicketCheck,Layers,AlertTriangle} from 'lucide-react';
export function TicketSummary({scope}:{scope:'solvent'|'quality'}){
 const [counts,setCounts]=useState<{open:number;closed:number;total:number}|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let stopped=false;async function refresh(){try{const r=await fetch(`/api/tickets?scope=${scope}&summary=1`,{cache:'no-store'});if(!r.ok)throw Error();const j=await r.json();if(!stopped){setCounts(j.counts);setError(false)}}catch{if(!stopped)setError(true)}}void refresh();const timer=setInterval(refresh,5000);return()=>{stopped=true;clearInterval(timer)}},[scope]);
 return <><div className="ticket-counts" aria-label="Ticket counts"><Link href={`/${scope}/tickets`}><Ticket size={14}/><span>Open</span><b>{counts?.open??'—'}</b></Link><Link href={`/${scope}/tickets?status=closed`}><TicketCheck size={14}/><span>Closed</span><b>{counts?.closed??'—'}</b></Link><Link href={`/${scope}/tickets?status=all`}><Layers size={14}/><span>Total</span><b>{counts?.total??'—'}</b></Link></div>{error?<p className="notice warn">Ticket counts could not refresh. Please check your connection.</p>:null}<PendingSafetyProcessing/></>
}

// Visibility for the durable follow-up queue (sql/018: deviation_processing_
// failures) — a deviation's ticket/notification creation runs atomically
// with the save via a database trigger and can never block it, but if that
// follow-up itself fails, it is queued here instead of lost. Authorised
// staff (management/heads/admin — the endpoint itself enforces this, so the
// banner simply stays hidden for anyone else) see the count and can retry
// on demand; it also self-heals on the same poll cadence used elsewhere in
// the app (no background worker in this deployment).
function PendingSafetyProcessing(){
 const [state,setState]=useState<{pending:number;failedPermanent:number}|null>(null);
 const [busy,setBusy]=useState(false);
 async function refresh(){try{const r=await fetch('/api/deviations/process-pending',{cache:'no-store'});if(!r.ok){setState(null);return}const j=await r.json();setState({pending:j.pending||0,failedPermanent:j.failedPermanent||0})}catch{setState(null)}}
 useEffect(()=>{void refresh();const t=setInterval(refresh,30000);return()=>clearInterval(t)},[]);
 if(!state||(!state.pending&&!state.failedPermanent))return null;
 async function retryNow(){setBusy(true);try{await fetch('/api/deviations/process-pending',{method:'POST'});await refresh()}finally{setBusy(false)}}
 return <div className="notice warn" style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
  <AlertTriangle size={16}/>
  <span>{state.pending?`${state.pending} deviation alert${state.pending===1?'':'s'} waiting on ticket/notification processing.`:''}{state.failedPermanent?` ${state.failedPermanent} could not be processed after repeated retries — check Admin.`:''}</span>
  <button type="button" className="btn btn-outline" style={{marginLeft:'auto'}} disabled={busy} onClick={retryNow}>{busy?'Retrying…':'Retry now'}</button>
 </div>;
}
