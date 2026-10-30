import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// The Teams-style "view someone's profile" endpoint — deliberately
// narrower than /api/directory (which lists everyone but only name+email
// for the member-picker use case). This selects exactly the fields meant
// to be visible: name, role, email, phone. Department, designation,
// compensation, documents etc. are never even queried here, so there's
// nothing for the UI to accidentally leak.
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 const {data:profile,error}=await db.from('profiles').select('id,full_name,email,phone').eq('id',id).maybeSingle();
 if(error)throw error;
 if(!profile)return NextResponse.json({error:'Not found'},{status:404});
 const {data:roleRow}=await db.from('user_roles').select('role').eq('user_id',id).limit(1).maybeSingle();
 return NextResponse.json({id:profile.id,full_name:profile.full_name,email:profile.email,phone:profile.phone,role:roleRow?.role||null});
}catch(e){logServerError('directory/id',e);return NextResponse.json({error:errorMessage(e,'Unable to load profile')},{status:500})}}
