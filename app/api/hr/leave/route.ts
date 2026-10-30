import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}
const SELECT='id,leave_type,start_date,end_date,days_count,reason,status,decision_comment,decided_at,created_at,employee_id,approver_id,employee:profiles!leave_requests_employee_id_fkey(full_name,email),approver:profiles!leave_requests_approver_id_fkey(full_name,email)';

// Approval routing follows the reporting line (profiles.supervisor_id), not
// a role — a Solvent Head approving their own operator's leave is not an
// HR Admin, so "awaiting my approval" has to work for anyone who happens to
// be someone's supervisor, not just HR-role users.
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const [mineRes,pendingRes,allRes]=await Promise.all([
  db.from('leave_requests').select(SELECT).eq('employee_id',user.id).order('created_at',{ascending:false}).limit(200),
  db.from('leave_requests').select(SELECT).eq('approver_id',user.id).order('created_at',{ascending:false}).limit(200),
  hr?db.from('leave_requests').select(SELECT).order('created_at',{ascending:false}).limit(300):Promise.resolve({data:null,error:null}),
 ]);
 if(mineRes.error)throw mineRes.error;if(pendingRes.error)throw pendingRes.error;if((allRes as any).error)throw (allRes as any).error;
 return NextResponse.json({mine:mineRes.data||[],awaitingMyApproval:(pendingRes.data||[]).filter((r:any)=>r.status==='pending'),all:hr?allRes.data||[]:null});
}catch(e){logServerError('hr/leave',e);return NextResponse.json({error:errorMessage(e,'Unable to load leave requests')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const b=await req.json(),startDate=String(b.startDate||''),endDate=String(b.endDate||''),daysCount=Number(b.daysCount);
 if(!startDate||!endDate||!Number.isFinite(daysCount)||daysCount<=0)return NextResponse.json({error:'Start date, end date and number of days are required.'},{status:400});
 const {data:me}=await db.from('profiles').select('supervisor_id').eq('id',user.id).maybeSingle();
 if(!me?.supervisor_id)return NextResponse.json({error:'You have no reporting manager set up yet — ask HR to configure who you report to before submitting leave.'},{status:400});
 const {data,error}=await db.from('leave_requests').insert({
  employee_id:user.id,leave_type:b.leaveType||'casual',start_date:startDate,end_date:endDate,days_count:daysCount,reason:b.reason||null,approver_id:me.supervisor_id,
 }).select(SELECT).single();
 if(error)throw error;
 try{
  const {data:requester}=await db.from('profiles').select('full_name,email').eq('id',user.id).maybeSingle();
  const leaveTitle='New leave request',leaveBody=`${requester?.full_name||requester?.email||'An employee'} requested ${daysCount} day${daysCount===1?'':'s'} of ${b.leaveType||'casual'} leave.`;
  await db.from('notifications').insert({user_id:me.supervisor_id,event_type:'leave_request',title:leaveTitle,body:leaveBody,severity:'info',entity_type:'leave_request',entity_id:data.id,push_sent_at:new Date().toISOString()});
  await sendPushToUser(db,me.supervisor_id,{title:leaveTitle,body:leaveBody,severity:'info',tag:'leave_request',url:'/hr/my'});
 }catch{/* leave is saved regardless of whether the bell notification could be written */}
 return NextResponse.json({request:data});
}catch(e){logServerError('hr/leave',e);return NextResponse.json({error:errorMessage(e,'Unable to submit leave request')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const b=await req.json(),id=String(b.id||''),decision=String(b.decision||''),comment=String(b.comment||'').trim();
 if(!id||!['approved','rejected'].includes(decision))return NextResponse.json({error:'Invalid request.'},{status:400});
 const {data:existing,error:ge}=await db.from('leave_requests').select('id,approver_id,employee_id,status,leave_type').eq('id',id).single();if(ge)throw ge;
 const hr=await isHr(db,user.id);
 if(existing.approver_id!==user.id&&!hr)return NextResponse.json({error:'Only the assigned approver can decide this request.'},{status:403});
 if(existing.status!=='pending')return NextResponse.json({error:'This request has already been decided.'},{status:409});
 const {data,error}=await db.from('leave_requests').update({status:decision,decision_comment:comment||null,decided_at:new Date().toISOString()}).eq('id',id).select(SELECT).single();
 if(error)throw error;
 try{const title=`Leave request ${decision}`,body=`Your ${existing.leave_type} leave request was ${decision}.${comment?` ${comment}`:''}`,severity=decision==='rejected'?'warning':'info';await db.from('notifications').insert({user_id:existing.employee_id,event_type:'leave_decided',title,body,severity,entity_type:'leave_request',entity_id:id,push_sent_at:new Date().toISOString()});await sendPushToUser(db,existing.employee_id,{title,body,severity,tag:'leave_decided',url:'/hr/my'})}catch{}
 return NextResponse.json({request:data});
}catch(e){logServerError('hr/leave',e);return NextResponse.json({error:errorMessage(e,'Unable to update leave request')},{status:500})}}
