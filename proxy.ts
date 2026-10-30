import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type CookieToSet = { name:string; value:string; options?:any };
const defaults:Record<string,Set<string>>={
  ceo:new Set(['super_admin','ceo','management']),
  solvent_management:new Set(['super_admin','admin','ceo','management','solvent_head']),
  quality_management:new Set(['super_admin','admin','ceo','management','quality_head']),
  finance_transaction:new Set(['super_admin','admin','ceo','management','finance_user','finance_manager']),
  finance_vendor_payment:new Set(['super_admin','admin','ceo','management','finance_user','finance_manager']),
  input:new Set(['super_admin','admin','solvent_operator','solvent_head','safety_user']),
  quality_input:new Set(['super_admin','admin','quality_operator','quality_head']),
  admin:new Set(['super_admin','admin']),
  hr:new Set(['super_admin','admin','hr_admin'])
};
function defaultAllows(roles:string[],module:string){return roles.some(r=>defaults[module]?.has(r))}
function areaFor(pathname:string){
  if(pathname.startsWith('/hr/my'))return null; // every employee's own HR view — no module gate
  if(pathname.startsWith('/admin/access-requests'))return'access_requests'; // role-gated below, not a module
  if(pathname.startsWith('/ai-credits'))return'ai_credits'; // role-gated below (Management + Super Admin only)
  if(pathname.startsWith('/ceo'))return'ceo';
  if(pathname.startsWith('/quality-input'))return'quality_input';
  if(pathname.startsWith('/quality'))return'quality_management';
  if(pathname.startsWith('/input'))return'input';
  if(pathname.startsWith('/admin'))return'admin';
  if(pathname.startsWith('/hr'))return'hr';
  if(pathname.startsWith('/solvent'))return'solvent_management';
  if(pathname.startsWith('/finance/transaction'))return'finance_transaction';
  if(pathname.startsWith('/finance/amount'))return'finance_vendor_payment';
  if(pathname.startsWith('/finance'))return'finance';
  return null;
}
export async function proxy(req:NextRequest){
 const pathname=req.nextUrl.pathname;
 if(pathname.startsWith('/api')||pathname.startsWith('/_next')||pathname.includes('.'))return NextResponse.next();
 let res=NextResponse.next({request:req});const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)return res;
 const sb=createServerClient(url,key,{cookies:{getAll(){return req.cookies.getAll()},setAll(items:CookieToSet[]){items.forEach(({name,value})=>req.cookies.set(name,value));res=NextResponse.next({request:req});items.forEach(({name,value,options})=>res.cookies.set(name,value,options))}}});
 const {data:{user}}=await sb.auth.getUser();
 if(pathname==='/login'){if(user){const t=req.nextUrl.clone();t.pathname='/';return NextResponse.redirect(t)}return res}
 if(pathname==='/unauthorized')return res;
 if(!user){const t=req.nextUrl.clone();t.pathname='/login';t.search='';return NextResponse.redirect(t)}
 const {data:roleRows}=await sb.from('user_roles').select('role').eq('user_id',user.id);const roles=(roleRows||[]).map((x:any)=>String(x.role));
 let accessRows:any[]=[];try{const {data}=await sb.from('user_module_access').select('module,can_view').eq('user_id',user.id);accessRows=data||[]}catch{}
 const granted=accessRows.filter((x:any)=>x.can_view).map((x:any)=>String(x.module));
 const has=(module:string)=>roles.includes('super_admin')||(accessRows.length?granted.includes(module):defaultAllows(roles,module));
 const operatorRole=roles.some(r=>['solvent_operator','safety_user','quality_operator'].includes(r));
 const privilegedRole=roles.some(r=>['super_admin','admin','ceo','management','solvent_head','quality_head'].includes(r));
 if(operatorRole&&!privilegedRole){
   const {data:active}=await sb.from('shift_sessions').select('id,scope').eq('operator_id',user.id).eq('status','active').limit(1).maybeSingle();
   // Chat stays reachable even while locked to the entry page — an
   // operator mid-shift still needs a way to flag an issue or send a
   // photo to someone, not just silently be cut off from everyone.
   if(active&&!pathname.startsWith('/chat')){const target=active.scope==='quality'?'/quality-input':'/input';if(!pathname.startsWith(target)){const t=req.nextUrl.clone();t.pathname=target;return NextResponse.redirect(t)}}
 }
 const area=areaFor(pathname);
 if(area==='finance'&&!has('finance_transaction')&&!has('finance_vendor_payment')){const t=req.nextUrl.clone();t.pathname='/unauthorized';return NextResponse.redirect(t)}
 else if((area==='access_requests'||area==='ai_credits')&&!roles.some(r=>['super_admin','management'].includes(r))){const t=req.nextUrl.clone();t.pathname='/unauthorized';return NextResponse.redirect(t)}
 else if(area&&area!=='finance'&&area!=='access_requests'&&area!=='ai_credits'&&!has(area)){const t=req.nextUrl.clone();t.pathname='/unauthorized';return NextResponse.redirect(t)}
 return res;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|svma-logo.png|sw.js).*)']};
