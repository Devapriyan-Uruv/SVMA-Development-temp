import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {healthScore} from '@/lib/metrics';
import {productName} from '@/lib/products';
import {errorMessage,logServerError} from '@/lib/errors';
import {attachHandoffInfo} from '@/lib/shiftHandoff';

function statusSummary(rows:any[]){const normal=rows.filter(x=>x.validation_status==='normal').length,warning=rows.filter(x=>x.validation_status==='warning').length,critical=rows.filter(x=>x.validation_status==='critical').length,unconfigured=rows.filter(x=>x.validation_status==='unconfigured'||x.validation_status==='target_missing').length;return{normal,warning,critical,unconfigured,health:healthScore(normal,warning,critical,unconfigured)}}

// Section AF: Date / Shift / Product / Severity filters. `date` (and
// optional `shiftId`) resolve the actual shift_sessions for that operational
// day — the same field the entry/shift APIs already use, so a night shift
// that crosses midnight is attributed to the correct day here too, unlike
// filtering on a raw entry timestamp range. When no `date` is supplied this
// falls back to "live" mode: whatever shift is currently active. The
// currently-active shift is ALWAYS returned separately as `liveShift` so the
// UI can show "live now" even while a historical date is being viewed.
export async function GET(req:NextRequest){try{
 const az=await moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Solvent management access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const qp=req.nextUrl.searchParams,date=qp.get('date'),shiftId=qp.get('shiftId'),productFilter=qp.get('product'),severityFilter=qp.get('severity'),dateFrom=qp.get('dateFrom'),dateTo=qp.get('dateTo');
 // Two independent ways to look at the past: a single operational day (+
 // optional shift) resolved via shift_sessions — used by the dashboard's
 // own Period filter and correct for a night shift crossing midnight — or a
 // plain server_timestamp range, used by the Analytics trend page to show a
 // longer window across many shifts. They can't both be set meaningfully;
 // `date` takes precedence if a caller somehow sends both.
 const fromTs=dateFrom?`${dateFrom}T00:00:00`:null,toTs=dateTo?`${dateTo}T23:59:59`:null;

 const [{data:liveShiftRaw},{data:viewedSessions,error:vse}]=await Promise.all([
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle(),
  date
   ? (()=>{let q=db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').eq('operational_date',date).order('actual_start',{ascending:false});if(shiftId)q=q.eq('shift_id',shiftId);return q})()
   : Promise.resolve({data:null,error:null}),
 ]);
 const liveShift=liveShiftRaw?await attachHandoffInfo(db,liveShiftRaw):null;
 if(vse)throw vse;

 // "period" = the shift(s) whose data drive the summary cards: the explicit
 // date/shift selection when given, otherwise the single live shift.
 const periodSessions=date?(viewedSessions||[]):(liveShift?[liveShift]:[]);
 const periodSessionIds=new Set(periodSessions.map((s:any)=>s.id));
 // Every currently active/paused session, for the live-shift chip display
 // only — liveShift above (still exactly one) keeps driving the KPI/period
 // math unchanged. See the identical comment in quality/dashboard for why
 // this exists: a second concurrent session (e.g. right after a hand-off,
 // when the sender starts a fresh shift of their own too) was otherwise
 // invisible on the dashboard.
 const {data:allLiveRaw}=await db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').in('status',['active','paused']).order('actual_start',{ascending:false});
 const liveShifts=await Promise.all((allLiveRaw||[]).map((s:any)=>attachHandoffInfo(db,s)));

 const rangeMode=!date&&!!(fromTs||toTs);
 let entryQuery=db.from('parameter_entries').select('id,parameter_id,product_code,shift_session_id,slot_start,value_numeric,value_text,validation_status,timeliness_status,server_timestamp,entered_by,profiles!parameter_entries_entered_by_fkey(full_name,email),parameter_master(name,target_text,unit,frequency,source_serial,source_group,parameter_sections(name,module))').order('server_timestamp',{ascending:false}).limit(2200);
 if(date){
  if(!periodSessionIds.size)entryQuery=entryQuery.eq('shift_session_id','00000000-0000-0000-0000-000000000000'); // no session that day -> no rows
  else entryQuery=entryQuery.in('shift_session_id',Array.from(periodSessionIds));
 }else if(rangeMode){
  if(fromTs)entryQuery=entryQuery.gte('server_timestamp',fromTs);
  if(toTs)entryQuery=entryQuery.lte('server_timestamp',toTs);
 }
 if(productFilter&&productFilter!=='all')entryQuery=entryQuery.eq('product_code',productFilter);
 if(severityFilter&&severityFilter!=='all')entryQuery=entryQuery.eq('validation_status',severityFilter);

 const [{data:entryRows,error},{data:devRows},{data:ticketRows},{data:params}]=await Promise.all([
  entryQuery,
  db.from('deviations').select('id,severity,status,created_at,parameter_id,shift_session_id,parameter_master(name,parameter_sections(module))').order('created_at',{ascending:false}).limit(600),
  db.from('deviation_tickets').select('id,status,deviation_id,created_at,due_at').order('created_at',{ascending:false}).limit(600),
  db.from('parameter_master').select('id,frequency,mandatory,parameter_sections!inner(module)').eq('active',true).eq('mandatory',true).in('parameter_sections.module',['solvent','boiler'])
 ]);
 if(error)throw error;
 const all=(entryRows||[]).filter((e:any)=>['solvent','boiler'].includes(String(e.parameter_master?.parameter_sections?.module)));
 // Live mode (no date filter) still needs `current` narrowed to the single
 // live session, since the unfiltered query above returns recent rows across
 // any session for the metrics/timeline panels.
 const current=(date||rangeMode)?all:(liveShift?.id?all.filter((e:any)=>e.shift_session_id===liveShift.id):[]);
 const devs=(devRows||[]).filter((d:any)=>['solvent','boiler'].includes(String(d.parameter_master?.parameter_sections?.module))&&(!date||periodSessionIds.has(d.shift_session_id)));
 const devIds=new Set(devs.map((d:any)=>d.id));const tickets=(ticketRows||[]).filter((t:any)=>devIds.has(t.deviation_id));
 const products=rangeMode?Array.from(new Set(current.map((e:any)=>String(e.product_code||'')).filter(Boolean))):Array.from(new Set(periodSessions.flatMap((s:any)=>Array.isArray(s.active_products)?s.active_products.map(String):[])));
 // Only genuinely hourly-cadence parameters (hourly/every_two_hours/
 // every_4_hours) count toward "expected" — once_per_shift/daily/
 // first_shift_only/weekly parameters are optional (see the matching fix
 // in app/api/shift/session/route.ts and components/ParameterEntryBoard.tsx
 // scheduleCount()) and were inflating this figure, making coverage read
 // far lower than what was actually outstanding. No per-product multiplier,
 // since these rows are always submitted plant-wide (product_code 'PLANT').
 function scheduleCountFor(freq:string){return freq==='hourly'||freq==='every_two_hours'||freq==='every_4_hours'?8:0}
 const shiftCount=Math.max(1,periodSessions.length),expected=(params||[]).reduce((n:number,p:any)=>n+scheduleCountFor(String(p.frequency)),0)*shiftCount;
 const onTime=current.filter((x:any)=>x.timeliness_status==='on_time').length,submitted=current.length,compliance=expected?Math.min(100,Math.round(submitted/expected*100)):0,onTimePct=submitted?Math.round(onTime/submitted*100):0;
 const production=current.filter((x:any)=>x.parameter_master?.parameter_sections?.module==='solvent'&&x.parameter_master?.frequency==='hourly');
 const safety=current.filter((x:any)=>x.parameter_master?.parameter_sections?.module==='boiler'||x.parameter_master?.frequency!=='hourly');
 const prod=statusSummary(production),safe=statusSummary(safety),overall=statusSummary(current);
 const by=new Map<string,any[]>();current.forEach((e:any)=>{const k=`${e.parameter_id}|${e.product_code||'PLANT'}`,a=by.get(k)||[];a.push(e);by.set(k,a)});
 const metrics=Array.from(by.entries()).map(([key,es])=>{const p=es[0]?.parameter_master||{},nums=es.filter((x:any)=>x.value_numeric!=null).map((x:any)=>Number(x.value_numeric)),st=statusSummary(es),points=es.slice(0,30).reverse().map((x:any)=>({time:x.slot_start||x.server_timestamp,value:x.value_numeric??x.value_text,status:x.validation_status}));return{key,parameterId:es[0]?.parameter_id,productCode:es[0]?.product_code||'PLANT',product:productName(es[0]?.product_code||'PLANT'),name:p.name,target:p.target_text,unit:p.unit,frequency:p.frequency,section:p.parameter_sections?.name,latest:es[0]?.value_numeric??es[0]?.value_text,average:nums.length?nums.reduce((a:number,b:number)=>a+b,0)/nums.length:null,...st,points}}).filter((m:any)=>m.points.length).sort((a:any,b:any)=>b.critical-a.critical||b.warning-a.warning||String(a.section).localeCompare(String(b.section))).slice(0,80);
 const criticalTimeline=current.filter((x:any)=>['critical','warning'].includes(x.validation_status)).slice(0,30).map((x:any)=>({time:x.slot_start||x.server_timestamp,status:x.validation_status,productCode:x.product_code||'PLANT',product:productName(x.product_code||'PLANT'),parameter:x.parameter_master?.name,section:x.parameter_master?.parameter_sections?.name,actual:x.value_numeric??x.value_text,target:x.parameter_master?.target_text,enteredBy:x.profiles?.full_name||x.profiles?.email||null}));
 const productSummary=products.map((pc:string)=>{const r=current.filter((x:any)=>x.product_code===pc),s=statusSummary(r);return{code:pc,name:productName(pc),submitted:r.length,...s}});
 const period=date?{date,shiftLabel:periodSessions.map((s:any)=>s.shift_master?.name).filter(Boolean).join(' + ')||null,sessionCount:periodSessions.length}:{date:null,shiftLabel:liveShift?.shift_master?.name||null,sessionCount:liveShift?1:0};
 // Section: "when did we last actually run this product" is independent of
 // whatever period/product filter is currently applied, so it is computed
 // here across all history rather than scoped to `current`.
 const {data:historySessions}=await db.from('shift_sessions').select('operational_date,active_products,shift_master(name)').eq('scope','solvent').order('operational_date',{ascending:false}).limit(500);
 const lastRun:Record<string,{date:string;shift:string|null}>={};
 for(const s of historySessions||[]){for(const pc of Array.isArray((s as any).active_products)?(s as any).active_products:[]){const code=String(pc);if(!lastRun[code])lastRun[code]={date:(s as any).operational_date,shift:(s as any).shift_master?.name||null}}}
 return NextResponse.json({activeShift:liveShift||null,liveShift:liveShift||null,liveShifts,period,products:productSummary,lastRun,summary:{expected,submitted,completed:submitted,onTime,late:current.filter((x:any)=>x.timeliness_status==='late').length,compliance,onTimePct,...overall,openDeviations:devs.filter((d:any)=>!['resolved','closed'].includes(d.status)).length,openTickets:tickets.filter((t:any)=>!['resolved','closed'].includes(t.status)).length},production:{submitted:production.length,...prod},safety:{submitted:safety.length,...safe},metrics,criticalTimeline});
}catch(e){logServerError('solvent/dashboard',e);return NextResponse.json({error:errorMessage(e,'Dashboard failed')},{status:500})}}
