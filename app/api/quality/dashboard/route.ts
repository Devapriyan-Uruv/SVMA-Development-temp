import {moduleAuthorization,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {healthScore} from '@/lib/metrics';
import {productName} from '@/lib/products';
import {errorMessage,logServerError} from '@/lib/errors';
import {attachHandoffInfo} from '@/lib/shiftHandoff';
function sum(rows:any[]){const normal=rows.filter(x=>x.validation_status==='normal').length,warnings=rows.filter(x=>x.validation_status==='warning').length,critical=rows.filter(x=>x.validation_status==='critical').length,unconfigured=rows.filter(x=>x.validation_status==='unconfigured'||x.validation_status==='target_missing').length,measured=normal+warnings+critical;return{normal,warnings,critical,unconfigured,health:measured?healthScore(normal,warnings,critical,unconfigured):null}}
// Section AF: Date / Shift / Product / Severity filters, same shape and same
// operational_date-based resolution as the Solvent dashboard (see that
// file's header comment for why this is keyed off shift_sessions rather
// than a raw timestamp range).
export async function GET(req:NextRequest){try{
 const az=await moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Quality access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const qp=req.nextUrl.searchParams,date=qp.get('date'),shiftId=qp.get('shiftId'),productFilter=qp.get('product'),severityFilter=qp.get('severity'),dateFrom=qp.get('dateFrom'),dateTo=qp.get('dateTo');
 // Same two historical modes as the Solvent dashboard: a single operational
 // day (+ optional shift), resolved via shift_sessions so a night shift
 // crossing midnight lands on the right day; or a plain server_timestamp
 // range for the Analytics trend page's longer window. Neither given ->
 // live mode: whatever Quality shift is currently active.
 const fromTs=dateFrom?`${dateFrom}T00:00:00`:null,toTs=dateTo?`${dateTo}T23:59:59`:null;
 const rangeMode=!date&&!!(fromTs||toTs);

 const [{data:liveShiftRaw},{data:viewedSessions,error:vse}]=await Promise.all([
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle(),
  date
   ? (()=>{let q=db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').eq('operational_date',date).order('actual_start',{ascending:false});if(shiftId)q=q.eq('shift_id',shiftId);return q})()
   : Promise.resolve({data:null,error:null}),
 ]);
 if(vse)throw vse;
 const liveShift=liveShiftRaw?await attachHandoffInfo(db,liveShiftRaw):null;
 const periodSessions=date?(viewedSessions||[]):(liveShift?[liveShift]:[]);
 const periodSessionIds=new Set(periodSessions.map((s:any)=>s.id));
 // liveShift above is only ever the single most-recently-started session —
 // fine for the KPI/period math below, which has always used exactly one.
 // But when two operators are simultaneously active in this scope (a
 // hand-off followed by the sender starting a fresh shift of their own is
 // exactly how this happens), that logic was silently hiding whichever
 // session wasn't the newest — including one that had just been handed
 // off, entries and all. liveShifts is every currently active/paused
 // session, purely for the dashboard's live-shift chip display.
 const {data:allLiveRaw}=await db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').in('status',['active','paused']).order('actual_start',{ascending:false});
 const liveShifts=await Promise.all((allLiveRaw||[]).map((s:any)=>attachHandoffInfo(db,s)));

 let entryQuery=db.from('parameter_entries').select('id,parameter_id,product_code,shift_session_id,slot_start,value_numeric,value_text,validation_status,timeliness_status,server_timestamp,entered_by,profiles!parameter_entries_entered_by_fkey(full_name,email),parameter_master(name,target_text,unit,frequency,sample_frequency,result_latency_minutes,source_serial,source_group,parameter_sections(name,module))').order('server_timestamp',{ascending:false}).limit(2400);
 if(date){
  if(!periodSessionIds.size)entryQuery=entryQuery.eq('shift_session_id','00000000-0000-0000-0000-000000000000');
  else entryQuery=entryQuery.in('shift_session_id',Array.from(periodSessionIds));
 }else if(rangeMode){
  if(fromTs)entryQuery=entryQuery.gte('server_timestamp',fromTs);
  if(toTs)entryQuery=entryQuery.lte('server_timestamp',toTs);
 }else if(liveShift?.id){
  entryQuery=entryQuery.eq('shift_session_id',liveShift.id);
 }else{
  entryQuery=entryQuery.eq('shift_session_id','00000000-0000-0000-0000-000000000000'); // no live shift -> no rows in default live mode
 }
 if(productFilter&&productFilter!=='all')entryQuery=entryQuery.eq('product_code',productFilter);
 if(severityFilter&&severityFilter!=='all')entryQuery=entryQuery.eq('validation_status',severityFilter);
 const [{data:entries,error},{data:devRows},{data:ticketRows}]=await Promise.all([
  entryQuery,
  db.from('deviations').select('id,severity,status,created_at,shift_session_id,parameter_master(name,source_group,parameter_sections(module))').order('created_at',{ascending:false}).limit(700),
  db.from('deviation_tickets').select('id,status,deviation_id,created_at').order('created_at',{ascending:false}).limit(700),
 ]);if(error)throw error;
 // Sections AB/AC: sample/result SLA compliance, scoped to the same
 // period (live shift, or the explicitly viewed date/shift) as everything
 // else on this dashboard.
 let sampleOverdue=0,resultOverdue=0,samplesExpected=0,samplesReceived=0,resultsExpected=0,resultsOnTime=0;
 if(periodSessionIds.size){
  const {data:tasks}=await db.from('quality_sample_tasks').select('status,sample_received_at,result_submitted_at,result_due_at').in('shift_session_id',Array.from(periodSessionIds));
  samplesExpected=(tasks||[]).length;
  samplesReceived=(tasks||[]).filter((t:any)=>t.sample_received_at).length;
  sampleOverdue=(tasks||[]).filter((t:any)=>t.status==='sample_overdue').length;
  resultOverdue=(tasks||[]).filter((t:any)=>t.status==='result_overdue').length;
  resultsExpected=(tasks||[]).filter((t:any)=>t.sample_received_at).length;
  resultsOnTime=(tasks||[]).filter((t:any)=>t.result_submitted_at&&(!t.result_due_at||new Date(t.result_submitted_at)<=new Date(t.result_due_at))).length;
 }
 const quality=(entries||[]).filter((e:any)=>e.parameter_master?.parameter_sections?.module==='quality'),current=quality;
 const devs=(devRows||[]).filter((d:any)=>d.parameter_master?.parameter_sections?.module==='quality'&&(!date||periodSessionIds.has(d.shift_session_id))),qualityDevIds=new Set(devs.map((d:any)=>d.id)),tickets=(ticketRows||[]).filter((t:any)=>qualityDevIds.has(t.deviation_id));
 const by=new Map<string,any[]>();quality.forEach((e:any)=>{const k=`${e.parameter_id}|${e.product_code||'PLANT'}`,a=by.get(k)||[];a.push(e);by.set(k,a)});
 // Section AM/UI-V4: MIN/MAX/AVG mirrors the paper lab-report form's own
 // trailing rollup columns -- pure arithmetic over this period's readings,
 // computed here rather than stored, so it is always exact and never stale.
 const metrics=Array.from(by.entries()).map(([key,es])=>{const p=es[0]?.parameter_master||{},numeric=es.filter((x:any)=>x.value_numeric!=null).map((x:any)=>Number(x.value_numeric)),st=sum(es),points=es.slice(0,30).reverse().map((x:any)=>({time:x.slot_start||x.server_timestamp,value:x.value_numeric??x.value_text,status:x.validation_status}));return{key,parameterId:es[0]?.parameter_id,productCode:es[0]?.product_code||'',product:productName(es[0]?.product_code||''),name:p.name,target:p.target_text,unit:p.unit,serial:p.source_serial,group:p.source_group,frequency:p.frequency,sampleFrequency:p.sample_frequency,resultLatencyMinutes:p.result_latency_minutes,latest:es[0]?.value_numeric??es[0]?.value_text,average:numeric.length?numeric.reduce((a:number,b:number)=>a+b,0)/numeric.length:null,min:numeric.length?Math.min(...numeric):null,max:numeric.length?Math.max(...numeric):null,total:es.length,...st,normalPct:es.length?Math.round(st.normal/es.length*100):0,points}}).sort((a:any,b:any)=>b.critical-a.critical||b.warnings-a.warnings||String(a.productCode).localeCompare(String(b.productCode))||String(a.group).localeCompare(String(b.group))).slice(0,120);
 const periodProducts=rangeMode?Array.from(new Set(current.map((e:any)=>String(e.product_code||'')).filter(Boolean))):Array.from(new Set(periodSessions.flatMap((s:any)=>Array.isArray(s.active_products)?s.active_products.map(String):[])));
 const products=['RB','COPRA','PK'].map(pc=>{const r=current.filter((x:any)=>x.product_code===pc),s=sum(r);return{code:pc,name:productName(pc),active:periodProducts.includes(pc),submitted:r.length,...s}});
 const criticalTimeline=quality.filter((x:any)=>['critical','warning'].includes(x.validation_status)).slice(0,30).map((x:any)=>({time:x.slot_start||x.server_timestamp,status:x.validation_status,productCode:x.product_code,product:productName(x.product_code),parameter:x.parameter_master?.name,group:x.parameter_master?.source_group,actual:x.value_numeric??x.value_text,target:x.parameter_master?.target_text,enteredBy:x.profiles?.full_name||x.profiles?.email||null}));
 const s=sum(current);
 const period=date?{date,shiftLabel:periodSessions.map((sess:any)=>sess.shift_master?.name).filter(Boolean).join(' + ')||null,sessionCount:periodSessions.length}:{date:null,shiftLabel:liveShift?.shift_master?.name||null,sessionCount:liveShift?1:0};
 // Section: "when did we last actually run this product" is independent of
 // whatever period/product filter is currently applied, so it is computed
 // here across all history rather than scoped to `current`.
 const {data:historySessions}=await db.from('shift_sessions').select('operational_date,active_products,shift_master(name)').eq('scope','quality').order('operational_date',{ascending:false}).limit(500);
 const lastRun:Record<string,{date:string;shift:string|null}>={};
 for(const s of historySessions||[]){for(const pc of Array.isArray((s as any).active_products)?(s as any).active_products:[]){const code=String(pc);if(!lastRun[code])lastRun[code]={date:(s as any).operational_date,shift:(s as any).shift_master?.name||null}}}
 return NextResponse.json({metrics,products,criticalTimeline,period,lastRun,summary:{submitted:current.length,...s,late:current.filter((e:any)=>e.timeliness_status==='late').length,openDeviations:devs.filter((d:any)=>!['resolved','closed'].includes(d.status)).length,openTickets:tickets.filter((t:any)=>!['resolved','closed'].includes(t.status)).length,samplesExpected,samplesReceived,sampleOverdue,resultsExpected,resultsOnTime,resultOverdue},activeShift:liveShift||null,liveShift:liveShift||null,liveShifts});
}catch(e){logServerError('quality/dashboard',e);return NextResponse.json({error:errorMessage(e,'Unable to load Quality analytics')},{status:500})}}
