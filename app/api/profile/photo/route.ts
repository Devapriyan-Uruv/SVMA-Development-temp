import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const fd=await req.formData(),file=fd.get('file');
 if(!(file instanceof File))return NextResponse.json({error:'Photo file is required.'},{status:400});
 if(file.size>5*1024*1024)return NextResponse.json({error:'Photo exceeds 5 MB.'},{status:400});
 if(!file.type.startsWith('image/'))return NextResponse.json({error:'Only image files are accepted.'},{status:400});
 const db=supabaseAdmin(),safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_'),path=`${user.id}/${Date.now()}-${safe}`;
 const {error:up}=await db.storage.from('svma-avatars').upload(path,Buffer.from(await file.arrayBuffer()),{contentType:file.type,upsert:false});if(up)throw up;
 const {data:{publicUrl}}=db.storage.from('svma-avatars').getPublicUrl(path);
 const {data,error}=await db.from('profiles').update({avatar_url:publicUrl,updated_at:new Date().toISOString()}).eq('id',user.id).select('id,full_name,email,phone,department,designation,avatar_url').single();if(error)throw error;
 return NextResponse.json({profile:data});
}catch(e){logServerError('profile/photo',e);return NextResponse.json({error:errorMessage(e,'Unable to upload photo')},{status:500})}}
