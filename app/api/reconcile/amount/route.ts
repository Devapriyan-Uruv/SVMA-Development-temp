import {moduleAuthorization,FINANCE_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {detectCreditPeriod,detectTallyPeriod,readWorkbook} from '@/lib/reconcile';
import {reconcilePayments,paymentCreditSources,makeCanonical,finalizePayments,summarizePayments} from '@/lib/paymentReconciliationV82';
import {resolvePaymentAmbiguities} from '@/lib/paymentAiResolver';
import {addPaymentComments} from '@/lib/paymentComments';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {istTodayDate} from '@/lib/time';
export const runtime='nodejs';
// Two sequential AI phases can now run per upload — ambiguous-candidate
// resolution (lib/paymentAiResolver.ts) then commentary (lib/paymentComments.ts)
// — each in rounds of 2 concurrent batches at up to 55s. A large upload
// needs real headroom on serverless platforms, or a batch past the old
// limit silently fell back to the deterministic/rule-based result.
export const maxDuration=180;
async function buf(v:FormDataEntryValue|null){return v instanceof File?Buffer.from(await v.arrayBuffer()):null}
export async function POST(req:NextRequest){try{
 const az=await moduleAuthorization('finance_vendor_payment',FINANCE_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Finance access not assigned'},{status:az.status});
 const fd=await req.formData(),[tallyBuf,cdBuf]=await Promise.all([buf(fd.get('tally')),buf(fd.get('creditDebit'))]);if(!tallyBuf||!cdBuf)return NextResponse.json({error:'Credit / Debit Note and Tally Daybook are both required.'},{status:400});
 const tallyBook=readWorkbook(tallyBuf),creditRows=paymentCreditSources(readWorkbook(cdBuf));let gstPercent=5,tolerance=1,ruleVersion=1;let aliases:{alias:string;canonical:string}[]=[];
 try{const db=supabaseAdmin();const [ruleRes,aliasRes]=await Promise.all([db.from('finance_reconciliation_rules').select('*').eq('rule_code','NORMAL_PURCHASE').eq('active',true).order('rule_version',{ascending:false}).limit(1).maybeSingle(),db.from('finance_vendor_aliases').select('alias_normalized,display_name,vendor_master_id').eq('active',true)]);const rule=ruleRes.data;if(rule){gstPercent=Number(rule.gst_percent??5);tolerance=Number(rule.tolerance??1);ruleVersion=Number(rule.rule_version??1)}aliases=(aliasRes.data||[]).map((x:any)=>({alias:String(x.alias_normalized||''),canonical:String(x.vendor_master_id||x.display_name||x.alias_normalized||'')})).filter(x=>x.alias&&x.canonical)}catch{}
 const recon=reconcilePayments(creditRows,tallyBook,gstPercent,tolerance,aliases),sourcePeriod={creditDebit:detectCreditPeriod(creditRows),tally:detectTallyPeriod(tallyBook)};
 const canonical=makeCanonical(aliases),warnings:string[]=[];
 const aiResolution=await resolvePaymentAmbiguities(recon.rows,creditRows,gstPercent,tolerance,canonical);
 if(aiResolution.resolved)finalizePayments(recon.rows,recon.voucherControls);
 if(aiResolution.warning)warnings.push(aiResolution.warning);
 const summary={...summarizePayments(recon.rows,recon.voucherControls),gstPercent,tolerance,ruleVersion,ambiguousPaymentRows:aiResolution.total,aiResolvedAmbiguities:aiResolution.resolved};
 const comments=await addPaymentComments(recon.rows);if(comments.warning)warnings.push(comments.warning);
 let runId:string|null=null;try{const user=await currentUser(),db=supabaseAdmin();const ins=await db.from('reconciliation_runs').insert({reconciliation_date:sourcePeriod.tally.to||sourcePeriod.creditDebit.to||istTodayDate(),status:'completed',run_by:user?.id||null,summary:{...summary,sourcePeriod,downloadReport:{reconciliationDate:sourcePeriod.tally.to||sourcePeriod.creditDebit.to,sourcePeriod,summary,vendorPayments:comments.rows,aiComments:{generated:comments.generated,total:comments.rows.length},rulesVersion:'8.2',voucherControls:recon.voucherControls}},completed_at:new Date().toISOString(),reconciliation_type:'vendor_payment'}).select('id').single();runId=ins.data?.id||null;if(!runId)warnings.push('Run history could not be saved. Results are available for download.')}catch{warnings.push('Run history could not be saved. Results are available for download.')}
 return NextResponse.json({runId,reconciliationDate:sourcePeriod.tally.to||sourcePeriod.creditDebit.to,sourcePeriod,summary,vendorPayments:comments.rows,warnings,aiComments:{generated:comments.generated,total:comments.rows.length},rulesVersion:'8.2',voucherControls:recon.voucherControls,rule:{code:'NORMAL_PURCHASE',gstPercent,tolerance,ruleVersion,versioned:true}})
}catch(e){logServerError('reconcile/amount',e);return NextResponse.json({error:errorMessage(e,'Purchase payment reconciliation failed.')},{status:500})}}
