import {moduleAuthorization,FINANCE_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import * as XLSX from 'xlsx';
import {exportTransactionWorkbook} from '@/lib/transactionExport';
import {CATEGORIES,calendarDate} from '@/lib/transactionPresence';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const az=await moduleAuthorization('finance_transaction',FINANCE_ROLES);if(!az.ok)return NextResponse.json({error:'Finance access not assigned'},{status:az.status});
 try {
  const body=await req.json();
  if(body.rulesVersion!=='8.1'||!Array.isArray(body.svmaCR)||!body.svmaCR.every((r:any)=>CATEGORIES.includes(r.status)&&Array.isArray(r.evidence)&&Array.isArray(r.candidates)))return NextResponse.json({error:'Run reconciliation with this version before exporting.'},{status:400});
  const date=calendarDate(body.reconciliationDate);if(!date)return NextResponse.json({error:'A valid reconciliation date is required.'},{status:400});
  const wb=exportTransactionWorkbook(body.svmaCR,date),out=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  return new NextResponse(out,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="SVMA_CR_${date}.xlsx"`}});
 }catch{return NextResponse.json({error:'The reconciliation result could not be exported. Run the reconciliation again.'},{status:400});}
}
