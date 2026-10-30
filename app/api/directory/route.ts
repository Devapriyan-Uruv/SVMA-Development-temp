import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// A lightweight "who else is in this organisation" list — names and emails
// only, no role/module data — used by the approver picker and the chat
// panel. Any authenticated user can see coworker names; this is an internal
// tool, not a source of sensitive data.
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data,error}=await db.from('profiles').select('id,full_name,email').eq('is_active',true).order('full_name',{ascending:true});if(error)throw error;
 return NextResponse.json({profiles:data||[]});
}catch(e){logServerError('directory',e);return NextResponse.json({error:errorMessage(e,'Unable to load directory')},{status:500})}}
