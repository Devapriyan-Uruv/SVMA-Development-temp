import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {computeQcSettlementRows} from '@/lib/ops/reconciliationQc';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const date=req.nextUrl.searchParams.get('date');
 if(!date)return NextResponse.json({error:'A date is required.'},{status:400});
 const rows=await computeQcSettlementRows(date);
 return NextResponse.json({rows});
}
