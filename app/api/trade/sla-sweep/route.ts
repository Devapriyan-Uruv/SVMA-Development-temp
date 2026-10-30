import {NextResponse} from 'next/server';
import {anyModuleAuthorization,IMPORT_VIEW_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';
import {daysUntil,daysOverdue} from '@/lib/trade';

// Notification housekeeping for the trade desk — LC expiry, Buyer's Credit
// due/overdue, shipment-window slippage and export realisation overdue.
// No background job runner in this deployment (same note as
// app/api/quality/sla-sweep/route.ts), so this is polled lightly by the
// Import/Export workspaces on load. Every insert is idempotent via
// notifications.dedupe_key, so a repeated sweep never double-sends.
// Recipients are scoped per the explicit brief: each module's own
// operator/manager get their own module's issues; CEO/Management/Super
// Admin get everything, on both sides, always.
export async function GET(){
 try{
  const az=await anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_VIEW_ROLES},{module:'export',fallbackRoles:EXPORT_VIEW_ROLES}]);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export access is required'},{status:az.status});
  const db=supabaseAdmin();

  const [{data:importRows,error:ie},{data:exportRows,error:ee}]=await Promise.all([
   db.from('import_entries').select('id,ref_code,status,converted_to_bc,bc_closed,bc_due_date,lc_expiry_date,documents_complete').neq('status','closed'),
   db.from('export_entries').select('id,ref_code,status,bill_amount_fcy,realised_amount_fcy,due_date,latest_shipment_date').neq('status','closed'),
  ]);
  if(ie)throw ie;if(ee)throw ee;

  let sent=0;
  for(const r of (importRows||[]) as any[]){
   if(r.converted_to_bc&&!r.bc_closed&&r.bc_due_date){
    const d=daysUntil(r.bc_due_date);
    if(d!=null&&d<=7)sent+=await notify(db,'import',r.id,d<0?'critical':'warning',`${d<0?'BUYER\'S CREDIT OVERDUE':'BUYER\'S CREDIT DUE SOON'} • ${r.ref_code}`,d<0?`Buyer's Credit is overdue by ${-d} day${-d===1?'':'s'}.`:`Buyer's Credit is due in ${d} day${d===1?'':'s'}.`,`bc:${r.id}`);
   }
   if(r.lc_expiry_date&&['contract_received','lc_opened'].includes(r.status)){
    const d=daysUntil(r.lc_expiry_date);
    if(d!=null&&d<=14)sent+=await notify(db,'import',r.id,d<0?'critical':'warning',`${d<0?'LC EXPIRED':'LC EXPIRING SOON'} • ${r.ref_code}`,d<0?`LC expired ${-d} day${-d===1?'':'s'} ago and goods are not yet shipped.`:`LC expires in ${d} day${d===1?'':'s'} — confirm shipment or request an extension.`,`lc:${r.id}`);
   }
  }
  for(const r of (exportRows||[]) as any[]){
   const outstanding=Math.max(0,Number(r.bill_amount_fcy||0)-Number(r.realised_amount_fcy||0));
   if(outstanding>0&&r.due_date){
    const d=daysOverdue(r.due_date);
    if(d!=null&&d>0)sent+=await notify(db,'export',r.id,'critical',`REALISATION OVERDUE • ${r.ref_code}`,`Export bill realisation is overdue by ${d} day${d===1?'':'s'}.`,`realisation:${r.id}`);
   }
   if(['contract_received','lc_awaited','lc_received','goods_in_production','goods_ready'].includes(r.status)&&r.latest_shipment_date){
    const d=daysUntil(r.latest_shipment_date);
    if(d!=null&&d<=7)sent+=await notify(db,'export',r.id,d<0?'critical':'warning',`${d<0?'SHIPMENT OVERDUE':'SHIPMENT DUE SOON'} • ${r.ref_code}`,d<0?`Latest shipment date passed ${-d} day${-d===1?'':'s'} ago and goods have not shipped.`:`Only ${d} day${d===1?'':'s'} left to ship against the contracted window.`,`shipment:${r.id}`);
   }
  }
  return NextResponse.json({notified:sent});
 }catch(e){logServerError('trade/sla-sweep',e);return NextResponse.json({error:errorMessage(e,'Trade SLA sweep failed')},{status:500})}
}

async function notify(db:ReturnType<typeof supabaseAdmin>,tradeModule:'import'|'export',entityId:string,severity:'warning'|'critical',title:string,body:string,dedupeKind:string):Promise<number>{
 const moduleRoles=tradeModule==='import'?['import_operator','import_manager']:['export_operator','export_manager'];
 const {data:roleRows}=await db.from('user_roles').select('user_id,role').in('role',[...moduleRoles,'ceo','management','super_admin']);
 const recipientIds=Array.from(new Set((roleRows||[]).map((x:any)=>x.user_id).filter(Boolean)));
 if(!recipientIds.length)return 0;
 const payload=recipientIds.map(uid=>({user_id:uid,event_type:`trade_${tradeModule}_alert`,title,body,severity,entity_type:tradeModule==='import'?'import_entry':'export_entry',entity_id:entityId,dedupe_key:`${dedupeKind}:${uid}`}));
 const {data:justInserted}=await db.from('notifications').upsert(payload,{onConflict:'dedupe_key',ignoreDuplicates:true}).select('id,user_id,title,body,severity');
 if(justInserted?.length){
  await Promise.all(justInserted.map((n:any)=>sendPushToUser(db,n.user_id,{title:n.title,body:n.body||'',severity:n.severity,tag:'trade_sla',url:tradeModule==='import'?'/import':'/export'}).catch(()=>{})));
  await db.from('notifications').update({push_sent_at:new Date().toISOString()}).in('id',justInserted.map((n:any)=>n.id));
 }
 return justInserted?.length||0;
}
