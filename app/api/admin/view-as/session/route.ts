import {NextRequest,NextResponse} from 'next/server';
import {authorization,SUPER_ADMIN_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {attachHandoffInfo} from '@/lib/shiftHandoff';
import {errorMessage,logServerError} from '@/lib/errors';

// A dedicated, narrowly-scoped route for "look up ANY user's session" —
// deliberately not a branch bolted onto the operator-facing
// GET /api/shift/session, which stays strictly self-scoped. Powers the
// Super-Admin-only "View As" read-only preview; nothing here ever writes.
export async function GET(req:NextRequest){try{
 const az=await authorization(SUPER_ADMIN_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Super Admin access is required'},{status:az.status});
 const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent';
 const userId=req.nextUrl.searchParams.get('userId');
 if(!userId)return NextResponse.json({error:'userId is required'},{status:400});
 const db=supabaseAdmin();
 const {data:profile}=await db.from('profiles').select('full_name,email').eq('id',userId).maybeSingle();
 const viewAsName=profile?.full_name||profile?.email||'Unknown';
 const {data,error}=await db.from('shift_sessions').select('*,shift_master(*)').eq('operator_id',userId).eq('scope',scope).in('status',['active','paused']).order('actual_start',{ascending:false}).limit(1).maybeSingle();
 if(error)throw error;
 const session=data?await attachHandoffInfo(db,data):null;
 return NextResponse.json({session,viewAsName});
}catch(e){logServerError('admin/view-as/session',e);return NextResponse.json({error:errorMessage(e,'Unable to load session')},{status:500})}}
