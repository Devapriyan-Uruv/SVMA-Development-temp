import {moduleAuthorization,INPUT_ROLES,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {eligibleOperatorIds} from '@/lib/shiftEligibility';

function scopeOf(v:any){return v==='quality'?'quality':'solvent'}
function authFor(scope:string){return scope==='quality'?moduleAuthorization('quality_input',QUALITY_INPUT_ROLES):moduleAuthorization('input',INPUT_ROLES)}

// The Hand-off picker's people list — everyone with entry access for this
// scope (by module access, else role — see lib/shiftEligibility), excluding the caller (nothing to pick if the answer is "myself").
// Deliberately its own small route rather than extending the existing
// minimal /api/directory (name+email only, no role filtering, used by the
// chat member picker) — a different, narrower contract.
export async function GET(req:NextRequest){try{
 const scope=scopeOf(req.nextUrl.searchParams.get('scope')),az=await authFor(scope);
 if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Input access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const ids=Array.from(await eligibleOperatorIds(db,scope)).filter(id=>id!==az.user!.id);
 if(!ids.length)return NextResponse.json({operators:[]});
 const {data:profiles,error:pe}=await db.from('profiles').select('id,full_name,email').in('id',ids).eq('is_active',true).order('full_name');
 if(pe)throw pe;
 return NextResponse.json({operators:profiles||[]});
}catch(e){logServerError('shift/session/operators',e);return NextResponse.json({error:errorMessage(e,'Unable to load operators')},{status:500})}}
