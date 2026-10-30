import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {computeProductionStockRows} from '@/lib/ops/reconciliation';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const date=req.nextUrl.searchParams.get('date');
 if(!date)return NextResponse.json({error:'A date is required.'},{status:400});
 const rows=await computeProductionStockRows(date);
 return NextResponse.json({rows});
}
