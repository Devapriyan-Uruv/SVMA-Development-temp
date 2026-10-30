import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('./')?load(path.join(path.dirname(file),n)+'.ts'):require(n),module,module.exports);
 return module.exports;
}
const X=require('xlsx'),{reconcilePayments,paymentCreditSources}=load('lib/paymentReconciliationV82.ts'),{addPaymentComments}=load('lib/paymentComments.ts');
const fixture='reference-samples/validation-10-Sep-2026/';
const read=name=>X.read(fs.readFileSync(fixture+name),{type:'buffer',cellDates:true});
const book=read('Daybook 10.09.26.xlsx'),credit=paymentCreditSources(read('Credit_Debit Note ListSVMAAdmin20260911010244PM.xlsx'));
const r=reconcilePayments(credit,book);let count=0;
function check(label,f){f();count++;console.log('PASS '+label);}
check('Sample population and totals conserved',()=>{assert.equal(r.rows.length,47);assert.equal(r.summary.paymentVouchers,43);assert.equal(r.summary.totalActual,14709562);assert.equal(r.summary.voucherControlFailures,0);assert.equal(r.summary.noReferenceVouchers,5);});
check('Sample matches reproduce approved review',()=>{assert.equal(r.summary.formulaMatches,9);assert.equal(r.summary.correct,7);assert.equal(r.summary.directCandidateMatches,2);assert.equal(r.summary.underpayments,1);assert.equal(r.summary.sourceMissing,30);assert.equal(r.summary.onAccount,1);assert.equal(r.summary.aiDifferences,3);});
check('Oviya separate lot is name-only; no invented adjustment',()=>{const a=r.rows.find(x=>x.paymentVoucher==='06730'),b=r.rows.find(x=>x.paymentVoucher==='06749');assert.equal(a.variance,-40000.25);assert.equal(a.creditVariance,-40001);assert.equal(b.expected,null);assert.equal(b.status,'VENDOR FOUND — LOT UNCONFIRMED');});
check('Source rows, leading zeros and multiple allocations survive',()=>{const h=r.rows[0];assert.equal(h.creditRow,312);assert.equal(h.dayBookRow,19);assert.equal(h.lotSequence,'083007');assert.equal(h.paymentVoucher,'06729');assert.equal(r.rows.filter(x=>x.paymentVoucher==='06731').length,2);});
function synthetic(refs,amount=100,vendor='Alpha Industries'){
 const raw=[['Date','Particulars','','','','','Vch Type','Vch No.','Debit Amount','Credit Amount'],[new Date(2026,8,10),vendor,null,null,null,null,'Payment','00001',amount],...refs.map(([ref,n,kind='Agst Ref',dc='Dr'])=>[null,kind,ref,null,n,dc])];
 const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(raw),'Day Book');return w;
}
const source={_row:6,LotNumber:'RB-G1/090101/26-27','Customer Name':'Alpha Industries',PurchaseType:'Indirect Purchase',BillValue:100,NetValue:105};
check('First row after header and zero allocation preserved',()=>{const x=reconcilePayments([source],synthetic([['090101',0]],0));assert.equal(x.rows[0].actual,0);assert.equal(x.rows[0].status,'POSSIBLE UNDERPAYMENT');});
check('Same lot multiple payments requires review',()=>{const x=reconcilePayments([source],synthetic([['090101',50],['090101',55]],105));assert.ok(x.rows.every(y=>y.status==='NEEDS REVIEW'));assert.equal(x.rows[0].repeatedLotActual,105);});
check('Duplicate credit candidates do not pick arbitrary amounts',()=>assert.equal(reconcilePayments([source,{...source,_row:7}],synthetic([['090101',105]],105)).rows[0].status,'AMBIGUOUS LOT MATCH'));
check('Vendor conflict, missing value, unknown type stay reviewable',()=>{assert.equal(reconcilePayments([source],synthetic([['090101',105]],105,'Unrelated Supplier')).rows[0].status,'VENDOR MISMATCH');assert.equal(reconcilePayments([{...source,BillValue:''}],synthetic([['090101',105]],105)).rows[0].expected,null);assert.equal(reconcilePayments([{...source,PurchaseType:'Other'}],synthetic([['090101',105]],105)).rows[0].expected,null);});
check('Allocation control failure prevents correct status',()=>assert.equal(reconcilePayments([source],synthetic([['090101',105]],999)).rows[0].status,'NEEDS REVIEW'));
check('Explicit advance and absent reference remain distinct',()=>{assert.equal(reconcilePayments([],synthetic([['Adv',100,'Advance']])).rows[0].status,'ON ACCOUNT PAYMENT');assert.equal(reconcilePayments([],synthetic([])).rows[0].status,'NO REFERENCE ALLOCATION');});
const fallback=await addPaymentComments(r.rows,false);
check('No API key gives honest fallback on every row',()=>{assert.equal(fallback.generated,0);assert.ok(fallback.rows.every(x=>x.aiComment&&x.commentSource==='Rule-based fallback'));});
const ai=await addPaymentComments(r.rows,true,async input=>({output_text:JSON.stringify({comments:JSON.parse(input.input).map(x=>({id:x.id,comment:'Review: '+x.evidence}))})}));
check('AI comments cover all rows without changing calculations',()=>{assert.equal(ai.generated,47);assert.deepEqual(ai.rows.map(x=>[x.actual,x.expected,x.status]),r.rows.map(x=>[x.actual,x.expected,x.status]));});
const bad=await addPaymentComments(r.rows,true,async()=>({output_text:'not json'}));
check('Malformed AI response retains every evidence comment',()=>assert.ok(bad.rows.every(x=>x.aiComment&&x.commentSource==='Rule-based fallback')));
const partial=await addPaymentComments(r.rows.slice(0,2),true,async()=>({output_text:JSON.stringify({comments:[{id:1,comment:'ok'},{id:1,comment:'duplicate'},{id:999,comment:'wrong row'}]})}));
check('Duplicate and unknown AI ids cannot overwrite comments',()=>assert.equal(partial.generated,0));
fs.writeFileSync('VALIDATION_PAYMENT_SAMPLE_V8_2.json',JSON.stringify({...r,rows:fallback.rows},null,2));
console.log(count+' payment checks passed; AI mocked, no external calls.');
