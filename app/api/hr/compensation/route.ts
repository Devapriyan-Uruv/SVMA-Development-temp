import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// History table — every row is kept (insert-only); the highest effective_date
// is "current." A non-HR caller can only ever see their own history: the
// requested profileId is silently ignored for them, never trusted from the
// client, so compensation can't leak by simply changing a query param.
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const requested=req.nextUrl.searchParams.get('profileId');
 const profileId=hr&&requested?requested:user.id;
 const {data,error}=await db.from('employee_compensation').select('*,profiles!employee_compensation_created_by_fkey(full_name,email)').eq('profile_id',profileId).order('effective_date',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:data||[]});
}catch(e){logServerError('hr/compensation',e);return NextResponse.json({error:errorMessage(e,'Unable to load compensation')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json(),profileId=String(b.profileId||''),effectiveDate=String(b.effectiveDate||''),baseSalary=Number(b.baseSalary);
 if(!profileId||!effectiveDate||!Number.isFinite(baseSalary)||baseSalary<0)return NextResponse.json({error:'Employee, effective date and a valid base salary are required.'},{status:400});
 const {data,error}=await db.from('employee_compensation').insert({
  profile_id:profileId,effective_date:effectiveDate,base_salary:baseSalary,currency:b.currency||'INR',
  pay_frequency:b.payFrequency||'monthly',allowances:Array.isArray(b.allowances)?b.allowances:[],notes:b.notes||null,created_by:user.id,
 }).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/compensation',e);return NextResponse.json({error:errorMessage(e,'Unable to save compensation record')},{status:500})}}
