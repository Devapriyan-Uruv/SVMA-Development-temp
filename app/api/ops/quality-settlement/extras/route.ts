import {NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';

/** QC Pending Lots: a complementary log to the existing Inward QC /
 * Settlement Pending reconciliation above — lots the ERP itself still
 * shows as awaiting QC, not merged into that reconciliation. */
export async function GET(){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const {data:raw}=await db.from('ops_qc_pending_lots').select('reference_no,pending_date,party_name,product_raw,lot_no,codes,quantity').order('pending_date',{ascending:false}).limit(100);
 const qcPendingLots=(raw||[]).map((r:any)=>({referenceNo:r.reference_no,pendingDate:r.pending_date,partyName:r.party_name,productRaw:r.product_raw,lotNo:r.lot_no,codes:r.codes,quantity:r.quantity===null?null:Number(r.quantity)}));
 return NextResponse.json({qcPendingLots});
}
