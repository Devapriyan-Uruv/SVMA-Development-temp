import {NextResponse} from 'next/server';
import {moduleAuthorization,IMPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {daysUntil} from '@/lib/trade';

// The numbers this report surfaces are lifted directly from the "CFO
// Instructions" tab of the source Import Master sheet: LC expiry
// watchlist, Buyer's Credit ageing/overdue, customs (BOE) totals,
// documents-incomplete exceptions, and cost-per-ton by commodity.
export async function GET(){
 try{
  const az=await moduleAuthorization('import',IMPORT_VIEW_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import access is required'},{status:az.status});
  const db=supabaseAdmin();
  const {data:entries,error}=await db.from('import_entries').select('*,trade_parties(name),trade_commodities(name,unit)').order('created_at',{ascending:false});
  if(error)throw error;
  const rows=entries||[];
  const open=rows.filter((r:any)=>r.status!=='closed');

  const totals={
   contractValue:rows.reduce((s:number,r:any)=>s+Number(r.contract_value_fcy||0),0),
   advanceValueInr:rows.reduce((s:number,r:any)=>s+Number(r.advance_value_inr||0),0),
   customsOutgoInr:rows.reduce((s:number,r:any)=>s+Number(r.basic_customs_duty_inr||0)+Number(r.sws_other_duty_inr||0)+Number(r.import_igst_inr||0)+Number(r.other_customs_charges_inr||0),0),
   bcOutstandingInr:rows.filter((r:any)=>r.converted_to_bc&&!r.bc_closed).reduce((s:number,r:any)=>s+Number(r.bc_principal_inr||0),0),
   bcInterestAccruedInr:rows.reduce((s:number,r:any)=>s+Number(r.bc_interest_accrued_inr||0),0),
   entriesCount:rows.length,openCount:open.length,
  };

  const lcExpiryWatchlist=open.filter((r:any)=>r.lc_expiry_date&&['contract_received','lc_opened'].includes(r.status)).map((r:any)=>({id:r.id,refCode:r.ref_code,party:r.trade_parties?.name,lcExpiryDate:r.lc_expiry_date,daysLeft:daysUntil(r.lc_expiry_date)})).filter((r:any)=>r.daysLeft!=null&&r.daysLeft<=21).sort((a:any,b:any)=>(a.daysLeft??0)-(b.daysLeft??0));

  const bcAgeing=rows.filter((r:any)=>r.converted_to_bc&&!r.bc_closed&&r.bc_due_date).map((r:any)=>({id:r.id,refCode:r.ref_code,party:r.trade_parties?.name,bcNo:r.bc_no,bcDueDate:r.bc_due_date,principalInr:Number(r.bc_principal_inr||0),daysLeft:daysUntil(r.bc_due_date)})).sort((a:any,b:any)=>(a.daysLeft??0)-(b.daysLeft??0));

  const documentExceptions=open.filter((r:any)=>!r.documents_complete).map((r:any)=>({id:r.id,refCode:r.ref_code,party:r.trade_parties?.name,status:r.status,note:r.exceptions_notes||null}));

  const byCommodity=new Map<string,{commodity:string;qty:number;valueInr:number}>();
  for(const r of rows as any[]){
   const name=r.trade_commodities?.name||'Unspecified';
   const cur=byCommodity.get(name)||{commodity:name,qty:0,valueInr:0};
   cur.qty+=Number(r.invoice_qty||r.contract_qty||0);
   cur.valueInr+=Number(r.settlement_value_inr||r.advance_value_inr||0);
   byCommodity.set(name,cur);
  }

  return NextResponse.json({totals,lcExpiryWatchlist,bcAgeing,documentExceptions,byCommodity:Array.from(byCommodity.values())});
 }catch(e){logServerError('import/reports',e);return NextResponse.json({error:errorMessage(e,'Unable to build import report')},{status:500})}
}
