import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),root=process.cwd(),cache=new Map();
let access={ok:true,status:200,user:{id:'test-user'}},failSave=false,passed=0;
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const resolver=name=>{
  if(name==='@/lib/authorize')return {FINANCE_ROLES:['finance_user'],moduleAuthorization:async()=>access};
  if(name==='@/lib/supabase/admin')return {supabaseAdmin:()=>({from:()=>({insert:()=>({error:failSave?{message:'Test save failure'}:null,select:()=>({single:async()=>({data:failSave?null:{id:'test-run'},error:failSave?{message:'Test save failure'}:null})})})})})};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
  if(name.startsWith('./'))return load(path.join(path.dirname(file),name)+'.ts');
  return require(name);
 };
 new Function('require','module','exports',code)(resolver,module,module.exports);return module.exports;
}
const transaction=load('app/api/reconcile/transaction/route.ts'),exporter=load('app/api/reconcile/export-transaction/route.ts');
const fixture=path.join(root,'reference-samples/validation-10-Sep-2026');
function upload(){const form=new FormData();for(const [key,name] of [['weighment','WeighmentRegister.Xls'],['gateIn','Gate In EntrySVMAAdmin20260911110306AM.xlsx'],['gateOut','Gate Out EntrySVMAAdmin20260911110248AM.xlsx'],['tally','Daybook 10.09.26.xlsx']])form.append(key,new File([fs.readFileSync(path.join(fixture,name))],name));return new Request('http://localhost/api/reconcile/transaction',{method:'POST',body:form});}
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
let result;
await check('Authenticated upload route returns the approved result',async()=>{const response=await transaction.POST(upload());assert.equal(response.status,200);result=await response.json();assert.equal(result.summary.tallyMatched,46);assert.equal(result.svmaCR.length,75);assert.equal(result.nameEvidence.length,205);assert.equal(result.rulesVersion,'8.1');assert.equal(result.runId,'test-run');});
await check('Export route produces all category and evidence sheets',async()=>{const response=await exporter.POST(new Request('http://localhost/api/reconcile/export-transaction',{method:'POST',body:JSON.stringify(result)}));assert.equal(response.status,200);const xlsx=require('xlsx'),wb=xlsx.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'});assert.deepEqual(wb.SheetNames.slice(0,5),['Main','Purchase','Sales','Others','Job Work']);assert.equal(xlsx.utils.sheet_to_json(wb.Sheets.Main).length,75);assert.equal(xlsx.utils.sheet_to_json(wb.Sheets['Name Evidence']).length,205);});
await check('Unauthenticated upload and export remain denied',async()=>{access={ok:false,status:401,user:null};assert.equal((await transaction.POST(upload())).status,401);assert.equal((await exporter.POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status,401);});
await check('Missing Finance permission remains denied',async()=>{access={ok:false,status:403,user:{id:'test-user'}};assert.equal((await transaction.POST(upload())).status,403);});
access={ok:true,status:200,user:{id:'test-user'}};
await check('Incomplete upload is rejected',async()=>assert.equal((await transaction.POST(new Request('http://localhost',{method:'POST',body:new FormData()}))).status,400));
await check('Old reconciliation payload is rejected on export',async()=>assert.equal((await exporter.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({svmaCR:result.svmaCR})}))).status,400));
await check('History save failure still returns results with a visible warning',async()=>{failSave=true;const response=await transaction.POST(upload());assert.equal(response.status,200);const data=await response.json();assert.equal(data.summary.tallyMatched,46);assert.ok(data.warnings.some(w=>w.includes('could not be saved')));});
console.log(`\n${passed} API checks passed (authorization and database mocked; no live service writes).`);
