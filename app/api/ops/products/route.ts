import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
export async function GET(){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const {data,error}=await db.from('ops_product_master').select('id,product_code,display_name,category,uom,active,created_at,product_type').order('display_name');
 if(error)return NextResponse.json({error:'Unable to load products.'},{status:500});
 return NextResponse.json({products:data||[]});
}
const PRODUCT_TYPES=new Set(['finished_good','raw_material','packing_material']);
export async function PATCH(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json();
 const id=String(b.id||'');
 if(!id)return NextResponse.json({error:'A product id is required.'},{status:400});
 const productType=b.productType===null||b.productType===''?null:String(b.productType||'');
 if(productType!==null&&!PRODUCT_TYPES.has(productType))return NextResponse.json({error:'productType must be finished_good, raw_material, packing_material, or null.'},{status:400});
 const db=supabaseAdmin();
 const {error}=await db.from('ops_product_master').update({product_type:productType}).eq('id',id);
 if(error)return NextResponse.json({error:'Unable to update product.'},{status:500});
 return NextResponse.json({ok:true});
}
export async function POST(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json();
 const productCode=String(b.productCode||'').trim(),displayName=String(b.displayName||'').trim();
 if(!productCode||!displayName)return NextResponse.json({error:'Product code and display name are required.'},{status:400});
 const db=supabaseAdmin();
 const {data,error}=await db.from('ops_product_master').insert({product_code:productCode,display_name:displayName,category:b.category||null,uom:b.uom||'MT',created_by:az.user?.id||null}).select('id').single();
 if(error)return NextResponse.json({error:error.code==='23505'?'A product with this code already exists.':'Unable to create product.'},{status:400});
 return NextResponse.json({id:(data as any).id});
}
