import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,IMPORT_EDIT_ROLES,IMPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {nextRefCode,IMPORT_STATUSES} from '@/lib/trade';

// Every camelCase key the entry form can send, mapped straight to its
// column — one list shared by create and update instead of maintaining
// the same ~45-field mapping twice. Deliberately flat (not nested by tab)
// because the DB row is flat; the UI is the one that groups these into
// Contract / Advance & LC / Shipment / Invoice & BOE / BC & Settlement tabs.
const FIELD_MAP:[string,string][]=[
 ['brokerName','broker_name'],['partyId','party_id'],['commodityId','commodity_id'],['country','country'],
 ['contractNo','contract_no'],['contractDate','contract_date'],['contractQty','contract_qty'],['ratePerTon','rate_per_ton'],
 ['currency','currency'],['contractValueFcy','contract_value_fcy'],['paymentTerms','payment_terms'],
 ['advancePct','advance_pct'],['advanceAmountFcy','advance_amount_fcy'],['advanceRefNo','advance_ref_no'],['advanceDate','advance_date'],
 ['exchangeRate','exchange_rate'],['advanceValueInr','advance_value_inr'],
 ['lcNo','lc_no'],['lcType','lc_type'],['lcOpeningDate','lc_opening_date'],['lcExpiryDate','lc_expiry_date'],['lcAmountFcy','lc_amount_fcy'],
 ['shipmentPeriod','shipment_period'],['shipperName','shipper_name'],['portOfLoading','port_of_loading'],['blAwbNo','bl_awb_no'],
 ['blDate','bl_date'],['noOfContainers','no_of_containers'],['arrivalDate','arrival_date'],
 ['invoiceNo','invoice_no'],['invoiceDate','invoice_date'],['invoiceQty','invoice_qty'],['invoiceValueFcy','invoice_value_fcy'],['balanceAmountFcy','balance_amount_fcy'],
 ['billRefNo','bill_ref_no'],['billCollectionDate','bill_collection_date'],['billCollectionChargesInr','bill_collection_charges_inr'],
 ['boeNo','boe_no'],['boeDate','boe_date'],['boePaidDate','boe_paid_date'],['boeAmountInr','boe_amount_inr'],
 ['assessableValueInr','assessable_value_inr'],['basicCustomsDutyInr','basic_customs_duty_inr'],['swsOtherDutyInr','sws_other_duty_inr'],
 ['importIgstInr','import_igst_inr'],['otherCustomsChargesInr','other_customs_charges_inr'],
 ['settlementDate','settlement_date'],['settlementFxRate','settlement_fx_rate'],['settlementValueInr','settlement_value_inr'],
 ['convertedToBc','converted_to_bc'],['bcNo','bc_no'],['bcIssueDate','bc_issue_date'],['bcPrincipalInr','bc_principal_inr'],
 ['bcDueDate','bc_due_date'],['bcInterestRate','bc_interest_rate'],['bcInterestAccruedInr','bc_interest_accrued_inr'],
 ['bcInterestPaidInr','bc_interest_paid_inr'],['bcPrincipalPaidInr','bc_principal_paid_inr'],['bcCloseChargesInr','bc_close_charges_inr'],['bcClosed','bc_closed'],['bcClosedDate','bc_closed_date'],
 ['brokerCommissionFcy','broker_commission_fcy'],['brokerCommissionInr','broker_commission_inr'],
 ['documentsComplete','documents_complete'],['exceptionsNotes','exceptions_notes'],['cfoComments','cfo_comments'],
];
function toRow(b:Record<string,any>):Record<string,unknown>{
 const row:Record<string,unknown>={};
 for(const [key,col] of FIELD_MAP)if(key in b)row[col]=b[key]===''?null:b[key];
 return row;
}

const ENTRY_SELECT='*,trade_parties(id,name,party_type,country),trade_commodities(id,name,unit)';

export async function GET(req:NextRequest){
 try{
  const az=await moduleAuthorization('import',IMPORT_VIEW_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import access is required'},{status:az.status});
  const db=supabaseAdmin();
  const id=req.nextUrl.searchParams.get('id');
  if(id){
   const [{data:entry,error},{data:costLines,error:cle}]=await Promise.all([
    db.from('import_entries').select(ENTRY_SELECT).eq('id',id).maybeSingle(),
    db.from('import_cost_lines').select('*,trade_cost_categories(id,name,sort_order)').eq('import_entry_id',id),
   ]);
   if(error)throw error;if(cle)throw cle;
   if(!entry)return NextResponse.json({error:'Import entry not found'},{status:404});
   return NextResponse.json({entry,costLines:costLines||[]});
  }
  const status=req.nextUrl.searchParams.get('status');
  const partyId=req.nextUrl.searchParams.get('partyId');
  let q=db.from('import_entries').select(ENTRY_SELECT).order('created_at',{ascending:false}).limit(500);
  if(status)q=q.eq('status',status);
  if(partyId)q=q.eq('party_id',partyId);
  const {data,error}=await q;
  if(error)throw error;
  return NextResponse.json({entries:data||[]});
 }catch(e){logServerError('import/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to load import entries')},{status:500})}
}

export async function POST(req:NextRequest){
 try{
  const az=await moduleAuthorization('import',IMPORT_EDIT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import edit access is required'},{status:az.status});
  const b=await req.json();
  if(!b.partyId)return NextResponse.json({error:'Supplier is required.'},{status:400});
  if(!b.commodityId)return NextResponse.json({error:'Commodity is required.'},{status:400});
  const db=supabaseAdmin();
  const refCode=await nextRefCode(db,'import');
  const row={...toRow(b),ref_code:refCode,status:'contract_received',created_by:az.user!.id};
  const {data,error}=await db.from('import_entries').insert(row).select(ENTRY_SELECT).single();
  if(error)throw error;
  return NextResponse.json({entry:data});
 }catch(e){logServerError('import/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to create import entry')},{status:500})}
}

export async function PATCH(req:NextRequest){
 try{
  const az=await moduleAuthorization('import',IMPORT_EDIT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import edit access is required'},{status:az.status});
  const b=await req.json();
  if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
  const db=supabaseAdmin();
  const update=toRow(b);
  if('status' in b){
   if(!IMPORT_STATUSES.includes(b.status))return NextResponse.json({error:'Unknown status'},{status:400});
   update.status=b.status;
  }
  update.updated_at=new Date().toISOString();
  const {data,error}=await db.from('import_entries').update(update).eq('id',b.id).select(ENTRY_SELECT).single();
  if(error)throw error;
  return NextResponse.json({entry:data});
 }catch(e){logServerError('import/entries',e);return NextResponse.json({error:errorMessage(e,'Unable to update import entry')},{status:500})}
}
