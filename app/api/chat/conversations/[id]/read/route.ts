import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function POST(_req:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 const {error}=await db.from('chat_conversation_members').update({last_read_at:new Date().toISOString()}).eq('conversation_id',id).eq('user_id',user.id);if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('chat/read',e);return NextResponse.json({error:errorMessage(e,'Unable to update read status')},{status:500})}}
