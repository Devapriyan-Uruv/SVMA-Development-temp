import {NextRequest,NextResponse} from 'next/server';
import {authorization} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {fetchAllRows} from '@/lib/supabase/fetchAll';
import {errorMessage,logServerError} from '@/lib/errors';
import {AI_MARKUP_PCT,GST_PCT,TOKENS_PER_CREDIT,tierLabel,usdInrRate} from '@/lib/aiUsage';

export const runtime='nodejs';

// URUV model credits — Management and Super Admin only. Charge = what the
// model provider billed for the tokens + AI_MARKUP_PCT. The provider's own
// name and the underlying model names are never sent to the browser.
const ALLOWED=['super_admin','management'];
const IST_MS=330*60000;
const istDate=(iso:string)=>new Date(new Date(iso).getTime()+IST_MS).toISOString().slice(0,10);
const todayIst=()=>istDate(new Date().toISOString());
const dayStart=(d:string)=>new Date(`${d}T00:00:00+05:30`).toISOString();
const dayEnd=(d:string)=>new Date(new Date(`${d}T00:00:00+05:30`).getTime()+864e5).toISOString();
const isDate=(s:string|null)=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s);
const r4=(n:number)=>Number(n.toFixed(4));
// billed_inr in the table is the usage value before GST; every figure shown on the dashboard includes GST.
const GST_MUL=1+GST_PCT/100;
const credits=(tokens:number)=>Number((tokens/TOKENS_PER_CREDIT).toFixed(2));

type Row={id:number;created_at:string;feature:string;model:string;user_id:string|null;total_tokens:number;billed_inr:number;usd_inr_rate:number;status:string};
type Agg={requests:number;tokens:number;charge:number};
// Earlier (pre-metering) usage rows are top-up amounts, not individual requests, so they add credits and charge but no request count.
const isEarlier=(r:Row)=>r.model==='earlier-usage';
const add=(m:Map<string,Agg>,k:string,r:Row)=>{const a=m.get(k)||{requests:0,tokens:0,charge:0};if(!isEarlier(r))a.requests++;a.tokens+=r.total_tokens||0;a.charge+=(Number(r.billed_inr)||0)*GST_MUL;m.set(k,a)};
const list=(m:Map<string,Agg>,extra?:(k:string)=>object)=>[...m.entries()].map(([key,a])=>({key,requests:a.requests,credits:credits(a.tokens),charge:r4(a.charge),...(extra?extra(key):{})})).sort((x,y)=>y.charge-x.charge);

