import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,EXPORT_EDIT_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {nextRefCode,EXPORT_STATUSES} from '@/lib/trade';

// Mirrors app/api/import/entries/route.ts's shape for the Export side —
// same flat field-map-to-column pattern, kept as its own file (not a
// shared generic handler) because the two modules have genuinely
// different fields and, per the brief, different permission boundaries.
const FIELD_MAP:[string,string][]=[
 ['partyId','party_id'],['commodityId','commodity_id'],['country','country'],['incoterm','incoterm'],
 ['portOfLoading','port_of_loading'],['portOfDischarge','port_of_discharge'],['mode','mode'],['currency','currency'],
 ['contractNo','contract_no'],['contractDate','contract_date'],['contractQty','contract_qty'],['contractValueFcy','contract_value_fcy'],
 ['advancePct','advance_pct'],['advanceAmountFcy','advance_amount_fcy'],['balanceAmountFcy','balance_amount_fcy'],
 ['lcOrNonlc','lc_or_nonlc'],['lcNo','lc_no'],['lcDate','lc_date'],['lcType','lc_type'],['lcAmountFcy','lc_amount_fcy'],
 ['lcExpiryDate','lc_expiry_date'],['latestShipmentDate','latest_shipment_date'],['amendmentDetails','amendment_details'],
 ['pcAmountInr','pc_amount_inr'],['pcDate','pc_date'],['goodsReadyDate','goods_ready_date'],
 ['shipmentInvoiceNo','shipment_invoice_no'],['invoiceDate','invoice_date'],['invoiceValueFcy','invoice_value_fcy'],
 ['shippingBillNo','shipping_bill_no'],['shippingBillDate','shipping_bill_date'],['blAwbNo','bl_awb_no'],['blDate','bl_date'],
 ['actualShipmentDate','actual_shipment_date'],['etd','etd'],['eta','eta'],['docsSubmittedDate','docs_submitted_date'],
 ['exportBillNo','export_bill_no'],['billDate','bill_date'],['billType','bill_type'],['billAmountFcy','bill_amount_fcy'],
 ['bankAdCode','bank_ad_code'],['bcConvertedDate','bc_converted_date'],['dueDate','due_date'],
 ['realisationDate','realisation_date'],['realisedAmountFcy','realised_amount_fcy'],['exchangeRate','exchange_rate'],
 ['exchangeDifferenceInr','exchange_difference_inr'],['bankChargesInr','bank_charges_inr'],['interestRate','interest_rate'],
 ['interestAmountInr','interest_amount_inr'],['customsDutyInr','customs_duty_inr'],['igstRefundInr','igst_refund_inr'],
 ['otherIncentivesInr','other_incentives_inr'],['reasonForDelay','reason_for_delay'],['followUpAction','follow_up_action'],
 ['responsiblePerson','responsible_person'],['managementComments','management_comments'],
];
function toRow(b:Record<string,any>):Record<string,unknown>{
 const row:Record<string,unknown>={};
 for(const [key,col] of FIELD_MAP)if(key in b)row[col]=b[key]===''?null:b[key];
 return row;
}

const ENTRY_SELECT='*,trade_parties(id,name,party_type,country),trade_commodities(id,name,unit)';

export async function GET(req:NextRequest){
 try{
  const az=await moduleAuthorization('export',EXPORT_VIEW_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export access is required'},{status:az.status});
  const db=supabaseAdmin();
  const id=req.nextUrl.searchParams.get('id');
  if(id){
   const [{data:entry,error},{data:costLines,error:cle}]=await Promise.all([
    db.from('export_entries').select(ENTRY_SELECT).eq('id',id).maybeSingle(),
    db.from('export_cost_lines').select('*,trade_cost_categories(id,name,sort_order)').eq('export_entry_id',id),
   ]);
   if(error)throw error;if(cle)throw cle;
   if(!entry)return NextResponse.json({error:'Export entry not found'},{status:404});
   return NextResponse.json({entry,costLines:costLines||[]});
  }
  const status=req.nextUrl.searchParams.get('status');
  const partyId=req.nextUrl.searchParams.get('partyId');
  let q=db.from('export_entries').select(ENTRY_SELECT).order('created_at',{ascending:false}).limit(500);
  if(status)q=q.eq('status',status);
  if(partyId)q=q.eq('party_id',partyId);
  const {data,error}=await q;
  if(error)throw error;
  return NextResponse.json({entries:data||[]});
 }catch(e){logServerError('export/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to load export entries')},{status:500})}
}

export async function POST(req:NextRequest){
 try{
  const az=await moduleAuthorization('export',EXPORT_EDIT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export edit access is required'},{status:az.status});
  const b=await req.json();
  if(!b.partyId)return NextResponse.json({error:'Customer is required.'},{status:400});
  if(!b.commodityId)return NextResponse.json({error:'Commodity is required.'},{status:400});
  const db=supabaseAdmin();
  const refCode=await nextRefCode(db,'export');
  const row={...toRow(b),ref_code:refCode,status:'contract_received',created_by:az.user!.id};
  const {data,error}=await db.from('export_entries').insert(row).select(ENTRY_SELECT).single();
  if(error)throw error;
  return NextResponse.json({entry:data});
 }catch(e){logServerError('export/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to create export entry')},{status:500})}
}

export async function PATCH(req:NextRequest){
 try{
  const az=await moduleAuthorization('export',EXPORT_EDIT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export edit access is required'},{status:az.status});
  const b=await req.json();
  if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
  const db=supabaseAdmin();
  const update=toRow(b);
  if('status' in b){
   if(!EXPORT_STATUSES.includes(b.status))return NextResponse.json({error:'Unknown status'},{status:400});
   update.status=b.status;
  }
  update.updated_at=new Date().toISOString();
  const {data,error}=await db.from('export_entries').update(update).eq('id',b.id).select(ENTRY_SELECT).single();
  if(error)throw error;
  return NextResponse.json({entry:data});
 }catch(e){logServerError('export/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to update export entry')},{status:500})}
}
