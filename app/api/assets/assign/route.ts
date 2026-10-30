import {NextRequest,NextResponse} from 'next/server';
import {authorization,HR_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

// Assign pulls the asset's details from the registry (rather than free
// typing them again) and denormalizes them onto the employee_assets row —
// the same snapshot pattern used across this schema — so the existing "My
// Assets" read UI needs no changes at all.
export async function POST(req:NextRequest){try{
 const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});
 const db=supabaseAdmin();
 const b=await req.json(),action=String(b.action||'');

 if(action==='assign'){
  const profileId=String(b.profileId||''),assetId=Number(b.assetId);
  if(!profileId||!assetId)return NextResponse.json({error:'Employee and asset are required.'},{status:400});
  const {data:asset,error:ae}=await db.from('assets').select('*').eq('id',assetId).single();if(ae)throw ae;
  if(asset.status!=='available')return NextResponse.json({error:'This asset is not available to assign.'},{status:400});
  const {data,error}=await db.from('employee_assets').insert({
   profile_id:profileId,asset_id:assetId,asset_type:asset.type,asset_name:asset.name,serial_number:asset.serial_number,
   condition_notes:b.conditionNotes||null,issued_date:b.issuedDate||new Date().toISOString().slice(0,10),issued_by:az.user.id,
  }).select('*').single();
  if(error)throw error;
  await db.from('assets').update({status:'assigned',updated_at:new Date().toISOString()}).eq('id',assetId);
  try{
   await db.from('notifications').insert({user_id:profileId,event_type:'asset_issued',title:'Asset issued',body:asset.name,severity:'info',entity_type:'employee_asset',entity_id:data.id,push_sent_at:new Date().toISOString()});
   await sendPushToUser(db,profileId,{title:'Asset issued',body:asset.name,severity:'info',tag:'asset_issued',url:'/hr/my'});
  }catch{/* the issuance is saved regardless of whether the bell notification could be written */}
  return NextResponse.json({record:data});
 }

 if(action==='return'){
  const employeeAssetId=Number(b.employeeAssetId);
  if(!employeeAssetId)return NextResponse.json({error:'employeeAssetId is required.'},{status:400});
  const {data:ea,error:ee}=await db.from('employee_assets').select('*').eq('id',employeeAssetId).single();if(ee)throw ee;
  if(!ea.asset_id)return NextResponse.json({error:'This issuance predates the asset registry — return it from the HR console instead.'},{status:400});
  const returnDate=b.returnDate||new Date().toISOString().slice(0,10);
  const {data,error}=await db.from('employee_assets').update({return_date:returnDate,updated_at:new Date().toISOString()}).eq('id',employeeAssetId).select('*').single();
  if(error)throw error;
  await db.from('assets').update({status:b.newStatus==='maintenance'?'maintenance':'available',updated_at:new Date().toISOString()}).eq('id',ea.asset_id);
  return NextResponse.json({record:data});
 }

 return NextResponse.json({error:'Unknown action.'},{status:400});
}catch(e){logServerError('assets/assign',e);return NextResponse.json({error:errorMessage(e,'Unable to process asset assignment')},{status:500})}}
