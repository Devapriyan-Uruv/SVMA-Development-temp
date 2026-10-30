import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// used/remaining are never stored — always summed live from approved
// leave_requests, same "derive, don't duplicate" choice already made for
// employee_compensation's insert-only history, so a balance can't drift
// from the requests actually decided against it.
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const year=Number(req.nextUrl.searchParams.get('year'))||new Date().getFullYear();
 const requested=req.nextUrl.searchParams.get('profileId');
 // "My HR" always wants the caller's own balances, even for an HR/Super
 // Admin viewer — ?self=1 is how it opts out of the "no profileId means
 // give me everyone's" default the HR admin console's own Leave Balances
 // tab relies on.
 const self=req.nextUrl.searchParams.get('self')==='1';

 if(hr&&!requested&&!self){
  const {data,error}=await db.from('leave_balances').select('*,profile:profiles!leave_balances_profile_id_fkey(full_name,email)').eq('year',year).order('profile_id');
  if(error)throw error;
  return NextResponse.json({mode:'all',year,balances:data||[]});
 }
 const profileId=hr&&requested?requested:user.id;
 const [{data:balances,error:be},{data:approved,error:ae}]=await Promise.all([
  db.from('leave_balances').select('*').eq('profile_id',profileId).eq('year',year),
  db.from('leave_requests').select('leave_type,days_count').eq('employee_id',profileId).eq('status','approved').gte('start_date',`${year}-01-01`).lte('start_date',`${year}-12-31`),
 ]);
 if(be)throw be;if(ae)throw ae;
 const usedByType:Record<string,number>={};
 for(const r of approved||[])usedByType[r.leave_type]=(usedByType[r.leave_type]||0)+Number(r.days_count);
 const merged=(balances||[]).map((b:any)=>({...b,usedDays:usedByType[b.leave_type]||0,remainingDays:Number(b.allocated_days)-(usedByType[b.leave_type]||0)}));
 return NextResponse.json({mode:'mine',year,balances:merged});
}catch(e){logServerError('hr/leave-balances',e);return NextResponse.json({error:errorMessage(e,'Unable to load leave balances')},{status:500})}}

async function upsert(req:NextRequest){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json(),profileId=String(b.profileId||''),leaveType=String(b.leaveType||'').trim(),year=Number(b.year),allocatedDays=Number(b.allocatedDays);
 if(!profileId||!leaveType||!Number.isFinite(year)||!Number.isFinite(allocatedDays)||allocatedDays<0)return NextResponse.json({error:'Employee, leave type, year and allocated days are required.'},{status:400});
 const {data,error}=await db.from('leave_balances').upsert({
  profile_id:profileId,leave_type:leaveType,year,allocated_days:allocatedDays,created_by:user.id,updated_at:new Date().toISOString(),
 },{onConflict:'profile_id,leave_type,year'}).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}
export async function POST(req:NextRequest){try{return await upsert(req)}catch(e){logServerError('hr/leave-balances',e);return NextResponse.json({error:errorMessage(e,'Unable to save leave balance')},{status:500})}}
export async function PATCH(req:NextRequest){try{return await upsert(req)}catch(e){logServerError('hr/leave-balances',e);return NextResponse.json({error:errorMessage(e,'Unable to save leave balance')},{status:500})}}
