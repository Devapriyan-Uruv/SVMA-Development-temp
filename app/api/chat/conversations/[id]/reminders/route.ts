import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

async function assertMember(db:ReturnType<typeof supabaseAdmin>,conversationId:string,userId:string){
 const {data}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',conversationId).eq('user_id',userId).maybeSingle();
 return !!data;
}

// Upcoming (not yet delivered) reminders for this conversation, so the
// thread can show what's scheduled.
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const {data,error}=await db.from('chat_reminders').select('id,message,remind_at,created_at,profiles(full_name,email)').eq('conversation_id',id).is('delivered_at',null).order('remind_at',{ascending:true}).limit(20);
 if(error)throw error;
 return NextResponse.json({reminders:(data||[]).map((r:any)=>({id:r.id,message:r.message,remindAt:r.remind_at,createdAt:r.created_at,createdByName:r.profiles?.full_name||r.profiles?.email||'Someone'}))});
}catch(e){logServerError('chat/reminders',e);return NextResponse.json({error:errorMessage(e,'Unable to load reminders')},{status:500})}}

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const b=await req.json(),message=String(b.message||'').trim(),remindAt=String(b.remindAt||'');
 if(!message)return NextResponse.json({error:'Write what to remind the group about.'},{status:400});
 if(message.length>500)return NextResponse.json({error:'Reminder text is too long (500 characters max).'},{status:400});
 const when=remindAt?new Date(remindAt):null;
 if(!when||Number.isNaN(when.getTime()))return NextResponse.json({error:'Choose a valid date and time.'},{status:400});
 if(when.getTime()<=Date.now())return NextResponse.json({error:'Pick a time in the future.'},{status:400});
 const {data,error}=await db.from('chat_reminders').insert({conversation_id:id,created_by:user.id,message,remind_at:when.toISOString()}).select('id,message,remind_at,created_at').single();
 if(error)throw error;
 return NextResponse.json({reminder:{id:data.id,message:data.message,remindAt:data.remind_at,createdAt:data.created_at}});
}catch(e){logServerError('chat/reminders',e);return NextResponse.json({error:errorMessage(e,'Unable to schedule reminder')},{status:500})}}
