import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// The staffing plan — who is assigned to work which shift, on which date,
// for which department. Deliberately distinct from shift_sessions (the
// live, single-operator data-entry session).
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const qp=req.nextUrl.searchParams,department=qp.get('department'),from=qp.get('from'),to=qp.get('to');
 let q=db.from('staff_shift_roster').select('*,profiles!staff_shift_roster_profile_id_fkey(full_name,email),department_master(name),shift_master(name,start_time,end_time)').order('roster_date',{ascending:true});
 if(hr){
  if(department)q=q.eq('department_id',department);
  if(from)q=q.gte('roster_date',from);
  if(to)q=q.lte('roster_date',to);
 }else{
  q=q.eq('profile_id',user.id).gte('roster_date',from||new Date().toISOString().slice(0,10));
  if(to)q=q.lte('roster_date',to);
 }
 const {data,error}=await q.limit(500);
 if(error)throw error;
 return NextResponse.json({roster:data||[]});
}catch(e){logServerError('hr/roster',e);return NextResponse.json({error:errorMessage(e,'Unable to load shift roster')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json(),profileId=String(b.profileId||''),departmentId=Number(b.departmentId),shiftId=Number(b.shiftId),rosterDate=String(b.rosterDate||'');
 if(!profileId||!departmentId||!shiftId||!rosterDate)return NextResponse.json({error:'Employee, department, shift and date are required.'},{status:400});
 const {data,error}=await db.from('staff_shift_roster').upsert({
  profile_id:profileId,department_id:departmentId,shift_id:shiftId,roster_date:rosterDate,status:b.status||'scheduled',notes:b.notes||null,created_by:user.id,
 },{onConflict:'profile_id,roster_date,shift_id'}).select('*').single();
 if(error)throw error;
 return NextResponse.json({entry:data});
}catch(e){logServerError('hr/roster',e);return NextResponse.json({error:errorMessage(e,'Unable to save roster entry')},{status:500})}}
