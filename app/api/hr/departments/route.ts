import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// Departments are readable by any signed-in user (roster/employee forms
// across the app need the list), but only HR-role users can add, rename or
// deactivate one.
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data,error}=await db.from('department_master').select('*').order('sort_order',{ascending:true}).order('name',{ascending:true});
 if(error)throw error;
 return NextResponse.json({departments:data||[]});
}catch(e){logServerError('hr/departments',e);return NextResponse.json({error:errorMessage(e,'Unable to load departments')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json(),name=String(b.name||'').trim();
 if(!name)return NextResponse.json({error:'Department name is required.'},{status:400});
 if(b.id){
  const update:any={name};if('active' in b)update.active=!!b.active;if('sortOrder' in b)update.sort_order=Number(b.sortOrder)||0;
  const {data,error}=await db.from('department_master').update(update).eq('id',b.id).select('*').single();if(error)throw error;
  return NextResponse.json({department:data});
 }
 const {data,error}=await db.from('department_master').insert({name}).select('*').single();
 if(error)throw error;
 return NextResponse.json({department:data});
}catch(e){logServerError('hr/departments',e);return NextResponse.json({error:errorMessage(e,'Unable to save department')},{status:500})}}
