import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

const SELECT='id,title,description,status,decision_comment,decided_at,created_at,requested_by,approver_id,attachment_path,attachment_name,attachment_mime,requester:profiles!approval_requests_requested_by_fkey(full_name,email),approver:profiles!approval_requests_approver_id_fkey(full_name,email)';

async function shape(db:ReturnType<typeof supabaseAdmin>,r:any){
 let attachmentUrl:string|null=null;
 if(r.attachment_path){try{const {data}=await db.storage.from('svma-approval-files').createSignedUrl(r.attachment_path,3600);attachmentUrl=data?.signedUrl||null}catch{}}
 return{id:r.id,title:r.title,description:r.description,status:r.status,decisionComment:r.decision_comment,decidedAt:r.decided_at,createdAt:r.created_at,requestedBy:r.requested_by,approverId:r.approver_id,requesterName:r.requester?.full_name||r.requester?.email||'Unknown',approverName:r.approver?.full_name||r.approver?.email||'Unknown',attachmentUrl,attachmentName:r.attachment_name,attachmentMime:r.attachment_mime};
}

export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data:roleRows}=await db.from('user_roles').select('role').eq('user_id',user.id);
 const isSuperAdmin=(roleRows||[]).some((r:any)=>r.role==='super_admin');
 const [mineRes,pendingRes,allRes]=await Promise.all([
  db.from('approval_requests').select(SELECT).eq('requested_by',user.id).order('created_at',{ascending:false}).limit(200),
  db.from('approval_requests').select(SELECT).eq('approver_id',user.id).order('created_at',{ascending:false}).limit(200),
  isSuperAdmin?db.from('approval_requests').select(SELECT).order('created_at',{ascending:false}).limit(300):Promise.resolve({data:null,error:null}),
 ]);
 if(mineRes.error)throw mineRes.error;if(pendingRes.error)throw pendingRes.error;if((allRes as any).error)throw (allRes as any).error;
 const [mine,pendingMyApproval,all]=await Promise.all([
  Promise.all((mineRes.data||[]).map(r=>shape(db,r))),
  Promise.all((pendingRes.data||[]).filter((r:any)=>r.status==='pending').map(r=>shape(db,r))),
  isSuperAdmin?Promise.all((allRes.data||[]).map(r=>shape(db,r))):Promise.resolve(null),
 ]);
 return NextResponse.json({mine,pendingMyApproval,all});
}catch(e){logServerError('approvals',e);return NextResponse.json({error:errorMessage(e,'Unable to load approvals')},{status:500})}}

// Section: the attachment is deliberately optional everywhere — a request
// with no evidence is just as valid as one with a photo/file, matching
// "just give an option ... but just optional".
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const fd=await req.formData(),title=String(fd.get('title')||'').trim(),description=String(fd.get('description')||'').trim(),approverId=String(fd.get('approverId')||''),file=fd.get('file');
 if(!title)return NextResponse.json({error:'Title is required.'},{status:400});
 if(!approverId)return NextResponse.json({error:'Choose who should approve this.'},{status:400});
 if(approverId===user.id)return NextResponse.json({error:'You cannot approve your own request.'},{status:400});
 const db=supabaseAdmin();
 const {data:approver}=await db.from('profiles').select('id').eq('id',approverId).maybeSingle();
 if(!approver)return NextResponse.json({error:'Selected approver was not found.'},{status:400});
 let attachment_path:string|null=null,attachment_name:string|null=null,attachment_mime:string|null=null;
 if(file instanceof File&&file.size>0){
  if(file.size>15*1024*1024)return NextResponse.json({error:'Attachment exceeds 15 MB.'},{status:400});
  const safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_');attachment_path=`${user.id}/${Date.now()}-${safe}`;
  const {error:up}=await db.storage.from('svma-approval-files').upload(attachment_path,Buffer.from(await file.arrayBuffer()),{contentType:file.type||'application/octet-stream',upsert:false});if(up)throw up;
  attachment_name=file.name;attachment_mime=file.type||null;
 }
 const {data,error}=await db.from('approval_requests').insert({title,description:description||null,requested_by:user.id,approver_id:approverId,status:'pending',attachment_path,attachment_name,attachment_mime}).select(SELECT).single();if(error)throw error;
 try{await db.from('notifications').insert({user_id:approverId,event_type:'approval_request',title:'New approval request',body:title,severity:'info',entity_type:'approval_request',entity_id:data.id,push_sent_at:new Date().toISOString()});await sendPushToUser(db,approverId,{title:'New approval request',body:title,severity:'info',tag:'approval_request',url:'/approvals'})}catch{}
 return NextResponse.json({request:await shape(db,data)});
}catch(e){logServerError('approvals',e);return NextResponse.json({error:errorMessage(e,'Unable to create request')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json(),id=String(b.id||''),decision=String(b.decision||''),comment=String(b.comment||'').trim();
 if(!id||!['approved','rejected'].includes(decision))return NextResponse.json({error:'Invalid request.'},{status:400});
 const db=supabaseAdmin();
 const {data:existing,error:ge}=await db.from('approval_requests').select('id,approver_id,requested_by,status,title').eq('id',id).single();if(ge)throw ge;
 const {data:roleRows}=await db.from('user_roles').select('role').eq('user_id',user.id);
 const isSuperAdmin=(roleRows||[]).some((r:any)=>r.role==='super_admin');
 if(existing.approver_id!==user.id&&!isSuperAdmin)return NextResponse.json({error:'Only the assigned approver can decide this request.'},{status:403});
 if(existing.status!=='pending')return NextResponse.json({error:'This request has already been decided.'},{status:409});
 const {data,error}=await db.from('approval_requests').update({status:decision,decision_comment:comment||null,decided_at:new Date().toISOString()}).eq('id',id).select(SELECT).single();if(error)throw error;
 try{const title=`Request ${decision}`,severity=decision==='rejected'?'warning':'info';await db.from('notifications').insert({user_id:existing.requested_by,event_type:'approval_decided',title,body:existing.title,severity,entity_type:'approval_request',entity_id:id,push_sent_at:new Date().toISOString()});await sendPushToUser(db,existing.requested_by,{title,body:existing.title,severity,tag:'approval_decided',url:'/approvals'})}catch{}
 return NextResponse.json({request:await shape(db,data)});
}catch(e){logServerError('approvals',e);return NextResponse.json({error:errorMessage(e,'Unable to update request')},{status:500})}}
