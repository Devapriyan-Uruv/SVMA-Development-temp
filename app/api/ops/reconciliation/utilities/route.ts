import {NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';

/** Plant-floor utility/downtime logs — genuinely new information (no
 * existing table covers any of these), kept as their own independent logs
 * rather than folded into the Production/Raw Material reconciliation
 * above. Solvent Daily Report deliberately overlaps the Solvent module's
 * own manual entry and Quality's Process Lab Report (same per-shift/
 * per-hour %OIL/%FFA readings) — built as a separate cross-check log per
 * explicit instruction, not a source of truth for either. */
export async function GET(){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const [{data:consumableRaw},{data:ebPowerRaw},{data:shutdownRaw},{data:solventRaw}]=await Promise.all([
  db.from('ops_consumable_issues').select('issue_date,reference_no,department,product_raw,weight').order('issue_date',{ascending:false}).limit(50),
  db.from('ops_eb_power_readings').select('report_date,department,particulars,opening_kwh,closing_kwh,consumption_units').order('report_date',{ascending:false}).limit(50),
  db.from('ops_shutdowns').select('effective_date,reason,from_time,to_time,minutes,remarks').order('effective_date',{ascending:false}).limit(50),
  db.from('ops_solvent_daily_readings').select('report_date,shift,time_slot,dob_doc_oil_pct,miscella,production_oil_ffa,iv,mv,flash_point').order('report_date',{ascending:false}).limit(50),
 ]);
 const consumableIssues=(consumableRaw||[]).map((r:any)=>({issueDate:r.issue_date,referenceNo:r.reference_no,department:r.department,productRaw:r.product_raw,weight:r.weight===null?null:Number(r.weight)}));
 const ebPowerReadings=(ebPowerRaw||[]).map((r:any)=>({reportDate:r.report_date,department:r.department,particulars:r.particulars,openingKwh:r.opening_kwh===null?null:Number(r.opening_kwh),closingKwh:r.closing_kwh===null?null:Number(r.closing_kwh),consumptionUnits:r.consumption_units===null?null:Number(r.consumption_units)}));
 const shutdowns=(shutdownRaw||[]).map((r:any)=>({effectiveDate:r.effective_date,reason:r.reason,fromTime:r.from_time,toTime:r.to_time,minutes:r.minutes===null?null:Number(r.minutes),remarks:r.remarks}));
 const solventDaily=(solventRaw||[]).map((r:any)=>({reportDate:r.report_date,shift:r.shift,timeSlot:r.time_slot,dobDocOilPct:r.dob_doc_oil_pct===null?null:Number(r.dob_doc_oil_pct),miscella:r.miscella===null?null:Number(r.miscella),productionOilFfa:r.production_oil_ffa===null?null:Number(r.production_oil_ffa),iv:r.iv===null?null:Number(r.iv),mv:r.mv===null?null:Number(r.mv),flashPoint:r.flash_point===null?null:Number(r.flash_point)}));
 return NextResponse.json({consumableIssues, ebPowerReadings, shutdowns, solventDaily});
}
