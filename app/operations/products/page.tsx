'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {OperationsNav} from '@/components/ops/OperationsNav';

export default function OpsProductsPage(){
 const [tab,setTab]=useState<'duplicates'|'products'|'productAliases'|'lotAliases'>('duplicates');
 return <>
  <PageHeader title="Products & Mapping" subtitle="New product/lot text is mapped automatically on upload. The two things that still need your call: possible duplicate products, and lot numbers that don't match exactly across files." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <div className="tabs" style={{marginTop:14}}>
   <button className={`tab ${tab==='duplicates'?'active':''}`} onClick={()=>setTab('duplicates')}>Possible Duplicates</button>
   <button className={`tab ${tab==='lotAliases'?'active':''}`} onClick={()=>setTab('lotAliases')}>Lot Aliases (RM)</button>
   <button className={`tab ${tab==='products'?'active':''}`} onClick={()=>setTab('products')}>Product Master</button>
   <button className={`tab ${tab==='productAliases'?'active':''}`} onClick={()=>setTab('productAliases')}>Product Aliases</button>
  </div>
  {tab==='duplicates'?<DuplicateSuggestions/>:tab==='products'?<ProductMaster/>:tab==='productAliases'?<ProductAliases/>:<LotAliases/>}
 </>;
}

function DuplicateSuggestions(){
 const [suggestions,setSuggestions]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [workingId,setWorkingId]=useState('');

 function load(){setBusy(true);fetch('/api/ops/products/merge-suggestions?status=pending').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(j=>setSuggestions(j.suggestions||[])).catch(e=>setError(e instanceof Error?e.message:'Unable to load')).finally(()=>setBusy(false))}
 useEffect(load,[]);

 async function act(id:string,action:'merge'|'dismiss'){
  setWorkingId(id);setError('');
  try{const r=await fetch('/api/ops/products/merge-suggestions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});if(!r.ok)throw new Error((await r.json()).error);load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update')}finally{setWorkingId('')}
 }

 return <section className="card" style={{marginTop:14,padding:0}}>
  {error?<div className="notice danger" style={{margin:14}}>{error}</div>:null}
  {busy?<div className="empty">Loading…</div>:!suggestions.length?<div className="empty">No possible duplicates flagged — every product name is either an exact repeat (already merged automatically) or different enough from every other product that it's kept separate.</div>:
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Keep</th><th>Possible duplicate of it</th><th>Similarity</th><th>Action</th></tr></thead><tbody>
    {suggestions.map((s:any)=><tr key={s.id}>
     <td><b>{s.keep?.display_name}</b><div className="sub">{s.keep?.product_code}</div></td>
     <td>{s.merge?.display_name}<div className="sub">{s.merge?.product_code}</div></td>
     <td>{s.confidence!=null?`${Math.round(s.confidence*100)}%`:'—'}</td>
     <td style={{display:'flex',gap:6}}>
      <button className="btn btn-primary" disabled={workingId===s.id} onClick={()=>act(s.id,'merge')}>{workingId===s.id?'Working…':'Merge — same product'}</button>
      <button className="btn btn-outline" disabled={workingId===s.id} onClick={()=>act(s.id,'dismiss')}>Not a duplicate</button>
     </td>
    </tr>)}
   </tbody></table></div>}
 </section>;
}

function ProductMaster(){
 const [products,setProducts]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [code,setCode]=useState('');
 const [name,setName]=useState('');
 const [category,setCategory]=useState('');

 function load(){setBusy(true);fetch('/api/ops/products').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(j=>setProducts(j.products||[])).catch(e=>setError(e.message)).finally(()=>setBusy(false))}
 useEffect(load,[]);

 async function create(){
  if(!code||!name)return setError('Product code and name are required.');
  setError('');
  try{const r=await fetch('/api/ops/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productCode:code,displayName:name,category})});if(!r.ok)throw new Error((await r.json()).error);setCode('');setName('');setCategory('');load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to create product')}
 }

 async function setType(id:string,productType:string){
  setProducts(ps=>ps.map(p=>p.id===id?{...p,product_type:productType||null}:p));
  try{const r=await fetch('/api/ops/products',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,productType:productType||null})});if(!r.ok)throw new Error((await r.json()).error);}
  catch(e){setError(e instanceof Error?e.message:'Unable to update product type');load();}
 }

 return <section className="card" style={{marginTop:14}}>
  <div className="grid three" style={{gap:10}}>
   <div className="field"><label>Product code</label><input value={code} onChange={e=>setCode(e.target.value)} placeholder="e.g. DORB"/></div>
   <div className="field"><label>Display name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. DE OILED RICE BRAN Normal (PLASTIC)"/></div>
   <div className="field"><label>Category</label><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Finished Good / Raw Material / …"/></div>
  </div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  <button className="btn btn-primary" style={{marginTop:10}} onClick={create}>Add product</button>
  <p className="sub" style={{marginTop:10}}>Type controls whether a product can appear in Sales' Free to Sell — raw material and packing material are excluded there.</p>
  <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>UOM</th><th>Type</th></tr></thead><tbody>
   {busy?<tr><td colSpan={5} className="sub">Loading…</td></tr>:products.map((p:any)=><tr key={p.id}><td>{p.product_code}</td><td>{p.display_name}</td><td>{p.category||'—'}</td><td>{p.uom}</td>
    <td><select value={p.product_type||''} onChange={e=>setType(p.id,e.target.value)}><option value="">— unclassified —</option><option value="finished_good">Finished Good</option><option value="raw_material">Raw Material</option><option value="packing_material">Packing Material</option></select></td>
   </tr>)}
   {!busy&&!products.length?<tr><td colSpan={5} className="sub">No products yet — add one above, or approve an AI suggestion under Product Aliases.</td></tr>:null}
  </tbody></table></div>
 </section>;
}

