import type {supabaseAdmin} from '@/lib/supabase/admin';

export const IMPORT_STATUSES=['contract_received','lc_opened','shipped','arrived','boe_filed','cleared','bc_open','settled','closed'] as const;
export const EXPORT_STATUSES=['contract_received','lc_awaited','lc_received','goods_in_production','goods_ready','shipped','documents_submitted','bill_purchased','realisation_awaited','partly_realised','fully_realised','overdue','closed'] as const;

export const IMPORT_STATUS_LABELS:Record<string,string>={
 contract_received:'Contract Received',lc_opened:'LC Opened',shipped:'Shipped',arrived:'Arrived',
 boe_filed:'BOE Filed',cleared:'Cleared',bc_open:'Buyer\'s Credit Open',settled:'Settled',closed:'Closed',
};
export const EXPORT_STATUS_LABELS:Record<string,string>={
 contract_received:'Contract Received',lc_awaited:'LC Awaited',lc_received:'LC Received',
 goods_in_production:'Goods in Production',goods_ready:'Goods Ready',shipped:'Shipped',
 documents_submitted:'Documents Submitted',bill_purchased:'Bill Purchased/Discounted',
 realisation_awaited:'Realisation Awaited',partly_realised:'Partly Realised',fully_realised:'Fully Realised',
 overdue:'Overdue',closed:'Closed',
};

// Sole-reference numbers ("IMP-2026-0001" / "EXP-2026-0001") always come
// from the DB-side sequence (sql/036) so two people saving at the same
// instant can never receive the same code — never generate one in app code.
export async function nextRefCode(db:ReturnType<typeof supabaseAdmin>,tradeModule:'import'|'export'):Promise<string>{
 const {data,error}=await db.rpc('generate_trade_ref_code',{p_module:tradeModule});
 if(error)throw error;
 return String(data);
}

export function costLineTotal(l:{value?:number|null;gst?:number|null}):number{return Number(l.value||0)+Number(l.gst||0)}

export function daysUntil(dateStr:string|null|undefined):number|null{
 if(!dateStr)return null;
 return Math.round((new Date(dateStr+'T00:00:00Z').getTime()-Date.now())/86400000);
}
export function daysOverdue(dateStr:string|null|undefined):number|null{
 const d=daysUntil(dateStr);return d==null?null:-d;
}

// Shared by GET /api/trade/insights (the Import/Export module's own panel)
// and the Management dashboard (app/api/ceo/dashboard/route.ts), so the
// same real, non-invented facts feed both places instead of two versions
// quietly drifting apart.
export type TradeFlag={id:string;module:'import'|'export';refCode:string;party:string;issue:string;nextBestAction:string;daysMetric:number|null};
export type TradeWentWell={module:'import'|'export';refCode:string;party:string;text:string};

