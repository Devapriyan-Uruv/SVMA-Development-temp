import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {computeSalesReconciliationRows} from '@/lib/ops/reconciliationSales';
import {computeAvailability} from '@/lib/ops/availability';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const date=req.nextUrl.searchParams.get('date');
 // Availability (Free to Sell) is a "right now" figure, not date-scoped —
 // callers that only want it (e.g. the Management Control Tower KPI strip)
 // can omit ?date and skip the date-scoped SO-vs-invoice reconciliation.
 const [rows,availability]=await Promise.all([date?computeSalesReconciliationRows(date):Promise.resolve([]),computeAvailability()]);
 return NextResponse.json({rows,availability});
}
