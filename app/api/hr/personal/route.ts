import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

const EDITABLE_FIELDS=['date_of_birth','gender','marital_status','blood_group','personal_email','alternate_phone','current_address','permanent_address','emergency_contact_name','emergency_contact_phone','emergency_contact_relation','bank_account_name','bank_account_number','bank_ifsc','bank_name','pan_number','aadhaar_number'];
// date_of_joining is HR-set (part of employment record, not something an
// employee should be able to backdate themselves).
const HR_ONLY_FIELDS=['date_of_joining'];

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const requested=req.nextUrl.searchParams.get('profileId');
 const profileId=hr&&requested?requested:user.id;
 const {data,error}=await db.from('profiles').select('*').eq('id',profileId).maybeSingle();
 if(error)throw error;
 return NextResponse.json({profile:data,canEditEmploymentFields:hr});
}catch(e){logServerError('hr/personal',e);return NextResponse.json({error:errorMessage(e,'Unable to load personal details')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const b=await req.json();
 const requested=String(b.profileId||'');
 const profileId=hr&&requested?requested:user.id;
 if(!hr&&requested&&requested!==user.id)return NextResponse.json({error:'You can only edit your own personal details.'},{status:403});
 const update:Record<string,any>={};
 for(const k of EDITABLE_FIELDS)if(k in b)update[k]=b[k]===''?null:b[k];
 if(hr)for(const k of HR_ONLY_FIELDS)if(k in b)update[k]=b[k]===''?null:b[k];
 if(!Object.keys(update).length)return NextResponse.json({error:'Nothing to update.'},{status:400});
 const {data,error}=await db.from('profiles').update(update).eq('id',profileId).select('*').single();
 if(error)throw error;
 return NextResponse.json({profile:data});
}catch(e){logServerError('hr/personal',e);return NextResponse.json({error:errorMessage(e,'Unable to save personal details')},{status:500})}}
