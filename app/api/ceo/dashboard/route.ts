import {authorization,CEO_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {healthScore,safeArray} from '@/lib/metrics';
import {productName} from '@/lib/products';
import {errorMessage,logServerError} from '@/lib/errors';
import {istDateString,istTodayDate} from '@/lib/time';
import {attachHandoffInfo} from '@/lib/shiftHandoff';
import {buildTradeDeterministic,fetchTradeRowsForInsights} from '@/lib/trade';

function status(rows:any[]){const normal=rows.filter(x=>x.validation_status==='normal').length,warning=rows.filter(x=>x.validation_status==='warning').length,critical=rows.filter(x=>x.validation_status==='critical').length,unconfigured=rows.filter(x=>x.validation_status==='unconfigured'||x.validation_status==='target_missing').length,measured=normal+warning+critical;return{normal,warning,critical,unconfigured,health:measured?healthScore(normal,warning,critical,unconfigured):null}}
function merge(...a:string[][]){return Array.from(new Set(a.flat().filter(Boolean))).slice(0,9)}

// Section: 7-day health trend for the CEO Cockpit graphs. Resolved via
// shift_sessions.operational_date (not raw timestamp) for the same reason
// every other dashboard in this app does — a night shift crossing midnight
// must land on the right calendar day.
async function dailyTrend(db:ReturnType<typeof supabaseAdmin>,scope:'solvent'|'quality',moduleOk:(m:any)=>boolean,fromDate:string,toDate:string){
 const {data:sessions}=await db.from('shift_sessions').select('id,operational_date').eq('scope',scope).gte('operational_date',fromDate).lte('operational_date',toDate);
 const ids=(sessions||[]).map((s:any)=>s.id);
 if(!ids.length)return new Map<string,ReturnType<typeof status>>();
 const dateMap=new Map((sessions||[]).map((s:any)=>[s.id,s.operational_date]));
 const {data:entries}=await db.from('parameter_entries').select('shift_session_id,validation_status,parameter_master(parameter_sections(module))').in('shift_session_id',ids).limit(6000);
 const byDate=new Map<string,any[]>();
 for(const e of entries||[]){
  const mod=(e as any).parameter_master?.parameter_sections?.module;
  if(!moduleOk(mod))continue;
  const d=dateMap.get((e as any).shift_session_id);if(!d)continue;
  const arr=byDate.get(d)||[];arr.push(e);byDate.set(d,arr);
 }
 const out=new Map<string,ReturnType<typeof status>>();
 for(const [d,rows] of byDate)out.set(d,status(rows));
 return out;
}

// Same date/shift resolution as the Solvent and Quality dashboards (see
// app/api/solvent/dashboard/route.ts) — the CEO Cockpit previously always
// showed the single currently-live shift with no way to see a prior day.
export async function GET(req:NextRequest){try{
 const az=await authorization(CEO_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const qp=req.nextUrl.searchParams,date=qp.get('date'),shiftId=qp.get('shiftId');

 const [liveSolvent,liveQuality,solventSessions,qualitySessions]=await Promise.all([
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle(),
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle(),
  date?(()=>{let q=db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').eq('operational_date',date).order('actual_start',{ascending:false});if(shiftId)q=q.eq('shift_id',shiftId);return q})():Promise.resolve({data:null}),
  date?(()=>{let q=db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').eq('operational_date',date).order('actual_start',{ascending:false});if(shiftId)q=q.eq('shift_id',shiftId);return q})():Promise.resolve({data:null}),
 ]);
 const solvent=date?(solventSessions.data?.[0]||null):liveSolvent.data;
 const quality=date?(qualitySessions.data?.[0]||null):liveQuality.data;
 const solventIds=date?(solventSessions.data||[]).map((s:any)=>s.id):(solvent?.id?[solvent.id]:[]);
 const qualityIds=date?(qualitySessions.data||[]).map((s:any)=>s.id):(quality?.id?[quality.id]:[]);

 let se:any[]=[],qe:any[]=[],openDev=0,openTickets=0,sr:any=null,qr:any=null,latestTxn:any=null,latestPay:any=null;
 const toStr=istTodayDate(),fromStr=istDateString(Date.now()-6*86400000);
 const [devCount,ticketCount,devResolvedCount,ticketResolvedCount,srep,qrep,txn,pay,solventTrendMap,qualityTrendMap]=await Promise.all([
  db.from('deviations').select('id',{count:'exact',head:true}).eq('status','open'),
  db.from('deviation_tickets').select('id',{count:'exact',head:true}).not('status','in','("closed","resolved")'),
  db.from('deviations').select('id',{count:'exact',head:true}).eq('status','resolved'),
  db.from('deviation_tickets').select('id',{count:'exact',head:true}).in('status',['closed','resolved']),
  db.from('ai_reports').select('*').not('report_type','like','quality_%').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  db.from('ai_reports').select('*').like('report_type','quality_%').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  db.from('reconciliation_runs').select('summary,reconciliation_date').eq('reconciliation_type','transaction').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  db.from('reconciliation_runs').select('summary,reconciliation_date').eq('reconciliation_type','vendor_payment').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  dailyTrend(db,'solvent',(m:any)=>['solvent','boiler'].includes(String(m)),fromStr,toStr),
  dailyTrend(db,'quality',(m:any)=>String(m)==='quality',fromStr,toStr),
 ]);
 openDev=devCount.count||0;openTickets=ticketCount.count||0;sr=srep.data;qr=qrep.data;latestTxn=txn.data;latestPay=pay.data;
 const resolvedDev=devResolvedCount.count||0,resolvedTickets=ticketResolvedCount.count||0;
 const devResolutionPct=(openDev+resolvedDev)?Math.round(resolvedDev/(openDev+resolvedDev)*100):null;
 const ticketResolutionPct=(openTickets+resolvedTickets)?Math.round(resolvedTickets/(openTickets+resolvedTickets)*100):null;
 const trendDaily:{date:string;solventHealth:number|null;qualityHealth:number|null}[]=[];
 for(let i=6;i>=0;i--){const key=istDateString(Date.now()-i*86400000);trendDaily.push({date:key,solventHealth:solventTrendMap.get(key)?.health??null,qualityHealth:qualityTrendMap.get(key)?.health??null})}
 if(solventIds.length)se=(await db.from('parameter_entries').select('*,parameter_master(name,frequency,parameter_sections(module))').in('shift_session_id',solventIds)).data||[];
 if(qualityIds.length)qe=(await db.from('parameter_entries').select('*,parameter_master(name,source_group,parameter_sections(module))').in('shift_session_id',qualityIds)).data||[];

 const ss=status(se.filter((x:any)=>['solvent','boiler'].includes(String(x.parameter_master?.parameter_sections?.module)))),qs=status(qe.filter((x:any)=>x.parameter_master?.parameter_sections?.module==='quality'));
 const products=['RB','COPRA','PK'].map(pc=>({code:pc,name:productName(pc),solventHealth:status(se.filter((x:any)=>x.product_code===pc&&['solvent','boiler'].includes(String(x.parameter_master?.parameter_sections?.module)))).health,qualityHealth:status(qe.filter((x:any)=>x.product_code===pc&&x.parameter_master?.parameter_sections?.module==='quality')).health}));
 const prod=status(se.filter((x:any)=>x.parameter_master?.parameter_sections?.module==='solvent'&&x.parameter_master?.frequency==='hourly')),safe=status(se.filter((x:any)=>x.parameter_master?.parameter_sections?.module==='boiler'||x.parameter_master?.frequency!=='hourly'));
 const tx=latestTxn?.summary||{},pay2=latestPay?.summary||{};const sR=sr?.report||{},qR=qr?.report||{};
 // Section: each scope's own deterministic fallback used to be gated by
 // `!good.length` on the ALREADY-MERGED array — so the moment Solvent's AI
 // report had anything in it, Quality's fallback silently never ran, even
 // if Quality's own AI report was empty. Every scope now gets its own
 // fallback computed independently, so Quality (and now Import/Export and
 // Finance) can never be crowded out of "what went well" just because
 // Solvent got there first — this is what the Management dashboard was
 // missing everything except Solvent.
 let sGood=safeArray(sR.whatWentWell);if(!sGood.length&&ss.normal)sGood=[`${ss.normal} Solvent readings are currently within configured target or expected condition.`];
 let qGood=safeArray(qR.whatWentWell);if(!qGood.length&&qs.normal)qGood=[`${qs.normal} Quality results are currently within configured target.`];
 let sAttn=safeArray(sR.needsAttention||sR.attention);
 let qAttn=safeArray(qR.needsAttention||qR.attention);
 if(ss.critical)sAttn=[...sAttn,`${ss.critical} critical Solvent reading${ss.critical===1?'':'s'} require management attention.`];
 if(qs.critical)qAttn=[...qAttn,`${qs.critical} critical Quality reading${qs.critical===1?'':'s'} require management attention.`];
 if(openTickets)sAttn=[...sAttn,`${openTickets} corrective action ticket${openTickets===1?' is':'s are'} open.`];

 // Import/Export — the same deterministic facts the Trade Intelligence
 // panel itself shows (lib/trade.ts), never invented here separately.
 const {importRows,exportRows}=await fetchTradeRowsForInsights(db);
 const trade=buildTradeDeterministic(importRows,exportRows);
 const tradeGood=trade.whatWentWell.map(w=>w.text);
 const tradeAttn=[...trade.needsAttention,...trade.paymentPending,...trade.shipmentPending].map(f=>`${f.refCode} (${f.party}): ${f.issue}.`);

 // Finance — the same counts already shown in the FINANCE CONTROL panel
 // below, turned into the same plain-English sentence shape as every
 // other scope here, so Finance stops being represented only as numbers.
 const financeReviewCount=(Number(tx.erpMissing||0)+Number(tx.tallyMissing||0)+Number(tx.needsReview||0));
 const financePaymentsReview=(Number(pay2.overpayments||0)+Number(pay2.underpayments||0)+Number(pay2.sourceMissing||0)+Number(pay2.needsReview||0));
 const financeGood=(!financeReviewCount&&!financePaymentsReview&&(latestTxn||latestPay))?['Finance reconciliation has no open review items in the latest run.']:[];
 const financeAttn=[
  ...(financeReviewCount?[`${financeReviewCount} Finance transaction${financeReviewCount===1?'':'s'} await ERP/Tally review.`]:[]),
  ...(financePaymentsReview?[`${financePaymentsReview} vendor payment${financePaymentsReview===1?'':'s'} need review.`]:[]),
 ];

 const good=merge(sGood,qGood,tradeGood,financeGood);
 const attention=merge(sAttn,qAttn,tradeAttn,financeAttn);
 const better=merge(safeArray(sR.canBeDoneBetter||sR.recommendedChecks),safeArray(qR.canBeDoneBetter||qR.recommendedChecks));
 const trends=merge(safeArray(sR.trendSignals),safeArray(qR.trendSignals));

 // liveSolvent/liveQuality above (single, most-recently-started) still
 // drive `solvent`/`quality` and every KPI below exactly as before.
 // liveSolventShifts/liveQualityShifts are every currently active/paused
 // session per scope, purely for the dashboard's live-shift chips — see
 // the identical comment in the Solvent/Quality dashboards for why a
 // single "most recent" session was hiding concurrent ones.
 const [liveSolventShaped,liveQualityShaped,liveSolventAllRaw,liveQualityAllRaw]=await Promise.all([
  liveSolvent.data?attachHandoffInfo(db,liveSolvent.data):null,
  liveQuality.data?attachHandoffInfo(db,liveQuality.data):null,
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','solvent').in('status',['active','paused']).order('actual_start',{ascending:false}),
  db.from('shift_sessions').select('*,shift_master(*)').eq('scope','quality').in('status',['active','paused']).order('actual_start',{ascending:false}),
 ]);
 const [liveSolventShifts,liveQualityShifts]=await Promise.all([
  Promise.all((liveSolventAllRaw.data||[]).map((s:any)=>attachHandoffInfo(db,s))),
  Promise.all((liveQualityAllRaw.data||[]).map((s:any)=>attachHandoffInfo(db,s))),
 ]);
 return NextResponse.json({
  liveSolvent:liveSolventShaped,liveQuality:liveQualityShaped,liveSolventShifts,liveQualityShifts,
  solvent,quality,ss,qs,prod,safe,good,attention,better,trends,openDev,openTickets,
  resolvedDev,resolvedTickets,devResolutionPct,ticketResolutionPct,products,trendDaily,
  finance:{physicalReview:(tx.erpMissing||0)+(tx.tallyMissing||0)+(tx.needsReview||0),paymentsReview:(pay2.overpayments||0)+(pay2.underpayments||0)+(pay2.sourceMissing||0)+(pay2.needsReview||0),netVariance:typeof pay2.netVariance==='number'?pay2.netVariance:null,latestTxnDate:latestTxn?.reconciliation_date||null,latestPayDate:latestPay?.reconciliation_date||null},
  period:date?{date,solventShiftLabel:solvent?.shift_master?.name||null,qualityShiftLabel:quality?.shift_master?.name||null,solventSessionCount:solventIds.length,qualitySessionCount:qualityIds.length}:{date:null},
 });
}catch(e){logServerError('ceo/dashboard',e);return NextResponse.json({error:errorMessage(e,'Management dashboard failed')},{status:500})}}
