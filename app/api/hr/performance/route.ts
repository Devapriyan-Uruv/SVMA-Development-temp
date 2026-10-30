import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// Mirrors app/api/hr/leave's shape: "mine" (my own reviews as the
// employee), "pendingMyReview" (reviews where I'm the reviewer and the
// employee has submitted their self-assessment), and "all" (HR oversight,
// only populated for HR_ROLES).
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const nameSel='profile:profiles!performance_reviews_profile_id_fkey(full_name,email),reviewer:profiles!performance_reviews_reviewer_id_fkey(full_name,email)';
 const [mineRes,pendingRes,allRes]=await Promise.all([
  db.from('performance_reviews').select(`*,${nameSel}`).eq('profile_id',user.id).order('created_at',{ascending:false}),
  db.from('performance_reviews').select(`*,${nameSel}`).eq('reviewer_id',user.id).eq('status','submitted').order('created_at',{ascending:false}),
  hr?db.from('performance_reviews').select(`*,${nameSel}`).order('created_at',{ascending:false}).limit(200):Promise.resolve({data:null,error:null}),
 ]);
 if(mineRes.error)throw mineRes.error;if(pendingRes.error)throw pendingRes.error;if(allRes.error)throw allRes.error;
 return NextResponse.json({mine:mineRes.data||[],pendingMyReview:pendingRes.data||[],all:allRes.data});
}catch(e){logServerError('hr/performance',e);return NextResponse.json({error:errorMessage(e,'Unable to load performance reviews')},{status:500})}}

// Starting a formal review cycle is an HR/admin action — the reviewer
// defaults to the employee's own supervisor_id (same snapshot pattern
// leave_requests already uses) unless one is explicitly given.
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json();
 const profileId=String(b.profileId||''),periodLabel=String(b.periodLabel||'').trim();
 if(!profileId||!periodLabel)return NextResponse.json({error:'Employee and review period are required.'},{status:400});
 let reviewerId=String(b.reviewerId||'')||null;
 if(!reviewerId){const {data:profile}=await db.from('profiles').select('supervisor_id').eq('id',profileId).maybeSingle();reviewerId=profile?.supervisor_id||null}
 const {data,error}=await db.from('performance_reviews').insert({
  profile_id:profileId,reviewer_id:reviewerId,period_label:periodLabel,period_start:b.periodStart||null,period_end:b.periodEnd||null,
  goals:Array.isArray(b.goals)?b.goals:[],created_by:user.id,
 }).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/performance',e);return NextResponse.json({error:errorMessage(e,'Unable to create review')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const b=await req.json();
 if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row,error:ge}=await db.from('performance_reviews').select('*').eq('id',b.id).single();if(ge)throw ge;
 const isOwner=row.profile_id===user.id,isReviewer=row.reviewer_id===user.id;
 if(!isOwner&&!isReviewer&&!hr)return NextResponse.json({error:'You do not have access to this review.'},{status:403});
 const update:Record<string,any>={updated_at:new Date().toISOString()};
 // The employee can propose goals and write their own self-assessment,
 // then submit — after that it's the reviewer's/HR's turn to respond.
 if(isOwner||hr){
  if('goals' in b&&Array.isArray(b.goals))update.goals=b.goals;
  if('selfAssessment' in b)update.self_assessment=b.selfAssessment||null;
 }
 if((isOwner||hr)&&b.submit&&row.status==='draft'){update.status='submitted';update.submitted_at=new Date().toISOString()}
 // The reviewer (or HR, standing in for/overseeing) responds and closes it out.
 if(isReviewer||hr){
  if('reviewerAssessment' in b)update.reviewer_assessment=b.reviewerAssessment||null;
  if('rating' in b)update.rating=b.rating||null;
  if(b.complete&&['submitted','draft'].includes(row.status)){update.status='completed';update.reviewed_at=new Date().toISOString()}
 }
 const {data,error}=await db.from('performance_reviews').update(update).eq('id',b.id).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/performance',e);return NextResponse.json({error:errorMessage(e,'Unable to update review')},{status:500})}}
