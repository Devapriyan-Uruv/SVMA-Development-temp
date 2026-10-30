import * as XLSX from 'xlsx';
import {type Row} from './reconcile';
import {similarity} from './normalize';

const text=(x:unknown)=>String(x??'').trim();
const number=(x:unknown)=>Number(text(x).replace(/,/g,''))||0;
const paise=(x:unknown)=>Math.round(number(x)*100);
const rs=(x:number)=>x/100;
const tokens=(x:unknown):string[]=>text(x).match(/(?<!\d)\d{6}(?!\d)/g)||[];
const name=(x:unknown)=>text(x).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\b(LTD|LIMITED|PVT|PRIVATE|TRADERS|TRADER|AGENCIES|AGENCY|SRI|SHREE|SREE|BRAN|FW)\b/g,'').replace(/\s/g,'');
function nameScore(a:unknown,b:unknown){
 const A=name(a),B=name(b);if(!A||!B)return 0;if(A===B)return 1;
 const [short,long]=[A,B].sort((x,y)=>x.length-y.length);
 return short.length>=3&&long.startsWith(short)?.96:similarity(A,B);
}
function day(x:unknown){
 if(x instanceof Date)return [x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
 return text(x);
}
/** The CreditList's own "Reference Number" column (e.g. "DN/1115/26-27",
 * "CN-450-26-27") is a genuinely separate signal from PurchaseType
 * (Direct/Indirect) — confirmed against real source data, both values of
 * PurchaseType appear under both DN and CN references. A Debit Note keeps
 * the existing Direct/Indirect formula exactly as before. A Credit Note
 * means SVMA owes the supplier MORE, not less — rebate and rebate GST flip
 * from a subtraction to an addition, uniformly regardless of Direct/
 * Indirect, while weighment/unloading/TDS are still subtracted either way. */
function creditDebitKind(refNumber:unknown):'CN'|'DN'|null{
 const t=text(refNumber).toUpperCase();
 if(/^CN\b/.test(t))return 'CN';
 if(/^DN\b/.test(t))return 'DN';
 return null;
}
type ExpectedCalc={expected:number;isCN:boolean;formulaBasis:string};
function computeExpected(direct:boolean,bill:number,gst:number,full:number,weigh:number,unloading:number,tds:number,refKind:'CN'|'DN'|null):ExpectedCalc{
 if(refKind==='CN')return {expected:bill+gst+full-weigh-unloading-tds,isCN:true,formulaBasis:'CREDIT NOTE: AJ + GST on AJ + full rebate - AB - AC - TDS (rebate added, not subtracted — SVMA owes the supplier more)'};
 return {expected:direct?bill+gst-tds:bill+gst-full-weigh-unloading-tds,isCN:false,formulaBasis:direct?'DEBIT NOTE / DIRECT CANDIDATE: AJ + GST on AJ - TDS':'DEBIT NOTE / INDIRECT: AJ + GST on AJ - full rebate - AB - AC - TDS'};
}
/** Isolated parser: preserves physical source rows and includes Advance without altering other modules. */
export function paymentSources(book:XLSX.WorkBook){
 const sn=book.SheetNames.find(s=>/^day\s*book$/i.test(s));if(!sn)throw new Error('Day Book sheet was not found.');
 const raw=XLSX.utils.sheet_to_json<any[]>(book.Sheets[sn],{header:1,defval:null,raw:true});
 const header=raw.findIndex(r=>text(r[0])==='Date'&&text(r[1])==='Particulars');
 if(header<0)throw new Error('Day Book headers were not found.');
 const vouchers:any[]=[];let v:any=null;
 for(let i=header+1;i<raw.length;i++){
  const r=raw[i];
  if(text(r[6])&&text(r[7])){
   v=null;if(!/^payment$/i.test(text(r[6])))continue;
   v={row:i+1,date:day(r[0]),vendor:text(r[1]),paymentVoucher:text(r[7]),total:paise(r[8])-paise(r[9]),refs:[],lines:[]};vouchers.push(v);continue;
  }
  if(!v)continue;
  if(/^(agst ref|new ref|on account|advance)$/i.test(text(r[1])))v.refs.push({row:i+1,kind:text(r[1]),ref:text(r[2]),actual:paise(r[4])*(/^cr$/i.test(text(r[5]))?-1:1)});
  else if(text(r[1]))v.lines.push(text(r[1]));
 }
 if(!vouchers.length)throw new Error('No Payment vouchers were found in the Day Book.');
 return vouchers;
}
export function paymentCreditSources(book:XLSX.WorkBook):Row[]{
 const sn=book.SheetNames.find(s=>/^CreditList$/i.test(s));if(!sn)throw new Error('CreditList sheet was not found.');
 const raw=XLSX.utils.sheet_to_json<any[]>(book.Sheets[sn],{header:1,defval:null,raw:false});
 const hi=raw.findIndex(r=>r.some(x=>text(x)==='LotNumber')&&r.some(x=>text(x)==='NetValue'));
 if(hi<0)throw new Error('Credit LotNumber and NetValue headers were not found.');
 const heads=raw[hi].map(text);return raw.slice(hi+1).map((r,i)=>({...Object.fromEntries(heads.map((h,c)=>[h||'_c'+c,r[c]])),_row:hi+i+2} as Row)).filter(r=>text(r.LotNumber)&&text(r['Customer Name']));
}
export function makeCanonical(aliases:{alias:string;canonical:string}[]){
 return (x:unknown)=>aliases.find(a=>name(a.alias)===name(x))?.canonical||x;
}
/** Given a confirmed CreditList row `c` for payment row `r` (either the
 * unique lot+vendor match, or an AI-resolved candidate — see
 * lib/paymentAiResolver.ts), computes and writes the full match: purchase
 * type / CN-DN formula, Credit AI comparison, and the resulting status.
 * Pulled out of reconcilePayments so the deterministic match branch and the
 * AI second-pass layer apply the exact same rule, never a parallel one. */
export function applyCreditMatch(r:any,c:Row,gstPercent:number,tolerance:number,canonical:(x:unknown)=>unknown){
 const tol=paise(tolerance),refActual=paise(r.actual);
 // `full` used `||` against a rebate figure that can be a genuine 0 (a
 // recorded rebate that nets to nothing is not the same as "not
 // recorded") — that fell through to the computed rebate+rebateGst
 // fallback and silently discarded the source's own explicit 0.
 const bill=paise(c.BillValue),gst=Math.round(bill*gstPercent/100),rebate=paise(c['Rebate Value']),rebateGst=paise(c['Rebate IGST Amount'])+paise(c['Rebate CGST Amount'])+paise(c['Rebate SGST Amount']),hasRebateNet=text(c['Rebate Net Value'])!==''&&Number.isFinite(Number(text(c['Rebate Net Value']).replace(/,/g,''))),full=hasRebateNet?paise(c['Rebate Net Value']):rebate+rebateGst,weigh=paise(c.Weightment??c.Weighment),unloading=paise(c.Unloading),tds=paise(c.TDS);
 const direct=/^direct\s+purchase$/i.test(text(c.PurchaseType)),indirect=/^(indirect|normal)\s+purchase$/i.test(text(c.PurchaseType));
 const cnDnKind=creditDebitKind(c['Reference Number']);
 const calc=computeExpected(direct,bill,gst,full,weigh,unloading,tds,cnDnKind);
 const expected=calc.expected;
 const validBill=text(c.BillValue)!==''&&Number.isFinite(Number(text(c.BillValue).replace(/,/g,'')));
 const validAI=text(c.NetValue)!==''&&Number.isFinite(Number(text(c.NetValue).replace(/,/g,'')));
 Object.assign(r,{source:c,creditRow:c._row,matchedLot:c.LotNumber,creditVendor:c['Customer Name'],nameSimilarity:nameScore(canonical(r.vendor),canonical(c['Customer Name'])),matchBasis:'Lot reference + vendor name',product:c['Product Name'],purchaseType:c.PurchaseType,creditDebitKind:cnDnKind||'—',referenceNumber:text(c['Reference Number']),invoice:c['Invoice No'],billValue:rs(bill),gst:rs(gst),rebate:rs(rebate),rebateGst:rs(rebateGst),fullRebate:rs(full),weighment:rs(weigh),unloading:rs(unloading),tds:rs(tds),documentedAdvance:number(c.Advance),creditNetValue:validAI?number(c.NetValue):null,creditVariance:validAI?rs(refActual-paise(c.NetValue)):null,formulaBasis:calc.formulaBasis,candidateFormula:direct});
 r.creditComparison=!validAI?'AI value missing':r.creditVariance===0?'Exact AI match':Math.abs(r.creditVariance)<=tolerance?'AI within tolerance':'AI differs';
 if((direct||indirect)&&validBill){
  r.expected=rs(expected);r.variance=rs(refActual-expected);r.formulaMatches=Math.abs(refActual-expected)<=tol;
  // Direct Purchase rows are always grouped as "Needs Validation" — the
  // candidate formula for Direct is explicitly a weaker rule (spec: never
  // auto-confirmed), so a single consistent label is clearer than
  // splitting it into two status strings that both mean "review this".
  r.status=direct?'NEEDS VALIDATION':r.formulaMatches?'MATCHED — CORRECT AMOUNT':r.variance>0?'POSSIBLE OVERPAYMENT':'POSSIBLE UNDERPAYMENT';
  r.comment='Lot '+r.lotSequence+' and vendor name match. Daybook allocation '+r.actual.toFixed(2)+'; calculated amount '+r.expected.toFixed(2)+'; difference '+r.variance.toFixed(2)+'. '+(cnDnKind==='CN'?'Reference Number is a Credit Note — rebate and rebate GST are added to the bill value, not subtracted, since this represents an additional amount owed to the supplier. ':'')+(direct?'Direct Purchase uses the candidate BillValue + GST - TDS rule; this does not establish that Credit AI is correct. ':r.formulaMatches?'Calculation agrees within tolerance. ':'The difference is unexplained; check settlement or adjustment evidence. ')+(validAI?'Credit AI comparison: '+r.creditComparison+' (difference '+r.creditVariance.toFixed(2)+').':'Credit AI is missing.');
  if(number(c.Advance)){r.status='NEEDS REVIEW';r.comment+=' An advance is recorded in CreditList; it is not automatically deducted.';}
 }else{r.status='RULE REVIEW REQUIRED';r.comment='Lot and vendor match, but the purchase type or BillValue cannot support the configured calculation. Credit AI comparison remains separate.';}
}
/** Rebuilds the summary block from the current row set — used both for the
 * initial deterministic pass and again after the AI resolver (see
 * lib/paymentAiResolver.ts) may have moved rows out of the ambiguous
 * statuses, so counts never go stale against what the UI/export show. */
export function summarizePayments(rows:any[],voucherControls:any[]){
 const comparable=rows.filter(r=>r.expected!==null);
 const sum=(xs:any[],field:string)=>rs(xs.reduce((s,r)=>s+paise(r[field]),0));
 return {purchasePayments:rows.length,paymentVouchers:voucherControls.length,correct:rows.filter(r=>r.status==='MATCHED — CORRECT AMOUNT').length,formulaMatches:rows.filter(r=>r.formulaMatches).length,needsValidation:rows.filter(r=>r.status==='NEEDS VALIDATION').length,directCandidateMatches:rows.filter(r=>r.status==='NEEDS VALIDATION').length,creditNoteRows:rows.filter(r=>r.creditDebitKind==='CN').length,debitNoteRows:rows.filter(r=>r.creditDebitKind==='DN').length,overpayments:rows.filter(r=>r.status==='POSSIBLE OVERPAYMENT').length,underpayments:rows.filter(r=>r.status==='POSSIBLE UNDERPAYMENT').length,sourceMissing:rows.filter(r=>r.status==='CREDIT/DEBIT RECORD NOT FOUND').length,needsReview:rows.filter(r=>['NEEDS REVIEW','RULE REVIEW REQUIRED','AMBIGUOUS LOT MATCH','VENDOR MISMATCH','VENDOR FOUND — LOT UNCONFIRMED','NEEDS VALIDATION','NO REFERENCE ALLOCATION'].includes(r.status)).length,onAccount:rows.filter(r=>r.status==='ON ACCOUNT PAYMENT').length,totalExpected:sum(comparable,'expected'),comparableActual:sum(comparable,'actual'),totalActual:sum(rows,'actual'),netVariance:sum(comparable,'variance'),aiDifferences:rows.filter(r=>r.creditComparison==='AI differs').length,voucherControlFailures:voucherControls.filter(v=>v.status==='PAYMENT ALLOCATION CONTROL FAILED').length,noReferenceVouchers:voucherControls.filter(v=>v.status==='NO REFERENCE DETAIL').length};
}
export function reconcilePayments(creditRows:Row[],book:XLSX.WorkBook,gstPercent=5,tolerance=1,aliases:{alias:string;canonical:string}[]=[]){
 const vouchers=paymentSources(book),tol=paise(tolerance);
 const canonical=makeCanonical(aliases);
 const rows:any[]=[];const voucherControls:any[]=[];
 for(const v of vouchers){
  const refs=v.refs.length?v.refs:[{row:v.row,kind:'No reference allocation',ref:'',actual:v.total}];
  const allocated=v.refs.reduce((s:number,r:any)=>s+r.actual,0);
  voucherControls.push({paymentDate:v.date,paymentVoucher:v.paymentVoucher,vendor:v.vendor,sourceRow:v.row,voucherTotal:rs(v.total),allocatedTotal:rs(allocated),difference:rs(v.total-allocated),status:!v.refs.length?'NO REFERENCE DETAIL':allocated===v.total?'PASS':'PAYMENT ALLOCATION CONTROL FAILED'});
  for(const ref of refs){
   const ts=tokens(ref.ref),lotMatches=creditRows.filter(c=>tokens(c.LotNumber).some(t=>ts.includes(t)));
   const names=creditRows.filter(c=>nameScore(canonical(v.vendor),canonical(c['Customer Name']))>=.86);
   const both=lotMatches.filter(c=>names.includes(c));
   const r:any={sequence:rows.length+1,paymentDate:v.date,vendor:v.vendor,paymentVoucher:v.paymentVoucher,bankReference:v.lines.join(' ').match(/(?:UTR|NEFT|RTGS|CHE\.?\s*NO\.?)\s*[:#.-]?\s*([A-Z0-9/-]+)/i)?.[1]||'',dayBookRef:ref.ref,referenceKind:ref.kind,dayBookRow:ref.row,voucherRow:v.row,voucherTotal:rs(v.total),actual:rs(ref.actual),lotSequence:ts.join(', '),expected:null,variance:null,creditNetValue:null,creditVariance:null,creditComparison:'Not compared',matchedLot:'',creditVendor:'',purchaseType:'',nameVerified:names.length>0,nameCandidates:names.map(c=>({vendor:c['Customer Name'],lot:c.LotNumber,row:c._row})),matches:(lotMatches.length?lotMatches:names).map(c=>({lot:c.LotNumber,vendor:c['Customer Name'],row:c._row,netValue:number(c.NetValue)})),commentSource:'Rule-based fallback',aiComment:''};
   if(!v.refs.length){r.status='NO REFERENCE ALLOCATION';r.comment='The Daybook voucher total is retained, but no reference allocation is supplied. A lot amount cannot be verified.';}
   else if(/^(advance|on account)$/i.test(ref.kind)){r.status='ON ACCOUNT PAYMENT';r.comment='Explicit advance/on-account allocation. No purchase lot or adjustment is inferred.';}
   else if(both.length!==1){
    r.status=both.length>1?'AMBIGUOUS LOT MATCH':lotMatches.length?'VENDOR MISMATCH':names.length?'VENDOR FOUND — LOT UNCONFIRMED':'CREDIT/DEBIT RECORD NOT FOUND';
    r.comment=both.length>1?'Multiple lot and vendor rows match; review the source rows before comparing amounts.':lotMatches.length?'The reference lot exists but the vendor name differs. Verify the vendor or configure an approved alias.':names.length?'Vendor name is found in CreditList, but the payment lot is not identified. Candidate amounts are not assigned to this payment.':'No matching lot or sufficiently similar vendor name was found in the supplied CreditList. Check report coverage and transaction type.';
   }else{
    applyCreditMatch(r,both[0],gstPercent,tolerance,canonical);
   }
   rows.push(r);
  }
 }
 finalizePayments(rows,voucherControls);
 return {rows,voucherControls,summary:summarizePayments(rows,voucherControls)};
}
/** Repeated-lot duplicate flagging + voucher-allocation-control attach —
 * re-run after lib/paymentAiResolver.ts assigns a creditRow to a previously
 * ambiguous row, so a lot the AI resolves for two different rows still gets
 * caught, not just the ones matched on the first deterministic pass. */
export function finalizePayments(rows:any[],voucherControls:any[]){
 const byLot=new Map<string,any[]>();
 for(const r of rows)if(r.creditRow){const key=String(r.creditRow);byLot.set(key,[...(byLot.get(key)||[]),r]);}
 for(const group of byLot.values())if(group.length>1){const total=rs(group.reduce((s,r)=>s+paise(r.actual),0));for(const r of group)if(!r.repeatedLotActual){r.status='NEEDS REVIEW';r.comment+=' This credit lot is referenced '+group.length+' times in the uploaded Daybook (combined '+total.toFixed(2)+'). Review partial/repeated payments; no duplicate settlement is assumed.';r.repeatedLotActual=total;}}
 for(const r of rows){const control=voucherControls.find(v=>v.sourceRow===r.voucherRow);if(!control)continue;r.voucherControl=control.status;if(control.status==='PAYMENT ALLOCATION CONTROL FAILED'&&!/Voucher allocations do not equal/.test(r.comment)){r.status='NEEDS REVIEW';r.comment+=' Voucher allocations do not equal the parent total.';}r.aiComment=r.comment;}
}
