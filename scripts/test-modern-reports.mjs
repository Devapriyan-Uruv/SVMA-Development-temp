import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);let access={ok:true,status:200},calls=[],records=[],passed=0;
function load(file){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>{
 if(n==='@/lib/authorize')return {FINANCE_ROLES:[],SOLVENT_MANAGEMENT_ROLES:[],QUALITY_MANAGEMENT_ROLES:[],moduleAuthorization:async m=>{calls.push(['auth',m]);return access}};
 if(n==='@/lib/supabase/admin')return {supabaseAdmin:()=>({from:table=>{calls.push(['from',table]);const q={then(resolve){return Promise.resolve({data:records,error:null}).then(resolve)}};for(const method of ['select','eq','order','range','in'])q[method]=(...args)=>{calls.push([method,...args]);return q};q.maybeSingle=async()=>({data:records[0]||null,error:null});return q}})};
 if(n==='@/lib/errors')return {errorMessage:(e,fallback)=>(e instanceof Error?e.message:(e&&typeof e==='object'&&e.message))||fallback,logServerError:()=>{}};
 return require(n);
 },m,m.exports);return m.exports}
const history=load('app/api/reconcile/history/route.ts'),shifts=load('app/api/shift/history/route.ts'),{NextRequest}=require('next/server');
const request=s=>new NextRequest('http://localhost'+s);
async function test(name,fn){calls=[];records=[];access={ok:true,status:200};await fn();console.log('PASS '+name);passed++}
await test('Reconciliation filters by exact date and module',async()=>{await history.GET(request('/?date=2026-09-10&type=vendor_payment'));assert.ok(calls.some(x=>x[0]==='auth'&&x[1]==='finance_vendor_payment'));assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='reconciliation_date'&&x[2]==='2026-09-10'))});
await test('Private report detail requires module permission',async()=>{access={ok:false,status:403};assert.equal((await history.GET(request('/?id=other&type=vendor_payment'))).status,403);assert.ok(!calls.some(x=>x[0]==='from'))});
await test('Saved report details returned unchanged',async()=>{const report={rulesVersion:'8.2',vendorPayments:[{paymentVoucher:'06733',actual:902304}]};records=[{summary:{downloadReport:report}}];assert.deepEqual(await (await history.GET(request('/?id=one&type=vendor_payment'))).json(),report)});
await test('Older report never fabricates a download',async()=>{records=[{summary:{}}];assert.equal((await history.GET(request('/?id=old'))).status,404)});
await test('History list excludes full financial details and paginates',async()=>{records=Array.from({length:51},(_,i)=>({id:String(i),summary:{downloadReport:{secret:'details'}}}));const j=await(await history.GET(request('/?page=2'))).json();assert.equal(j.runs.length,50);assert.equal(j.hasMore,true);assert.ok(!('summary' in j.runs[0]));assert.deepEqual(calls.find(x=>x[0]==='range'),['range',100,150])});
await test('Shift report date is filtered before pagination',async()=>{await shifts.GET(request('/?scope=quality&date=2026-09-10'));assert.ok(calls.some(x=>x[0]==='auth'&&x[1]==='quality_management'));assert.ok(calls.findIndex(x=>x[0]==='eq'&&x[1]==='operational_date')<calls.findIndex(x=>x[0]==='range'))});
await test('Shift history access enforced',async()=>{access={ok:false,status:401};assert.equal((await shifts.GET(request('/?scope=solvent'))).status,401)});
await test('Invalid date input rejected',async()=>{assert.equal((await shifts.GET(request('/?date=bad'))).status,400);assert.equal((await history.GET(request('/?date=bad'))).status,400)});
console.log(`${passed} report checks passed; database and authorization mocked.`);
