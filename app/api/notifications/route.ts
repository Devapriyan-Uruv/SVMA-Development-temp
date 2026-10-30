import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Surfaces the notification rows that already exist in the `notifications`
// table (see sql/001_schema.sql) — deviation-triggered alerts are already
// inserted deterministically by app/api/entries/route.ts for the Solvent
// Head / Quality Head / CEO / management / admin roles whenever a saved
// reading is outside target. Nothing about which readings raise a
// notification, or who it is addressed to, is decided here — this route
// only reads and (for PATCH) marks-read a user's own rows, always scoped
// to their own user_id, using the service-role client the rest of this
// codebase already uses for privileged reads (see app/api/reports and
// app/api/entries for the same pattern).

export async function GET(req:NextRequest){
 try{
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const db=supabaseAdmin();
  const limit=Math.min(Number(req.nextUrl.searchParams.get('limit'))||20,50);
  const [{data:rows,error},{count,error:ce}]=await Promise.all([
   db.from('notifications').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(limit),
   db.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',user.id).is('read_at',null),
  ]);
  if(error)throw error;
  if(ce)throw ce;
  return NextResponse.json({notifications:rows||[],unread:count||0});
 }catch(e){logServerError('notifications',e);return NextResponse.json({error:errorMessage(e,'Unable to load notifications')},{status:500})}
}

export async function PATCH(req:NextRequest){
 try{
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const b=await req.json().catch(()=>({}));
  const db=supabaseAdmin();
  if(b.all){
   const {error}=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',user.id).is('read_at',null);
   if(error)throw error;
   return NextResponse.json({ok:true});
  }
  // Section K/AD: CRITICAL alerts stay persistent until explicitly
  // acknowledged (distinct from merely "read" by opening the bell).
  if(b.id&&b.acknowledge){
   const {error}=await db.from('notifications').update({acknowledged_at:new Date().toISOString(),acknowledged_by:user.id,read_at:new Date().toISOString()}).eq('id',b.id).eq('user_id',user.id);
   if(error)throw error;
   return NextResponse.json({ok:true});
  }
  // "Acknowledge all" — CEO/Management/Super Admin only (enforced client-
  // side by which roles ever render the bulk button; server-side this is
  // still always scoped to the caller's own rows, same as the single-id
  // path above, so it can never touch another user's alerts either way).
  if(Array.isArray(b.ids)&&b.ids.length&&b.acknowledge){
   const ids=b.ids.map(String).slice(0,100);
   const {error}=await db.from('notifications').update({acknowledged_at:new Date().toISOString(),acknowledged_by:user.id,read_at:new Date().toISOString()}).in('id',ids).eq('user_id',user.id);
   if(error)throw error;
   return NextResponse.json({ok:true});
  }
  if(!b.id)return NextResponse.json({error:'id or all is required'},{status:400});
  const {error}=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',b.id).eq('user_id',user.id);
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(e){logServerError('notifications',e);return NextResponse.json({error:errorMessage(e,'Unable to update notification')},{status:500})}
}

// "Clear all" — a real delete of the caller's own rows (never another
// user's; notifications are a leaf table nothing else references by FK, so
// this is safe). A single `id` clears just that one notification instead.
export async function DELETE(req:NextRequest){
 try{
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const db=supabaseAdmin();
  const id=req.nextUrl.searchParams.get('id');
  let q=db.from('notifications').delete().eq('user_id',user.id);
  if(id)q=q.eq('id',id);
  const {error}=await q;
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(e){logServerError('notifications',e);return NextResponse.json({error:errorMessage(e,'Unable to clear notifications')},{status:500})}
}

// First-login / settings control for the "ENABLE OPERATIONAL ALERT SOUND"
// preference (Section K) — browsers block autoplay until a user gesture, so
// the preference is both stored (for the record and other devices) and
// mirrored to localStorage client-side for the immediate unlock.
export async function PUT(req:NextRequest){
 try{
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const b=await req.json().catch(()=>({}));
  const db=supabaseAdmin();
  const {error}=await db.from('notification_preferences').upsert({user_id:user.id,sound_enabled:!!b.soundEnabled},{onConflict:'user_id'});
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(e){logServerError('notifications',e);return NextResponse.json({error:errorMessage(e,'Unable to update preference')},{status:500})}
}
