import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data,error}=await db.from('profiles').select('id,full_name,email,phone,department,designation,avatar_url').eq('id',user.id).maybeSingle();if(error)throw error;
 return NextResponse.json({profile:data});
}catch(e){logServerError('profile',e);return NextResponse.json({error:errorMessage(e,'Unable to load profile')},{status:500})}}

// Self-service is deliberately limited to identity fields a person can
// safely change about themselves. Department/designation/role assignment
// stays with the Administrator (see app/admin) so this endpoint can't be
// used to quietly widen access.
export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json(),fullName=String(b.fullName||'').trim(),phone=String(b.phone||'').trim();
 if(!fullName)return NextResponse.json({error:'Name is required.'},{status:400});
 const db=supabaseAdmin();
 const {data,error}=await db.from('profiles').update({full_name:fullName,phone:phone||null,updated_at:new Date().toISOString()}).eq('id',user.id).select('id,full_name,email,phone,department,designation,avatar_url').single();if(error)throw error;
 return NextResponse.json({profile:data});
}catch(e){logServerError('profile',e);return NextResponse.json({error:errorMessage(e,'Unable to update profile')},{status:500})}}
