'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {SectionIcon} from '@/components/SectionIcon';
import {unlockAlertSound,playAlertSound,vibrateAlert} from '@/lib/alerts';
import {SaveNotice} from '@/components/SaveNotice';

import {useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2, Clock3, Eye, Lock, Sparkles} from 'lucide-react';
import {ProductTabs} from '@/components/ProductPicker';
import {productName} from '@/lib/products';
import {Drawer} from '@/components/Drawer';

type Scope='solvent'|'quality';
type Param={
  id:number;
  source_serial?:string|null;
  source_group?:string|null;
  product_code?:string|null;
  name:string;
  unit?:string|null;
  target_text?:string|null;
  input_type:string;
  frequency:string;
  mandatory?:boolean;
  sample_frequency?:string|null;
  result_latency_minutes?:number|null;
  options?:unknown;
  parameter_sections:{name:string;module:string}|{name:string;module:string}[]|null;
  sort_order?: number | null;
};
type Entry={id:string;parameter_id:number;slot_start:string|null;product_code?:string|null;value_numeric:number|null;value_text:string|null;comments?:string|null;validation_status?:string|null;timeliness_status?:string|null;server_timestamp?:string|null;amended_value_numeric?:number|null;amended_value_text?:string|null;amended_at?:string|null;result_state?:'result'|'na'|null;na_reason?:string|null;na_note?:string|null};
type Session={id:string;scheduled_start:string;scheduled_end:string;operational_date:string;active_products?:string[];shift_master?:{name:string};entry_person_name?:string|null};
type SampleTask={id:string;parameter_id:number;product_code:string;sample_due_at:string;sample_received_at:string|null;result_due_at:string|null;result_submitted_at:string|null;status:string;parameter_master?:{name:string}};
type Props={kind:'hourly'|'inspection'|'boiler'|'quality'|'plant';mode?:'hourly'|'inspection';scope?:Scope;title:string;subtitle?:string};
type HourSlot={start:string;end:string;label:string};

const OFFLINE_QUEUE='svma-offline-entry-queue';
const AMEND_ROLES_SOLVENT=['solvent_head','super_admin','admin'];
const AMEND_ROLES_QUALITY=['quality_head','super_admin','admin'];
const NA_REASONS=['Sample not received','Plant stopped','Material not running','Lab equipment unavailable','Insufficient sample','Test not applicable','Other'];

