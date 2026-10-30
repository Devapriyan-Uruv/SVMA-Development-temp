import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,FINANCE_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
export async function GET(req:NextRequest){try{
 const typeParam=req.nextUrl.searchParams.get('type');
 const type=typeParam==='vendor_payment'?'vendor_payment':typeParam==='ai_transaction'?'ai_transaction':'transaction';
 const az=await moduleAuthorization(type==='vendor_payment'?'finance_vendor_payment':'finance_transaction',FINANCE_ROLES);
 if(!az.ok)return NextResponse.json({error:'Report access is not assigned.'},{status:az.status});
 const db=supabaseAdmin(),id=req.nextUrl.searchParams.get('id');
 if(id){const {data,error}=await db.from('reconciliation_runs').select('summary').eq('id',id).eq('reconciliation_type',type).maybeSingle();if(error)throw error;const report=data?.summary?.downloadReport;return report?NextResponse.json(report):NextResponse.json({error:'This older report has no saved detail. Upload its source files again to download it.'},{status:404})}
 const date=req.nextUrl.searchParams.get('date')||'',page=Math.max(0,Math.floor(Number(req.nextUrl.searchParams.get('page'))||0));
 if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Choose a valid date.'},{status:400});
 let query=db.from('reconciliation_runs').select('id,reconciliation_date,reconciliation_type,status,created_at,summary').eq('reconciliation_type',type).order('created_at',{ascending:false});if(date)query=query.eq('reconciliation_date',date);
 const {data,error}=await query.range(page*50,page*50+50);if(error)throw error;
 return NextResponse.json({hasMore:(data||[]).length>50,runs:(data||[]).slice(0,50).map(r=>({...r,summary:undefined,downloadable:!!r.summary?.downloadReport}))});
 }catch{return NextResponse.json({error:'Unable to load reports. Please try again.'},{status:500})}}
