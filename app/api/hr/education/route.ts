import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}
function targetProfileId(hr:boolean,requested:string|null,selfId:string){return hr&&requested?requested:selfId}

export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const profileId=targetProfileId(hr,req.nextUrl.searchParams.get('profileId'),user.id);
 const {data,error}=await db.from('employee_education').select('*').eq('profile_id',profileId).order('end_year',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:data||[]});
}catch(e){logServerError('hr/education',e);return NextResponse.json({error:errorMessage(e,'Unable to load education records')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const b=await req.json();
 const profileId=targetProfileId(hr,b.profileId||null,user.id);
 const level=String(b.level||'').trim();
 if(!level)return NextResponse.json({error:'Education level is required.'},{status:400});
 const {data,error}=await db.from('employee_education').insert({
  profile_id:profileId,level,institution:String(b.institution||'')||null,field_of_study:String(b.fieldOfStudy||'')||null,
  start_year:b.startYear?Number(b.startYear):null,end_year:b.endYear?Number(b.endYear):null,grade:String(b.grade||'')||null,created_by:user.id,
 }).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/education',e);return NextResponse.json({error:errorMessage(e,'Unable to save education record')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row}=await db.from('employee_education').select('profile_id').eq('id',id).maybeSingle();
 if(!row)return NextResponse.json({error:'Not found'},{status:404});
 if(!hr&&row.profile_id!==user.id)return NextResponse.json({error:'You can only remove your own education records.'},{status:403});
 const {error}=await db.from('employee_education').delete().eq('id',id);
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('hr/education',e);return NextResponse.json({error:errorMessage(e,'Unable to remove education record')},{status:500})}}
