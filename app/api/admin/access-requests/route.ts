import {NextRequest,NextResponse} from 'next/server';
import {authorization,ACCESS_APPROVAL_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {sendPushToUser} from '@/lib/push';
import {errorMessage,logServerError} from '@/lib/errors';

export async function GET(){try{
 const az=await authorization(ACCESS_APPROVAL_ROLES);if(!az.ok)return NextResponse.json({error:'Management or Super Admin access is required'},{status:az.status});
 const db=supabaseAdmin();
 const [{data:pending,error},{data:recent}]=await Promise.all([
  db.from('module_access_requests').select('*,profiles!module_access_requests_user_id_fkey(full_name,email),requester:profiles!module_access_requests_requested_by_fkey(full_name,email)').eq('status','pending').order('created_at',{ascending:true}),
  db.from('module_access_requests').select('*,profiles!module_access_requests_user_id_fkey(full_name,email),requester:profiles!module_access_requests_requested_by_fkey(full_name,email),approver:profiles!module_access_requests_decided_by_fkey(full_name,email)').neq('status','pending').order('decided_at',{ascending:false}).limit(100),
 ]);
 if(error)throw error;
 return NextResponse.json({pending:pending||[],recent:recent||[]});
}catch(e){logServerError('admin/access-requests',e);return NextResponse.json({error:errorMessage(e,'Unable to load access requests')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const az=await authorization(ACCESS_APPROVAL_ROLES);if(!az.ok)return NextResponse.json({error:'Management or Super Admin access is required'},{status:az.status});
 const b=await req.json(),id=String(b.id||''),decision=String(b.decision||''),comment=String(b.comment||'').trim();
 if(!id||!['approved','rejected'].includes(decision))return NextResponse.json({error:'Invalid request.'},{status:400});
 const db=supabaseAdmin();
 const {data:reqRow,error:ge}=await db.from('module_access_requests').select('*').eq('id',id).single();if(ge)throw ge;
 if(reqRow.status!=='pending')return NextResponse.json({error:'This request has already been decided.'},{status:409});
 // Approve applies exactly what was requested; reject restores exactly
 // what it was before the request — never a guess, since both were
 // captured at request time.
 const apply=decision==='approved'
  ?{can_view:reqRow.requested_view,can_edit:reqRow.requested_edit,can_delete:reqRow.requested_delete}
  :{can_view:reqRow.previous_view,can_edit:reqRow.previous_edit,can_delete:reqRow.previous_delete};
 const {error:ue}=await db.from('user_module_access').upsert({user_id:reqRow.user_id,module:reqRow.module,...apply,updated_at:new Date().toISOString()},{onConflict:'user_id,module'});
 if(ue)throw ue;
 const {error:re}=await db.from('module_access_requests').update({status:decision,decided_by:az.user!.id,decided_at:new Date().toISOString(),decision_comment:comment||null}).eq('id',id);
 if(re)throw re;
 try{
  const title=`Access request ${decision}`,body=`${reqRow.module.replaceAll('_',' ')} access was ${decision}.${comment?` ${comment}`:''}`,severity=decision==='rejected'?'warning':'info';
  await db.from('notifications').insert({user_id:reqRow.requested_by,event_type:'access_decided',title,body,severity,entity_type:'module_access_request',entity_id:id,push_sent_at:new Date().toISOString()});
  await sendPushToUser(db,reqRow.requested_by,{title,body,severity,tag:'access_decided',url:'/admin'});
 }catch{}
 return NextResponse.json({ok:true});
}catch(e){logServerError('admin/access-requests',e);return NextResponse.json({error:errorMessage(e,'Unable to update access request')},{status:500})}}
