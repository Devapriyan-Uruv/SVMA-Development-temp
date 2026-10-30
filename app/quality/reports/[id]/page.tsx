import {ShiftReportView} from '@/components/ShiftReportView';
export default async function QualityShiftReport({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ShiftReportView scope="quality" shiftSessionId={id}/>}
