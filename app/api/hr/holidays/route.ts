import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data,error}=await db.from('company_holidays').select('*').order('holiday_date',{ascending:true});
 if(error)throw error;
 return NextResponse.json({holidays:data||[]});
}catch(e){logServerError('hr/holidays',e);return NextResponse.json({error:errorMessage(e,'Unable to load holidays')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json(),name=String(b.name||'').trim(),holidayDate=String(b.holidayDate||'');
 if(!name||!holidayDate)return NextResponse.json({error:'Name and date are required.'},{status:400});
 const {data,error}=await db.from('company_holidays').insert({name,holiday_date:holidayDate,description:b.description||null,created_by:user.id}).select('*').single();
 if(error){if((error as any).code==='23505')return NextResponse.json({error:'A holiday is already recorded for this date.'},{status:400});throw error}
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/holidays',e);return NextResponse.json({error:errorMessage(e,'Unable to add holiday')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {error}=await db.from('company_holidays').delete().eq('id',id);
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('hr/holidays',e);return NextResponse.json({error:errorMessage(e,'Unable to remove holiday')},{status:500})}}
