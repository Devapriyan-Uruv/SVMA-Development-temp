import {NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {fetchAllRows} from '@/lib/supabase/fetchAll';

function daysSince(dateStr:string|null){ if(!dateStr)return null; return Math.floor((Date.now()-new Date(dateStr).getTime())/86400000); }

/** Supply Intelligence: open PO pending (the latest active
 * purchase_order_pending snapshot — NOT mixed with purchase_details' own
 * append-only history, which would double-count POs across many days),
 * recent gate activity with whether each inward pass has a matching
 * weighment yet (Gate In and Time Office In share the same gate_pass_no —
 * confirmed against real files), and the lot lifecycle board. No staleness
 * threshold is invented here (e.g. "stuck after 24h") — real days-since
 * figures are surfaced and the UI lets the user judge, since no such
 * threshold was ever confirmed with the business. */
export async function GET(){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();

 const {data:activeBatch}=await db.from('ops_upload_batches').select('id,report_date').eq('report_type','purchase_order_pending').eq('is_active',true).order('report_date',{ascending:false}).limit(1).maybeSingle();
 const {data:poRowsRaw}=activeBatch?await db.from('ops_purchase_orders').select('po_no,po_date,product_id,product_raw,supplier_name,broker_name,ordered_qty,received_qty,pending_qty,rate').eq('upload_batch_id',(activeBatch as any).id):{data:[] as any[]};
 const productIds=[...new Set((poRowsRaw||[]).map((r:any)=>r.product_id).filter(Boolean))];
 const {data:products}=productIds.length?await db.from('ops_product_master').select('id,display_name').in('id',productIds):{data:[] as any[]};
 const nameById=new Map((products||[]).map((p:any)=>[p.id,p.display_name]));
 const openPos=(poRowsRaw||[]).map((r:any)=>({poNo:r.po_no,poDate:r.po_date,productName:r.product_id?nameById.get(r.product_id)||r.product_raw:r.product_raw,supplierName:r.supplier_name,brokerName:r.broker_name,orderedQty:Number(r.ordered_qty||0),receivedQty:Number(r.received_qty||0),pendingQty:Number(r.pending_qty||0),rate:r.rate===null?null:Number(r.rate),daysSinceOrder:daysSince(r.po_date)})).sort((a:any,b:any)=>b.pendingQty-a.pendingQty);

 // ops_weighments (direction=IN) has already passed 1000 rows — a bare
 // select() would silently drop the rest with no ordering to say which,
 // which was flagging recently-weighed gate passes as "Awaiting" (see
 // lib/supabase/fetchAll.ts). Paged, so every weighment is actually seen.
 const [{data:gateInRaw},{data:weighInRaw,error:weighErr},{data:lotsRaw}]=await Promise.all([
  db.from('ops_gate_movements').select('gate_pass_no,direction,movement_date,party_name,material_raw,vehicle_no,in_time,out_time').order('movement_date',{ascending:false}).limit(60),
  fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_weighments').select('gate_pass_no').eq('direction','IN').range(rangeFrom,rangeTo)),
  db.from('ops_lots').select('lot_no,status,po_no,supplier_name,product_id,updated_at').order('updated_at',{ascending:false}).limit(60),
 ]);
 if(weighErr)return NextResponse.json({error:'Unable to load weighment data.'},{status:500});
 const weighedPasses=new Set((weighInRaw||[]).map((r:any)=>r.gate_pass_no));
 const gateActivity=(gateInRaw||[]).map((r:any)=>({gatePassNo:r.gate_pass_no,direction:r.direction,movementDate:r.movement_date,partyName:r.party_name,materialRaw:r.material_raw,vehicleNo:r.vehicle_no,inTime:r.in_time,outTime:r.out_time,hasWeighment:r.direction==='IN'?weighedPasses.has(r.gate_pass_no):null}));

 const lotProductIds=[...new Set((lotsRaw||[]).map((r:any)=>r.product_id).filter(Boolean))];
 const {data:lotProducts}=lotProductIds.length?await db.from('ops_product_master').select('id,display_name').in('id',lotProductIds):{data:[] as any[]};
 const lotNameById=new Map((lotProducts||[]).map((p:any)=>[p.id,p.display_name]));
 const lots=(lotsRaw||[]).map((r:any)=>({lotNo:r.lot_no,status:r.status,poNo:r.po_no,supplierName:r.supplier_name,productName:r.product_id?lotNameById.get(r.product_id)||null:null,updatedAt:r.updated_at}));

 const vehiclesAwaitingWeighment=gateActivity.filter(g=>g.direction==='IN'&&g.hasWeighment===false).length;
 const lotsInProgress=lots.filter(l=>l.status!=='COMPLETED').length;

 // Purchase Summary / Inward Payment: independent cross-check logs (own
 // tables, deliberately not merged with Purchase Order Pending/Purchase
 // Register LotWise above — see sql/056's header comment) — most recent
 // rows only, no reconciliation implied.
 const [{data:purchaseSummaryRaw},{data:inwardPaymentsRaw}]=await Promise.all([
  db.from('ops_purchase_summary').select('reference_no,po_no,inward_date,supplier_name,product_raw,value,gross_amount,payable_amount,paid_amount').order('inward_date',{ascending:false}).limit(50),
  db.from('ops_inward_payments').select('reference_no,payment_date,supplier_name,bank_name,lot_or_bill_no,amount,total_amount').order('payment_date',{ascending:false}).limit(50),
 ]);
 const purchaseSummary=(purchaseSummaryRaw||[]).map((r:any)=>({referenceNo:r.reference_no,poNo:r.po_no,inwardDate:r.inward_date,supplierName:r.supplier_name,productRaw:r.product_raw,value:r.value===null?null:Number(r.value),grossAmount:r.gross_amount===null?null:Number(r.gross_amount),payableAmount:r.payable_amount===null?null:Number(r.payable_amount),paidAmount:r.paid_amount===null?null:Number(r.paid_amount)}));
 const inwardPayments=(inwardPaymentsRaw||[]).map((r:any)=>({referenceNo:r.reference_no,paymentDate:r.payment_date,supplierName:r.supplier_name,bankName:r.bank_name,lotOrBillNo:r.lot_or_bill_no,amount:r.amount===null?null:Number(r.amount),totalAmount:r.total_amount===null?null:Number(r.total_amount)}));

 return NextResponse.json({
  openPos, gateActivity, lots, purchaseSummary, inwardPayments,
  kpis:{openPoCount:openPos.length,totalPendingQty:openPos.reduce((s,r)=>s+r.pendingQty,0),vehiclesAwaitingWeighment,lotsInProgress},
  asOf:activeBatch?(activeBatch as any).report_date:null,
 });
}
