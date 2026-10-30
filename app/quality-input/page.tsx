'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Suspense,useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {ProductPicker} from '@/components/ProductPicker';
import {EntryPersonPhotoField} from '@/components/EntryPersonField';
import {ArrowRightLeft, Clock3, Eye, FlaskConical, Pause, Play, PlusCircle, ShieldCheck, Sparkles} from 'lucide-react';
import {productName} from '@/lib/products';

// `toISOString().slice(0,10)` always returns the UTC calendar date, which
// is the wrong day for part of the IST calendar day (00:00–05:29 IST is
// still "yesterday" in UTC) — build the date string from local components
// instead so the default matches what the operator's clock actually shows.
function localDateInput(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

// The Start Shift dropdown must default to whatever shift is ACTUALLY
// running right now (IST wall-clock), not always the first one in the list.
function currentShiftId(shifts:any[]):string{
 if(!shifts.length)return '';
 const ist=new Date(Date.now()+5.5*3600000),minutesNow=ist.getUTCHours()*60+ist.getUTCMinutes();
 for(const s of shifts){
  const [sh,sm]=String(s.start_time).split(':').map(Number),[eh,em]=String(s.end_time).split(':').map(Number);
  const startMin=sh*60+sm,endMin=eh*60+em;
  const inWindow=s.crosses_midnight?(minutesNow>=startMin||minutesNow<endMin):(minutesNow>=startMin&&minutesNow<endMin);
  if(inWindow)return String(s.id);
 }
 return String(shifts[0].id);
}

export default function QualityInputHub(){return <Suspense><QualityInputHubInner/></Suspense>}
function QualityInputHubInner(){
 const viewAsUserId=useSearchParams().get('viewAs')||'';
 const [viewAsName,setViewAsName]=useState('');
 const [viewAsPicker,setViewAsPicker]=useState<{id:string;full_name:string;email:string}[]>([]);
 const [viewAsPick,setViewAsPick]=useState('');
 const [sessions,setSessions]=useState<any[]>([]),[roles,setRoles]=useState<string[]>([]),[shifts,setShifts]=useState<any[]>([]),[shiftId,setShiftId]=useState(''),[date,setDate]=useState(localDateInput()),[activeProducts,setActiveProducts]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[entryPersonPhotoUrl,setEntryPersonPhotoUrl]=useState('');
 const [tab,setTab]=useState<'active'|'new'>('new');
 const [handoffNotice,setHandoffNotice]=useState('');

 function load(){
  Promise.all([fetch('/api/shift/session?scope=quality',{cache:'no-store'}).then(r=>r.json()),fetch('/api/admin/shifts',{cache:'no-store'}).then(r=>r.json())]).then(([s,m])=>{
   const list=s.sessions||(s.session?[s.session]:[]);
   setSessions(list);setRoles(s.roles||[]);setShifts(m.shifts||[]);
   if(m.shifts?.length)setShiftId(currentShiftId(m.shifts));
   setTab(list.length?'active':'new');
   if(s.roles?.includes('super_admin'))fetch('/api/shift/session/operators?scope=quality',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setViewAsPicker(j.operators||[])}).catch(()=>{});
  }).catch(()=>{});
 }
 useEffect(()=>{
  if(viewAsUserId){
   fetch(`/api/admin/view-as/session?scope=quality&userId=${viewAsUserId}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{setSessions(j.session?[j.session]:[]);setViewAsName(j.viewAsName||'')}).catch(()=>setMessage('Unable to load that operator\'s shift.'));
   return;
  }
  load();
 },[viewAsUserId]);

 async function start(){setBusy(true);setMessage('');setHandoffNotice('');try{const r=await fetch('/api/shift/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftId:Number(shiftId),operationalDate:date,activeProducts,entryPersonPhotoUrl,deviceInfo:{userAgent:navigator.userAgent}})}),j=await r.json();if(!r.ok)throw new Error(j.error);window.location.reload()}catch(e){setMessage(e instanceof Error?e.message:'Unable to start Quality shift')}finally{setBusy(false)}}
 const canOverride=roles.some(r=>['super_admin','quality_head'].includes(r));
 async function end(sessionId:string,force=false){const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:sessionId,force,reason:force?'Authorised Quality shift override':''})}),j=await r.json();if(!r.ok){setMessage(j.error||'Unable to end shift');return}window.location.reload()}
 async function extend(sessionId:string,hours:number){setMessage('');try{const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:sessionId,action:'extend',extendHours:hours})}),j=await r.json();if(!r.ok)throw new Error(j.error);load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to extend shift')}}
 async function pause(sessionId:string,reason:string){if(!reason.trim())return;setMessage('');try{const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:sessionId,action:'pause',reason:reason.trim()})}),j=await r.json();if(!r.ok)throw new Error(j.error);load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to pause entry')}}
 async function resume(sessionId:string){setMessage('');try{const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:sessionId,action:'resume'})}),j=await r.json();if(!r.ok)throw new Error(j.error);load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to resume entry')}}
 async function handoff(sessionId:string,toOperatorId:string,toName:string,reason:string){setMessage('');try{const r=await fetch('/api/shift/session',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:sessionId,action:'handoff',toOperatorId,reason:reason.trim()})}),j=await r.json();if(!r.ok)throw new Error(j.error);setHandoffNotice(`Shift handed off to ${toName}.`);load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to hand off shift');throw e}}

 return <><PageHeader title="Quality Data Entry" subtitle="" backHref="/" backLabel="Home"/>{message?<div className="notice warn" style={{marginBottom:12}}>{message}{message.includes('Authorised override')&&canOverride?<span className="sub"> Use Authorised Override Close on the shift below.</span>:null}</div>:null}
 {viewAsUserId?<div className="notice warn view-as-banner"><Eye size={14}/> Viewing as <b>{viewAsName||'operator'}</b> — read-only preview. <Link href="/quality-input">Exit preview</Link></div>:null}
 {!viewAsUserId&&viewAsPicker.length?<div className="card tight" style={{marginBottom:12,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><Eye size={15}/><span className="sub" style={{marginRight:4}}>Super Admin: view as</span><select value={viewAsPick} onChange={e=>setViewAsPick(e.target.value)}><option value="">Select an operator</option>{viewAsPicker.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select><button type="button" className="btn btn-outline btn-sm" disabled={!viewAsPick} onClick={()=>{window.location.href=`/quality-input?viewAs=${viewAsPick}`}}>View</button></div>:null}
 {!viewAsUserId&&handoffNotice?<div className="notice" style={{marginBottom:12}}>{handoffNotice}</div>:null}

 {viewAsUserId?
  (sessions[0]?<LiveShiftCard scope="quality" session={sessions[0]} readOnly canOverride={false} onEnd={()=>{}} onExtend={()=>{}} onPause={()=>{}} onResume={()=>{}} onHandoff={async()=>{}} entryHref={`/quality-input/lab?viewAs=${viewAsUserId}`}/>
   :<div className="card"><div className="section-title">No active shift for {viewAsName||'this operator'}</div></div>)
  :<>
   {sessions.length?<div className="tabs" style={{marginBottom:14}}><button className={`tab ${tab==='active'?'active':''}`} onClick={()=>setTab('active')}>Active Shifts ({sessions.length})</button><button className={`tab ${tab==='new'?'active':''}`} onClick={()=>setTab('new')}><PlusCircle size={14} style={{verticalAlign:-2,marginRight:4}}/>New Shift</button></div>:null}
   {tab==='active'&&sessions.length?<div style={{display:'flex',flexDirection:'column',gap:16}}>{sessions.map(s=><LiveShiftCard key={s.id} scope="quality" session={s} readOnly={false} canOverride={canOverride} onEnd={force=>end(s.id,force)} onExtend={hours=>extend(s.id,hours)} onPause={reason=>pause(s.id,reason)} onResume={()=>resume(s.id)} onHandoff={(to,toName,reason)=>handoff(s.id,to,toName,reason)} entryHref={`/quality-input/lab?shiftSessionId=${s.id}`}/>)}</div>:null}
   {tab==='new'?<StartShiftForm shifts={shifts} shiftId={shiftId} onShiftId={setShiftId} date={date} onDate={setDate} activeProducts={activeProducts} onActiveProducts={setActiveProducts} entryPersonPhotoUrl={entryPersonPhotoUrl} onEntryPersonPhotoUrl={setEntryPersonPhotoUrl} busy={busy} onStart={start} startedElsewhere={sessions.length>0}/>:null}
  </>}
 </>;
}

function StartShiftForm({shifts,shiftId,onShiftId,date,onDate,activeProducts,onActiveProducts,entryPersonPhotoUrl,onEntryPersonPhotoUrl,busy,onStart,startedElsewhere}:{shifts:any[];shiftId:string;onShiftId:(v:string)=>void;date:string;onDate:(v:string)=>void;activeProducts:string[];onActiveProducts:(v:string[])=>void;entryPersonPhotoUrl:string;onEntryPersonPhotoUrl:(v:string)=>void;busy:boolean;onStart:()=>void;startedElsewhere:boolean}){
 return <div className="entry-start-grid"><section className="entry-start-main quality-entry-start"><div className="entry-start-title"><span className="entry-icon"><Sparkles size={19}/></span><div><span>START QUALITY SHIFT</span><h2>Select the products being tested</h2><p>Choose the date, shift and products being tested. The shift will run under your own login.</p></div></div>{startedElsewhere?<div className="notice" style={{marginBottom:10}}>You already hold another active shift — starting this one is separate and won&apos;t close it. Close or hand off the other shift from the Active Shifts tab when it&apos;s done.</div>:null}<div className="grid two"><div className="field"><label>Shift</label><select value={shiftId} onChange={e=>onShiftId(e.target.value)}>{shifts.map(s=><option key={s.id} value={s.id}>{s.name} • {String(s.start_time).slice(0,5)}–{String(s.end_time).slice(0,5)}</option>)}</select></div><div className="field"><label>Operational date</label><input type="date" value={date} onChange={e=>onDate(e.target.value)}/></div></div><ProductPicker value={activeProducts} onChange={onActiveProducts} label="Which products will the Lab handle in this shift?"/><EntryPersonPhotoField photoUrl={entryPersonPhotoUrl} onPhotoUrl={onEntryPersonPhotoUrl}/><button className="btn btn-primary btn-lg" style={{marginTop:14}} disabled={!shiftId||!activeProducts.length||busy} onClick={onStart}>{busy?'Starting shift…':'Start Quality Shift'}</button></section><aside className="entry-start-side"><div className="start-side-card"><FlaskConical/><b>Product-specific templates</b><p>Rice Bran, Copra and Palm Kernel each have their own raw material, by-product and oil test groups.</p></div><div className="start-side-card"><Clock3/><b>Sampling frequency</b><p>The source frequency is preserved as reference metadata. It never hides an hour: every parameter has all 8 shift-hour cells available.</p></div><div className="start-side-card"><ShieldCheck/><b>Immediate validation</b><p>Configured targets create deviations and alerts as soon as results are saved.</p></div></aside></div>;
}

function LiveShiftCard({scope,session,readOnly,canOverride,onEnd,onExtend,onPause,onResume,onHandoff,entryHref}:{scope:'quality'|'solvent';session:any;readOnly:boolean;canOverride:boolean;onEnd:(force:boolean)=>void;onExtend:(hours:number)=>void;onPause:(reason:string)=>void;onResume:()=>void;onHandoff:(toOperatorId:string,toName:string,reason:string)=>Promise<void>;entryHref:string}){
 const [extendOpen,setExtendOpen]=useState(false),[extendHours,setExtendHours]=useState('4');
 const [pauseOpen,setPauseOpen]=useState(false),[pauseReason,setPauseReason]=useState('');
 const [handoffOpen,setHandoffOpen]=useState(false),[handoffOperators,setHandoffOperators]=useState<{id:string;full_name:string;email:string}[]>([]),[handoffTo,setHandoffTo]=useState(''),[handoffReason,setHandoffReason]=useState(''),[handoffBusy,setHandoffBusy]=useState(false);
 const endAt=session?.scheduled_end?new Date(session.scheduled_end):null,remaining=endAt?Math.max(0,endAt.getTime()-Date.now()):0,hrs=Math.floor(remaining/3600000),mins=Math.floor((remaining%3600000)/60000),running:string[]=session?.active_products||[];
 function openHandoff(){setHandoffOpen(true);fetch(`/api/shift/session/operators?scope=${scope}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setHandoffOperators(j.operators||[])}).catch(()=>{})}
 async function confirmHandoff(){if(!handoffTo)return;setHandoffBusy(true);const toName=handoffOperators.find(p=>p.id===handoffTo)?.full_name||'your colleague';try{await onHandoff(handoffTo,toName,handoffReason);setHandoffOpen(false);setHandoffTo('');setHandoffReason('')}catch{}finally{setHandoffBusy(false)}}
 return <section className="card" style={{padding:0,overflow:'hidden'}}>
  <div className="live-context quality-live" style={{margin:0}}><div><span className="eyebrow">{session.status==='paused'?`${scope.toUpperCase()} SHIFT PAUSED`:`${scope.toUpperCase()} SHIFT ACTIVE`}</span><h2>{session.shift_master?.name||'Shift'} • {session.operational_date}</h2><div className="run-chips">{running.map(p=><span key={p}>{productName(p)}</span>)}</div>
   {session.receivedViaHandoff?<div className="sub" style={{marginTop:6}}>Started by <b>{session.entry_person_name}</b> — handed to <b>you</b>{session.handoff?` at ${new Date(session.handoff.handedOffAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}`:''}</div>
    :<div className="sub" style={{marginTop:6}}>Started by <b>you</b> ({session.entry_person_name})</div>}
  </div><div className="live-timer">{session.status==='paused'?<span className="pill warn" style={{fontSize:12}}><Pause size={12}/> Paused</span>:<><span>Time remaining</span><b>{remaining>0?`${hrs}h ${mins}m`:'Shift period complete'}</b></>}</div></div>
  <div style={{padding:'0 17px 17px'}}>
  {session.status==='paused'?<div className="notice warn" style={{marginTop:16}}><b>Entry is paused.</b> Resume to continue recording results.</div>
   :<div className="workspace-grid compact" style={{marginTop:16}}><Link href={entryHref} className="workspace-card tone-purple"><div className="workspace-top"><span className="workspace-icon"><FlaskConical/></span><span className="workspace-tag">Full 8-hour QC sheet</span></div><h2>{scope==='quality'?'Quality QC Sheet Entry':'Enter Plant Readings'}</h2><p>Continue entering results for this shift.</p></Link></div>}
  {!readOnly&&pauseOpen?<div className="card tight" style={{marginTop:14}}><div className="field"><label>Reason for pausing entry</label><textarea rows={2} value={pauseReason} onChange={e=>setPauseReason(e.target.value)} placeholder="e.g. Instrument issue, sample delay, break…"/></div><div style={{display:'flex',gap:8,marginTop:10}}><button className="btn btn-danger" disabled={!pauseReason.trim()} onClick={()=>{onPause(pauseReason);setPauseOpen(false);setPauseReason('')}}>Confirm pause</button><button className="btn btn-outline" onClick={()=>{setPauseOpen(false);setPauseReason('')}}>Cancel</button></div></div>:null}
  {!readOnly&&handoffOpen?<div className="card tight" style={{marginTop:14}}>
   <p className="sub" style={{marginBottom:10}}>Staying on it yourself? Nothing to do. Use this only to transfer the shift to someone else.</p>
   <div className="field"><label>Hand off to</label><select value={handoffTo} onChange={e=>setHandoffTo(e.target.value)}><option value="">Select a colleague</option>{handoffOperators.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
   <div className="field" style={{marginTop:10}}><label>Reason (optional)</label><input value={handoffReason} onChange={e=>setHandoffReason(e.target.value)} placeholder="e.g. Shift change, pending lab results"/></div>
   <div style={{display:'flex',gap:8,marginTop:10}}><button className="btn btn-primary" disabled={handoffBusy||!handoffTo} onClick={confirmHandoff}>{handoffBusy?'Handing off…':'Confirm hand-off'}</button><button className="btn btn-outline" onClick={()=>{setHandoffOpen(false);setHandoffTo('');setHandoffReason('')}}>Cancel</button></div>
  </div>:null}
  {!readOnly?<div className="shift-control-modern" style={{marginTop:14}}><div><b>{session.status==='paused'?'Resume when ready':`${scope==='quality'?'Quality':'Solvent'} shift stays live for the full period`}</b><span>{session.status==='paused'?'The Head and Management have been notified of the pause.':'Data can be entered any time you\'re logged in.'}</span></div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   {session.status==='paused'?<button className="btn btn-success" onClick={onResume}><Play size={14}/> Resume Entry</button>:<button className="btn btn-outline" onClick={()=>setPauseOpen(true)}><Pause size={14}/> Pause Entry</button>}
   <button className="btn btn-outline" onClick={openHandoff}><ArrowRightLeft size={14}/> Hand off Shift</button>
   {canOverride?(extendOpen?<><input type="number" min={1} max={12} value={extendHours} onChange={e=>setExtendHours(e.target.value)} style={{width:64}}/><span className="sub">hours</span><button className="btn btn-secondary" onClick={()=>{onExtend(Number(extendHours));setExtendOpen(false)}}>Confirm</button><button className="btn btn-outline" onClick={()=>setExtendOpen(false)}>Cancel</button></>:<button className="btn btn-secondary" onClick={()=>setExtendOpen(true)}>Extend Shift</button>):null}
   <button className="btn btn-outline" onClick={()=>onEnd(false)}>Close Shift at End</button>
   {canOverride?<button className="btn btn-danger" onClick={()=>onEnd(true)}>Authorised Override Close</button>:null}
  </div></div>:null}
  </div>
 </section>;
}