export function buildTradeDeterministic(importRows:any[],exportRows:any[]){
 const needsAttention:TradeFlag[]=[],paymentPending:TradeFlag[]=[],shipmentPending:TradeFlag[]=[],whatWentWell:TradeWentWell[]=[];

 for(const r of importRows){
  const party=r.trade_parties?.name||'Unknown supplier';
  if(r.status==='closed'){
   if(r.settlement_value_inr&&r.advance_value_inr){whatWentWell.push({module:'import',refCode:r.ref_code,party,text:`${r.ref_code} (${party}) closed and settled cleanly.`})}
   continue;
  }
  if(r.converted_to_bc&&!r.bc_closed&&r.bc_due_date){
   const d=daysUntil(r.bc_due_date);
   if(d!=null&&d<=7){
    const overdue=d<0;
    paymentPending.push({id:r.id,module:'import',refCode:r.ref_code,party,issue:overdue?`Buyer's Credit overdue by ${-d} day${-d===1?'':'s'}`:`Buyer's Credit due in ${d} day${d===1?'':'s'}`,nextBestAction:overdue?'Close or renew the Buyer\'s Credit immediately — bank interest is accruing.':'Arrange funds to close the Buyer\'s Credit before the due date.',daysMetric:d});
   }
  }
  if(r.lc_expiry_date&&['contract_received','lc_opened'].includes(r.status)){
   const d=daysUntil(r.lc_expiry_date);
   if(d!=null&&d<=14){
    shipmentPending.push({id:r.id,module:'import',refCode:r.ref_code,party,issue:d<0?`LC expired ${-d} day${-d===1?'':'s'} ago, not yet shipped`:`LC expires in ${d} day${d===1?'':'s'}, not yet shipped`,nextBestAction:d<0?'Contact the supplier and bank urgently — the LC has lapsed.':'Confirm shipment or request an LC extension before it expires.',daysMetric:d});
   }
  }
  if(!r.documents_complete&&r.status!=='contract_received'){
   needsAttention.push({id:r.id,module:'import',refCode:r.ref_code,party,issue:'Documents incomplete',nextBestAction:'Chase the missing shipping/BOE/bank document — see Exceptions notes.',daysMetric:null});
  }
 }

 for(const r of exportRows){
  const party=r.trade_parties?.name||'Unknown customer';
  if(r.status==='fully_realised'||r.status==='closed'){
   whatWentWell.push({module:'export',refCode:r.ref_code,party,text:`${r.ref_code} (${party}) fully realised${r.status==='closed'?' and closed':''}.`});
   continue;
  }
  const outstanding=Math.max(0,Number(r.bill_amount_fcy||0)-Number(r.realised_amount_fcy||0));
  if(outstanding>0&&r.due_date){
   const d=daysOverdue(r.due_date);
   if(d!=null&&d>0){
    paymentPending.push({id:r.id,module:'export',refCode:r.ref_code,party,issue:`Realisation overdue by ${d} day${d===1?'':'s'}`,nextBestAction:'Follow up with the bank/customer for realisation — flag to CFO if unresolved beyond 30 days.',daysMetric:d});
   }else if(d!=null&&d>=-7){
    paymentPending.push({id:r.id,module:'export',refCode:r.ref_code,party,issue:`Realisation due in ${-d} day${-d===1?'':'s'}`,nextBestAction:'Confirm documents are with the bank ahead of the due date.',daysMetric:d});
   }
  }
  if(['contract_received','lc_awaited','lc_received','goods_in_production','goods_ready'].includes(r.status)&&r.latest_shipment_date){
   const d=daysUntil(r.latest_shipment_date);
   if(d!=null&&d<=7){
    shipmentPending.push({id:r.id,module:'export',refCode:r.ref_code,party,issue:d<0?`Latest shipment date passed ${-d} day${-d===1?'':'s'} ago`:`Only ${d} day${d===1?'':'s'} left to ship`,nextBestAction:d<0?'Escalate — the contractual shipment window has already passed.':'Confirm goods readiness and book the shipment now.',daysMetric:d});
   }
  }
  if(r.reason_for_delay&&outstanding>0){
   needsAttention.push({id:r.id,module:'export',refCode:r.ref_code,party,issue:`Delay flagged: ${r.reason_for_delay}`,nextBestAction:r.follow_up_action||'Review and record a follow-up action.',daysMetric:null});
  }
 }

 const sortByUrgency=(a:TradeFlag,b:TradeFlag)=>(a.daysMetric??999)-(b.daysMetric??999);
 return {
  whatWentWell:whatWentWell.slice(0,10),
  needsAttention:needsAttention.slice(0,20),
  paymentPending:paymentPending.sort(sortByUrgency).slice(0,20),
  shipmentPending:shipmentPending.sort(sortByUrgency).slice(0,20),
 };
}

export async function fetchTradeRowsForInsights(db:ReturnType<typeof supabaseAdmin>){
 const [{data:importRows,error:ie},{data:exportRows,error:ee}]=await Promise.all([
  db.from('import_entries').select('id,ref_code,status,converted_to_bc,bc_closed,bc_due_date,lc_expiry_date,documents_complete,settlement_value_inr,advance_value_inr,trade_parties(name)').order('created_at',{ascending:false}).limit(500),
  db.from('export_entries').select('id,ref_code,status,bill_amount_fcy,realised_amount_fcy,due_date,latest_shipment_date,reason_for_delay,follow_up_action,trade_parties(name)').order('created_at',{ascending:false}).limit(500),
 ]);
 if(ie)throw ie;if(ee)throw ee;
 return {importRows:importRows||[],exportRows:exportRows||[]};
}
