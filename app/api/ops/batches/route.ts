import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),reportType=req.nextUrl.searchParams.get('reportType'),date=req.nextUrl.searchParams.get('date');
 let q=db.from('ops_upload_batches').select('id,report_type,report_date,file_name,status,is_active,version_no,supersedes_batch_id,row_count,new_row_count,duplicate_row_count,correction_flagged_count,uploaded_by,created_at,completed_at').order('created_at',{ascending:false}).limit(100);
 if(reportType)q=q.eq('report_type',reportType);
 if(date)q=q.eq('report_date',date);
 const {data,error}=await q;
 if(error)return NextResponse.json({error:'Unable to load upload history.'},{status:500});
 return NextResponse.json({batches:data||[]});
}
