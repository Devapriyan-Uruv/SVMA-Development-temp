import {NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';

/** Three cross-check logs kept as their own independent tables (per
 * explicit instruction, not merged into Sale Order Details/Sales
 * Register): Brokerage (con_no overlaps ops_sales_orders.so_no — a genuine
 * enrichment, since ops_sales_orders has no broker columns), Contract List
 * Pending (a versioned "As On Date" snapshot — only the currently active
 * batch's rows are shown), and Freight Summary (per-invoice freight cost,
 * separate from Sales Register's own invoice amount). */
export async function GET(){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();

 const {data:activeContractBatch}=await db.from('ops_upload_batches').select('id,report_date').eq('report_type','contract_pending').eq('is_active',true).order('report_date',{ascending:false}).limit(1).maybeSingle();
 const [{data:brokerageRaw},{data:contractPendingRaw},{data:freightRaw}]=await Promise.all([
  db.from('ops_brokerage').select('con_no,con_date,broker_name,party_name,con_qty,per_ton,total').order('con_date',{ascending:false}).limit(50),
  activeContractBatch?db.from('ops_contract_pending').select('cont_no,cont_date,product_raw,party_name,con_qty,des_qty,bal_qty').eq('upload_batch_id',(activeContractBatch as any).id).order('cont_no'):Promise.resolve({data:[] as any[]}),
  db.from('ops_freight_summary').select('invoice_no,invoice_date,party_name,vehicle_no,product_raw,invoice_qty,freight_amt_per_ton').order('invoice_date',{ascending:false}).limit(50),
 ]);

 const brokerage=(brokerageRaw||[]).map((r:any)=>({conNo:r.con_no,conDate:r.con_date,brokerName:r.broker_name,partyName:r.party_name,conQty:r.con_qty===null?null:Number(r.con_qty),perTon:r.per_ton===null?null:Number(r.per_ton),total:r.total===null?null:Number(r.total)}));
 const contractPending=(contractPendingRaw||[]).map((r:any)=>({contNo:r.cont_no,contDate:r.cont_date,productRaw:r.product_raw,partyName:r.party_name,conQty:r.con_qty===null?null:Number(r.con_qty),desQty:r.des_qty===null?null:Number(r.des_qty),balQty:r.bal_qty===null?null:Number(r.bal_qty)}));
 const freightSummary=(freightRaw||[]).map((r:any)=>({invoiceNo:r.invoice_no,invoiceDate:r.invoice_date,partyName:r.party_name,vehicleNo:r.vehicle_no,productRaw:r.product_raw,invoiceQty:r.invoice_qty===null?null:Number(r.invoice_qty),freightAmtPerTon:r.freight_amt_per_ton===null?null:Number(r.freight_amt_per_ton)}));

 return NextResponse.json({brokerage, contractPending, freightSummary, contractAsOf:activeContractBatch?(activeContractBatch as any).report_date:null});
}
