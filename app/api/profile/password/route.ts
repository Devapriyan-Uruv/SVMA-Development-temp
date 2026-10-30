import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {supabaseServer} from '@/lib/supabase/server';
import {errorMessage,logServerError} from '@/lib/errors';

export async function POST(req:NextRequest){try{
 const sb=await supabaseServer();
 const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json(),newPassword=String(b.newPassword||'');
 if(newPassword.length<8)return NextResponse.json({error:'Password must be at least 8 characters.'},{status:400});
 // A temporary password cannot be kept: the new one must differ from the current one (checked by trying to sign in with it).
 if(user.user_metadata?.must_change_password===true&&user.email){
  const probe=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:same}=await probe.auth.signInWithPassword({email:user.email,password:newPassword});
  if(same?.session)return NextResponse.json({error:'Choose a new password — it cannot be the same as your temporary password.'},{status:400});
 }
 const {error}=await sb.auth.updateUser({password:newPassword,data:{must_change_password:false}});if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('profile/password',e);return NextResponse.json({error:errorMessage(e,'Unable to change password')},{status:500})}}
