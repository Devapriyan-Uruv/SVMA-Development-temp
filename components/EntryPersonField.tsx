'use client';
import {useRef,useState} from 'react';
import {Camera} from 'lucide-react';

// The operator of record is always whoever is logged in (entry_person_name
// is derived server-side from their own profile — see app/api/shift/session/
// route.ts) — this field is now photo-only, an optional visual record, not
// an identity field.
export function EntryPersonPhotoField({photoUrl,onPhotoUrl}:{photoUrl:string;onPhotoUrl:(v:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),fileInput=useRef<HTMLInputElement>(null);
 async function upload(file:File){setBusy(true);setError('');try{const fd=new FormData();fd.append('file',file);const r=await fetch('/api/shift/entry-photo',{method:'POST',body:fd}),j=await r.json();if(!r.ok)throw new Error(j.error);onPhotoUrl(j.url)}catch(e){setError(e instanceof Error?e.message:'Unable to upload photo')}finally{setBusy(false)}}
 return <div className="field" style={{marginTop:14}}>
  <label>Photo for the record (optional)</label>
  <div style={{display:'flex',alignItems:'center',gap:12}}>
   <button type="button" className="btn btn-outline" onClick={()=>fileInput.current?.click()} disabled={busy} style={{whiteSpace:'nowrap'}}>{photoUrl?<img src={photoUrl} alt="" style={{width:20,height:20,borderRadius:'50%',objectFit:'cover',verticalAlign:-5,marginRight:6}}/>:<Camera size={15} style={{verticalAlign:-3,marginRight:6}}/>}{busy?'Uploading…':photoUrl?'Photo added':'Add photo'}</button>
   <input ref={fileInput} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)upload(f)}}/>
  </div>
  {error?<div className="notice danger" style={{marginTop:8}}>{error}</div>:null}
 </div>;
}
