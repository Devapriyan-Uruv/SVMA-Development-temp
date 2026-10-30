'use client';
import {useEffect,useRef,useState,useCallback} from 'react';
import {createPortal} from 'react-dom';
import {useRouter} from 'next/navigation';
import {Bell,Volume2,VolumeX,AlertOctagon} from 'lucide-react';
import {statusTone} from '@/components/StatusBadge';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {unlockAlertSound,isAlertSoundUnlocked,playAlertSound,vibrateAlert} from '@/lib/alerts';

type Notif={id:string;title:string;body?:string|null;severity?:string|null;event_type?:string|null;entity_type?:string|null;entity_id?:string|null;read_at?:string|null;acknowledged_at?:string|null;created_at:string};

const SOUND_PREF_KEY='svma-alert-sound-enabled';

function timeAgo(iso:string){
 const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));
 if(s<60)return 'just now';
 const m=Math.round(s/60);if(m<60)return `${m}m ago`;
 const h=Math.round(m/60);if(h<24)return `${h}h ago`;
 return `${Math.round(h/24)}d ago`;
}
// Deviation notifications are already tagged with an event_type of
// `solvent_parameter_deviation` / `quality_parameter_deviation` /
// `*_target_missing` / `quality_sample_overdue` / `quality_result_overdue`
// by the server (app/api/entries, app/api/quality/sla-sweep) — this only
// reads that existing tag to route the click to the right board.
function targetHref(n:Notif){
 if(n.event_type?.startsWith('quality_'))return '/quality/tickets';
 if(n.event_type?.startsWith('solvent_'))return '/solvent/tickets';
 if(n.event_type?.startsWith('approval_'))return '/approvals';
 if(n.event_type==='chat_message')return '/chat';
 if(n.event_type?.startsWith('leave_'))return '/hr/my';
 return '/';
}

