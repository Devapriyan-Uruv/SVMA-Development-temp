import {supabaseAdmin} from '@/lib/supabase/admin';

// Shared by every dashboard that surfaces a "live shift" chip (Solvent,
// Quality, CEO Cockpit) — a handed-off session's entry_person_name still
// says who STARTED it (that field never changes), but nothing else showed
// who it was handed to, or when, until now.
export async function attachHandoffInfo(db:ReturnType<typeof supabaseAdmin>,shift:any){
 if(!shift)return shift;
 const {data:handoff}=await db.from('shift_session_handoffs').select('to_operator_id,handed_off_at,to:profiles!shift_session_handoffs_to_operator_id_fkey(full_name,email)').eq('shift_session_id',shift.id).order('handed_off_at',{ascending:false}).limit(1).maybeSingle() as {data:any};
 return {...shift,handoff:handoff?{toName:handoff.to?.full_name||handoff.to?.email||'Unknown',handedOffAt:handoff.handed_off_at}:null};
}
