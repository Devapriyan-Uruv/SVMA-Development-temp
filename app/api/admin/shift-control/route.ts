import {NextResponse} from 'next/server';
import {authorization,SUPER_ADMIN_ROLES,CEO_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {attachHandoffInfo} from '@/lib/shiftHandoff';
import {errorMessage,logServerError} from '@/lib/errors';

// Every currently active/paused shift session across BOTH scopes — read
// access for the Admin "Shift Control" tab (Super Admin, full control) and
// the Management dashboard's read-only "Shift Control" panel (CEO_ROLES
// already includes super_admin/management, so this alone is the read
// gate for both). This route is read-only itself either way — closing a
// shift reuses the existing PATCH /api/shift/session {force:true} path,
// which stays Super-Admin-only for acting on someone else's session; a
// Management viewer reaching this GET never gains the ability to stop one.
export async function GET(){try{
 const az=await authorization(CEO_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access is required'},{status:az.status});
 const db=supabaseAdmin();
 const {data,error}=await db.from('shift_sessions').select('*,shift_master(*),profiles!shift_sessions_operator_id_fkey(full_name,email)').in('status',['active','paused']).order('actual_start',{ascending:false});
 if(error)throw error;
 const sessions=await Promise.all((data||[]).map(async(s:any)=>{
  const shaped=await attachHandoffInfo(db,s);
  return {...shaped,operatorName:s.profiles?.full_name||s.profiles?.email||'Unknown'};
 }));
 // Shifts closed in the last 24h — surfaced so Super Admin can reopen+
 // reassign one that was closed by mistake (e.g. a reflexive re-click
 // right after closing left the real, filled-in session completed and an
 // empty duplicate handed off instead). entryCount is included so the
 // admin can tell at a glance which closed session actually has the data.
 const since=new Date(Date.now()-24*3600000).toISOString();
 const {data:closedRaw,error:ce}=await db.from('shift_sessions').select('*,shift_master(*),profiles!shift_sessions_operator_id_fkey(full_name,email)').eq('status','completed').gte('actual_end',since).order('actual_end',{ascending:false}).limit(30);
 if(ce)throw ce;
 const recentlyClosed=await Promise.all((closedRaw||[]).map(async(s:any)=>{
  const {count}=await db.from('parameter_entries').select('id',{count:'exact',head:true}).eq('shift_session_id',s.id);
  return {...s,operatorName:s.profiles?.full_name||s.profiles?.email||'Unknown',entryCount:count||0};
 }));
 return NextResponse.json({sessions,recentlyClosed});
}catch(e){logServerError('admin/shift-control',e);return NextResponse.json({error:errorMessage(e,'Unable to load live shifts')},{status:500})}}