// Polls the user's own notification rows as a reliable fallback (Section
// AI explicitly allows this when Realtime is unavailable), while a
// Supabase Realtime subscription — scoped to this user's own rows only via
// RLS — delivers new CRITICAL/WARNING alerts within about a second when it
// is available. A CRITICAL alert additionally opens a persistent, full
// attention overlay that will not go away until acknowledged.
export function NotificationBell(){
 const [open,setOpen]=useState(false);
 const [alertError,setAlertError]=useState('');
 const [items,setItems]=useState<Notif[]>([]);
 const [unread,setUnread]=useState(0);
 const [soundOn,setSoundOn]=useState(true);
 const seen=useRef(new Set<string>());
 const [uid,setUid]=useState<string|null>(null);
 const [criticalQueue,setCriticalQueue]=useState<Notif[]>([]);
 const [bulkBusy,setBulkBusy]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 const router=useRouter();

 // CEO/Management/Super Admin sit above the operational floor and can end
 // up with a backlog of many queued critical alerts at once (e.g. after
 // being away) — they get a bulk "Acknowledge all" escape hatch. Solvent
 // and Quality (operators and heads) are the ones actually meant to act on
 // each deviation individually, so they keep the original one-at-a-time flow.
 const [canBulkAcknowledge,setCanBulkAcknowledge]=useState(false);

 useEffect(()=>{try{const v=localStorage.getItem(SOUND_PREF_KEY);if(v!=null)setSoundOn(v==='1')}catch{}},[]);

 async function load(){
  try{const r=await fetch('/api/notifications',{cache:'no-store'});if(!r.ok)return;const j=await r.json();for(const n of j.notifications||[])handleNew(n);setItems(j.notifications||[]);setUnread(j.unread||0)}catch{}
 }
 useEffect(()=>{void load();const t=setInterval(load,5000);const refresh=()=>void load();window.addEventListener('svma-readings-saved',refresh);window.addEventListener('online',refresh);return ()=>{clearInterval(t);window.removeEventListener('svma-readings-saved',refresh);window.removeEventListener('online',refresh)}},[soundOn]);
 useEffect(()=>{const unlock=()=>{if(soundOn&&!isAlertSoundUnlocked())unlockAlertSound()};document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock)}},[soundOn]);
 useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.user?.id)setUid(j.user.id);if(Array.isArray(j?.roles))setCanBulkAcknowledge(j.roles.some((r:string)=>['ceo','management','super_admin'].includes(r)))}).catch(()=>{})},[]);
 // App-icon badge (the number shown on the icon itself, outside the app) —
 // the Badging API. Only actually renders anything when running as an
 // installed PWA (Android Chrome, and iOS Safari 16.4+ once added to the
 // home screen); it's a harmless no-op in a regular browser tab, so no
 // platform check is needed beyond feature detection.
 useEffect(()=>{
  const nav=navigator as any;
  if(unread>0&&nav.setAppBadge)nav.setAppBadge(unread).catch(()=>{});
  else if(unread===0&&nav.clearAppBadge)nav.clearAppBadge().catch(()=>{});
 },[unread]);

 const handleNew=useCallback((n:Notif)=>{
  if(seen.current.has(n.id))return;seen.current.add(n.id);
  setItems(x=>[n,...x.filter(y=>y.id!==n.id)].slice(0,20));
  if(!n.read_at)setUnread(x=>x+1);
  // Critical still interrupts with sound/vibration and the full-screen
  // forced-acknowledge overlay below. Warning stays out of the way here too
  // — it still lands in the bell list (and, separately, in Deviations/the
  // ticket queue) but never sounds, vibrates, or blocks the screen.
  if(n.severity==='critical'&&!n.acknowledged_at){
   if(soundOn)playAlertSound('critical');
   vibrateAlert('critical');
  }
  // The full-screen forced-acknowledge overlay is reserved for genuine
  // CRITICAL deviations (entity_type set only by the deviation trigger,
  // sql/018) — QC sample/result overdue reminders and warning-severity
  // deviations still show in the bell, they just don't block the screen.
  if(n.entity_type==='deviation'&&n.severity==='critical'&&!n.acknowledged_at)setCriticalQueue(x=>x.find(y=>y.id===n.id)?x:[...x,n]);
 },[soundOn]);

 useEffect(()=>{
  if(!uid)return;
  let channel:ReturnType<ReturnType<typeof supabaseBrowser>['channel']>|null=null;
  try{
   const sb=supabaseBrowser();
   channel=sb.channel(`notif-${uid}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},(payload:any)=>handleNew(payload.new as Notif)).subscribe();
  }catch{/* Realtime is a best-effort enhancement — the 45s poll above still delivers every alert. */}
  return ()=>{try{if(channel)supabaseBrowser().removeChannel(channel)}catch{}};
 },[uid,handleNew]);

 useEffect(()=>{
  function onDoc(e:MouseEvent){if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)}
  document.addEventListener('mousedown',onDoc);return ()=>document.removeEventListener('mousedown',onDoc);
 },[]);

 function toggleSound(){
  const next=!isAlertSoundUnlocked()||!soundOn;setSoundOn(next);
  try{localStorage.setItem(SOUND_PREF_KEY,next?'1':'0')}catch{}
  if(next)unlockAlertSound();
  void fetch('/api/notifications',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({soundEnabled:next})}).catch(()=>{});
 }

 async function markAllRead(){
  setItems(x=>x.map(n=>n.read_at?n:{...n,read_at:new Date().toISOString()}));setUnread(0);
  try{await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({all:true})})}catch{}
 }
 async function clearAll(){
  setItems([]);setUnread(0);seen.current.clear();
  try{await fetch('/api/notifications',{method:'DELETE'})}catch{}
 }
 async function openItem(n:Notif){
  setOpen(false);
  if(!n.read_at){
   setItems(x=>x.map(y=>y.id===n.id?{...y,read_at:new Date().toISOString()}:y));
   setUnread(x=>Math.max(0,x-1));
   try{await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:n.id})})}catch{}
  }
  router.push(targetHref(n));
 }
 async function acknowledge(n:Notif){
  setAlertError('');try{const r=await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:n.id,acknowledge:true})});if(!r.ok)throw Error();setCriticalQueue(x=>x.filter(y=>y.id!==n.id));setItems(x=>x.map(y=>y.id===n.id?{...y,acknowledged_at:new Date().toISOString(),read_at:y.read_at||new Date().toISOString()}:y));return true}catch{setAlertError('Acknowledgement was not saved. Please try again.');return false}
 }
 async function acknowledgeAll(){
  const ids=criticalQueue.map(n=>n.id);if(!ids.length)return;
  setAlertError('');setBulkBusy(true);
  try{
   const r=await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({ids,acknowledge:true})});
   if(!r.ok)throw Error();
   const now=new Date().toISOString();
   setCriticalQueue([]);
   setItems(x=>x.map(y=>ids.includes(y.id)?{...y,acknowledged_at:now,read_at:y.read_at||now}:y));
  }catch{setAlertError('Some alerts may not have been acknowledged. Please try again.')}finally{setBulkBusy(false)}
 }

 const activeCritical=criticalQueue[0];
 const [bellShaking,setBellShaking]=useState(false);
const bellTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 useEffect(()=>{
  if(unread<=0){
   setBellShaking(false);
   if(bellTimer.current)clearTimeout(bellTimer.current);
   bellTimer.current=null;
   return;
  }

  const shakeBell=()=>{
   setBellShaking(true);
   if(bellTimer.current)clearTimeout(bellTimer.current);
   bellTimer.current=setTimeout(()=>setBellShaking(false),800);
  };

  shakeBell();
  const interval=setInterval(shakeBell,1000);

  return ()=>{
   clearInterval(interval);
   if(bellTimer.current)clearTimeout(bellTimer.current);
   bellTimer.current=null;
  };
 },[unread]);
 return <div className="notif-wrap" ref={ref}>
  {activeCritical?createPortal(<div className="critical-alert-overlay" role="alertdialog" aria-modal="true">
   <div className="critical-alert-card">
    <div className="critical-alert-icon"><AlertOctagon size={28}/></div>
    <b>{activeCritical.title}</b>
    {activeCritical.body?<p>{activeCritical.body}</p>:null}
    <span className="critical-alert-time">{timeAgo(activeCritical.created_at)}</span>
    {alertError?<p role="alert">{alertError}</p>:null}<div className="critical-alert-actions">
     <button type="button" className="btn btn-secondary" onClick={async()=>{if(await acknowledge(activeCritical))void openItem(activeCritical)}}>Open ticket</button>
     <button type="button" className="btn btn-primary" onClick={()=>acknowledge(activeCritical)}>ACKNOWLEDGE</button>
    </div>
    {criticalQueue.length>1?<small>{criticalQueue.length-1} more alert{criticalQueue.length-1===1?'':'s'} waiting</small>:null}
    {canBulkAcknowledge&&criticalQueue.length>1?<button type="button" className="critical-alert-ack-all" disabled={bulkBusy} onClick={acknowledgeAll}>{bulkBusy?'Acknowledging…':`Acknowledge all ${criticalQueue.length} alerts`}</button>:null}
   </div>
  </div>,document.body):null}

  <button type="button" className="icon-btn" aria-label={soundOn?'Disable operational alert sound':'Enable operational alert sound'} title={soundOn?'Alert sound on':'Alert sound off — click to enable'} onClick={toggleSound}>
   {soundOn?<Volume2 size={15}/>:<VolumeX size={15}/>}
  </button>
  <button
  type="button"
  className="icon-btn"
  aria-label={`Notifications${unread>0?`, ${unread} unread`:''}`}
  title="Notifications"
  onClick={()=>setOpen(o=>!o)}
>
  <Bell
    size={16}
    className={bellShaking&&unread>0?'notification-bell-shake':''}
  />
  {unread>0?<span className="notif-badge">{unread}</span>:null}
</button>
  {open?<div className="notif-panel">
   <div className="notif-panel-head"><b>Notifications</b><span className="notif-panel-actions">{unread>0?<button type="button" onClick={markAllRead}>Mark all read</button>:null}{items.length?<button type="button" onClick={clearAll}>Clear all</button>:null}</span></div>
   {!isAlertSoundUnlocked()&&soundOn?<div className="notif-sound-hint">Tap the speaker to enable sound alerts.</div>:null}
   {items.length?<div className="notif-list">{items.map(n=>
    <button type="button" key={n.id} className={`notif-item ${n.read_at?'':'unread'}`} onClick={()=>openItem(n)}>
     <span className={`notif-item-dot ${statusTone(n.severity||'info')}`}/>
     <span className="notif-item-main">
      <span className="notif-item-title">{n.title}</span>
      {n.body?<span className="notif-item-body">{n.body}</span>:null}
      <span className="notif-item-time">{timeAgo(n.created_at)}</span>
     </span>
    </button>
   )}</div>:<div className="notif-empty">No notifications yet — deviation alerts appear here automatically.</div>}
  </div>:null}
 </div>;
}