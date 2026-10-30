import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}

// Company property is HR-issued, not self-service — an employee can only
// ever see their own list here, never add or edit it themselves.
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const requested=req.nextUrl.searchParams.get('profileId');
 const profileId=hr&&requested?requested:user.id;
 const {data,error}=await db.from('employee_assets').select('*').eq('profile_id',profileId).order('issued_date',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:data||[]});
}catch(e){logServerError('hr/assets',e);return NextResponse.json({error:errorMessage(e,'Unable to load assets')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json();
 const profileId=String(b.profileId||''),assetType=String(b.assetType||'').trim(),assetName=String(b.assetName||'').trim();
 if(!profileId||!assetType||!assetName)return NextResponse.json({error:'Employee, asset type and name are required.'},{status:400});
 const {data,error}=await db.from('employee_assets').insert({
  profile_id:profileId,asset_type:assetType,asset_name:assetName,serial_number:String(b.serialNumber||'')||null,
  condition_notes:String(b.conditionNotes||'')||null,issued_date:b.issuedDate||new Date().toISOString().slice(0,10),issued_by:user.id,
 }).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/assets',e);return NextResponse.json({error:errorMessage(e,'Unable to save asset')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json();
 if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
 const update:Record<string,any>={};
 for(const k of ['assetType','assetName','serialNumber','conditionNotes'] as const){
  const col={assetType:'asset_type',assetName:'asset_name',serialNumber:'serial_number',conditionNotes:'condition_notes'}[k];
  if(k in b)update[col]=b[k]||null;
 }
 if('returnDate' in b)update.return_date=b.returnDate||null;
 update.updated_at=new Date().toISOString();
 const {data,error}=await db.from('employee_assets').update(update).eq('id',b.id).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('hr/assets',e);return NextResponse.json({error:errorMessage(e,'Unable to update asset')},{status:500})}}
