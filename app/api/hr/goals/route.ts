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
// A goal's manager isn't necessarily an HR role — any user who has direct
// reports (profiles.supervisor_id points at them) can set goals for their
// own reports, same reporting-line convention leave_requests/performance
// reviews already use.
async function myReports(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('profiles').select('id,full_name,email').eq('supervisor_id',userId).order('full_name');
 return data||[];
}
async function managerOf(db:ReturnType<typeof supabaseAdmin>,profileId:string){
 const {data}=await db.from('profiles').select('supervisor_id').eq('id',profileId).maybeSingle();
 return data?.supervisor_id||null;
}

export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const reports=await myReports(db,user.id);
 const requested=req.nextUrl.searchParams.get('profileId');
 const profileId=requested||user.id;
 if(requested&&requested!==user.id){
  const allowed=hr||reports.some(r=>r.id===requested);
  if(!allowed)return NextResponse.json({error:'You do not have access to this employee\'s goals.'},{status:403});
 }
 const canManage=hr||reports.some(r=>r.id===profileId);
 const {data,error}=await db.from('employee_goals').select('*').eq('profile_id',profileId).order('created_at',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:data||[],myReports:reports,canManage});
}catch(e){logServerError('hr/goals',e);return NextResponse.json({error:errorMessage(e,'Unable to load goals')},{status:500})}}

// Goals can only be created by HR or the target employee's own reporting
// manager — never by the employee themselves or anyone else.
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const b=await req.json(),profileId=String(b.profileId||''),title=String(b.title||'').trim();
 if(!profileId||!title)return NextResponse.json({error:'Employee and a goal title are required.'},{status:400});
 const hr=await isHr(db,user.id);
 if(!hr){
  const supervisorId=await managerOf(db,profileId);
  if(supervisorId!==user.id)return NextResponse.json({error:'Only HR or this employee\'s reporting manager can add a goal.'},{status:403});
 }
 const {data,error}=await db.from('employee_goals').insert({
  profile_id:profileId,title,description:b.description||null,target_date:b.targetDate||null,created_by:user.id,
 }).select('*').single();
 if(error)throw error;
 try{
  await db.from('notifications').insert({user_id:profileId,event_type:'goal_assigned',title:'New goal assigned',body:title,severity:'info',entity_type:'employee_goal',entity_id:data.id,push_sent_at:new Date().toISOString()});
  await sendPushToUser(db,profileId,{title:'New goal assigned',body:title,severity:'info',tag:'goal_assigned',url:'/hr/my'});
 }catch{/* the goal is saved regardless of whether the bell notification could be written */}
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/goals',e);return NextResponse.json({error:errorMessage(e,'Unable to add goal')},{status:500})}}

// The employee themselves can update progress/status on their own goal
// (self-reported progress against a manager-set target); title/description/
// target_date stay HR/manager-only.
export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const b=await req.json(),id=String(b.id||'');
 if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row,error:ge}=await db.from('employee_goals').select('*').eq('id',id).single();if(ge)throw ge;
 const hr=await isHr(db,user.id),isOwner=row.profile_id===user.id;
 const isManager=!hr&&!isOwner?(await managerOf(db,row.profile_id))===user.id:false;
 if(!hr&&!isOwner&&!isManager)return NextResponse.json({error:'You do not have access to this goal.'},{status:403});
 const update:Record<string,any>={updated_at:new Date().toISOString()};
 if(hr||isManager){
  if('title' in b)update.title=String(b.title||'').trim()||row.title;
  if('description' in b)update.description=b.description||null;
  if('targetDate' in b)update.target_date=b.targetDate||null;
 }
 if(hr||isManager||isOwner){
  if('status' in b&&['not_started','in_progress','completed','missed'].includes(String(b.status)))update.status=b.status;
  if('progress' in b){const p=Number(b.progress);if(Number.isFinite(p))update.progress=Math.max(0,Math.min(100,Math.round(p)))}
 }
 const {data,error}=await db.from('employee_goals').update(update).eq('id',id).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/goals',e);return NextResponse.json({error:errorMessage(e,'Unable to update goal')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row,error:ge}=await db.from('employee_goals').select('profile_id').eq('id',id).single();if(ge)throw ge;
 const hr=await isHr(db,user.id);
 const isManager=!hr?(await managerOf(db,row.profile_id))===user.id:false;
 if(!hr&&!isManager)return NextResponse.json({error:'Only HR or this employee\'s reporting manager can remove a goal.'},{status:403});
 const {error}=await db.from('employee_goals').delete().eq('id',id);
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('hr/goals',e);return NextResponse.json({error:errorMessage(e,'Unable to remove goal')},{status:500})}}
