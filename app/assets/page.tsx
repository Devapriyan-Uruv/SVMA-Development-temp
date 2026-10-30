'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Drawer} from '@/components/Drawer';
import {EmptyState} from '@/components/EmptyState';
import {Package,PlusCircle,History,UserPlus,Undo2} from 'lucide-react';

function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
const statusTone:Record<string,string>={available:'ok',assigned:'warn',maintenance:'neutral',retired:'danger'};

export default function AssetsPage(){
 const [records,setRecords]=useState<any[]>([]);
 const [employees,setEmployees]=useState<any[]>([]);
 const [addOpen,setAddOpen]=useState(false);
 const [assignFor,setAssignFor]=useState<any>(null);
 const [historyFor,setHistoryFor]=useState<any>(null);
 const [editFor,setEditFor]=useState<any>(null);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');

 function load(){fetch('/api/assets',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load();fetch('/api/admin/users',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setEmployees(j.users||[])}).catch(()=>{})},[]);

 return <>
  <PageHeader title="Assets" subtitle="Company asset registry — register once, then assign to employees." backHref="/" backLabel="Home" action={<button className="btn btn-primary" onClick={()=>{setAddOpen(true);setError('')}}><PlusCircle size={16}/> Register asset</button>}/>
  {notice?<div className="notice" style={{marginBottom:12}}>{notice}</div>:null}
  {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  {!records.length?<EmptyState title="No assets registered yet" description="Register the first company asset to get started."/>:
  <div className="table-wrap"><table><thead><tr><th>Tag</th><th>Name</th><th>Type</th><th>Serial</th><th>Status</th><th>Current holder</th><th>Warranty</th><th></th></tr></thead><tbody>
   {records.map((r:any)=><tr key={r.id}>
    <td>{r.asset_tag}</td><td>{r.name}</td><td>{r.type}</td><td>{r.serial_number||'—'}</td>
    <td><span className={`pill ${statusTone[r.status]||'neutral'}`}>{r.status}</span></td>
    <td>{r.currentHolder?.full_name||r.currentHolder?.email||'—'}</td>
    <td>{r.warranty_expiry||'—'}</td>
    <td style={{display:'flex',gap:6}}>
     {r.status==='available'?<button className="btn btn-outline btn-sm" onClick={()=>{setAssignFor(r);setError('')}}><UserPlus size={13}/> Assign</button>:null}
     <button className="btn btn-outline btn-sm" onClick={()=>setHistoryFor(r)}><History size={13}/> History</button>
     <button className="btn btn-outline btn-sm" onClick={()=>setEditFor({...r})}>Edit</button>
    </td>
   </tr>)}
  </tbody></table></div>}

  <Drawer open={addOpen} onClose={()=>setAddOpen(false)} title="Register asset" subtitle="Adds it to the company asset registry." footer={<><button type="button" className="btn btn-outline" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" form="register-asset-form" className="btn btn-primary">Register</button></>}>
   <RegisterAssetForm onError={setError} onDone={()=>{setAddOpen(false);setNotice('Asset registered.');load()}}/>
  </Drawer>

  <Drawer open={!!assignFor} onClose={()=>setAssignFor(null)} title={assignFor?`Assign ${assignFor.name}`:'Assign'} subtitle="Pulls this asset from the registry and tags it to an employee." footer={null}>
   {assignFor?<AssignForm asset={assignFor} employees={employees} onError={setError} onDone={()=>{setAssignFor(null);setNotice('Asset assigned.');load()}}/>:null}
  </Drawer>

  <Drawer open={!!historyFor} onClose={()=>setHistoryFor(null)} title={historyFor?`${historyFor.name} — history`:'History'} subtitle="Every assignment this asset has had." footer={null} wide>
   {historyFor?<AssetHistory assetId={historyFor.id} onReturned={()=>{load();setHistoryFor(null)}}/>:null}
  </Drawer>

  <Drawer open={!!editFor} onClose={()=>setEditFor(null)} title={editFor?.name||'Edit asset'} subtitle="Registry details." footer={null}>
   {editFor?<EditAssetForm asset={editFor} onError={setError} onDone={()=>{setEditFor(null);setNotice('Asset updated.');load()}}/>:null}
  </Drawer>
 </>;
}

function RegisterAssetForm({onError,onDone}:{onError:(s:string)=>void;onDone:()=>void}){
 const [assetTag,setAssetTag]=useState(''),[name,setName]=useState(''),[type,setType]=useState(''),[serialNumber,setSerialNumber]=useState('');
 const [purchaseDate,setPurchaseDate]=useState(''),[purchaseCost,setPurchaseCost]=useState(''),[vendor,setVendor]=useState(''),[warrantyExpiry,setWarrantyExpiry]=useState(''),[notes,setNotes]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();onError('');
  try{
   const r=await fetch('/api/assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assetTag,name,type,serialNumber,purchaseDate,purchaseCost,vendor,warrantyExpiry,notes})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   onDone();
  }catch(err){onError(err instanceof Error?err.message:'Unable to register asset')}
 }
 return <form id="register-asset-form" className="drawer-form" onSubmit={submit}>
  <Field label="Asset tag (unique)"><input required value={assetTag} onChange={e=>setAssetTag(e.target.value)} placeholder="e.g. SVMA-LAP-001"/></Field>
  <Field label="Name"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Dell Latitude 5440"/></Field>
  <Field label="Type"><input required value={type} onChange={e=>setType(e.target.value)} placeholder="Laptop / ID card / Uniform"/></Field>
  <Field label="Serial number"><input value={serialNumber} onChange={e=>setSerialNumber(e.target.value)}/></Field>
  <div className="grid two">
   <Field label="Purchase date"><input type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}/></Field>
   <Field label="Purchase cost"><input type="number" min={0} value={purchaseCost} onChange={e=>setPurchaseCost(e.target.value)}/></Field>
  </div>
  <div className="grid two">
   <Field label="Vendor"><input value={vendor} onChange={e=>setVendor(e.target.value)}/></Field>
   <Field label="Warranty expiry"><input type="date" value={warrantyExpiry} onChange={e=>setWarrantyExpiry(e.target.value)}/></Field>
  </div>
  <Field label="Notes"><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
 </form>;
}