function sectionOf(p:Param){const r=p.parameter_sections;return Array.isArray(r)?r[0]?.name||'Other':r?.name||'Other'}
function moduleOf(p:Param){const r=p.parameter_sections;return Array.isArray(r)?r[0]?.module:r?.module}
function slugify(s:string){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'section'}
function slots(s:Session){
  const start=new Date(s.scheduled_start);
  // Normally 8 (a standard shift), but an extended shift (see the Extend
  // Shift action, authorised-override only) pushes scheduled_end further
  // out — the grid always covers exactly that span, real hours only, so
  // an extended shift genuinely gets more enterable columns rather than
  // silently stopping at 8.
  const end=new Date(s.scheduled_end),hours=Math.min(24,Math.max(1,Math.round((end.getTime()-start.getTime())/3600000)));
  return Array.from({length:hours},(_,i)=>{
    const a=new Date(start.getTime()+i*3600000),b=new Date(a.getTime()+3600000);
    return {start:a.toISOString(),end:b.toISOString(),label:`${a.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}–${b.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`};
  });
}
// A slot timestamp reaches this function in two different serializations
// that represent the exact same instant: the browser's own
// `Date.toISOString()` (`...T10:30:33.265Z`) when building a key for a cell
// on screen, versus Postgres/PostgREST's own ISO format
// (`...T10:30:33.265+00:00`) once that same value round-trips through
// `/api/entries`. Compared as plain strings those never match, so a
// genuinely-saved entry was never recognised as locked — it silently
// reverted to an empty, still-editable cell. Routing every slot through
// `new Date(...).toISOString()` here normalises both to one canonical
// string before the key is built, so the lookup actually matches.
function entryKey(id:number,slot:string|null,product:string){const norm=slot?new Date(slot).toISOString():'shift';return `${id}|${norm}|${product}`}
function statusClass(v?:string|null){return v==='critical'?'danger':v==='warning'?'warn':v==='normal'?'ok':v==='target_missing'?'neutral':'neutral'}
function targetLabel(p:Param){return String(p.target_text||'').trim()||'TARGET NOT CONFIGURED'}
// once_per_shift/daily/first_shift_only/weekly parameters get their one
// editable cell (see the NO ENTRY lock below) whether or not they're
// mandatory. For Solvent/Boiler, a mandatory one now counts toward the
// progress bar's "expected" total, matching the server-side close-out gate
// in app/api/shift/session/route.ts (scheduleCountFor). Quality keeps the
// old exempt behavior for non-hourly parameters — it has real mandatory
// once_per_shift rows too (product-specific PROCESS LAB REPORT items), and
// tightening its gate was never asked for.
function scheduleCount(p:Param,shiftHours=8){if(p.frequency==='hourly'||p.frequency==='every_two_hours'||p.frequency==='every_4_hours')return shiftHours;return p.mandatory&&moduleOf(p)!=='quality'?1:0}
function dueAtHour(p:Param,hour:number){if(p.frequency==='hourly')return true;if(p.frequency==='every_two_hours'||p.frequency==='every_4_hours')return true;return false}
function queueOffline(payload:unknown){try{const q=JSON.parse(localStorage.getItem(OFFLINE_QUEUE)||'[]');q.push(payload);localStorage.setItem(OFFLINE_QUEUE,JSON.stringify(q))}catch{}}
async function flushOffline(){
  if(typeof window==='undefined'||!navigator.onLine)return 0;
  let q:unknown[]=[];try{q=JSON.parse(localStorage.getItem(OFFLINE_QUEUE)||'[]')}catch{}
  const remaining:unknown[]=[];let synced=0;
  for(const payload of q){try{const r=await fetch('/api/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(r.ok||r.status===409)synced++;else remaining.push(payload)}catch{remaining.push(payload)}}
  localStorage.setItem(OFFLINE_QUEUE,JSON.stringify(remaining));return synced;
}

export function ParameterEntryBoard({kind,mode,scope='solvent',title,subtitle}:Props){
  const actualMode=mode||(kind==='inspection'?'inspection':'hourly');
  const plantWide=scope==='solvent'&&(actualMode==='inspection'||kind==='boiler'||kind==='plant');
  // Super-Admin-only read-only preview of another operator's screen (see
  // app/api/admin/view-as/session/route.ts). Every mutating trigger below
  // gets `||viewAsUserId` added to its existing `disabled` — the same
  // mechanical change repeated, not a new gating system — and canAmend is
  // forced false regardless of the CALLER's own roles, since a Super Admin
  // is always in both amend-role lists and would otherwise see "Request
  // correction" even when previewing an operator who never could.
  const searchParams=useSearchParams();
  const viewAsUserId=searchParams.get('viewAs')||'';
  // An operator can now hold more than one concurrent session (a shift
  // handed to them plus one they started fresh) — the hub page links here
  // with the specific session the operator picked; omitted, GET falls back
  // to its own default (the first/most recent of theirs).
  const shiftSessionId=searchParams.get('shiftSessionId')||'';
  const [viewAsName,setViewAsName]=useState('');
  const [session,setSession]=useState<Session|null>(null);
  const [params,setParams]=useState<Param[]>([]);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [product,setProduct]=useState('');
  const [section,setSection]=useState('');
  const [group,setGroup]=useState('');
  const [hour,setHour]=useState(0);
  const [values,setValues]=useState<Record<string,string>>({});
  const [comments,setComments]=useState<Record<string,string>>({});
  const [naDrafts,setNaDrafts]=useState<Record<string,{reason:string;note:string}>>({});
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState<{title:string;message:string;tone:'success'|'warning'|'error'}|null>(null);
  const [report,setReport]=useState<any>();
  const [aiBusy,setAiBusy]=useState(false);
  const [roles,setRoles]=useState<string[]>([]);
  const [amendEntry,setAmendEntry]=useState<{entry:Entry;param:Param}|null>(null);
  const [sampleTasks,setSampleTasks]=useState<SampleTask[]>([]);
  const [plantPage,setPlantPage]=useState(0);
  const [pendingScrollTo,setPendingScrollTo]=useState('');
  // Plant kind only: once-per-shift-style parameters default to a single
  // editable cell at the shift's start hour (matching the source Excel's
  // own "NO ENTRY" convention for the other 7 hours) — this set tracks
  // which specific non-default hour cells an operator has explicitly
  // unlocked to re-enter, so that provision survives page navigation.
  const [unlockedCells,setUnlockedCells]=useState<Set<string>>(new Set());

  useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(Array.isArray(j?.roles))setRoles(j.roles)}).catch(()=>{})},[]);
  const canAmend=!viewAsUserId&&(scope==='quality'?roles.some(r=>AMEND_ROLES_QUALITY.includes(r)):roles.some(r=>AMEND_ROLES_SOLVENT.includes(r)));

  useEffect(()=>{void(async()=>{
    const sessionUrl=viewAsUserId?`/api/admin/view-as/session?scope=${scope}&userId=${viewAsUserId}`:`/api/shift/session?scope=${scope}${shiftSessionId?`&shiftSessionId=${shiftSessionId}`:''}`;
    const sr=await fetch(sessionUrl,{cache:'no-store'}),sj=await sr.json(),s:Session|null=sj.session||null;
    if(viewAsUserId)setViewAsName(sj.viewAsName||'');
    setSession(s);if(!s)return;
    const products=s.active_products||[];setProduct(plantWide?'PLANT':products[0]||'');
    const hs=slots(s),now=Date.now(),idx=hs.findIndex(x=>now>=new Date(x.start).getTime()&&now<new Date(x.end).getTime());if(idx>=0)setHour(idx);
    const er=await fetch(`/api/entries?shiftSessionId=${s.id}&scope=${scope}`,{cache:'no-store'}),ej=await er.json(),es:Entry[]=ej.entries||[];setEntries(es);
    const v:Record<string,string>={},c:Record<string,string>={};
    es.forEach(e=>{const pc=e.product_code||'PLANT',k=entryKey(e.parameter_id,e.slot_start,pc);v[k]=e.value_numeric!=null?String(e.value_numeric):String(e.value_text??'');c[k]=e.comments||''});setValues(v);setComments(c);
  })().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load shift data'))},[scope,kind,actualMode,plantWide,viewAsUserId,shiftSessionId]);

  useEffect(()=>{if(!session||(!product&&!plantWide))return;void(async()=>{
    const requestKind=scope==='quality'?'quality':kind,qs=new URLSearchParams({kind:requestKind,scope});if(scope==='quality'&&product)qs.set('product',product);
    const pr=await fetch(`/api/parameters?${qs.toString()}`,{cache:'no-store'}),pj=await pr.json();if(!pr.ok)throw new Error(pj.error||'Unable to load parameters');
    let ps:Param[]=pj.parameters||[];
    if(scope==='quality')ps=ps.filter(p=>['hourly','every_two_hours','every_4_hours','once_per_shift','daily','first_shift_only','weekly'].includes(String(p.frequency))); // unified QC sheet: frequency is metadata; every row gets all 8 hours
    if(kind==='boiler')ps=actualMode==='hourly'?ps.filter(p=>['hourly','every_two_hours','every_4_hours'].includes(String(p.frequency))):ps.filter(p=>!['hourly','every_two_hours','every_4_hours','no_entry','display_only'].includes(String(p.frequency)));
    setParams(ps);
    const first=Array.from(new Set(ps.map(sectionOf)))[0]||'';setSection(first);setGroup('');
  })().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load parameters'))},[session?.id,product,scope,kind,actualMode,plantWide]);

  // Skipped entirely in a View-As preview — flushOffline reads AND rewrites
  // this device's own real offline queue (svma-offline-entry-queue), and a
  // Super Admin's preview session has no business touching it at all, not
  // even a no-op rewrite.
  useEffect(()=>{if(viewAsUserId)return;const online=()=>void flushOffline().then(n=>{if(n){setMessage(`${n} offline entries synced.`);setNotice({title:'Readings synced',message:`${n} queued readings are now confirmed in the saved records.`,tone:'success'});window.dispatchEvent(new Event('svma-readings-saved'))}});window.addEventListener('online',online);void flushOffline();return()=>window.removeEventListener('online',online)},[viewAsUserId]);

  // Section U/V/W/X/Y: for the Quality workspace only, load the expected
  // sample-task schedule for this shift and periodically re-run the SLA
  // overdue sweep so Sample/Result Overdue banners and notifications stay
  // current without a background job runner.
  useEffect(()=>{
    if(scope!=='quality'||!session)return;
    let cancelled=false;
    async function reloadTasks(){const r=await fetch(`/api/quality/sample-tasks?shiftSessionId=${session!.id}`,{cache:'no-store'}).catch(()=>null);if(!r||!r.ok||cancelled)return;const j=await r.json();setSampleTasks(j.tasks||[])}
    void reloadTasks();
    const sweep=setInterval(()=>{void fetch('/api/quality/sla-sweep',{cache:'no-store'}).then(()=>reloadTasks()).catch(()=>{})},60000);
    return ()=>{cancelled=true;clearInterval(sweep)};
  },[scope,session?.id]);

  const hs=useMemo(()=>session?slots(session):[],[session]);
  const sections=useMemo(()=>Array.from(new Set(params.map(sectionOf))),[params]);
  
  const sectionRows = useMemo(() => {
  const filtered = params.filter(
    (p) => sectionOf(p) === section
  );

  if (scope !== 'quality') return filtered;

  const groupOrder = new Map<string, number>();

  for (const p of filtered) {
    const group = p.source_group || '';

    if (!groupOrder.has(group)) {
      groupOrder.set(group, groupOrder.size);
    }
  }

  return [...filtered].sort((a, b) => {
    const groupA = a.source_group || '';
    const groupB = b.source_group || '';

    return (
      (groupOrder.get(groupA) ?? 0) -
        (groupOrder.get(groupB) ?? 0) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.id - b.id
    );
  });
}, [params, section, scope]);
  const groups=useMemo(()=>Array.from(new Set(sectionRows.map(p=>p.source_group||'').filter(Boolean))),[sectionRows]);
  const visible=useMemo(()=>scope==='quality'?sectionRows:sectionRows.filter(p=>!group||p.source_group===group),[sectionRows,group,scope]);
  const saved=useMemo(()=>new Map(entries.map(e=>[entryKey(e.parameter_id,e.slot_start,e.product_code||'PLANT'),e])),[entries]);
  useEffect(()=>{if(scope==='quality'){if(group)setGroup('');return}if(group&&!groups.includes(group))setGroup('');if(!groups.length&&group)setGroup('')},[groups,group,scope]);

  // "Plant" kind (Solvent + Boiler unified): every category rendered as its
  // own headed block, not hidden behind a tab. One category = one step —
  // showing several categories together on one screen was reported as hard
  // to work through, so each "page" here is exactly one section, stepped
  // through in the source Excel's own order (Next/Previous section) with a
  // per-section Save. `params` already arrives sorted by
  // parameter_sections.sort_order (the original Excel row numbers), so
  // first-appearance order is correct without any extra sorting here.
  const plantSectionOrder=useMemo(()=>{
    if(kind!=='plant')return [] as {name:string;rows:Param[]}[];
    const order:string[]=[],bySection:Record<string,Param[]>={};
    for(const p of params){const s=sectionOf(p);if(!bySection[s]){bySection[s]=[];order.push(s)}bySection[s].push(p)}
    return order.map(name=>({name,rows:bySection[name]}));
  },[params,kind]);
  const plantPages=useMemo(()=>plantSectionOrder.map(sec=>[sec]),[plantSectionOrder]);
  useEffect(()=>{setPlantPage(0);setUnlockedCells(new Set())},[params.length,kind]);
  useEffect(()=>{if(!pendingScrollTo)return;const id=requestAnimationFrame(()=>{document.getElementById(pendingScrollTo)?.scrollIntoView({behavior:'smooth',block:'start'});setPendingScrollTo('')});return()=>cancelAnimationFrame(id)},[pendingScrollTo,plantPage]);
  function jumpToSection(name:string){
    const idx=plantPages.findIndex(pg=>pg.some(s=>s.name===name));if(idx<0)return;
    const slug=slugify(name);
    if(idx===plantPage){document.getElementById(slug)?.scrollIntoView({behavior:'smooth',block:'start'});return}
    setPlantPage(idx);setPendingScrollTo(slug);
  }

  if(!session)return <div className="card"><div className="section-title">{viewAsUserId?`No active shift for ${viewAsName||'this operator'}`:'No active shift'}</div><div className="sub"><Link className="btn btn-primary" href={scope==='quality'?'/quality-input':'/input'}>Back to entry menu</Link></div></div>;

  const active=session,selected=hs[hour],activeProduct=plantWide?'PLANT':product;
  // Section AM/UI-V4: the Quality hourly grid shows every due parameter's
  // full shift (all 8 hour columns at once, matching the paper lab-report
  // form) rather than one hour at a time, so `currentRows` stays the whole
  // visible set for that case; only the active `hour` column is editable —
  // see QualityGridTable. Solvent's one-hour-at-a-time table is unchanged.
  const qualityGrid=scope==='quality'&&actualMode==='hourly';
  // Solvent+Boiler "plant" kind: an entirely separate, additive flag. It
  // never fires when scope==='quality' (kind is always 'quality' there), so
  // every `qualityGrid||plantGrid` check below is a no-op for Quality —
  // Quality's own behavior/branches are unchanged.
  const plantGrid=kind==='plant';
  const dueRows=plantGrid?params:(actualMode==='hourly'?(qualityGrid?visible:visible.filter(p=>dueAtHour(p,hour))):visible);
  const currentRows=qualityGrid?visible:dueRows;
  const relevantIds=new Set(params.map(p=>p.id));
  const productEntries=entries.filter(e=>(e.product_code||'PLANT')===activeProduct&&relevantIds.has(e.parameter_id));
  // once_per_shift/daily/first_shift_only/weekly parameters are optional
  // in both grids — never counted toward "expected", so this bar can read
  // 100% without them. Only genuinely hourly-cadence parameters count.
  const totalExpected=params.reduce((n,p)=>n+scheduleCount(p,hs.length),0),totalDone=productEntries.length,pct=totalExpected?Math.min(100,Math.round(totalDone/totalExpected*100)):0;
  const naCount=productEntries.filter(e=>e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA').length;
  const exceptionCount=productEntries.filter(e=>['warning','critical'].includes(String(e.validation_status))).length;
  const missingCount=Math.max(0,totalExpected-totalDone);
  const dueTasks=sampleTasks.filter(t=>t.product_code===activeProduct&&!t.sample_received_at);
  const targetGapCount=currentRows.filter(p=>!String(p.target_text||'').trim()).length;

  async function reload(){const r=await fetch(`/api/entries?shiftSessionId=${active.id}&scope=${scope}`,{cache:'no-store'}),j=await r.json();setEntries(j.entries||[])}
  function rowSlot(p:Param){if(qualityGrid||plantGrid)return selected?.start||active.scheduled_start;return actualMode==='inspection'||['once_per_shift','daily','first_shift_only','weekly'].includes(p.frequency)?active.scheduled_start:selected?.start||active.scheduled_start}
  function rowDue(p:Param){if((qualityGrid||plantGrid)&&selected){if(p.result_latency_minutes)return new Date(new Date(selected.start).getTime()+Number(p.result_latency_minutes)*60000).toISOString();return selected.end}if(actualMode==='inspection'||['once_per_shift','daily','first_shift_only','weekly'].includes(p.frequency))return active.scheduled_end;if(scope==='quality'&&p.result_latency_minutes&&selected)return new Date(new Date(selected.start).getTime()+Number(p.result_latency_minutes)*60000).toISOString();return selected?.end||active.scheduled_end}

  async function markSampleReceived(taskId:string){
    try{const r=await fetch('/api/quality/sample-tasks',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({taskId})});if(!r.ok)return;const j=await r.json();setSampleTasks(x=>x.map(t=>t.id===taskId?j.task:t))}catch{}
  }

  async function saveRows(rows:Param[]){
    unlockAlertSound();setSaving(true);setMessage('');
    try{
      let n=0,warnings=0,critical=0,locked=0,queued=0;let saveWarnings:string[]=[];
      for(const p of rows){
        if(scope==='quality'&&!String(p.target_text||'').trim())continue;
        const slotStart=rowSlot(p),slotEnd=actualMode==='inspection'?active.scheduled_end:selected?.end||active.scheduled_end,k=entryKey(p.id,slotStart,activeProduct),value=values[k],na=naDrafts[k];
        if(saved.has(k))continue;
        if(!na?.reason&&(value===undefined||value===''))continue;
        if(na?.reason==='Other'&&!na.note.trim())throw new Error(`${p.name}: add a note for the NA reason Other.`);

        const payload={scope,productCode:activeProduct,shiftSessionId:active.id,parameterId:p.id,slotStart,slotEnd,dueAt:rowDue(p),value:na?.reason?'':value,isNA:!!na?.reason,naReason:na?.reason||null,naNote:na?.note||null,comments:comments[k]||'',clientTimestamp:new Date().toISOString()};
        try{
          const r=await fetch('/api/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),j=await r.json();
          if(r.status===409){locked++;continue} // already locked by a concurrent submit — not an error
          if(!r.ok)throw new Error(j.error);
          n++;if(j.warnings?.length)saveWarnings.push(...j.warnings);
          if(j.validation==='warning')warnings++;if(j.validation==='critical')critical++;
        }
        catch(e){if(!navigator.onLine){queueOffline(payload);queued++;continue}throw e}
      }
      if(!n&&!locked&&!queued){setNotice({title:'Nothing saved',message:'Enter at least one new value before saving.',tone:'warning'});return}
      await reload();
      if(navigator.onLine){const deviations=warnings+critical;let msg=n?`${n} entr${n===1?'y':'ies'} saved. `:'';msg+=deviations?`${deviations} deviation${deviations===1?'':'s'} raised.`:(n?'Validated.':'');if(locked)msg+=` ${locked} row${locked===1?' was':'s were'} already submitted and locked.`;if(queued)msg+=` ${queued} readings are waiting to sync.`;if(saveWarnings.length)msg+=' '+Array.from(new Set(saveWarnings)).join(' ');setMessage(msg.trim());
        // Critical still interrupts with the blocking modal + sound/vibration.
        // Warning-only stays out of the operator's way — no popup, no alert
        // sound — the inline message above and the Deviations/ticket queue
        // (raised server-side regardless of severity) are enough.
        const popupWorthy=critical>0||queued>0||saveWarnings.length>0;
        if(popupWorthy)setNotice({title:critical?'Saved · deviations found':queued||saveWarnings.length?'Saved with items to review':'Readings saved',message:`${msg.trim()} Confirmed at ${new Date().toLocaleTimeString()}.`,tone:'warning'});
        if(critical){playAlertSound('critical');vibrateAlert('critical')}window.dispatchEvent(new Event('svma-readings-saved'));
        void ai(true);
      }else{setMessage('Offline: entries queued and will sync automatically.');setNotice({title:'Waiting to sync',message:`${queued} readings stored on this device. They are not yet confirmed as saved.`,tone:'warning'})}
    }catch(e){const error=e instanceof Error?e.message:'Save failed';setMessage(error);setNotice({title:'Save needs attention',message:error+' Readings already confirmed remain saved. Retry to save the remaining readings.',tone:'error'});await reload().catch(()=>{})}finally{setSaving(false)}
  }

  // Solvent + Boiler "plant" kind only — kept fully separate from saveRows
  // above (Quality's save path is untouched). Every hour cell in the plant
  // grid is directly editable (see PlantGridTable), so unlike saveRows
  // (which only ever looks at the single currently-active hour via
  // rowSlot), this sweeps every parameter × every one of the 8 hour slots
  // for a typed value or NA draft and submits each one found. That is the
  // fix for entries silently never reaching the server: previously, only
  // whichever hour happened to be active at the moment "Save readings" was
  // clicked got submitted — anything typed under a different, now-inactive
  // hour column was invisibly dropped, so no deviation/ticket could ever be
  // raised for it.
  async function savePlantRows(rows:Param[]){
    unlockAlertSound();setSaving(true);setMessage('');
    try{
      let n=0,warnings=0,critical=0,locked=0,queued=0;let saveWarnings:string[]=[];
      // Every hour is independently saveable here (unlike the single
      // "active hour" saveRows saves), so the AI Insight generated after a
      // save must cover whichever hour(s) were actually just written, not
      // just whichever hour happens to be highlighted — otherwise it can
      // silently analyse the wrong hour, or miss a save that spanned more
      // than one.
      let savedSlotStart:string|null=null,savedSlotEnd:string|null=null;
      for(const p of rows){
        for(const slot of hs){
          const k=entryKey(p.id,slot.start,activeProduct),value=values[k],na=naDrafts[k];
          if(saved.has(k))continue;
          if(!na?.reason&&(value===undefined||value===''))continue;
          if(na?.reason==='Other'&&!na.note.trim())throw new Error(`${p.name} (${slot.label}): add a note for the NA reason Other.`);

          const dueAt=p.result_latency_minutes?new Date(new Date(slot.start).getTime()+Number(p.result_latency_minutes)*60000).toISOString():slot.end;
          const payload={scope,productCode:activeProduct,shiftSessionId:active.id,parameterId:p.id,slotStart:slot.start,slotEnd:slot.end,dueAt,value:na?.reason?'':value,isNA:!!na?.reason,naReason:na?.reason||null,naNote:na?.note||null,comments:comments[k]||'',clientTimestamp:new Date().toISOString()};
          try{
            const r=await fetch('/api/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),j=await r.json();
            if(r.status===409){locked++;continue} // already locked by a concurrent submit — not an error
            if(!r.ok)throw new Error(j.error);
            n++;if(j.warnings?.length)saveWarnings.push(...j.warnings);
            if(j.validation==='warning')warnings++;if(j.validation==='critical')critical++;
            if(!savedSlotStart||slot.start<savedSlotStart)savedSlotStart=slot.start;
            if(!savedSlotEnd||slot.end>savedSlotEnd)savedSlotEnd=slot.end;
          }
          catch(e){if(!navigator.onLine){queueOffline(payload);queued++;continue}throw e}
        }
      }
      if(!n&&!locked&&!queued){setNotice({title:'Nothing saved',message:'Enter at least one new value before saving.',tone:'warning'});return}
      await reload();
      if(navigator.onLine){const deviations=warnings+critical;let msg=n?`${n} entr${n===1?'y':'ies'} saved. `:'';msg+=deviations?`${deviations} deviation${deviations===1?'':'s'} raised.`:(n?'Validated.':'');if(locked)msg+=` ${locked} row${locked===1?' was':'s were'} already submitted and locked.`;if(queued)msg+=` ${queued} readings are waiting to sync.`;if(saveWarnings.length)msg+=' '+Array.from(new Set(saveWarnings)).join(' ');setMessage(msg.trim());
        // Critical still interrupts with the blocking modal + sound/vibration.
        // Warning-only stays out of the operator's way — no popup, no alert
        // sound — the inline message above and the Deviations/ticket queue
        // (raised server-side regardless of severity) are enough.
        const popupWorthy=critical>0||queued>0||saveWarnings.length>0;
        if(popupWorthy)setNotice({title:critical?'Saved · deviations found':queued||saveWarnings.length?'Saved with items to review':'Readings saved',message:`${msg.trim()} Confirmed at ${new Date().toLocaleTimeString()}.`,tone:'warning'});
        if(critical){playAlertSound('critical');vibrateAlert('critical')}window.dispatchEvent(new Event('svma-readings-saved'));
        void ai(true,savedSlotStart&&savedSlotEnd?{slotStart:savedSlotStart,slotEnd:savedSlotEnd}:undefined);
      }else{setMessage('Offline: entries queued and will sync automatically.');setNotice({title:'Waiting to sync',message:`${queued} readings stored on this device. They are not yet confirmed as saved.`,tone:'warning'})}
    }catch(e){const error=e instanceof Error?e.message:'Save failed';setMessage(error);setNotice({title:'Save needs attention',message:error+' Readings already confirmed remain saved. Retry to save the remaining readings.',tone:'error'});await reload().catch(()=>{})}finally{setSaving(false)}
  }

  async function ai(silent=false,range?:{slotStart:string;slotEnd:string}){
    // The configured model is a reasoning model that can take up to ~40s to
    // analyse even a modest shift, so this needs its own busy indicator —
    // the button previously gave no feedback while the (frequently timed
    // out) request was in flight.
    setAiBusy(true);
    try{
      const reportType=scope==='quality'?(actualMode==='hourly'?'quality_hourly':'quality_shift'):actualMode==='hourly'?'hourly':'shift_inspection';
      const slotStart=range?range.slotStart:(actualMode==='hourly'?selected?.start:undefined),slotEnd=range?range.slotEnd:(actualMode==='hourly'?selected?.end:undefined);
      const r=await fetch('/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope,productCode:activeProduct==='PLANT'?undefined:activeProduct,shiftSessionId:active.id,reportType,operationalDate:active.operational_date,slotStart,slotEnd})}),j=await r.json();
      if(!r.ok){if(!silent)setMessage(j.error||'AI insight failed');return}setReport(j.report?.report||j.report);
    }finally{setAiBusy(false)}
  }

  return <div className="source-entry-page"><SaveNotice notice={notice} onClose={()=>setNotice(null)}/>
    {viewAsUserId?<div className="notice warn view-as-banner"><Eye size={14}/> Viewing as <b>{viewAsName||'operator'}</b> — read-only preview. Nothing here can be saved. <Link href={scope==='quality'?'/quality-input':'/input'}>Exit preview</Link></div>:null}
    <nav className="operator-navigation" aria-label="Data entry navigation"><Link className="btn btn-outline" href={scope==='quality'?'/quality-input':'/input'}>← Back to entry menu</Link><span>{viewAsUserId?'Read-only preview — no changes can be made here.':'Your shift stays open. Save your entries before leaving.'}</span></nav>
    <section className="source-entry-header">
      <div><span className="eyebrow">{scope==='quality'?'QUALITY • FULL QC SHEET':plantGrid?'SOLVENT & BOILER • PLANT SAFETY CHART':`SOLVENT • ${actualMode==='hourly'?'HOURLY / SCHEDULED ENTRY':'ONE-TIME SHIFT ENTRY'}`}</span><h1>{title}</h1><p>{subtitle}</p>
        {plantGrid?<div className="plant-run-context"><span><b>Shift</b>{active.shift_master?.name||'—'}</span><span><b>Started</b>{new Date(active.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}</span><span><b>Running</b>{(active.active_products||[]).map(productName).join(', ')||'—'}</span><span><b>Entered by</b>{active.entry_person_name||'—'}</span></div>:null}
      </div>
      <div className="source-shift-summary"><b>{active.shift_master?.name||'Shift'}</b><span>{active.operational_date} • Started {new Date(active.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}</span><small>{totalDone}/{totalExpected||0} completed • {pct}%</small><div className="quality-summary-strip"><span><b>{exceptionCount}</b> exceptions</span><span><b>{naCount}</b> NA</span><span><b>{missingCount}</b> missing</span></div></div>
    </section>

    {!plantWide?<section className="source-control-row"><div><b>Running product</b><span>Select only the product currently running.</span></div><ProductTabs products={active.active_products||[]} value={product} onChange={setProduct}/></section>:null}

    {scope==='quality'&&dueTasks.length?<div className="sample-task-strip">{dueTasks.slice(0,8).map(t=>{const overdue=t.status==='sample_overdue';return <span key={t.id} className={`sample-task-chip ${overdue?'overdue':''}`}>{t.parameter_master?.name||'Sample'} • due {new Date(t.sample_due_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}<button type="button" disabled={!!viewAsUserId} onClick={()=>markSampleReceived(t.id)}>Mark received</button></span>})}</div>:null}

    {actualMode==='hourly'?<section className="source-hour-selector"><div className="source-control-label"><b>Select hour</b><span>{(qualityGrid||plantGrid)?'Choose the hour to enter readings.':'Parameters due for the selected interval are shown.'}</span></div><div className="source-hour-buttons">{hs.map((s,i)=>{const count=entries.filter(e=>(e.product_code||'PLANT')===activeProduct&&e.slot_start===s.start&&relevantIds.has(e.parameter_id)).length;return <button key={s.start} className={`${i===hour?'active':''} ${count?'done':''}`} onClick={()=>setHour(i)}><b>{s.label}</b><small>{count?`${count} saved`:i===hour?'Current':'Pending'}</small></button>})}</div></section>:null}

    {sections.length>1&&!plantGrid?<section className="source-category-wrap"><div className="source-control-label"><b>Category</b><span>Order and names are retained from the source sheet.</span></div><div className="source-category-tabs">{sections.map(s=><button key={s} className={section===s?'active':''} onClick={()=>{setSection(s);setGroup('')}}><SectionIcon name={s}/>{s}</button>)}</div></section>:null}

    {scope!=='quality'&&!plantGrid&&groups.length?<section className="source-group-wrap"><div className="source-control-label"><b>Test group</b></div><div className="source-category-tabs compact"><button className={!group?'active':''} onClick={()=>setGroup('')}>All parameters</button>{groups.map(g=><button key={g} className={group===g?'active':''} onClick={()=>setGroup(g)}>{g}</button>)}</div></section>:null}

    {!plantGrid?<section className="source-form-card">
      <header className="source-form-title"><div><span>{qualityGrid?`Approved ${productName(activeProduct)} QC sheet — editing ${selected?.label||'selected hour'}`:actualMode==='hourly'?(selected?.label||'Selected hour'):'Once per shift'}</span><h2>{qualityGrid?'All product groups':(group||section)}</h2></div><div className="source-legend"><span><i className="dot normal"/>Normal</span><span><i className="dot warning"/>Warning</span><span><i className="dot critical"/>Critical</span></div></header>
      {targetGapCount?<div className="notice danger target-gate-notice" style={{margin:'14px 16px 0'}}><b>Target configuration required.</b> {targetGapCount} parameter{targetGapCount===1?'':'s'} in this view {targetGapCount===1?'has':'have'} no approved target. {scope==='quality'?'Add the target before entering those results.':'You can record these readings. They will be marked Target missing, with no pass/fail judgement.'}</div>:null}
      {currentRows.length?(qualityGrid?<QualityGridTable rows={currentRows} session={active} hourSlots={hs} activeHour={hour} product={activeProduct} entries={entries} saved={saved} values={values} setValues={setValues} comments={comments} setComments={setComments} naDrafts={naDrafts} setNaDrafts={setNaDrafts} canAmend={canAmend} onRequestAmend={(entry,param)=>setAmendEntry({entry,param})} onJumpHour={setHour}/>:<SourceTable rows={currentRows} session={active} selected={selected} product={activeProduct} mode={actualMode} saved={saved} values={values} setValues={setValues} comments={comments} setComments={setComments} canAmend={canAmend} onRequestAmend={(entry,param)=>setAmendEntry({entry,param})}/>):<div className="source-empty"><Clock3/><b>No entries due in this interval</b><span>Select another hour or category.</span></div>}
      {message?<div className={`notice ${/fail|error|missing/i.test(message)?'danger':''}`} style={{margin:'14px 16px 0'}}>{message}</div>:null}
      <footer className="source-form-actions"><div><b>{productName(activeProduct)} • {qualityGrid?'Complete QC sheet':(group||section)}</b><span>{actualMode==='hourly'?`Saving hour: ${selected?.label||''}`:'One-time shift entry'}</span></div><div className="action-row"><button className="btn btn-secondary" disabled={aiBusy||!!viewAsUserId} onClick={()=>void ai(false)}>{aiBusy?'Analysing… (up to a minute)':'AI Insight'}</button><button className="btn btn-primary" disabled={saving||!dueRows.length||!!viewAsUserId} onClick={()=>saveRows(dueRows)}>{saving?'Saving…':'Save readings'}</button></div></footer>
    </section>:<PlantEntryPages plantPages={plantPages} plantPage={plantPage} onJumpToSection={jumpToSection} onPrevPage={()=>setPlantPage(p=>Math.max(0,p-1))} onNextPage={()=>setPlantPage(p=>Math.min(plantPages.length-1,p+1))} hourSlots={hs} activeHour={hour} product={activeProduct} entries={entries} saved={saved} values={values} setValues={setValues} comments={comments} setComments={setComments} naDrafts={naDrafts} setNaDrafts={setNaDrafts} unlockedCells={unlockedCells} setUnlockedCells={setUnlockedCells} canAmend={canAmend} onRequestAmend={(entry,param)=>setAmendEntry({entry,param})} message={message} aiBusy={aiBusy} saving={saving} readOnly={!!viewAsUserId} onAI={()=>void ai(false)} onSave={rows=>void savePlantRows(rows)}/>}

    {report?<section className="ai-mini-card" style={{marginTop:14}}><div className="ai-mini-title"><Sparkles size={17}/><b>Immediate AI observation</b></div><ReportView report={report}/></section>:null}

    <AmendDrawer entry={amendEntry} onClose={()=>setAmendEntry(null)} onSaved={()=>{setAmendEntry(null);void reload()}}/>
  </div>;
}

function SourceTable({rows,session,selected,product,mode,saved,values,setValues,comments,setComments,canAmend,onRequestAmend}:{rows:Param[];session:Session;selected?:HourSlot;product:string;mode:'hourly'|'inspection';saved:Map<string,Entry>;values:Record<string,string>;setValues:React.Dispatch<React.SetStateAction<Record<string,string>>>;comments:Record<string,string>;setComments:React.Dispatch<React.SetStateAction<Record<string,string>>>;canAmend:boolean;onRequestAmend:(entry:Entry,param:Param)=>void}){
  return <div className="source-table-scroll"><table className="source-entry-table"><thead><tr><th className="source-col-no">S.NO</th><th>PARAMETERS / UNIT</th><th className="source-col-target">TARGET</th><th className="source-col-actual">ACTUAL</th><th className="source-col-status">STATUS</th><th className="source-col-comments">COMMENTS</th></tr></thead><tbody>{rows.map(p=>{
    const shiftLike=mode==='inspection'||['once_per_shift','daily','first_shift_only','weekly'].includes(p.frequency),slot=shiftLike?session.scheduled_start:selected?.start||session.scheduled_start,k=entryKey(p.id,slot,product),e=saved.get(k);
    const locked=!!e;
    const displayValue=e?(e.amended_value_numeric??e.amended_value_text??e.value_numeric??e.value_text):values[k]||'';
    return <tr key={`${p.id}-${p.frequency}`} className={`source-row ${e?.validation_status||''}`}><td className="source-serial">{p.source_serial||'—'}</td><td><div className="source-param-name">{p.name}</div>{p.unit?<div className="source-param-unit">Unit: {p.unit}</div>:null}{p.sample_frequency?<div className="source-param-frequency">{p.sample_frequency}</div>:null}</td><td><span className={`source-target ${!String(p.target_text||'').trim()?'target-unconfigured':''}`}>{targetLabel(p)}</span></td><td>{locked?<span className="entry-locked-input">{String(displayValue)} {p.unit||''}</span>:<InputControl p={p} value={values[k]||''} onChange={v=>setValues(x=>({...x,[k]:v}))}/>}</td><td>{e?<span className={`pill ${statusClass(e.validation_status)} ${e.validation_status==='target_missing'?'target-missing-pill':''}`}>{(e.validation_status==='target_missing'?'TARGET NOT CONFIGURED':e.validation_status||'saved').toUpperCase()}</span>:!String(p.target_text||'').trim()?<span className="pill target-missing-pill">TARGET REQUIRED</span>:<span className="pill neutral">DUE</span>}
      {e?<div className="source-saved"><CheckCircle2 size={12}/> Submitted {e.server_timestamp?new Date(e.server_timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</div>:null}
      {e?<div className="entry-locked-badge"><Lock size={10}/> Locked</div>:null}
      {e&&e.amended_at?<div className="entry-locked-badge" style={{color:'#a96300',background:'#fff8ec',borderColor:'#f2e6cf'}}>Amended {new Date(e.amended_at).toLocaleDateString()}</div>:null}
      {e&&canAmend?<button type="button" className="entry-amend-link" onClick={()=>onRequestAmend(e,p)}>Request correction</button>:null}
    </td><td>{locked?<span className="entry-locked-input" style={{display:'block'}}>{comments[k]||'—'}</span>:<textarea rows={2} value={comments[k]||''} onChange={z=>setComments(x=>({...x,[k]:z.target.value}))} placeholder="Optional comment"/>}</td></tr>;
  })}</tbody></table></div>;
}

// UI-V4: the Quality hourly entry grid — rows are parameters, columns are
// every hour slot in the shift (5-6AM, 6-7AM, ... exactly like the paper
// PK/COPRA/RB lab-report forms), plus TARGET and a live, client-computed
// MIN/MAX/AVG/COMMENTS rollup at the end of the row. Only the currently
// selected hour column (`activeHour`, driven by the hour-selector strip
// above the table) is ever editable — every other cell is either a locked
// submitted value or an un-editable placeholder — so the save contract
// (one hour's worth of rows per Save click, per Section C/D) is completely
// unchanged; this component only changes what is *visible* at once.
// Keeps the hour being entered in view after the frozen columns (S.NO / group / parameter / target), so only the hour
// columns ever slide left and right. Runs when the active hour changes, and only scrolls if that column is hidden.
function useActiveHourScroll(activeHour:number){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const box=ref.current; if(!box)return;
    const id=requestAnimationFrame(()=>{
      const th=box.querySelector<HTMLElement>('thead th.qg-hour-col.active'); if(!th)return;
      const b=box.getBoundingClientRect();
      let frozenRight=0;
      box.querySelectorAll<HTMLElement>('thead th').forEach(h=>{const cs=getComputedStyle(h);if(cs.position==='sticky'&&cs.left!=='auto')frozenRight=Math.max(frozenRight,h.getBoundingClientRect().right-b.left)});
      const t=th.getBoundingClientRect(), left=t.left-b.left, right=t.right-b.left;
      if(left>=frozenRight&&right<=box.clientWidth)return;
      box.scrollTo({left:Math.max(0,box.scrollLeft+left-frozenRight-8),behavior:'smooth'});
    });
    return()=>cancelAnimationFrame(id);
  },[activeHour]);
  return ref;
}
function QualityGridTable({rows,session,hourSlots,activeHour,product,entries,saved,values,setValues,comments,setComments,naDrafts,setNaDrafts,canAmend,onRequestAmend,onJumpHour}:{rows:Param[];session:Session;hourSlots:HourSlot[];activeHour:number;product:string;entries:Entry[];saved:Map<string,Entry>;values:Record<string,string>;setValues:React.Dispatch<React.SetStateAction<Record<string,string>>>;comments:Record<string,string>;setComments:React.Dispatch<React.SetStateAction<Record<string,string>>>;naDrafts:Record<string,{reason:string;note:string}>;setNaDrafts:React.Dispatch<React.SetStateAction<Record<string,{reason:string;note:string}>>>;canAmend:boolean;onRequestAmend:(entry:Entry,param:Param)=>void;onJumpHour:(i:number)=>void}){
  const [naOpen,setNaOpen]=useState<string>('');
  const scrollRef=useActiveHourScroll(activeHour);
  function beginNA(k:string){setNaDrafts(x=>({...x,[k]:x[k]||{reason:'',note:''}}));setNaOpen(k)}
  function clearNA(k:string){setNaDrafts(x=>{const n={...x};delete n[k];return n});setNaOpen('')}
  return <div className="quality-grid-scroll" ref={scrollRef}><table className="quality-grid-table qg-has-group"><thead><tr>
    <th className="source-col-no">S.NO</th><th className="qg-group-col">PRODUCT / TEST GROUP</th><th className="qg-param-col">PARAMETER / UNIT</th><th className="qg-target-col">TARGET</th><th className="qg-frequency-col">SOURCE FREQUENCY</th>
    {hourSlots.map((s,i)=><th key={s.start} className={`qg-hour-col ${i===activeHour?'active':''}`}>{s.label}</th>)}
    <th className="qg-stat-col">MIN</th><th className="qg-stat-col">MAX</th><th className="qg-stat-col">AVG</th><th className="qg-comments-col">COMMENTS</th>
  </tr></thead><tbody>{rows.map(p=>{
    const shiftEntries=entries.filter(e=>e.parameter_id===p.id&&(e.product_code||'PLANT')===product).sort((a,b)=>(a.slot_start||'').localeCompare(b.slot_start||''));
    const numeric=p.input_type==='number'?shiftEntries.filter(e=>!(e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA')).map(e=>Number(e.amended_value_numeric??e.value_numeric)).filter(n=>Number.isFinite(n)):[];
    const min=numeric.length?Math.min(...numeric):null,max=numeric.length?Math.max(...numeric):null,avg=numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:null;
    const lastComment=[...shiftEntries].reverse().find(e=>e.comments&&e.comments.trim())?.comments||'';
    const worstStatus=shiftEntries.reduce((w,e)=>{const order:Record<string,number>={critical:4,warning:3,target_missing:2,na:1,normal:0};return (order[e.validation_status||'']||0)>(order[w]||0)?(e.validation_status||''):w},'');
    return <tr key={`${p.id}-grid`} className={`source-row ${worstStatus}`}>
      <td className="source-serial source-col-no">{p.source_serial||'—'}</td>
      <td className="qg-group-col"><b>{p.source_group||'—'}</b></td>
      <td className="qg-param-col"><div className="source-param-name">{p.name}</div>{p.unit?<div className="source-param-unit">Unit: {p.unit}</div>:null}</td>
      <td className="qg-target-col"><span className={`source-target ${!String(p.target_text||'').trim()?'target-unconfigured':''}`}>{targetLabel(p)}</span></td>
      <td className="qg-frequency-col"><span className="source-param-frequency">{p.sample_frequency||p.frequency.replaceAll('_',' ')}</span></td>
      {hourSlots.map((s,i)=>{
        const k=entryKey(p.id,s.start,product),e=saved.get(k),na=naDrafts[k];
        if(e){const isNA=e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA';const dv=e.amended_value_numeric??e.amended_value_text??e.value_numeric??e.value_text;return <td key={s.start} className={`qg-cell qg-cell-locked ${statusClass(e.validation_status)}`} title={isNA?(e.na_reason||'NA'):e.validation_status||''}><Lock size={9}/>{isNA?<span className="qg-na-chip">NA • {e.na_reason||'reason recorded'}</span>:String(dv)}</td>}
        if(i===activeHour){const hasTarget=!!String(p.target_text||'').trim();return <td key={s.start} className={`qg-cell qg-cell-active ${hasTarget?'':'qg-target-required'}`}>{!hasTarget?<span className="target-entry-locked"><Lock size={11}/> Target required</span>:na?.reason?<span className="qg-na-chip">NA • {na.reason}</span>:<InputControl p={p} value={values[k]||''} onChange={v=>setValues(x=>({...x,[k]:v}))} compact/>}{hasTarget?<button type="button" className="qg-na-action" onClick={()=>beginNA(k)}>NA</button>:null}{hasTarget&&naOpen===k?<div className="qg-na-popover" onClick={z=>z.stopPropagation()}><b>Mark result as NA</b><select value={na?.reason||''} onChange={z=>setNaDrafts(x=>({...x,[k]:{reason:z.target.value,note:x[k]?.note||''}}))}><option value="">Select reason</option>{NA_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</select>{na?.reason==='Other'?<input value={na.note} onChange={z=>setNaDrafts(x=>({...x,[k]:{reason:x[k]?.reason||'Other',note:z.target.value}}))} placeholder="Required note"/>:null}<div className="qg-na-buttons"><button type="button" onClick={()=>clearNA(k)}>Cancel</button><button type="button" className="primary" disabled={!na?.reason||(na.reason==='Other'&&!na.note.trim())} onClick={()=>setNaOpen('')}>Apply</button></div></div>:null}</td>;}
        return <td key={s.start} className="qg-cell qg-cell-pending" onClick={()=>onJumpHour(i)} title="Click to edit this hour">—</td>;
      })}
      <td className="qg-stat-col">{min!=null?min.toFixed(2).replace(/\.00$/,''):'—'}</td>
      <td className="qg-stat-col">{max!=null?max.toFixed(2).replace(/\.00$/,''):'—'}</td>
      <td className="qg-stat-col">{avg!=null?avg.toFixed(2):'—'}</td>
      <td className="qg-comments-col">{(()=>{const activeK=entryKey(p.id,hourSlots[activeHour]?.start||'',product),activeLocked=saved.has(activeK);if(!activeLocked)return String(p.target_text||'').trim()?<textarea rows={1} value={comments[activeK]||''} onChange={z=>setComments(x=>({...x,[activeK]:z.target.value}))} placeholder="Remark"/>:<span className="qg-comment-readout">Set target first</span>;return <span className="qg-comment-readout">{lastComment||'—'}</span>})()}
        {(()=>{const activeK=entryKey(p.id,hourSlots[activeHour]?.start||'',product),e=saved.get(activeK);if(!e)return null;return <>{e.amended_at?<div className="entry-locked-badge" style={{color:'#a96300',background:'#fff8ec',borderColor:'#f2e6cf',marginTop:4}}>Amended</div>:null}{canAmend?<button type="button" className="entry-amend-link" onClick={()=>onRequestAmend(e,p)}>Request correction</button>:null}</>})()}
      </td>
    </tr>;
  })}</tbody></table></div>;
}

// Solvent + Boiler "plant" kind: a standalone grid, adapted from (but not
// sharing code with) QualityGridTable above, so Quality's component is
// never touched. Two deliberate differences from Quality's grid: a missing
// target never hard-blocks entry (Solvent's existing tolerant behavior —
// every one of the 461 plant-safety-chart parameters already has a target
// configured, but this stays permissive rather than introduce a new gate),
// and the leading group column reads "TEST GROUP" since plant-wide
// safety-chart parameters have no product dimension.
// Every hour column is directly editable here (unlike Quality's grid,
// where only the currently-selected hour column is editable). That
// restriction turned out to silently lose data on the plant sheet: an
// operator filling in values while flipping between hour tabs would have
// only the LAST-active hour's entries actually picked up by Save (see
// savePlantRows), because everything else was rendered as a plain "—"
// placeholder the moment it wasn't the active column — even if a value had
// already been typed there. Enter data in any hour, in any order; Save
// sweeps every parameter × every hour for anything typed or marked NA.
// Once-per-shift-style parameters (frequency !== hourly) default to a
// single editable cell at the shift's start hour (column 0), matching the
// source Excel's own "NO ENTRY" convention for the other 7 hours — filling
// a "fire extinguisher available" check 8 times a shift has no operational
// meaning. Genuinely hourly parameters keep every column editable. Any
// "NO ENTRY" cell can still be unlocked on demand (unlockedCells) if a
// real re-check is needed at a different hour.
function isHourlyFrequency(f:string){return ['hourly','every_two_hours','every_4_hours'].includes(String(f))}
function PlantGridTable({rows,hourSlots,activeHour,product,entries,saved,values,setValues,comments,setComments,naDrafts,setNaDrafts,unlockedCells,setUnlockedCells,canAmend,onRequestAmend}:{rows:Param[];hourSlots:HourSlot[];activeHour:number;product:string;entries:Entry[];saved:Map<string,Entry>;values:Record<string,string>;setValues:React.Dispatch<React.SetStateAction<Record<string,string>>>;comments:Record<string,string>;setComments:React.Dispatch<React.SetStateAction<Record<string,string>>>;naDrafts:Record<string,{reason:string;note:string}>;setNaDrafts:React.Dispatch<React.SetStateAction<Record<string,{reason:string;note:string}>>>;unlockedCells:Set<string>;setUnlockedCells:React.Dispatch<React.SetStateAction<Set<string>>>;canAmend:boolean;onRequestAmend:(entry:Entry,param:Param)=>void}){
  const [naOpen,setNaOpen]=useState<string>('');
  const scrollRef=useActiveHourScroll(activeHour);
  function beginNA(k:string){setNaDrafts(x=>({...x,[k]:x[k]||{reason:'',note:''}}));setNaOpen(k)}
  function clearNA(k:string){setNaDrafts(x=>{const n={...x};delete n[k];return n});setNaOpen('')}
  function unlock(k:string){setUnlockedCells(x=>new Set(x).add(k))}
  return <div className="quality-grid-scroll" ref={scrollRef}><table className="quality-grid-table plant-grid-table"><thead><tr>
    <th className="source-col-no">S.NO</th><th className="qg-param-col">PARAMETER / UNIT</th><th className="qg-target-col">TARGET</th><th className="qg-frequency-col">SOURCE FREQUENCY</th>
    {hourSlots.map((s,i)=><th key={s.start} className={`qg-hour-col ${i===activeHour?'active':''}`}>{s.label}</th>)}
    <th className="qg-stat-col">MIN</th><th className="qg-stat-col">MAX</th><th className="qg-stat-col">AVG</th><th className="qg-comments-col">COMMENTS</th>
  </tr></thead><tbody>{rows.map(p=>{
    const shiftEntries=entries.filter(e=>e.parameter_id===p.id&&(e.product_code||'PLANT')===product).sort((a,b)=>(a.slot_start||'').localeCompare(b.slot_start||''));
    const numeric=p.input_type==='number'?shiftEntries.filter(e=>!(e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA')).map(e=>Number(e.amended_value_numeric??e.value_numeric)).filter(n=>Number.isFinite(n)):[];
    const min=numeric.length?Math.min(...numeric):null,max=numeric.length?Math.max(...numeric):null,avg=numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:null;
    const lastComment=[...shiftEntries].reverse().find(e=>e.comments&&e.comments.trim())?.comments||'';
    const worstStatus=shiftEntries.reduce((w,e)=>{const order:Record<string,number>={critical:4,warning:3,target_missing:2,na:1,normal:0};return (order[e.validation_status||'']||0)>(order[w]||0)?(e.validation_status||''):w},'');
    return <tr key={`${p.id}-grid`} className={`source-row ${worstStatus}`}>
      <td className="source-serial source-col-no">{p.source_serial||'—'}</td>
      <td className="qg-param-col"><div className="source-param-name">{p.name}</div>{p.unit?<div className="source-param-unit">Unit: {p.unit}</div>:null}{p.source_group?<div className="source-param-frequency">{p.source_group}</div>:null}</td>
      <td className="qg-target-col"><span className={`source-target ${!String(p.target_text||'').trim()?'target-unconfigured':''}`}>{targetLabel(p)}</span></td>
      <td className="qg-frequency-col"><span className="source-param-frequency">{p.sample_frequency||p.frequency.replaceAll('_',' ')}</span></td>
      {hourSlots.map((s,i)=>{
        const k=entryKey(p.id,s.start,product),e=saved.get(k),na=naDrafts[k];
        if(e){const isNA=e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA';const dv=e.amended_value_numeric??e.amended_value_text??e.value_numeric??e.value_text;return <td key={s.start} className={`qg-cell qg-cell-locked ${statusClass(e.validation_status)}`} title={isNA?(e.na_reason||'NA'):e.validation_status||''}><Lock size={9}/>{isNA?<span className="qg-na-chip">NA • {e.na_reason||'reason recorded'}</span>:String(dv)}</td>}
        const isDefaultHour=isHourlyFrequency(p.frequency)||i===0;
        if(!isDefaultHour&&!unlockedCells.has(k))return <td key={s.start} className="qg-cell qg-cell-noentry"><span>NO ENTRY</span><button type="button" className="qg-noentry-unlock" onClick={()=>unlock(k)}>Enter anyway</button></td>;
        return <td key={s.start} className={`qg-cell qg-cell-active ${i===activeHour?'qg-cell-current':''}`}>{na?.reason?<span className="qg-na-chip">NA • {na.reason}</span>:<InputControl p={p} value={values[k]||''} onChange={v=>setValues(x=>({...x,[k]:v}))} compact/>}<button type="button" className="qg-na-action" onClick={()=>beginNA(k)}>NA</button>{naOpen===k?<div className="qg-na-popover" onClick={z=>z.stopPropagation()}><b>Mark as NA</b><select value={na?.reason||''} onChange={z=>setNaDrafts(x=>({...x,[k]:{reason:z.target.value,note:x[k]?.note||''}}))}><option value="">Select reason</option>{NA_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</select>{na?.reason==='Other'?<input value={na.note} onChange={z=>setNaDrafts(x=>({...x,[k]:{reason:x[k]?.reason||'Other',note:z.target.value}}))} placeholder="Required note"/>:null}<div className="qg-na-buttons"><button type="button" onClick={()=>clearNA(k)}>Cancel</button><button type="button" className="primary" disabled={!na?.reason||(na.reason==='Other'&&!na.note.trim())} onClick={()=>setNaOpen('')}>Apply</button></div></div>:null}</td>;
      })}
      <td className="qg-stat-col">{min!=null?min.toFixed(2).replace(/\.00$/,''):'—'}</td>
      <td className="qg-stat-col">{max!=null?max.toFixed(2).replace(/\.00$/,''):'—'}</td>
      <td className="qg-stat-col">{avg!=null?avg.toFixed(2):'—'}</td>
      <td className="qg-comments-col">{(()=>{const activeK=entryKey(p.id,hourSlots[activeHour]?.start||'',product),activeLocked=saved.has(activeK);if(!activeLocked)return <textarea rows={1} value={comments[activeK]||''} onChange={z=>setComments(x=>({...x,[activeK]:z.target.value}))} placeholder="Remark"/>;return <span className="qg-comment-readout">{lastComment||'—'}</span>})()}
        {(()=>{const activeK=entryKey(p.id,hourSlots[activeHour]?.start||'',product),e=saved.get(activeK);if(!e)return null;return <>{e.amended_at?<div className="entry-locked-badge" style={{color:'#a96300',background:'#fff8ec',borderColor:'#f2e6cf',marginTop:4}}>Amended</div>:null}{canAmend?<button type="button" className="entry-amend-link" onClick={()=>onRequestAmend(e,p)}>Request correction</button>:null}</>})()}
      </td>
    </tr>;
  })}</tbody></table></div>;
}

// Category "blocks", not tabs: every section renders as its own headed
// block (matching the Excel checklist's own merged section-header rows).
// One section at a time — several categories together on one screen was
// reported as hard to work through — stepped through in the source
// Excel's own order with Next/Previous section, and Save scoped to just
// the current section's parameters. The chip strip at the top still lists
// every category regardless of step, for direct navigation — it is a
// jump-to link, not a filter: nothing is hidden by it.
function PlantEntryPages({plantPages,plantPage,onJumpToSection,onPrevPage,onNextPage,hourSlots,activeHour,product,entries,saved,values,setValues,comments,setComments,naDrafts,setNaDrafts,unlockedCells,setUnlockedCells,canAmend,onRequestAmend,message,aiBusy,saving,readOnly,onAI,onSave}:{plantPages:{name:string;rows:Param[]}[][];plantPage:number;onJumpToSection:(name:string)=>void;onPrevPage:()=>void;onNextPage:()=>void;hourSlots:HourSlot[];activeHour:number;product:string;entries:Entry[];saved:Map<string,Entry>;values:Record<string,string>;setValues:React.Dispatch<React.SetStateAction<Record<string,string>>>;comments:Record<string,string>;setComments:React.Dispatch<React.SetStateAction<Record<string,string>>>;naDrafts:Record<string,{reason:string;note:string}>;setNaDrafts:React.Dispatch<React.SetStateAction<Record<string,{reason:string;note:string}>>>;unlockedCells:Set<string>;setUnlockedCells:React.Dispatch<React.SetStateAction<Set<string>>>;canAmend:boolean;onRequestAmend:(entry:Entry,param:Param)=>void;message:string;aiBusy:boolean;saving:boolean;readOnly?:boolean;onAI:()=>void;onSave:(rows:Param[])=>void}){
  const allSections=plantPages.flat(),currentSections=plantPages[plantPage]||[],pageRows=currentSections.flatMap(s=>s.rows),isLast=plantPage>=plantPages.length-1;
  return <section className="source-form-card plant-entry-card">
    <div className="plant-section-index">{allSections.map(sec => { const onCurrentPage = currentSections.some(s => s.name === sec.name); const enteredCount = sec.rows.filter(p => entries.some(e => e.parameter_id === p.id && (e.product_code || 'PLANT') === product)).length; const totalCount = sec.rows.length; return <a key={sec.name} href={`#${slugify(sec.name)}`} className={onCurrentPage ? 'current-page' : ''} onClick={e => { if (!onCurrentPage) { e.preventDefault(); onJumpToSection(sec.name); } }}><SectionIcon name={sec.name} />{sec.name}<span className="plant-section-count">{enteredCount}/{totalCount}</span></a>; })}</div>
    {plantPages.length>1?<div className="plant-page-nav"><button type="button" className="btn btn-outline" disabled={plantPage===0} onClick={onPrevPage}>← Previous section</button><span>Section {plantPage+1} of {plantPages.length}</span><button type="button" className="btn btn-outline" disabled={isLast} onClick={onNextPage}>Next section →</button></div>:null}
    {currentSections.map(sec=><section key={sec.name} id={slugify(sec.name)} className="plant-section-block">
      <header className="plant-section-heading"><SectionIcon name={sec.name}/><h2>{sec.name}</h2><span>{sec.rows.length} parameter{sec.rows.length===1?'':'s'}</span></header>
      <PlantGridTable rows={sec.rows} hourSlots={hourSlots} activeHour={activeHour} product={product} entries={entries} saved={saved} values={values} setValues={setValues} comments={comments} setComments={setComments} naDrafts={naDrafts} setNaDrafts={setNaDrafts} unlockedCells={unlockedCells} setUnlockedCells={setUnlockedCells} canAmend={canAmend} onRequestAmend={onRequestAmend}/>
    </section>)}
    {message?<div className={`notice ${/fail|error|missing/i.test(message)?'danger':''}`} style={{margin:'14px 16px 0'}}>{message}</div>:null}
    <footer className="source-form-actions"><div><b>{currentSections[0]?.name||'Section'}</b><span>Save applies to this section only.</span></div><div className="action-row"><button className="btn btn-secondary" disabled={aiBusy||readOnly} onClick={onAI}>{aiBusy?'Analysing… (up to a minute)':'AI Insight'}</button><button className="btn btn-primary" disabled={saving||!pageRows.length||readOnly} onClick={()=>onSave(pageRows)}>{saving?'Saving…':'Save section'}</button>{plantPages.length>1&&!isLast?<button type="button" className="btn btn-outline" disabled={saving} onClick={onNextPage}>Next section →</button>:null}</div></footer>
  </section>;
}

function InputControl({p,value,onChange,compact}:{p:Param;value:string;onChange:(v:string)=>void;compact?:boolean}){
  if(p.input_type==='number')return <div className={compact?'source-input-number qg-input-number':'source-input-number'}><input type="number" inputMode="decimal" step="any" value={value} onChange={e=>onChange(e.target.value)} placeholder={compact?'':'Enter value'}/>{p.unit&&!compact?<span>{p.unit}</span>:null}</div>;
  if(p.input_type==='text'||p.input_type==='time')return <input className="source-text-input" type={p.input_type==='time'?'time':'text'} value={value} onChange={e=>onChange(e.target.value)} placeholder={compact?'':'Enter value'}/>;
  let opts:string[]=[];if(Array.isArray(p.options))opts=p.options.map(String);else if(typeof p.options==='string'){try{const parsed=JSON.parse(p.options);if(Array.isArray(parsed))opts=parsed.map(String)}catch{}}
  if(p.input_type==='check'&&!opts.length)opts=['✓','X'];
  if(!opts.length){const t=(p.target_text||'').toUpperCase();if(t.includes('CLOSED'))opts=['CLOSED','OPEN'];else if(t.includes('AVAILABLE')||t.includes('AVAILBLE'))opts=['AVAILABLE','NOT AVAILABLE'];else if(t.includes('HIGH'))opts=['HIGH','MEDIUM','LOW'];else if(t.includes('CLEAN'))opts=['CLEAN','NOT CLEAN'];else if(t.includes('LEAK')||t.includes('LEACK')||t.includes('VAPPOUR NIL'))opts=['NO LEAK','LEAK'];else if(t.includes('NIL'))opts=['NIL','PRESENT'];else if(t.includes('RED')&&t.includes('YELLOW'))opts=['RED & YELLOW','OTHER'];else opts=['NORMAL','ABNORMAL']}
  return <select className="source-select-input" value={value} onChange={e=>onChange(e.target.value)}><option value="">Select</option>{opts.map(o=><option value={o} key={o}>{o}</option>)}</select>;
}

function ReportView({report}:{report:any}){const keys=['whatWentWell','needsAttention','canBeDoneBetter','trendSignals'];return <div className="ai-mini-grid">{keys.map(k=>{const v=report?.[k];if(!Array.isArray(v)||!v.length)return null;return <div key={k}><b>{k.replace(/([A-Z])/g,' $1')}</b><ul>{v.slice(0,3).map((x:any,i:number)=><li key={i}>{String(x)}</li>)}</ul></div>})}</div>}

// Section C: the only route by which a locked reading can change — an
// authorised Solvent Head / Quality Head / Super Admin records a corrected
// value and a mandatory reason; the original captured value is never
// overwritten (see app/api/entries/amend/route.ts and entry_amendments).
function AmendDrawer({entry,onClose,onSaved}:{entry:{entry:Entry;param:Param}|null;onClose:()=>void;onSaved:()=>void}){
  const [correctedValue,setCorrectedValue]=useState('');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{setCorrectedValue('');setReason('');setError('')},[entry?.entry.id]);
  if(!entry)return null;
  const original=entry.entry.value_numeric??entry.entry.value_text;
  async function submit(){
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/entries/amend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entryId:entry!.entry.id,correctedValue,reason})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to record amendment');
      onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Unable to record amendment')}finally{setBusy(false)}
  }
  return <Drawer open={!!entry} onClose={onClose} title="Request correction" subtitle={`${entry.param.name} — the original submitted value is kept permanently; this records a reviewed correction.`}>
    <div className="drawer-form">
      <label className="field"><span>Originally submitted</span><input disabled value={String(original ?? '—')}/></label>
      <label className="field"><span>Corrected value</span><input value={correctedValue} onChange={e=>setCorrectedValue(e.target.value)} placeholder="Enter the corrected value"/></label>
      <label className="field"><span>Reason (required, permanently recorded)</span><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this being corrected?"/></label>
      {error?<div className="notice danger">{error}</div>:null}
      <button type="button" className="btn btn-primary" disabled={busy||!correctedValue||!reason.trim()} onClick={submit}>{busy?'Saving…':'Record correction'}</button>
    </div>
  </Drawer>;
}
