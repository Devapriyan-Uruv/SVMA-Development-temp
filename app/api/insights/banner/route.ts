import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Reuses the most recent AI report(s) already generated for a shift (see
// app/api/reports) rather than calling the model again — a free, always-
// current "what's happening" line built from real evidence, scoped to
// whatever this user can actually see (solvent-only users never see
// quality wording and vice versa).
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data:roleRows}=await db.from('user_roles').select('role').eq('user_id',user.id);
 const roles=(roleRows||[]).map((r:any)=>String(r.role));
 const isSuperAdmin=roles.includes('super_admin');
 let modules:string[]=[];
 if(!isSuperAdmin){const {data:access}=await db.from('user_module_access').select('module,can_view').eq('user_id',user.id);modules=(access||[]).filter((a:any)=>a.can_view).map((a:any)=>String(a.module))}
 const canSolvent=isSuperAdmin||modules.some(m=>['solvent_management','input','ceo'].includes(m));
 const canQuality=isSuperAdmin||modules.some(m=>['quality_management','quality_input','ceo'].includes(m));
 if(!canSolvent&&!canQuality)return NextResponse.json({headline:null,detail:null});
 let q=db.from('ai_reports').select('report_type,report,created_at').order('created_at',{ascending:false}).limit(20);
 const {data,error}=await q;if(error)throw error;
 const rows=(data||[]).filter((r:any)=>canSolvent&&canQuality?true:canQuality?String(r.report_type).startsWith('quality_'):!String(r.report_type).startsWith('quality_'));
 const latest=rows[0];
 if(!latest)return NextResponse.json({headline:'No AIX3 insight generated yet.',detail:'Open AIX3 Insight in Solvent or Quality to generate the first one for today.',createdAt:null});
 const r=latest.report||{};
 const headline=r.whatWentWell?.[0]||r.needsAttention?.[0]||'Latest AI report is available.';
 const detail=r.needsAttention?.[0]&&r.needsAttention[0]!==headline?r.needsAttention[0]:(r.canBeDoneBetter?.[0]||null);
 return NextResponse.json({headline,detail,createdAt:latest.created_at,scope:String(latest.report_type).startsWith('quality_')?'quality':'solvent'});
}catch(e){logServerError('insights/banner',e);return NextResponse.json({error:errorMessage(e,'Unable to load insight')},{status:500})}}