function ProductAliases(){
 const [aliases,setAliases]=useState<any[]>([]);
 const [products,setProducts]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [choice,setChoice]=useState<Record<string,string>>({});

 function load(){
  setBusy(true);
  Promise.all([fetch('/api/ops/products/aliases?status=pending').then(r=>r.json()),fetch('/api/ops/products').then(r=>r.json())])
   .then(([a,p])=>{setAliases(a.aliases||[]);setProducts(p.products||[])}).catch(e=>setError(e instanceof Error?e.message:'Unable to load')).finally(()=>setBusy(false));
 }
 useEffect(load,[]);

 const [busyId,setBusyId]=useState('');

 async function act(id:string,action:'approve'|'reject',productIdOverride?:string){
  try{const r=await fetch('/api/ops/products/aliases',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action,productId:productIdOverride??choice[id]})});if(!r.ok)throw new Error((await r.json()).error);load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update')}
 }

 // Common case: the same product text is unambiguous and there's no
 // existing master row yet — creating one manually first, then coming back
 // to approve, is a two-screen round trip for every single item, which is
 // real friction the first time a plant's product list is onboarded (seen
 // live: 15+ pending items with zero master products yet). This collapses
 // it to one click: derive a product code from the text, reuse an existing
 // product with that code if the same text was already approved for
 // another report type (e.g. "DORB" appearing in both Production and Stock
 // Summary), otherwise create it, then approve in the same action.
 async function quickCreateAndApprove(a:any){
  setBusyId(a.id);
  try{
   const code=a.source_text.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'PRODUCT';
   let productId=products.find((p:any)=>p.product_code===code)?.id;
   if(!productId){
    const r=await fetch('/api/ops/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productCode:code,displayName:a.source_text})});
    if(!r.ok){setError((await r.json()).error);return;}
    productId=(await r.json()).id;
   }
   await act(a.id,'approve',productId);
  }catch(e){setError(e instanceof Error?e.message:'Unable to create and approve')}
  finally{setBusyId('')}
 }

 return <section className="card" style={{marginTop:14,padding:0}}>
  {error?<div className="notice danger" style={{margin:14}}>{error}</div>:null}
  {busy?<div className="empty">Loading…</div>:!aliases.length?<div className="empty">No pending product mappings — every uploaded product text already resolves to a master product.</div>:
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Report Type</th><th>Source Text</th><th>Suggested By</th><th>Confidence</th><th>Map to existing</th><th>Action</th></tr></thead><tbody>
    {aliases.map((a:any)=><tr key={a.id}>
     <td>{a.report_type}</td><td>{a.source_text}</td><td>{a.suggested_by}</td><td>{a.confidence!=null?`${Math.round(a.confidence*100)}%`:'—'}</td>
     <td><select value={choice[a.id]||a.product_id||''} onChange={e=>setChoice(c=>({...c,[a.id]:e.target.value}))}><option value="">— choose product —</option>{products.map((p:any)=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select></td>
     <td style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <button className="btn btn-primary" disabled={!choice[a.id]&&!a.product_id} onClick={()=>act(a.id,'approve')}>Approve</button>
      <button className="btn btn-outline" disabled={busyId===a.id} onClick={()=>quickCreateAndApprove(a)}>{busyId===a.id?'Working…':'Quick create & approve'}</button>
      <button className="btn btn-outline" onClick={()=>act(a.id,'reject')}>Reject</button>
     </td>
    </tr>)}
   </tbody></table></div>}
 </section>;
}

function LotAliases(){
 const [aliases,setAliases]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');

 function load(){setBusy(true);fetch('/api/ops/lots/aliases?status=pending').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(j=>setAliases(j.aliases||[])).catch(e=>setError(e.message)).finally(()=>setBusy(false))}
 useEffect(load,[]);

 async function act(id:string,action:'approve'|'reject'){
  try{const r=await fetch('/api/ops/lots/aliases',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});if(!r.ok)throw new Error((await r.json()).error);load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update')}
 }

 return <section className="card" style={{marginTop:14,padding:0}}>
  {error?<div className="notice danger" style={{margin:14}}>{error}</div>:null}
  {busy?<div className="empty">Loading…</div>:!aliases.length?<div className="empty">No pending lot mappings — Raw Material reconciliation needs a Feeding lot uploaded before it can suggest a match.</div>:
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Feeding Lot</th><th>Suggested RM Lot</th><th>Confidence</th><th>Action</th></tr></thead><tbody>
    {aliases.map((a:any)=><tr key={a.id}><td>{a.feeding_lot_no}</td><td>{a.rm_batch_lot_no}</td><td>{a.confidence!=null?`${Math.round(a.confidence*100)}%`:'—'}</td>
     <td style={{display:'flex',gap:6}}><button className="btn btn-primary" onClick={()=>act(a.id,'approve')}>Approve</button><button className="btn btn-outline" onClick={()=>act(a.id,'reject')}>Reject</button></td>
    </tr>)}
   </tbody></table></div>}
 </section>;
}