export async function GET(req:NextRequest){
  try{
    const az=await authorization(ALLOWED);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'URUV model credits are visible to Management and Super Admin only.'},{status:az.status});
    const sp=req.nextUrl.searchParams,today=todayIst();
    const monthStart=`${today.slice(0,7)}-01`;
    const from=isDate(sp.get('from'))?sp.get('from')!:monthStart,to=isDate(sp.get('to'))?sp.get('to')!:today;
    const db=supabaseAdmin();

    // Statements need up to a year of history, so read one window wide enough for both.
    const yearAgo=istDate(new Date(Date.now()-366*864e5).toISOString());
    const since=from<yearAgo?from:yearAgo;
    const {data:rows,error}=await fetchAllRows<Row>((a,b)=>db.from('ai_usage_log').select('id,created_at,feature,model,user_id,total_tokens,billed_inr,usd_inr_rate,status').gte('created_at',dayStart(since)).order('created_at',{ascending:true}).range(a,b));
    if(error){
      const msg=String((error as any)?.message||'');
      if(/ai_usage_log/.test(msg)&&/(does not exist|schema cache|relation)/i.test(msg))return NextResponse.json({error:'The credits tables are not set up yet. Run sql/064_ai_usage_billing.sql once, then usage will start appearing.',notSetUp:true},{status:200});
      throw error;
    }

    const inRange=rows.filter(r=>{const d=istDate(r.created_at);return d>=from&&d<=to});

    if(sp.get('format')==='csv'){
      const {data:profiles}=await db.from('profiles').select('id,full_name');
      const names=new Map((profiles||[]).map((p:any)=>[String(p.id),String(p.full_name||'')]));
      const esc=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
      const lines=[['Date (IST)','Time (IST)','Feature','URUV model','Credits used','Usage value (INR)',`GST ${GST_PCT}% (INR)`,'Total incl. GST (INR)','Requested by'].map(esc).join(',')];
      for(const r of inRange){const ist=new Date(new Date(r.created_at).getTime()+IST_MS).toISOString();lines.push([ist.slice(0,10),ist.slice(11,19),r.feature,tierLabel(r.model),credits(r.total_tokens),r4(Number(r.billed_inr)),r4(Number(r.billed_inr)*(GST_MUL-1)),r4(Number(r.billed_inr)*GST_MUL),r.user_id?names.get(r.user_id)||'':'System'].map(esc).join(','))}
      return new NextResponse('﻿'+lines.join('\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="URUV_credits_${from}_to_${to}.csv"`}});
    }

    const total:Agg={requests:0,tokens:0,charge:0};let meteredCharge=0;
    const byDay=new Map<string,Agg>(),byFeature=new Map<string,Agg>(),byTier=new Map<string,Agg>(),byUser=new Map<string,Agg>();
    for(const r of inRange){if(!isEarlier(r)){total.requests++;meteredCharge+=(Number(r.billed_inr)||0)*GST_MUL}total.tokens+=r.total_tokens||0;total.charge+=(Number(r.billed_inr)||0)*GST_MUL;add(byDay,istDate(r.created_at),r);add(byFeature,r.feature,r);add(byTier,tierLabel(r.model),r);add(byUser,r.user_id||'system',r)}
    const ids=[...byUser.keys()].filter(k=>k!=='system');
    const {data:profiles}=ids.length?await db.from('profiles').select('id,full_name').in('id',ids):{data:[] as any[]};
    const nameOf=new Map((profiles||[]).map((p:any)=>[String(p.id),String(p.full_name||'')]));

    // Every day in the range, including zero days, so the chart has no holes.
    const daily:{date:string;requests:number;credits:number;charge:number}[]=[];
    for(let t=new Date(`${from}T00:00:00Z`).getTime(),end=new Date(`${to}T00:00:00Z`).getTime();t<=end&&daily.length<400;t+=864e5){const d=new Date(t).toISOString().slice(0,10),a=byDay.get(d);daily.push({date:d,requests:a?.requests||0,credits:credits(a?.tokens||0),charge:r4(a?.charge||0)})}

    const months=new Map<string,Agg>();
    for(const r of rows)add(months,istDate(r.created_at).slice(0,7),r);
    const statements=[...months.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([month,a])=>({month,statementNo:`URUV-${month}`,requests:a.requests,credits:credits(a.tokens),charge:r4(a.charge)}));

    const mtd=months.get(today.slice(0,7)),dayOfMonth=Number(today.slice(8,10)),daysInMonth=new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),0).getDate();
    const mtdCharge=mtd?.charge||0;

    const recent=[...inRange].reverse().slice(0,40).map(r=>({time:new Date(new Date(r.created_at).getTime()+IST_MS).toISOString().slice(0,16).replace('T',' '),feature:r.feature,tier:tierLabel(r.model),credits:credits(r.total_tokens),charge:r4(Number(r.billed_inr)*GST_MUL),user:r.user_id?nameOf.get(r.user_id)||'—':'System'}));

    return NextResponse.json({
      range:{from,to},markupPct:AI_MARKUP_PCT,currency:'INR',gstPct:GST_PCT,usdInrRate:usdInrRate(),creditUnit:`1 credit = ${TOKENS_PER_CREDIT.toLocaleString('en-US')} tokens`,
      totals:{requests:total.requests,credits:credits(total.tokens),charge:r4(total.charge),avgChargePerRequest:total.requests?r4(meteredCharge/total.requests):0},
      month:{label:today.slice(0,7),charge:r4(mtdCharge),credits:credits(mtd?.tokens||0),projectedCharge:r4(dayOfMonth?mtdCharge/dayOfMonth*daysInMonth:0)},
      daily,byFeature:list(byFeature),byTier:list(byTier),byUser:list(byUser,k=>({name:k==='system'?'System / scheduled':nameOf.get(k)||'—'})),statements,recent,
    });
  }catch(e){
    logServerError('ai-credits',e);
    return NextResponse.json({error:errorMessage(e,'Unable to load URUV model credits.')},{status:500});
  }
}
