import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
// Feeds the Management "ERP Daily Control Tower" section (app/ceo/page.tsx)
// from the pre-aggregated ops_daily_control_summary row rather than
// recomputing from raw tables on every dashboard load.
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),date=req.nextUrl.searchParams.get('date');
 let data:any[]|null=null;
 if(date){
  // The requested date may have no upload yet (a weekend, a not-yet-run
  // pipeline) — fall back to the latest summary AT OR BEFORE it rather
  // than showing nothing, same principle as every other "as of" figure
  // on this dashboard. requestedDate/isFallback tell the UI which
  // happened, so "as of {date}" is never silently wrong.
  const exact=await db.from('ops_daily_control_summary').select('*').eq('report_date',date).limit(1);
  if(exact.error)return NextResponse.json({error:'Unable to load the ERP control tower summary.'},{status:500});
  data=exact.data;
  if(!data?.length){
   const fallback=await db.from('ops_daily_control_summary').select('*').lte('report_date',date).order('report_date',{ascending:false}).limit(1);
   if(fallback.error)return NextResponse.json({error:'Unable to load the ERP control tower summary.'},{status:500});
   data=fallback.data;
  }
 } else {
  const latest=await db.from('ops_daily_control_summary').select('*').order('report_date',{ascending:false}).limit(1);
  if(latest.error)return NextResponse.json({error:'Unable to load the ERP control tower summary.'},{status:500});
  data=latest.data;
 }
 const summary=(data||[])[0]||null;
 const {data:products}=summary?.top_variance_products?.length?await db.from('ops_product_master').select('id,display_name').in('id',(summary.top_variance_products as any[]).map(p=>p.productId).filter(Boolean)):{data:[] as any[]};
 const nameById=new Map((products||[]).map((p:any)=>[p.id,p.display_name]));
 const topVariance=(summary?.top_variance_products||[]).map((p:any)=>({productName:nameById.get(p.productId)||p.productId,variance:p.variance}));
 const isFallback=!!(date&&summary&&summary.report_date!==date);
 // Total Sales/Purchase Value for the SAME resolved date the rest of this
 // summary reflects — computed live rather than persisted (a single day's
 // rows), each under 1000 for one day so no pagination is needed here.
 let totalSalesValue=0,totalPurchaseValue=0;
 if(summary?.report_date){
  const [{data:invoices},{data:receipts}]=await Promise.all([
   // amount is the per-LINE figure; total_invoice_amount repeats the same
   // invoice-level total on every line of that invoice, so summing it
   // directly would multiply each invoice by its own line count (same
   // distinction already documented in lib/oneReconciliation/build.ts).
   db.from('ops_sales_invoices').select('amount').eq('invoice_date',summary.report_date),
   db.from('ops_purchase_receipts').select('bill_value').eq('rn_date',summary.report_date),
  ]);
  totalSalesValue=(invoices||[]).reduce((s:number,r:any)=>s+Number(r.amount||0),0);
  totalPurchaseValue=(receipts||[]).reduce((s:number,r:any)=>s+Number(r.bill_value||0),0);
 }
 return NextResponse.json({summary:summary?{...summary,topVariance}:null,requestedDate:date||null,isFallback,totalSalesValue,totalPurchaseValue});
}
