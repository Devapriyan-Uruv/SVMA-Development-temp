import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),status=req.nextUrl.searchParams.get('status')||'pending';
 const {data,error}=await db.from('ops_lot_aliases').select('id,feeding_lot_no,rm_batch_lot_no,status,suggested_by,confidence,created_at').eq('status',status).order('created_at',{ascending:false}).limit(200);
 if(error)return NextResponse.json({error:'Unable to load lot aliases.'},{status:500});
 return NextResponse.json({aliases:data||[]});
}
export async function PATCH(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json(),id=String(b.id||''),action=String(b.action||'');
 if(!id||!['approve','reject'].includes(action))return NextResponse.json({error:'A valid id and action are required.'},{status:400});
 const db=supabaseAdmin();
 const {error}=await db.from('ops_lot_aliases').update({status:action==='approve'?'approved':'rejected',approved_by:az.user?.id||null,approved_at:new Date().toISOString()}).eq('id',id);
 if(error)return NextResponse.json({error:'Unable to update this lot mapping.'},{status:500});
 return NextResponse.json({ok:true});
}
