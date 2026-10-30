import {ShiftReportView} from '@/components/ShiftReportView';
export default async function SolventShiftReport({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ShiftReportView scope="solvent" shiftSessionId={id}/>}
