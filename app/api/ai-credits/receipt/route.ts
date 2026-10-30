import {NextRequest,NextResponse} from 'next/server';
import {authorization} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {fetchAllRows} from '@/lib/supabase/fetchAll';
import {errorMessage,logServerError} from '@/lib/errors';
import {TOKENS_PER_CREDIT} from '@/lib/aiUsage';
import {buildUsageReceipt,type ReceiptLine} from '@/lib/usageReceipt';

export const runtime='nodejs';

// Downloadable usage receipt (PDF) in the name of AIX3 — Management and Super
// Admin only. No invoice number: it is a receipt for the usage in the period,
// with GST added to the usage value.
const IST_MS=330*60000;
const istDate=(iso:string)=>new Date(new Date(iso).getTime()+IST_MS).toISOString().slice(0,10);
const dayStart=(d:string)=>new Date(`${d}T00:00:00+05:30`).toISOString();
const dayEnd=(d:string)=>new Date(new Date(`${d}T00:00:00+05:30`).getTime()+864e5).toISOString();
const isDate=(s:string|null)=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s);

function periodLabel(from:string,to:string){
  const [y,m]=from.split('-').map(Number),last=new Date(y,m,0).getDate();
  if(from.slice(0,7)===to.slice(0,7)&&from.endsWith('-01')&&Number(to.slice(8))===last)return new Date(y,m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  return '';
}

export async function GET(req:NextRequest){
  try{
    const az=await authorization(['super_admin','management']);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Receipts are available to Management and Super Admin only.'},{status:az.status});
    const sp=req.nextUrl.searchParams,from=sp.get('from'),to=sp.get('to');
    if(!isDate(from)||!isDate(to)||from!>to!)return NextResponse.json({error:'Choose a valid From and To date.'},{status:400});
    const db=supabaseAdmin();
    const {data:rows,error}=await fetchAllRows<{created_at:string;feature:string;model:string;total_tokens:number;billed_inr:number}>((a,b)=>db.from('ai_usage_log').select('created_at,feature,model,total_tokens,billed_inr').gte('created_at',dayStart(from!)).lt('created_at',dayEnd(to!)).order('created_at',{ascending:true}).range(a,b));
    if(error)throw error;
    if(!rows.length)return NextResponse.json({error:'No usage recorded in this period, so there is nothing to put on a receipt.'},{status:404});

    const by=new Map<string,{tokens:number;requests:number;amount:number}>();
    for(const r of rows){const a=by.get(r.feature)||{tokens:0,requests:0,amount:0};a.tokens+=r.total_tokens||0;if(r.model!=='earlier-usage')a.requests++;a.amount+=Number(r.billed_inr)||0;by.set(r.feature,a)}
    const lines:ReceiptLine[]=[...by.entries()].sort((x,y)=>y[1].amount-x[1].amount).map(([description,a])=>({description,credits:a.tokens/TOKENS_PER_CREDIT,requests:a.requests,amount:a.amount}));
    const generatedOn=istDate(new Date().toISOString());
    const pdf=await buildUsageReceipt({periodLabel:periodLabel(from!,to!),from:from!,to:to!,lines,generatedOn});
    return new NextResponse(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="AIX3_usage_receipt_${from}_to_${to}.pdf"`,'Cache-Control':'no-store'}});
  }catch(e){
    logServerError('ai-credits/receipt',e);
    return NextResponse.json({error:errorMessage(e,'Unable to create the receipt.')},{status:500});
  }
}
