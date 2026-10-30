import {NextResponse} from 'next/server';
import {moduleAuthorization,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {daysOverdue} from '@/lib/trade';

// Reproduces the source sheet's own "Export Monitoring Summary" tab
// exactly (total contract value, advance received, bill amount, realised
// amount, outstanding, interest, bank charges, IGST refund, overdue
// count) plus an overdue-bill ageing list and the 14-stage status funnel
// from its Status List tab.
export async function GET(){
 try{
  const az=await moduleAuthorization('export',EXPORT_VIEW_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export access is required'},{status:az.status});
  const db=supabaseAdmin();
  const {data:entries,error}=await db.from('export_entries').select('*,trade_parties(name),trade_commodities(name,unit)').order('created_at',{ascending:false});
  if(error)throw error;
  const rows=(entries||[]) as any[];

  const outstanding=(r:any)=>Math.max(0,Number(r.bill_amount_fcy||0)-Number(r.realised_amount_fcy||0));
  const isOverdue=(r:any)=>{const d=daysOverdue(r.due_date);return !!d&&d>0&&outstanding(r)>0};

  const summary={
   totalContractValue:rows.reduce((s,r)=>s+Number(r.contract_value_fcy||0),0),
   totalAdvanceReceived:rows.reduce((s,r)=>s+Number(r.advance_amount_fcy||0),0),
   totalExportBillAmount:rows.reduce((s,r)=>s+Number(r.bill_amount_fcy||0),0),
   totalRealisedAmount:rows.reduce((s,r)=>s+Number(r.realised_amount_fcy||0),0),
   outstandingExportBills:rows.reduce((s,r)=>s+outstanding(r),0),
   totalInterest:rows.reduce((s,r)=>s+Number(r.interest_amount_inr||0),0),
   totalBankCharges:rows.reduce((s,r)=>s+Number(r.bank_charges_inr||0),0),
   totalIgstRefund:rows.reduce((s,r)=>s+Number(r.igst_refund_inr||0),0),
   overdueBillsCount:rows.filter(isOverdue).length,
   entriesCount:rows.length,
  };

  const overdueAgeing=rows.filter(isOverdue).map((r:any)=>({id:r.id,refCode:r.ref_code,party:r.trade_parties?.name,dueDate:r.due_date,daysOverdue:daysOverdue(r.due_date),outstandingFcy:outstanding(r),currency:r.currency,reasonForDelay:r.reason_for_delay||null})).sort((a:any,b:any)=>(b.daysOverdue??0)-(a.daysOverdue??0));

  const statusFunnel=new Map<string,number>();
  for(const r of rows)statusFunnel.set(r.status,(statusFunnel.get(r.status)||0)+1);

  return NextResponse.json({summary,overdueAgeing,statusFunnel:Array.from(statusFunnel.entries()).map(([status,count])=>({status,count}))});
 }catch(e){logServerError('export/reports',e);return NextResponse.json({error:errorMessage(e,'Unable to build export report')},{status:500})}
}
