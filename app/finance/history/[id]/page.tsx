import {ReconciliationReportView} from '@/components/ReconciliationReportView';
export default async function ReconciliationReportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{type?:string}>}){
 const {id}=await params,{type}=await searchParams;
 return <ReconciliationReportView type={type==='vendor_payment'?'vendor_payment':type==='ai_transaction'?'ai_transaction':'transaction'} id={id}/>;
}
