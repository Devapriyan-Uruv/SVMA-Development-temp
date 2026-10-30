import fs from 'node:fs';import assert from 'node:assert/strict';import ts from 'typescript';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
let access={ok:true,status:200,user:{id:'operator'},roles:['solvent_operator']},param,session,locked=false;
function reset(){param={id:1,name:'Water level',target_text:'80',input_type:'number',parameter_sections:{module:'solvent',name:'Cooling Pond'}};session={id:'shift',scope:'solvent',status:'active',operator_id:'operator',active_products:['RB']};locked=false}
function load(file){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>{
if(n==='@/lib/authorize')return {moduleAuthorization:async()=>access,INPUT_ROLES:[],QUALITY_INPUT_ROLES:[]};
if(n==='@/lib/supabase/admin')return {supabaseAdmin:()=>({from:table=>{const q={then(resolve){return Promise.resolve({data:table==='parameter_master'?param:table==='shift_sessions'?session:table==='parameter_entries'?(locked?[]:[{id:'entry'}]):[],error:null}).then(resolve)}};for(const k of ['select','eq','upsert','insert','update','in','is','order','limit','single','maybeSingle'])q[k]=()=>q;return q}})};
if(n.startsWith('@/'))return load(n.slice(2)+'.ts');return require(n)},m,m.exports);return m.exports}
const api=load('app/api/entries/route.ts');let passed=0;const req=(b={})=>new Request('http://localhost',{method:'POST',body:JSON.stringify({scope:'solvent',productCode:'RB',shiftSessionId:'shift',parameterId:1,value:80,...b})});
async function test(name,f){reset();await f();passed++;console.log('PASS '+name)}
await test('Valid normal reading returns confirmed entry',async()=>{const r=await api.POST(req());assert.equal(r.status,200);assert.equal((await r.json()).validation,'normal')});
await test('Missing Solvent target saves without pass judgement',async()=>{param.target_text='';const r=await api.POST(req());assert.equal(r.status,200);assert.equal((await r.json()).validation,'unconfigured')});
await test('Quality missing target remains protected',async()=>{param.target_text='';param.parameter_sections.module='quality';session.scope='quality';assert.equal((await api.POST(req({scope:'quality'}))).status,422)});
await test('Empty reading rejected',async()=>assert.equal((await api.POST(req({value:''}))).status,400));
await test('Non-numeric reading rejected',async()=>assert.equal((await api.POST(req({value:'invalid'}))).status,400));
await test('Closed shift cannot receive new entries',async()=>{session.status='completed';assert.equal((await api.POST(req())).status,409)});
await test('Another operator cannot write the shift',async()=>{session.operator_id='other';assert.equal((await api.POST(req())).status,403)});
await test('Duplicate remains locked',async()=>{locked=true;assert.equal((await api.POST(req())).status,409)});
console.log(passed+' entry API checks passed; database mocked.');
