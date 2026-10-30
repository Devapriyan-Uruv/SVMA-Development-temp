import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),sp=req.nextUrl.searchParams;
 let q=db.from('ops_exceptions').select('id,exception_type,severity,report_date,module,expected_value,actual_value,variance,variance_pct,description,status,created_at,ops_product_master(display_name)').order('report_date',{ascending:false}).order('created_at',{ascending:false}).limit(300);
 if(sp.get('from'))q=q.gte('report_date',sp.get('from')!);
 if(sp.get('to'))q=q.lte('report_date',sp.get('to')!);
 if(sp.get('status'))q=q.eq('status',sp.get('status')!);
 if(sp.get('severity'))q=q.eq('severity',sp.get('severity')!);
 if(sp.get('module'))q=q.eq('module',sp.get('module')!);
 const {data,error}=await q;
 if(error)return NextResponse.json({error:'Unable to load ERP exceptions.'},{status:500});
 return NextResponse.json({exceptions:data||[]});
}
export async function PATCH(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json(),id=String(b.id||''),status=String(b.status||'');
 if(!id||!['acknowledged','resolved','ignored','open'].includes(status))return NextResponse.json({error:'A valid id and status are required.'},{status:400});
 const db=supabaseAdmin();
 const update:any={status};
 if(status==='resolved'){update.resolved_by=az.user?.id||null;update.resolved_at=new Date().toISOString();}
 const {error}=await db.from('ops_exceptions').update(update).eq('id',id);
 if(error)return NextResponse.json({error:'Unable to update this exception.'},{status:500});
 return NextResponse.json({ok:true});
}
