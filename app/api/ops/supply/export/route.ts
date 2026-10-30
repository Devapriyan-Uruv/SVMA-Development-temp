import {NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import * as XLSX from 'xlsx';
import {errorMessage,logServerError} from '@/lib/errors';
import {fetchAllRows} from '@/lib/supabase/fetchAll';

/** Same 5 datasets as /api/ops/supply/dashboard (Open POs, Gate Activity,
 * Lots, Purchase Summary, Inward Payments), each its own sheet — but
 * un-truncated (the dashboard route caps most queries for on-screen
 * display; this export is meant to be the full current data). Same
 * export shape (XLSX.utils.book_new/aoa_to_sheet/book_append_sheet,
 * Content-Disposition attachment) as app/api/deviations/export/route.ts. */
export async function GET(){
 try{
  const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Operations Intelligence access not assigned'},{status:az.status});
  const db=supabaseAdmin();

  const {data:activeBatch}=await db.from('ops_upload_batches').select('id,report_date').eq('report_type','purchase_order_pending').eq('is_active',true).order('report_date',{ascending:false}).limit(1).maybeSingle();
  const {data:poRowsRaw}=activeBatch?await db.from('ops_purchase_orders').select('po_no,po_date,product_id,product_raw,supplier_name,broker_name,ordered_qty,received_qty,pending_qty,rate').eq('upload_batch_id',(activeBatch as any).id):{data:[] as any[]};
  const productIds=[...new Set((poRowsRaw||[]).map((r:any)=>r.product_id).filter(Boolean))];
  const {data:products}=productIds.length?await db.from('ops_product_master').select('id,display_name').in('id',productIds):{data:[] as any[]};
  const nameById=new Map((products||[]).map((p:any)=>[p.id,p.display_name]));

  // This export is explicitly "un-truncated" (see doc comment above) — a
  // bare select() silently caps at 1000 rows with no error, which
  // ops_gate_movements (1600+) and ops_weighments (1000+) already exceed.
  // Page through every one of these so the export is actually complete
  // (see lib/supabase/fetchAll.ts).
  const [{data:gateInRaw},{data:weighInRaw},{data:lotsRaw},{data:purchaseSummaryRaw},{data:inwardPaymentsRaw}]=await Promise.all([
   fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_gate_movements').select('gate_pass_no,direction,movement_date,party_name,material_raw,vehicle_no,in_time,out_time').order('movement_date',{ascending:false}).range(rangeFrom,rangeTo)),
   fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_weighments').select('gate_pass_no').eq('direction','IN').range(rangeFrom,rangeTo)),
   fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_lots').select('lot_no,status,po_no,supplier_name,product_id,updated_at').order('updated_at',{ascending:false}).range(rangeFrom,rangeTo)),
   fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_purchase_summary').select('reference_no,po_no,inward_date,supplier_name,product_raw,value,gross_amount,payable_amount,paid_amount').order('inward_date',{ascending:false}).range(rangeFrom,rangeTo)),
   fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_inward_payments').select('reference_no,payment_date,supplier_name,bank_name,lot_or_bill_no,amount,total_amount').order('payment_date',{ascending:false}).range(rangeFrom,rangeTo)),
  ]);
  const weighedPasses=new Set((weighInRaw||[]).map((r:any)=>r.gate_pass_no));
  const lotProductIds=[...new Set((lotsRaw||[]).map((r:any)=>r.product_id).filter(Boolean))];
  const {data:lotProducts}=lotProductIds.length?await db.from('ops_product_master').select('id,display_name').in('id',lotProductIds):{data:[] as any[]};
  const lotNameById=new Map((lotProducts||[]).map((p:any)=>[p.id,p.display_name]));

  const wb=XLSX.utils.book_new();

  const poHeaders=['PO No','Order Date','Days','Product','Supplier','Broker','Ordered','Received','Pending'];
  const poOut:any[][]=[poHeaders];
  for(const r of (poRowsRaw||[]) as any[]) poOut.push([r.po_no,r.po_date||'',r.po_date?Math.floor((Date.now()-new Date(r.po_date).getTime())/86400000):'',r.product_id?nameById.get(r.product_id)||r.product_raw:r.product_raw,r.supplier_name||'',r.broker_name||'',Number(r.ordered_qty||0),Number(r.received_qty||0),Number(r.pending_qty||0)]);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(poOut),'Open Purchase Orders');

  const gateHeaders=['Gate Pass','Direction','Date','Party','Material','Vehicle','In Time','Out Time','Weighment'];
  const gateOut:any[][]=[gateHeaders];
  for(const g of (gateInRaw||[]) as any[]) gateOut.push([g.gate_pass_no,g.direction,g.movement_date||'',g.party_name||'',g.material_raw||'',g.vehicle_no||'',g.in_time||'',g.out_time||'',g.direction==='IN'?(weighedPasses.has(g.gate_pass_no)?'Weighed':'Awaiting'):'']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(gateOut),'Gate Activity');

  const lotHeaders=['Lot No','Status','PO No','Supplier','Product','Updated'];
  const lotOut:any[][]=[lotHeaders];
  for(const l of (lotsRaw||[]) as any[]) lotOut.push([l.lot_no,l.status,l.po_no||'',l.supplier_name||'',l.product_id?lotNameById.get(l.product_id)||'':'',l.updated_at?new Date(l.updated_at).toLocaleString('en-IN'):'']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(lotOut),'Lots');

  const psHeaders=['Reference No','PO No','Inward Date','Supplier','Product','Value','Gross Amount','Payable','Paid'];
  const psOut:any[][]=[psHeaders];
  for(const r of (purchaseSummaryRaw||[]) as any[]) psOut.push([r.reference_no,r.po_no||'',r.inward_date||'',r.supplier_name||'',r.product_raw||'',r.value??'',r.gross_amount??'',r.payable_amount??'',r.paid_amount??'']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(psOut),'Purchase Summary');

  const ipHeaders=['Reference No','Payment Date','Supplier','Bank','Lot / Bill No','Amount','Total Amount'];
  const ipOut:any[][]=[ipHeaders];
  for(const r of (inwardPaymentsRaw||[]) as any[]) ipOut.push([r.reference_no,r.payment_date||'',r.supplier_name||'',r.bank_name||'',r.lot_or_bill_no||'',r.amount??'',r.total_amount??'']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(ipOut),'Inward Payments');

  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const name=`SVMA_Supply_Intelligence_${new Date().toISOString().slice(0,10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`}});
 }catch(e){logServerError('ops/supply/export',e);return NextResponse.json({error:errorMessage(e,'Unable to export Supply Intelligence.')},{status:500})}
}
