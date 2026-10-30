import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Captures a photo of the physical person entering data at shift start —
// distinct from the logged-in account, since one tablet login can be shared
// across operators on different shifts. Uploaded before the shift session
// row exists, so it lives under the account id until attached.
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const fd=await req.formData(),file=fd.get('file');
 if(!(file instanceof File))return NextResponse.json({error:'Photo file is required.'},{status:400});
 if(file.size>5*1024*1024)return NextResponse.json({error:'Photo exceeds 5 MB.'},{status:400});
 if(!file.type.startsWith('image/'))return NextResponse.json({error:'Only image files are accepted.'},{status:400});
 const db=supabaseAdmin(),safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_'),path=`${user.id}/${Date.now()}-${safe}`;
 const {error:up}=await db.storage.from('svma-entry-photos').upload(path,Buffer.from(await file.arrayBuffer()),{contentType:file.type,upsert:false});if(up)throw up;
 const {data:{publicUrl}}=db.storage.from('svma-entry-photos').getPublicUrl(path);
 return NextResponse.json({url:publicUrl});
}catch(e){logServerError('shift/entry-photo',e);return NextResponse.json({error:errorMessage(e,'Unable to upload photo')},{status:500})}}
