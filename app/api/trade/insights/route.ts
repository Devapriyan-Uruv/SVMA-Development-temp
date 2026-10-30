import {NextResponse} from 'next/server';
import {anyModuleAuthorization,IMPORT_VIEW_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {getOpenAI,OPENAI_MODEL} from '@/lib/openai';
import {buildTradeDeterministic,fetchTradeRowsForInsights} from '@/lib/trade';

// The CEO/Management/Super Admin intelligence layer: "what went well, who
// needs attention, where's payment pending, where's shipment pending, and
// the next best action for each" — computed deterministically from real
// rows first (never invented; see lib/trade.ts's buildTradeDeterministic,
// shared with the Management dashboard), the same "deterministic base,
// optional AI enrichment" split already used in app/api/reports/route.ts.
// The AI layer (only active with OPENAI_API_KEY) is additive — a narrative
// summary on top of the structured lists, never a replacement for them, so
// a missing key still leaves a fully useful screen.
export async function GET(){
 try{
  const az=await anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_VIEW_ROLES},{module:'export',fallbackRoles:EXPORT_VIEW_ROLES}]);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export access is required'},{status:az.status});
  const db=supabaseAdmin();
  const {importRows,exportRows}=await fetchTradeRowsForInsights(db);
  const deterministic=buildTradeDeterministic(importRows,exportRows);
  let narrative:string|null=null;
  if(process.env.OPENAI_API_KEY&&(deterministic.needsAttention.length||deterministic.paymentPending.length||deterministic.shipmentPending.length||deterministic.whatWentWell.length)){
   try{
    const client=getOpenAI('Trade Insights');
    const prompt=`You are the CFO/Management intelligence layer for SVMA's Import/Export trade desk. Using ONLY the structured facts below (never invent numbers, dates, or causes), write a short (max 4 sentences) plain-English management brief: what's going well, what needs attention first, and the single most urgent next action. Facts:${JSON.stringify(deterministic)}`;
    const response=await client.responses.create({model:OPENAI_MODEL,input:prompt},{timeout:20000,maxRetries:1});
    narrative=response.output_text?.trim()||null;
   }catch{narrative=null}
  }
  return NextResponse.json({...deterministic,narrative});
 }catch(e){logServerError('trade/insights',e);return NextResponse.json({error:errorMessage(e,'Unable to build trade insights')},{status:500})}
}
