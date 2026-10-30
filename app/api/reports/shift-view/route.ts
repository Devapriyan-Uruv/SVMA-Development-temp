import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {buildShiftReportData} from '@/lib/shiftReport';
import {errorMessage,logServerError} from '@/lib/errors';

// Deliberately skips the Excel export's per-parameter AI commentary — an
// OpenAI call for every row isn't something a quick "let me look at this
// report" click should pay for (in time or cost) every time it's opened.
export async function GET(req:NextRequest){try{
 const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent',id=req.nextUrl.searchParams.get('shiftSessionId');
 if(!id)return NextResponse.json({error:'Shift session is required.'},{status:400});
 const az=scope==='quality'?await moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES):await moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES);
 if(!az.ok)return NextResponse.json({error:'Report access not assigned'},{status:az.status});
 const data=await buildShiftReportData(scope,id);
 return NextResponse.json(data);
}catch(e){logServerError('reports/shift-view',e);return NextResponse.json({error:errorMessage(e,'Unable to load report')},{status:500})}}
