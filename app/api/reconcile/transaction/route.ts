import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { parseWeighmentUpload, parseGateUpload, parseTallyUpload, reconcilePresence, period, DEFAULT_RULES } from '@/lib/transactionPresence';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export const runtime='nodejs';
async function workbook(file:File){return XLSX.read(Buffer.from(await file.arrayBuffer()),{type:'buffer',cellDates:true});}
export async function POST(req:NextRequest){
 try {
  const az=await moduleAuthorization('finance_transaction',FINANCE_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Finance access not assigned'},{status:az.status});
  const form=await req.formData(),weighFile=form.get('weighment'),tallyFile=form.get('tally');
  const gateInFiles=form.getAll('gateIn').filter((f):f is File=>f instanceof File&&f.size>0),gateOutFiles=form.getAll('gateOut').filter((f):f is File=>f instanceof File&&f.size>0);
  if(!(weighFile instanceof File)||!(tallyFile instanceof File)||!weighFile.size||!tallyFile.size||!gateInFiles.length||!gateOutFiles.length)return NextResponse.json({error:'Upload Weighment, Gate In, Gate Out and Tally Daybook.'},{status:400});
  const [wbook,tbook,inBooks,outBooks]=await Promise.all([workbook(weighFile),workbook(tallyFile),Promise.all(gateInFiles.map(workbook)),Promise.all(gateOutFiles.map(workbook))]);
  const weigh=parseWeighmentUpload(wbook,weighFile.name,String(form.get('reconciliationDate')||''));
  const gates=[...inBooks.flatMap((b,i)=>parseGateUpload(b,gateInFiles[i].name,'IN')),...outBooks.flatMap((b,i)=>parseGateUpload(b,gateOutFiles[i].name,'OUT'))];
  const tally=parseTallyUpload(tbook,tallyFile.name),result=reconcilePresence(weigh.rows,gates,tally.vouchers);
  const sourcePeriod={weighmentDate:weigh.date,gate:period(gates.map(g=>g.date)),tally:period(tally.vouchers.map(v=>v.date))};
  const exceptions=result.svmaCR.flatMap(row=>[
    ...(!row.erpGpNo?[{type:'GATE_REVIEW',severity:'warning',reference:row.weighBridgeRef,party:row.partyName,vehicle:row.lorryNo,description:row.erpState}]:[]),
    ...(!row.evidence.length?[{type:'TALLY_PRESENCE_NOT_FOUND',severity:'warning',reference:row.weighBridgeRef,party:row.partyName,vehicle:row.lorryNo,description:'No matching name or PO/SO reference found in the uploaded Tally records. This does not establish that the transaction is absent from live Tally.'}]:[])
  ]);
  const warnings:string[]=[];
  if(!tally.vouchers.length)warnings.push('The Tally file has recognized headers but no voucher rows. No entry can be found in this upload.');
  if(gates.some(g=>!g.date))warnings.push('Some Gate dates are missing or invalid. Those rows remain candidates and are not uniquely allocated.');
  if(result.sourceControl.duplicateSourceReferences)warnings.push('Duplicate weighment references were retained as separate source rows. Check source control.');
  let runId:string|null=null;
  try {
    const db=supabaseAdmin();const saved=await db.from('reconciliation_runs').insert({reconciliation_date:weigh.date,status:'completed',run_by:az.user?.id||null,summary:{...result.summary,downloadReport:{...result,reconciliationDate:weigh.date,rulesVersion:'8.1'},sourcePeriod,categoryCounts:result.categoryCounts,matchingMode:'name_or_order_presence',rulesVersion:'8.1'},completed_at:new Date().toISOString(),reconciliation_type:'transaction'}).select('id').single();
    if(saved.error)throw saved.error;runId=saved.data?.id||null;
    if(runId&&exceptions.length){const savedExceptions=await db.from('reconciliation_exceptions').insert(exceptions.map(e=>({run_id:runId,exception_type:e.type,severity:e.severity,vehicle_no:e.vehicle||null,party_name:e.party||null,reference_no:e.reference||null,description:e.description})));if(savedExceptions.error)warnings.push('Results are ready, but exception history could not be saved.');}
  }catch{warnings.push('Results and Excel export are ready, but this run could not be saved to history. Check the existing database configuration.');}
  return NextResponse.json({...result,runId,reconciliationDate:weigh.date,sourcePeriod,exceptions,warnings,rules:DEFAULT_RULES,sourceStats:{weighmentRows:weigh.rows.length,gateRows:gates.length,tallyVoucherAppearances:tally.rawVoucherCount,uniqueTallyVouchers:tally.vouchers.length,tallySheets:tally.recognizedSheets},matchingMode:'name_or_order_presence',rulesVersion:'8.1'});
 }catch(error){logServerError('reconcile/transaction',error);return NextResponse.json({error:errorMessage(error,'The uploaded reports could not be reconciled.')},{status:400});}
}
