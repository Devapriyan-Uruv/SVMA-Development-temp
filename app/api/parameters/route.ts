import {moduleAuthorization,INPUT_ROLES,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function GET(req:NextRequest){
 try{
  const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent',kind=req.nextUrl.searchParams.get('kind')||'hourly',product=req.nextUrl.searchParams.get('product');
  const az=scope==='quality'?await moduleAuthorization('quality_input',QUALITY_INPUT_ROLES):await moduleAuthorization('input',INPUT_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':`${scope==='quality'?'Quality':'Solvent'} input access not assigned`},{status:az.status});
  const db=supabaseAdmin(),moduleName=scope==='quality'?'quality':kind==='boiler'?'boiler':kind==='plant'?['solvent','boiler']:'solvent';
  let q=db.from('parameter_master').select('*,parameter_sections!inner(id,name,module,sort_order)').eq('active',true);
  q=Array.isArray(moduleName)?q.in('parameter_sections.module',moduleName):q.eq('parameter_sections.module',moduleName);
  if(scope==='quality'&&product)q=q.eq('product_code',product);const {data,error}=await q;if(error)throw error;let rows=data||[];
  // Ordering by an embedded (referencedTable) column doesn't actually sort
  // the top-level rows with this client/join shape — confirmed live: even a
  // single, unchained .order('sort_order',{referencedTable:'parameter_sections'})
  // returned rows in a non-ascending order. This was invisible while every
  // section's sort_order happened to roughly track insertion order; it broke
  // visibly once sql/052 gave several sections deliberately out-of-order
  // (negative) sort_order values to move them to the front. Sorting in JS
  // sidesteps the PostgREST/client quirk entirely.
  rows.sort((a:any,b:any)=>{
    const sa=a.parameter_sections,sb=b.parameter_sections;
    return (sa?.sort_order??0)-(sb?.sort_order??0)||(sa?.id??0)-(sb?.id??0)||(a.sort_order??0)-(b.sort_order??0);
  });
  if(scope==='quality'||kind==='plant')rows=rows.filter((x:any)=>['hourly','every_two_hours','every_4_hours','once_per_shift','daily','first_shift_only','weekly'].includes(String(x.frequency||'')));
  else if(kind==='hourly')rows=rows.filter((x:any)=>['hourly','every_two_hours','every_4_hours'].includes(String(x.frequency||'')));
  else if(kind==='inspection')rows=rows.filter((x:any)=>['once_per_shift','daily','first_shift_only','weekly'].includes(String(x.frequency||'')));
  return NextResponse.json({parameters:rows,scope,module:moduleName,product:product||null});
 }catch(e){logServerError('parameters',e);return NextResponse.json({error:errorMessage(e,'Unable to load parameters')},{status:500})}
}
