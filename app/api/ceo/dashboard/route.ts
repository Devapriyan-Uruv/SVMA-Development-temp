
import {authorization,CEO_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {healthScore,safeArray} from '@/lib/metrics';
import {productName} from '@/lib/products';
import {errorMessage,logServerError} from '@/lib/errors';
import {istDateString,istTodayDate} from '@/lib/time';
import {attachHandoffInfo} from '@/lib/shiftHandoff';
import {buildTradeDeterministic,fetchTradeRowsForInsights} from '@/lib/trade';
import {resolveParameterMetadata} from '@/lib/parameterMetadata';

function status(rows:any[]){
 const normal=rows.filter(x=>x.validation_status==='normal').length;
 const warning=rows.filter(x=>x.validation_status==='warning').length;
 const critical=rows.filter(x=>x.validation_status==='critical').length;
 const unconfigured=rows.filter(x=>x.validation_status==='unconfigured'||x.validation_status==='target_missing').length;
 const measured=normal+warning+critical;
 return{normal,warning,critical,unconfigured,health:measured?healthScore(normal,warning,critical,unconfigured):null};
}

function merge(...a:string[][]){
 return Array.from(new Set(a.flat().filter(Boolean))).slice(0,9);
}

// 7-day health trend using operational_date.
// Resolve parameter metadata independently of the master-table FK.
async function dailyTrend(
 db:ReturnType<typeof supabaseAdmin>,
 scope:'solvent'|'quality',
 moduleOk:(m:any)=>boolean,
 fromDate:string,
 toDate:string
){
 const {data:sessions,error:sessionError}=await db
  .from('shift_sessions')
  .select('id,operational_date')
  .eq('scope',scope)
  .gte('operational_date',fromDate)
  .lte('operational_date',toDate);

 if(sessionError)throw sessionError;

 const ids=(sessions||[]).map((s:any)=>s.id);

 if(!ids.length)return new Map<string,ReturnType<typeof status>>();

 const dateMap=new Map((sessions||[]).map((s:any)=>[s.id,s.operational_date]));

 const {data:entries,error}=await db
  .from('parameter_entries')
  .select('shift_session_id,parameter_id,validation_status')
  .in('shift_session_id',ids)
  .limit(6000);

 if(error)throw error;

 const metadata=await resolveParameterMetadata(
  db,
  (entries||[]).map((e:any)=>e.parameter_id)
 );

 const byDate=new Map<string,any[]>();

 for(const e of entries||[]){
  const parameter=metadata.get(Number(e.parameter_id));
  const mod=parameter?.parameter_sections?.module;

  if(!moduleOk(mod))continue;

  const d=dateMap.get(e.shift_session_id);
  if(!d)continue;

  const arr=byDate.get(d)||[];
  arr.push(e);
  byDate.set(d,arr);
 }

 const out=new Map<string,ReturnType<typeof status>>();

 for(const [d,rows] of byDate){
  out.set(d,status(rows));
 }

 return out;
}

// Same date/shift resolution as the Solvent and Quality dashboards.
export async function GET(req:NextRequest){
 try{
  const az=await authorization(CEO_ROLES);

  if(!az.ok){
   return NextResponse.json(
    {error:az.status===401?'Not authenticated':'Management access not assigned'},
    {status:az.status}
   );
  }

  const db=supabaseAdmin();
  const qp=req.nextUrl.searchParams;
  const date=qp.get('date');
  const shiftId=qp.get('shiftId');

  const [
   liveSolvent,
   liveQuality,
   solventSessions,
   qualitySessions
  ]=await Promise.all([
   db.from('shift_sessions')
    .select('*,shift_master(*)')
    .eq('scope','solvent')
    .in('status',['active','paused'])
    .order('actual_start',{ascending:false})
    .limit(1)
    .maybeSingle(),

   db.from('shift_sessions')
    .select('*,shift_master(*)')
    .eq('scope','quality')
    .in('status',['active','paused'])
    .order('actual_start',{ascending:false})
    .limit(1)
    .maybeSingle(),

   date
    ?(()=>{
      let q=db.from('shift_sessions')
       .select('*,shift_master(*)')
       .eq('scope','solvent')
       .eq('operational_date',date)
       .order('actual_start',{ascending:false});

      if(shiftId)q=q.eq('shift_id',shiftId);

      return q;
     })()
    :Promise.resolve({data:null}),

   date
    ?(()=>{
      let q=db.from('shift_sessions')
       .select('*,shift_master(*)')
       .eq('scope','quality')
       .eq('operational_date',date)
       .order('actual_start',{ascending:false});

      if(shiftId)q=q.eq('shift_id',shiftId);

      return q;
     })()
    :Promise.resolve({data:null}),
  ]);

  const solvent=date?(solventSessions.data?.[0]||null):liveSolvent.data;
  const quality=date?(qualitySessions.data?.[0]||null):liveQuality.data;

  const solventIds=date
   ?(solventSessions.data||[]).map((s:any)=>s.id)
   :(solvent?.id?[solvent.id]:[]);

  const qualityIds=date
   ?(qualitySessions.data||[]).map((s:any)=>s.id)
   :(quality?.id?[quality.id]:[]);

  let se:any[]=[];
  let qe:any[]=[];
  let openDev=0;
  let openTickets=0;
  let sr:any=null;
  let qr:any=null;
  let latestTxn:any=null;
  let latestPay:any=null;

  const toStr=istTodayDate();
  const fromStr=istDateString(Date.now()-6*86400000);

  const [
   devCount,
   ticketCount,
   devResolvedCount,
   ticketResolvedCount,
   srep,
   qrep,
   txn,
   pay,
   solventTrendMap,
   qualityTrendMap
  ]=await Promise.all([
   db.from('deviations')
    .select('id',{count:'exact',head:true})
    .eq('status','open'),

   db.from('deviation_tickets')
    .select('id',{count:'exact',head:true})
    .not('status','in','("closed","resolved")'),

   db.from('deviations')
    .select('id',{count:'exact',head:true})
    .eq('status','resolved'),

   db.from('deviation_tickets')
    .select('id',{count:'exact',head:true})
    .in('status',['closed','resolved']),

   db.from('ai_reports')
    .select('*')
    .not('report_type','like','quality_%')
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle(),

   db.from('ai_reports')
    .select('*')
    .like('report_type','quality_%')
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle(),

   db.from('reconciliation_runs')
    .select('summary,reconciliation_date')
    .eq('reconciliation_type','transaction')
    .eq('status','completed')
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle(),

   db.from('reconciliation_runs')
    .select('summary,reconciliation_date')
    .eq('reconciliation_type','vendor_payment')
    .eq('status','completed')
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle(),

   dailyTrend(
    db,
    'solvent',
    (m:any)=>['solvent','boiler'].includes(String(m)),
    fromStr,
    toStr
   ),

   dailyTrend(
    db,
    'quality',
    (m:any)=>String(m)==='quality',
    fromStr,
    toStr
   ),
  ]);

  openDev=devCount.count||0;
  openTickets=ticketCount.count||0;
  sr=srep.data;
  qr=qrep.data;
  latestTxn=txn.data;
  latestPay=pay.data;

  const resolvedDev=devResolvedCount.count||0;
  const resolvedTickets=ticketResolvedCount.count||0;

  const devResolutionPct=(openDev+resolvedDev)
   ?Math.round(resolvedDev/(openDev+resolvedDev)*100)
   :null;

  const ticketResolutionPct=(openTickets+resolvedTickets)
   ?Math.round(resolvedTickets/(openTickets+resolvedTickets)*100)
   :null;

  const trendDaily:{
   date:string;
   solventHealth:number|null;
   qualityHealth:number|null
  }[]=[];

  for(let i=6;i>=0;i--){
   const key=istDateString(Date.now()-i*86400000);

   trendDaily.push({
    date:key,
    solventHealth:solventTrendMap.get(key)?.health??null,
    qualityHealth:qualityTrendMap.get(key)?.health??null
   });
  }

  // Fetch readings without depending on parameter_master FK joins.
  const [solventEntryResult,qualityEntryResult]=await Promise.all([
   solventIds.length
    ?db.from('parameter_entries')
      .select('*')
      .in('shift_session_id',solventIds)
    :Promise.resolve({data:[],error:null}),

   qualityIds.length
    ?db.from('parameter_entries')
      .select('*')
      .in('shift_session_id',qualityIds)
    :Promise.resolve({data:[],error:null}),
  ]);

  if(solventEntryResult.error)throw solventEntryResult.error;
  if(qualityEntryResult.error)throw qualityEntryResult.error;

  se=solventEntryResult.data||[];
  qe=qualityEntryResult.data||[];

  // Resolve active and archived metadata for both sets of readings.
  const allParameterIds=[
   ...se.map((x:any)=>x.parameter_id),
   ...qe.map((x:any)=>x.parameter_id)
  ];

  const metadata=await resolveParameterMetadata(db,allParameterIds);

  for(const x of se){
   x.parameter_master=metadata.get(Number(x.parameter_id))||null;
  }

  for(const x of qe){
   x.parameter_master=metadata.get(Number(x.parameter_id))||null;
  }

  const ss=status(
   se.filter((x:any)=>
    ['solvent','boiler'].includes(
     String(x.parameter_master?.parameter_sections?.module)
    )
   )
  );

  const qs=status(
   qe.filter((x:any)=>
    x.parameter_master?.parameter_sections?.module==='quality'
   )
  );

  const products=['RB','COPRA','PK'].map(pc=>({
   code:pc,
   name:productName(pc),

   solventHealth:status(
    se.filter((x:any)=>
     x.product_code===pc&&
     ['solvent','boiler'].includes(
      String(x.parameter_master?.parameter_sections?.module)
     )
    )
   ).health,

   qualityHealth:status(
    qe.filter((x:any)=>
     x.product_code===pc&&
     x.parameter_master?.parameter_sections?.module==='quality'
    )
   ).health
  }));

  const prod=status(
   se.filter((x:any)=>
    x.parameter_master?.parameter_sections?.module==='solvent'&&
    x.parameter_master?.frequency==='hourly'
   )
  );

  const safe=status(
   se.filter((x:any)=>
    x.parameter_master?.parameter_sections?.module==='boiler'||
    x.parameter_master?.frequency!=='hourly'
   )
  );

  const tx=latestTxn?.summary||{};
  const pay2=latestPay?.summary||{};
  const sR=sr?.report||{};
  const qR=qr?.report||{};

  // Each scope has its own deterministic fallback.
  let sGood=safeArray(sR.whatWentWell);

  if(!sGood.length&&ss.normal){
   sGood=[
    `${ss.normal} Solvent readings are currently within configured target or expected condition.`
   ];
  }

  let qGood=safeArray(qR.whatWentWell);

  if(!qGood.length&&qs.normal){
   qGood=[
    `${qs.normal} Quality results are currently within configured target.`
   ];
  }

  let sAttn=safeArray(sR.needsAttention||sR.attention);
  let qAttn=safeArray(qR.needsAttention||qR.attention);

  if(ss.critical){
   sAttn=[
    ...sAttn,
    `${ss.critical} critical Solvent reading${ss.critical===1?'':'s'} require management attention.`
   ];
  }

  if(qs.critical){
   qAttn=[
    ...qAttn,
    `${qs.critical} critical Quality reading${qs.critical===1?'':'s'} require management attention.`
   ];
  }

  if(openTickets){
   sAttn=[
    ...sAttn,
    `${openTickets} corrective action ticket${openTickets===1?' is':'s are'} open.`
   ];
  }

  // Import/Export — same deterministic facts as Trade Intelligence.
  const {importRows,exportRows}=await fetchTradeRowsForInsights(db);
  const trade=buildTradeDeterministic(importRows,exportRows);

  const tradeGood=trade.whatWentWell.map(w=>w.text);

  const tradeAttn=[
   ...trade.needsAttention,
   ...trade.paymentPending,
   ...trade.shipmentPending
  ].map(f=>`${f.refCode} (${f.party}): ${f.issue}.`);

  // Finance review summary.
  const financeReviewCount=(
   Number(tx.erpMissing||0)+
   Number(tx.tallyMissing||0)+
   Number(tx.needsReview||0)
  );

  const financePaymentsReview=(
   Number(pay2.overpayments||0)+
   Number(pay2.underpayments||0)+
   Number(pay2.sourceMissing||0)+
   Number(pay2.needsReview||0)
  );

  const financeGood=(
   !financeReviewCount&&
   !financePaymentsReview&&
   (latestTxn||latestPay)
  )
   ?['Finance reconciliation has no open review items in the latest run.']
   :[];

  const financeAttn=[
   ...(financeReviewCount
    ?[`${financeReviewCount} Finance transaction${financeReviewCount===1?'':'s'} await ERP/Tally review.`]
    :[]),

   ...(financePaymentsReview
    ?[`${financePaymentsReview} vendor payment${financePaymentsReview===1?'':'s'} need review.`]
    :[]),
  ];

  const good=merge(sGood,qGood,tradeGood,financeGood);
  const attention=merge(sAttn,qAttn,tradeAttn,financeAttn);

  const better=merge(
   safeArray(sR.canBeDoneBetter||sR.recommendedChecks),
   safeArray(qR.canBeDoneBetter||qR.recommendedChecks)
  );

  const trends=merge(
   safeArray(sR.trendSignals),
   safeArray(qR.trendSignals)
  );

  // Attach handoff information to live sessions.
  const [
   liveSolventShaped,
   liveQualityShaped,
   liveSolventAllRaw,
   liveQualityAllRaw
  ]=await Promise.all([
   liveSolvent.data
    ?attachHandoffInfo(db,liveSolvent.data)
    :null,

   liveQuality.data
    ?attachHandoffInfo(db,liveQuality.data)
    :null,

   db.from('shift_sessions')
    .select('*,shift_master(*)')
    .eq('scope','solvent')
    .in('status',['active','paused'])
    .order('actual_start',{ascending:false}),

   db.from('shift_sessions')
    .select('*,shift_master(*)')
    .eq('scope','quality')
    .in('status',['active','paused'])
    .order('actual_start',{ascending:false}),
  ]);

  const [liveSolventShifts,liveQualityShifts]=await Promise.all([
   Promise.all(
    (liveSolventAllRaw.data||[]).map((s:any)=>attachHandoffInfo(db,s))
   ),

   Promise.all(
    (liveQualityAllRaw.data||[]).map((s:any)=>attachHandoffInfo(db,s))
   ),
  ]);

  return NextResponse.json({
   liveSolvent:liveSolventShaped,
   liveQuality:liveQualityShaped,
   liveSolventShifts,
   liveQualityShifts,

   solvent,
   quality,
   ss,
   qs,
   prod,
   safe,
   good,
   attention,
   better,
   trends,
   openDev,
   openTickets,
   resolvedDev,
   resolvedTickets,
   devResolutionPct,
   ticketResolutionPct,
   products,
   trendDaily,

   finance:{
    physicalReview:
     (tx.erpMissing||0)+
     (tx.tallyMissing||0)+
     (tx.needsReview||0),

    paymentsReview:
     (pay2.overpayments||0)+
     (pay2.underpayments||0)+
     (pay2.sourceMissing||0)+
     (pay2.needsReview||0),

    netVariance:
     typeof pay2.netVariance==='number'
      ?pay2.netVariance
      :null,

    latestTxnDate:latestTxn?.reconciliation_date||null,
    latestPayDate:latestPay?.reconciliation_date||null
   },

   period:date
    ?{
      date,
      solventShiftLabel:solvent?.shift_master?.name||null,
      qualityShiftLabel:quality?.shift_master?.name||null,
      solventSessionCount:solventIds.length,
      qualitySessionCount:qualityIds.length
     }
    :{date:null}
  });

 }catch(e){
  logServerError('ceo/dashboard',e);

  return NextResponse.json(
   {error:errorMessage(e,'Management dashboard failed')},
   {status:500}
  );
 }
}
