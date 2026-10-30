import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {aix3Complete,aix3Enabled} from '@/lib/aix3/provider';
import {getPeriodOperationsSummary,getOpenExceptions} from '@/lib/aix3/tools';
import {errorMessage,logServerError} from '@/lib/errors';

async function opsFacts(dateRange?:{from?:string;to?:string}){
 const to=dateRange?.to||new Date().toISOString().slice(0,10);
 const from=dateRange?.from||to;
 const [summary,exceptions]=await Promise.all([getPeriodOperationsSummary(from,to),getOpenExceptions({from,to})]);
 if(!summary)return {hasData:false,from,to};
 return {hasData:true,from,to,feedingTotalMt:summary.feedingTotalMt,productionTotalMt:summary.productionTotalMt,stockClosingValue:summary.stockClosingValue,openExceptions:summary.openExceptions,criticalExceptions:summary.criticalExceptions,openTickets:summary.openTickets,productionStockVarianceMt:summary.productionStockVarianceMt,exceptionDetails:exceptions.slice(0,15).map((e:any)=>({type:e.exception_type,severity:e.severity,date:e.report_date,description:e.description}))};
}

// Section: role-scoping mirrors AppShell's own `can()` — a solvent-only
// user's facts payload never even contains quality/finance numbers, so
// there is no way for the AI step to leak them even if asked to.
async function moduleSet(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data:roleRows}=await db.from('user_roles').select('role').eq('user_id',userId);
 const roles=(roleRows||[]).map((r:any)=>String(r.role));
 if(roles.includes('super_admin'))return{roles,modules:new Set(['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','input','quality_input','admin','operations_intelligence'])};
 const {data:access}=await db.from('user_module_access').select('module,can_view').eq('user_id',userId);
 return{roles,modules:new Set((access||[]).filter((a:any)=>a.can_view).map((a:any)=>String(a.module)))};
}

async function solventFacts(db:ReturnType<typeof supabaseAdmin>){
 const [{data:liveShift},{data:devs},{data:tickets}]=await Promise.all([
  db.from('shift_sessions').select('id,shift_master(name),active_products').eq('scope','solvent').eq('status','active').limit(1).maybeSingle(),
  db.from('deviations').select('id,severity,status,parameter_master(parameter_sections(module))').order('created_at',{ascending:false}).limit(400),
  db.from('deviation_tickets').select('id,status,deviation_id').order('created_at',{ascending:false}).limit(400),
 ]);
 const solventDevs=(devs||[]).filter((d:any)=>['solvent','boiler'].includes(String(d.parameter_master?.parameter_sections?.module)));
 const open=solventDevs.filter((d:any)=>!['resolved','closed'].includes(d.status));
 const devIds=new Set(solventDevs.map((d:any)=>d.id));
 const openTickets=(tickets||[]).filter((t:any)=>devIds.has(t.deviation_id)&&!['resolved','closed'].includes(t.status));
 return{liveShiftActive:!!liveShift,liveShiftName:(liveShift as any)?.shift_master?.name||null,liveProducts:liveShift?.active_products||[],openDeviations:open.length,criticalDeviations:open.filter((d:any)=>d.severity==='critical').length,warningDeviations:open.filter((d:any)=>d.severity==='warning').length,openTickets:openTickets.length};
}
async function qualityFacts(db:ReturnType<typeof supabaseAdmin>){
 const [{data:liveShift},{data:devs},{data:tickets}]=await Promise.all([
  db.from('shift_sessions').select('id,shift_master(name),active_products').eq('scope','quality').eq('status','active').limit(1).maybeSingle(),
  db.from('deviations').select('id,severity,status,parameter_master(parameter_sections(module))').order('created_at',{ascending:false}).limit(400),
  db.from('deviation_tickets').select('id,status,deviation_id').order('created_at',{ascending:false}).limit(400),
 ]);
 const qualDevs=(devs||[]).filter((d:any)=>String(d.parameter_master?.parameter_sections?.module)==='quality');
 const open=qualDevs.filter((d:any)=>!['resolved','closed'].includes(d.status));
 const devIds=new Set(qualDevs.map((d:any)=>d.id));
 const openTickets=(tickets||[]).filter((t:any)=>devIds.has(t.deviation_id)&&!['resolved','closed'].includes(t.status));
 return{liveShiftActive:!!liveShift,liveShiftName:(liveShift as any)?.shift_master?.name||null,liveProducts:liveShift?.active_products||[],openDeviations:open.length,criticalDeviations:open.filter((d:any)=>d.severity==='critical').length,warningDeviations:open.filter((d:any)=>d.severity==='warning').length,openTickets:openTickets.length};
}
async function financeFacts(db:ReturnType<typeof supabaseAdmin>){
 const {count:openExceptions}=await db.from('reconciliation_exceptions').select('id',{count:'exact',head:true}).eq('status','open');
 return{openExceptions:openExceptions||0};
}
// Unconditional (no module gate) — company policy applies to every
// employee regardless of what operational data they can see. Content is
// truncated per-doc and capped in count to keep the prompt a reasonable size.
async function companyPolicyFacts(db:ReturnType<typeof supabaseAdmin>){
 const {data}=await db.from('company_documents').select('title,category,content').eq('active',true).order('created_at',{ascending:false}).limit(30);
 return (data||[]).map((d:any)=>({title:d.title,category:d.category,excerpt:String(d.content||'').slice(0,1200)}));
}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json(),question=String(b.question||'').trim();
 if(!question)return NextResponse.json({error:'Ask a question first.'},{status:400});
 // Respects the caller's active period filter (e.g. sent from a page that
 // has one) — defaults to today inside opsFacts() when absent.
 const dateRange=b.from||b.to?{from:b.from?String(b.from):undefined,to:b.to?String(b.to):undefined}:undefined;
 const db=supabaseAdmin();
 const {roles,modules}=await moduleSet(db,user.id);
 const canSolvent=modules.has('solvent_management')||modules.has('input')||modules.has('ceo');
 const canQuality=modules.has('quality_management')||modules.has('quality_input')||modules.has('ceo');
 const canFinance=modules.has('finance_transaction')||modules.has('finance_vendor_payment')||modules.has('ceo');
 const canOps=modules.has('operations_intelligence')||modules.has('ceo');

 const facts:any={role:roles[0]||'user'};
 const jobs:Promise<void>[]=[];
 if(canSolvent)jobs.push(solventFacts(db).then(f=>{facts.solvent=f}));
 if(canQuality)jobs.push(qualityFacts(db).then(f=>{facts.quality=f}));
 if(canFinance)jobs.push(financeFacts(db).then(f=>{facts.finance=f}));
 if(canOps)jobs.push(opsFacts(dateRange).then(f=>{facts.ops=f}));
 jobs.push(companyPolicyFacts(db).then(f=>{facts.companyPolicies=f}));
 jobs.push((async()=>{
  const [{data:pendingRows},{data:notifRows}]=await Promise.all([
   db.from('approval_requests').select('id,status').eq('approver_id',user.id).eq('status','pending'),
   db.from('notifications').select('id').eq('user_id',user.id).is('read_at',null),
  ]);
  facts.approvals={pendingMyApproval:(pendingRows||[]).length};
  facts.unreadNotifications=(notifRows||[]).length;
 })());
 await Promise.all(jobs);

 const fallback=deterministicAnswer(question,facts);
 if(!aix3Enabled())return NextResponse.json({answer:fallback,facts});
 try{
  const instructions='You are AIX3, the plant intelligence assistant embedded in SVMA Operations Intelligence. Answer the user\'s question in 2-4 short sentences using ONLY the facts JSON below — never invent a number, name, or event that is not present in it. If a fact the question needs is missing (e.g. they asked about Quality but the "quality" key is absent because they don\'t have access), say plainly that they don\'t have visibility into that area rather than guessing. If the "ops" facts carry a from/to date range, answer scoped to that range, not "today". You may also answer questions about company policy, holidays, or HR documents using the companyPolicies facts if present. Be direct and actionable, no preamble. Never mention which AI model or provider powers you.';
  const answer=await aix3Complete({feature:'AIX3 Assistant',instructions,input:`Facts: ${JSON.stringify(facts)}. Question: "${question}"`,timeout:20000,maxRetries:1});
  return NextResponse.json({answer:answer||fallback,facts});
 }catch{return NextResponse.json({answer:fallback,facts})}
}catch(e){logServerError('assistant',e);return NextResponse.json({error:errorMessage(e,'Unable to answer right now')},{status:500})}}