function AssignForm({asset,employees,onError,onDone}:{asset:any;employees:any[];onError:(s:string)=>void;onDone:()=>void}){
 const [profileId,setProfileId]=useState(''),[issuedDate,setIssuedDate]=useState(''),[conditionNotes,setConditionNotes]=useState(''),[busy,setBusy]=useState(false);
 async function submit(){
  if(!profileId)return;onError('');setBusy(true);
  try{
   const r=await fetch('/api/assets/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',assetId:asset.id,profileId,issuedDate,conditionNotes})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   onDone();
  }catch(err){onError(err instanceof Error?err.message:'Unable to assign asset')}finally{setBusy(false)}
 }
 return <div className="drawer-body" style={{padding:0}}>
  <div className="drawer-form">
   <Field label="Employee"><select value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></Field>
   <Field label="Issued date"><input type="date" value={issuedDate} onChange={e=>setIssuedDate(e.target.value)}/></Field>
   <Field label="Condition notes"><input value={conditionNotes} onChange={e=>setConditionNotes(e.target.value)}/></Field>
   <button type="button" className="btn btn-primary" disabled={busy||!profileId} onClick={submit}>{busy?'Assigning…':'Assign asset'}</button>
  </div>
 </div>;
}

function AssetHistory({assetId,onReturned}:{assetId:number;onReturned:()=>void}){
 const [asset,setAsset]=useState<any>(null),[history,setHistory]=useState<any[]>([]);
 function load(){fetch(`/api/assets?id=${assetId}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error){setAsset(j.asset);setHistory(j.history||[])}})}
 useEffect(()=>{load()},[assetId]);
 async function markReturned(employeeAssetId:number){await fetch('/api/assets/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'return',employeeAssetId})});load();onReturned()}
 return <div className="drawer-body" style={{padding:0}}>
  <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Issued</th><th>Returned</th><th>Condition</th><th></th></tr></thead><tbody>
   {history.map((h:any)=><tr key={h.id}>
    <td>{h.profiles?.full_name||h.profiles?.email||'—'}</td><td>{h.issued_date}</td><td>{h.return_date||'—'}</td><td>{h.condition_notes||'—'}</td>
    <td>{!h.return_date?<button className="btn btn-outline btn-sm" onClick={()=>markReturned(h.id)}><Undo2 size={13}/> Return</button>:null}</td>
   </tr>)}
   {!history.length?<tr><td colSpan={5} className="sub">No assignment history yet.</td></tr>:null}
  </tbody></table></div>
 </div>;
}

function EditAssetForm({asset,onError,onDone}:{asset:any;onError:(s:string)=>void;onDone:()=>void}){
 const [form,setForm]=useState({name:asset.name,type:asset.type,serialNumber:asset.serial_number||'',purchaseDate:asset.purchase_date||'',purchaseCost:asset.purchase_cost??'',vendor:asset.vendor||'',warrantyExpiry:asset.warranty_expiry||'',notes:asset.notes||''});
 const [busy,setBusy]=useState(false);
 async function save(){
  onError('');setBusy(true);
  try{const r=await fetch('/api/assets',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:asset.id,...form})});const j=await r.json();if(!r.ok)throw new Error(j.error);onDone()}
  catch(err){onError(err instanceof Error?err.message:'Unable to update asset')}finally{setBusy(false)}
 }
 async function retire(){
  onError('');setBusy(true);
  try{const r=await fetch('/api/assets',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:asset.id,status:'retired'})});const j=await r.json();if(!r.ok)throw new Error(j.error);onDone()}
  catch(err){onError(err instanceof Error?err.message:'Unable to retire asset')}finally{setBusy(false)}
 }
 return <div className="drawer-form">
  <Field label="Name"><input value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))}/></Field>
  <Field label="Type"><input value={form.type} onChange={e=>setForm(x=>({...x,type:e.target.value}))}/></Field>
  <Field label="Serial number"><input value={form.serialNumber} onChange={e=>setForm(x=>({...x,serialNumber:e.target.value}))}/></Field>
  <div className="grid two">
   <Field label="Purchase date"><input type="date" value={form.purchaseDate} onChange={e=>setForm(x=>({...x,purchaseDate:e.target.value}))}/></Field>
   <Field label="Purchase cost"><input type="number" min={0} value={form.purchaseCost} onChange={e=>setForm(x=>({...x,purchaseCost:e.target.value}))}/></Field>
  </div>
  <div className="grid two">
   <Field label="Vendor"><input value={form.vendor} onChange={e=>setForm(x=>({...x,vendor:e.target.value}))}/></Field>
   <Field label="Warranty expiry"><input type="date" value={form.warrantyExpiry} onChange={e=>setForm(x=>({...x,warrantyExpiry:e.target.value}))}/></Field>
  </div>
  <Field label="Notes"><textarea rows={2} value={form.notes} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></Field>
  <div style={{display:'flex',gap:10,marginTop:8}}>
   <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save changes'}</button>
   {asset.status!=='assigned'?<button type="button" className="btn btn-danger" disabled={busy} onClick={retire}>Retire asset</button>:null}
  </div>
 </div>;
}
