import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json();
 const endpoint=String(b?.endpoint||''),p256dh=String(b?.keys?.p256dh||''),auth=String(b?.keys?.auth||'');
 if(!endpoint||!p256dh||!auth)return NextResponse.json({error:'Invalid push subscription.'},{status:400});
 const db=supabaseAdmin();
 const {error}=await db.from('push_subscriptions').upsert({user_id:user.id,endpoint,p256dh,auth},{onConflict:'endpoint'});
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('push/subscribe',e);return NextResponse.json({error:errorMessage(e,'Unable to save push subscription')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const endpoint=req.nextUrl.searchParams.get('endpoint');if(!endpoint)return NextResponse.json({error:'endpoint is required'},{status:400});
 const db=supabaseAdmin();
 const {error}=await db.from('push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',endpoint);
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('push/subscribe',e);return NextResponse.json({error:errorMessage(e,'Unable to remove push subscription')},{status:500})}}
