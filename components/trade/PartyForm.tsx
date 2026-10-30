'use client';
import {useState} from 'react';

// The single "add a counterparty" form the brief asked for — one form,
// pick Supplier or Customer, never two separate screens. Shared by both
// Import and Export.
export function PartyForm({defaultType,busy,setBusy,onError,onDone}:{defaultType:'supplier'|'customer';busy:boolean;setBusy:(b:boolean)=>void;onError:(s:string)=>void;onDone:()=>void}){
 const [partyType,setPartyType]=useState<'supplier'|'customer'>(defaultType);
 const [name,setName]=useState(''),[country,setCountry]=useState(''),[contactPerson,setContactPerson]=useState('');
 const [phone,setPhone]=useState(''),[email,setEmail]=useState('');
 const [bankName,setBankName]=useState(''),[bankAccountNo,setBankAccountNo]=useState(''),[bankSwift,setBankSwift]=useState('');
 const [taxId,setTaxId]=useState(''),[notes,setNotes]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();onError('');setBusy(true);
  try{
   const r=await fetch('/api/trade/parties',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({partyType,name,country,contactPerson,phone,email,bankName,bankAccountNo,bankSwift,taxId,notes})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   onDone();
  }catch(err){onError(err instanceof Error?err.message:'Unable to save party')}finally{setBusy(false)}
 }
 return <form id="party-form" className="drawer-form" onSubmit={submit}>
  <label className="field"><span>Type</span>
   <div className="tabs" style={{marginTop:2}}>
    <button type="button" className={`tab ${partyType==='supplier'?'active':''}`} onClick={()=>setPartyType('supplier')}>Supplier</button>
    <button type="button" className={`tab ${partyType==='customer'?'active':''}`} onClick={()=>setPartyType('customer')}>Customer</button>
   </div>
  </label>
  <label className="field"><span>Name</span><input required value={name} onChange={e=>setName(e.target.value)}/></label>
  <div className="grid two">
   <label className="field"><span>Country</span><input value={country} onChange={e=>setCountry(e.target.value)}/></label>
   <label className="field"><span>Contact Person</span><input value={contactPerson} onChange={e=>setContactPerson(e.target.value)}/></label>
   <label className="field"><span>Phone</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label>
   <label className="field"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label className="field"><span>Bank Name</span><input value={bankName} onChange={e=>setBankName(e.target.value)}/></label>
   <label className="field"><span>Bank Account No.</span><input value={bankAccountNo} onChange={e=>setBankAccountNo(e.target.value)}/></label>
   <label className="field"><span>SWIFT / IFSC</span><input value={bankSwift} onChange={e=>setBankSwift(e.target.value)}/></label>
   <label className="field"><span>Tax / GST ID</span><input value={taxId} onChange={e=>setTaxId(e.target.value)}/></label>
  </div>
  <label className="field"><span>Notes</span><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  {busy?null:null}
 </form>;
}
