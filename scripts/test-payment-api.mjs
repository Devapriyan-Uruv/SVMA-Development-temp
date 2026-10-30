import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();let access={ok:true,status:200},passed=0;
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const m={exports:{}};cache.set(file,m);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>{
  if(n==='@/lib/authorize')return {FINANCE_ROLES:[],moduleAuthorization:async()=>access};
  if(n==='@/lib/auth')return {currentUser:async()=>({id:'test'})};
  if(n==='@/lib/supabase/admin')return {supabaseAdmin:()=>{throw new Error('Mock database unavailable')}};
  if(n==='@/lib/paymentComments')return {addPaymentComments:async rows=>({rows:rows.map(r=>({...r,aiComment:r.comment,commentSource:'Rule-based fallback'})),generated:0,warning:'Test fallback'})};
  if(n.startsWith('@/'))return load(n.slice(2)+'.ts');
  if(n.startsWith('./'))return load(path.join(path.dirname(file),n)+'.ts');
  return require(n);
 },m,m.exports);return m.exports;
}
const api=load('app/api/reconcile/amount/route.ts'),exp=load('app/api/reconcile/export-amount/route.ts');
function upload(empty=false){const f=new FormData();if(!empty)for(const [key,name] of [['tally','Daybook 10.09.26.xlsx'],['creditDebit','Credit_Debit Note ListSVMAAdmin20260911010244PM.xlsx']])f.append(key,new File([fs.readFileSync('reference-samples/validation-10-Sep-2026/'+name)],name));return new Request('http://localhost',{method:'POST',body:f});}
async function check(s,f){await f();passed++;console.log('PASS '+s);}
let data;
await check('Payment upload returns all lines and visible history/AI warnings',async()=>{const r=await api.POST(upload());assert.equal(r.status,200);data=await r.json();assert.equal(data.rulesVersion,'8.2');assert.equal(data.vendorPayments.length,47);assert.equal(data.summary.formulaMatches,9);assert.ok(data.warnings.length>=2);});
await check('Excel includes every comment, separate AI comparisons and names',async()=>{const r=await exp.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify(data)}));assert.equal(r.status,200);const X=require('xlsx'),bytes=Buffer.from(await r.arrayBuffer()),w=X.read(bytes,{type:'buffer'}),all=X.utils.sheet_to_json(w.Sheets['ALL TRANSACTIONS']);assert.equal(all.length,47);assert.ok(all.every(x=>x['Transaction Comment']&&x['Rule Evidence']));assert.equal(X.utils.sheet_to_json(w.Sheets['AI DIFFERENCES']).length,3);assert.ok(w.Sheets['NAME EVIDENCE']);assert.equal(all[0]['Credit Row'],312);assert.equal(all[0]['Payment Voucher'],'06729');});
await check('Outdated export payload rejected',async()=>assert.equal((await exp.POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status,400));
await check('Missing upload rejected',async()=>assert.equal((await api.POST(upload(true))).status,400));
await check('Finance authorization enforced',async()=>{access={ok:false,status:403};assert.equal((await api.POST(upload())).status,403);assert.equal((await exp.POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status,403);});
console.log(passed+' payment API checks passed; external services mocked.');