// A readable answer without the model — used when OpenAI is not configured
// or fails, so the bubble always says something useful.
function deterministicAnswer(question:string,facts:any):string{
 const q=question.toLowerCase();
 const parts:string[]=[];
 if(q.includes('approval'))return facts.approvals.pendingMyApproval?`You have ${facts.approvals.pendingMyApproval} approval request${facts.approvals.pendingMyApproval===1?'':'s'} waiting on you.`:'No approval requests are waiting on you right now.';
 if(q.includes('polic')||q.includes('holiday')){
  const docs:{title:string;category:string|null;excerpt:string}[]=facts.companyPolicies||[];
  const match=docs.find(d=>q.includes(String(d.title).toLowerCase()))||docs.find(d=>d.category&&q.includes(String(d.category).toLowerCase()))||docs[0];
  if(match)return `${match.title}: ${match.excerpt.slice(0,300)}${match.excerpt.length>300?'…':''}`;
  return 'No company policy documents are available yet — ask HR to add one.';
 }
 if(facts.solvent)parts.push(`Solvent: ${facts.solvent.openDeviations} open deviation(s) (${facts.solvent.criticalDeviations} critical, ${facts.solvent.warningDeviations} warning), ${facts.solvent.openTickets} open ticket(s).${facts.solvent.liveShiftActive?` Live shift: ${facts.solvent.liveShiftName}.`:' No live shift.'}`);
 if(facts.quality)parts.push(`Quality: ${facts.quality.openDeviations} open deviation(s) (${facts.quality.criticalDeviations} critical, ${facts.quality.warningDeviations} warning), ${facts.quality.openTickets} open ticket(s).${facts.quality.liveShiftActive?` Live shift: ${facts.quality.liveShiftName}.`:' No live shift.'}`);
 if(facts.finance)parts.push(`Finance: ${facts.finance.openExceptions} open reconciliation exception(s).`);
 if(facts.ops)parts.push(facts.ops.hasData?`Operations (${facts.ops.from} to ${facts.ops.to}): production ${Number(facts.ops.productionTotalMt||0).toFixed(1)} MT, ${facts.ops.openExceptions} open exception(s) (${facts.ops.criticalExceptions} critical), ${facts.ops.openTickets} open ticket(s).`:'Operations: no operations data has been uploaded for this period yet.');
 parts.push(`Approvals waiting on you: ${facts.approvals.pendingMyApproval}.`);
 return parts.join(' ')||'No data is available for your access level yet.';
}
