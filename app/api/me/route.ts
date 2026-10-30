import {NextResponse} from 'next/server';
import {supabaseServer} from '@/lib/supabase/server';
import {createClient} from '@supabase/supabase-js';
import {errorMessage,logServerError} from '@/lib/errors';

const roleDefaults:Record<string,string[]>={
 super_admin:['ceo','solvent_management','finance_transaction','finance_vendor_payment','input','quality_input','quality_management','admin','hr','assets','import','export','operations_intelligence'],
 admin:['solvent_management','finance_transaction','finance_vendor_payment','input','quality_input','quality_management','hr','admin','assets','import','export','operations_intelligence'],
 ceo:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],
 management:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],
 finance_user:['finance_transaction','finance_vendor_payment'],finance_manager:['finance_transaction','finance_vendor_payment'],
 solvent_head:['solvent_management','input'],solvent_operator:['input'],safety_user:['input'],
 quality_head:['quality_management','quality_input'],quality_operator:['quality_input'],
 hr_admin:['hr','assets'],
 import_operator:['import'],import_manager:['import'],
 export_operator:['export'],export_manager:['export'],
 ops_operator:['operations_intelligence'],
 viewer:[]
};

function adminOrUserClient(userClient:any){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(url&&service){
  try{return createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})}catch{}
 }
 // Read-only session/bootstrap should still work without the service-role key.
 return userClient;
}

