import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {authorization,ACCESS_APPROVAL_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Marks one announcement read for the caller — called when the popup is
// dismissed, so it never shows again for that person.
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 await db.from('announcement_reads').upsert({announcement_id:id,user_id:user.id},{onConflict:'announcement_id,user_id'});
 return NextResponse.json({ok:true});
}catch(e){logServerError('announcements/read',e);return NextResponse.json({error:errorMessage(e,'Unable to mark as read')},{status:500})}}

// Retract — Management/Super Admin only, e.g. for a typo. Soft-delete
// (active=false) rather than a hard delete, so the audit trail survives.
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const az=await authorization(ACCESS_APPROVAL_ROLES);if(!az.ok)return NextResponse.json({error:'Management or Super Admin access is required'},{status:az.status});
 const {id}=await params,db=supabaseAdmin();
 const {error}=await db.from('announcements').update({active:false}).eq('id',id);
 if(error)throw error;
 return NextResponse.json({ok:true});
}catch(e){logServerError('announcements/retract',e);return NextResponse.json({error:errorMessage(e,'Unable to retract announcement')},{status:500})}}