export async function GET(){
 try{
  const sb=await supabaseServer();
  const {data:{user},error:userError}=await sb.auth.getUser();
  if(userError)return NextResponse.json({error:userError.message},{status:401});
  if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const db=adminOrUserClient(sb);
  // Chat online/offline presence rides on this poll — every logged-in
  // user's AppShell already calls this every 20s, so a dedicated heartbeat
  // endpoint would just be a second poll doing the same job. Fire-and-forget:
  // never let a presence write failure affect the session response itself.
  db.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',user.id).then(()=>{},()=>{});

  const [rolesRes,profileRes]=await Promise.all([
   db.from('user_roles').select('role').eq('user_id',user.id),
   db.from('profiles').select('*').eq('id',user.id).maybeSingle()
  ]);
  // If the service client is unavailable and RLS blocks a table, try the authenticated client explicitly.
  let rolesRows:any[]=rolesRes.data||[];
  let profile:any=profileRes.data||null;
  if(rolesRes.error){const r=await sb.from('user_roles').select('role').eq('user_id',user.id);rolesRows=r.data||[]}
  if(profileRes.error){const r=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();profile=r.data||null}

  const roles=rolesRows.map((x:any)=>String(x.role));

  // This route is polled every 20s by every logged-in user AND refetched on
  // every single page navigation (see AppShell) — it's the single most
  // frequently hit endpoint in the app. The block below used to run each of
  // these independent lookups one at a time with its own await, so a single
  // call paid for ~7 sequential round trips before responding; none of them
  // depend on each other (or on anything but user.id/roles, both already
  // resolved above), so they now run concurrently. Same per-lookup
  // try/catch-and-default-to-empty behavior as before, just in parallel.
  const [explicit,activeShift,chatUnread,pendingApprovalsCount,pendingLeaveApprovalsCount,pendingAccessRequestsCount,unreadAnnouncementCount]=await Promise.all([
   (async()=>{
    try{
     const r=await db.from('user_module_access').select('module,can_view').eq('user_id',user.id);
     if(!r.error)return r.data||[];
     const fallback=await sb.from('user_module_access').select('module,can_view').eq('user_id',user.id);
     return fallback.error?[]:fallback.data||[];
    }catch{return []}
   })(),
   (async()=>{
    try{
     const r=await db.from('shift_sessions').select('*,shift_master(*)').eq('operator_id',user.id).in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle();
     return r.error?null:r.data||null;
    }catch{return null}
   })(),
   // Nav dock badge (Chat unread). Kept as two small, bounded queries rather
   // than the per-conversation N+1 pattern /api/chat/conversations uses,
   // since this route is polled far more often.
   (async()=>{
    try{
     const {data:memberships}=await db.from('chat_conversation_members').select('conversation_id,last_read_at').eq('user_id',user.id);
     const convIds=(memberships||[]).map((m:any)=>m.conversation_id);
     if(!convIds.length)return 0;
     const readMap=new Map((memberships||[]).map((m:any)=>[m.conversation_id,m.last_read_at]));
     const {data:recent}=await db.from('chat_messages').select('conversation_id,created_at,sender_id').in('conversation_id',convIds).neq('sender_id',user.id).order('created_at',{ascending:false}).limit(500);
     const unreadConvIds=new Set<string>();
     for(const m of recent||[]){const lastRead=readMap.get(m.conversation_id);if(!lastRead||m.created_at>lastRead)unreadConvIds.add(m.conversation_id)}
     return unreadConvIds.size;
    }catch{return 0}
   })(),
   (async()=>{
    try{
     const {count}=await db.from('approval_requests').select('id',{count:'exact',head:true}).eq('approver_id',user.id).eq('status','pending');
     return count||0;
    }catch{return 0}
   })(),
   // "My HR" badge: leave requests waiting on THIS person's decision — not
   // gated to hr_admin/admin, since the approver is whoever the requester's
   // own supervisor_id points to (any Solvent/Quality Head approving their
   // own reports' leave, for instance).
   (async()=>{
    try{
     const {count}=await db.from('leave_requests').select('id',{count:'exact',head:true}).eq('approver_id',user.id).eq('status','pending');
     return count||0;
    }catch{return 0}
   })(),
   // Module-access approvals — only meaningful for management/super_admin
   // (the only roles that can decide these), zero for everyone else.
   (async()=>{
    if(!roles.includes('management')&&!roles.includes('super_admin'))return 0;
    try{
     const {count}=await db.from('module_access_requests').select('id',{count:'exact',head:true}).eq('status','pending');
     return count||0;
    }catch{return 0}
   })(),
   (async()=>{
    try{
     const [{data:active},{data:reads}]=await Promise.all([
      db.from('announcements').select('id').eq('active',true),
      db.from('announcement_reads').select('announcement_id').eq('user_id',user.id),
     ]);
     const readIds=new Set((reads||[]).map((r:any)=>r.announcement_id));
     return (active||[]).filter((a:any)=>!readIds.has(a.id)).length;
    }catch{return 0}
   })(),
  ]);
  const unreadChatCount=chatUnread;

  const modules0=roles.includes('super_admin')
   ? roleDefaults.super_admin
   : (explicit.length
      ? explicit.filter((x:any)=>x.can_view).map((x:any)=>String(x.module))
      : Array.from(new Set(roles.flatMap(r=>roleDefaults[r]||[]))));

  // Tickets module: shown to anyone named in the plant-area routing (sql/077) and to the heads / top management who see every ticket.
  let ticketsAccess=roles.some(r=>['super_admin','admin','ceo','management','solvent_head','quality_head'].includes(r));
  if(!ticketsAccess){try{const {count}=await db.from('ticket_route_people').select('user_id',{count:'exact',head:true}).eq('user_id',user.id);ticketsAccess=(count||0)>0}catch{}}
  const modules=ticketsAccess&&!modules0.includes('tickets')?[...modules0,'tickets']:modules0;

  const operatorRole=roles.some(r=>['solvent_operator','safety_user','quality_operator'].includes(r));
  const privileged=roles.some(r=>['super_admin','admin','ceo','management','solvent_head','quality_head'].includes(r));
  const lockApplies=!!activeShift&&operatorRole&&!privileged;

  return NextResponse.json({user:{id:user.id,email:user.email},mustChangePassword:user.user_metadata?.must_change_password===true,profile,roles,modules,activeShift,lockApplies,unreadChatCount,pendingApprovalsCount,pendingLeaveApprovalsCount,pendingAccessRequestsCount,unreadAnnouncementCount});
 }catch(e){logServerError('me',e);
  return NextResponse.json({error:errorMessage(e,'Unable to load session')},{status:500});
 }
}
