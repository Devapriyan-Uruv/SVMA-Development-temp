'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Megaphone,Send,Trash2} from 'lucide-react';

type Announcement={id:string;title:string;body:string;createdAt:string;createdBy:string;read:boolean};

export default function AnnouncementsPage(){
 const [roles,setRoles]=useState<string[]>([]);
 const [items,setItems]=useState<Announcement[]>([]);
 const [showForm,setShowForm]=useState(false);
 const [title,setTitle]=useState(''),[body,setBody]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');

 function load(){fetch('/api/announcements',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setItems(j.announcements||[])}).catch(()=>{})}
 useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.roles)setRoles(j.roles)}).catch(()=>{});load()},[]);
 const canPublish=roles.includes('management')||roles.includes('super_admin');

 async function publish(){
  if(!title.trim()||!body.trim())return;setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/announcements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.trim(),body:body.trim()})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setTitle('');setBody('');setShowForm(false);setNotice('Published — every user will see it next time they open the app, plus a notification and push alert.');load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to publish')}finally{setBusy(false)}
 }
 async function retract(id:string){
  if(!confirm('Retract this announcement? It will stop showing to anyone who hasn\'t seen it yet.'))return;
  await fetch(`/api/announcements/${id}`,{method:'DELETE'});load();
 }

 return <>
  <PageHeader title="Announcements" subtitle="Company-wide news and release updates." backHref="/" backLabel="Home" action={canPublish?<button className="btn btn-primary" onClick={()=>{setShowForm(x=>!x);setError('')}}><Megaphone size={16}/> New announcement</button>:null}/>

  {showForm&&canPublish?<section className="card" style={{marginTop:14}}>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <label className="field"><span>Title</span><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. New chat features are live"/></label>
   <label className="field" style={{marginTop:12}}><span>Message</span><textarea rows={6} value={body} onChange={e=>setBody(e.target.value)} placeholder="What's new, why it matters, anything people should do…"/></label>
   <button className="btn btn-primary" style={{marginTop:12}} disabled={busy||!title.trim()||!body.trim()} onClick={publish}><Send size={15}/> {busy?'Publishing…':'Publish to everyone'}</button>
  </section>:null}
  {notice?<div className="notice" style={{marginTop:14}}>{notice}</div>:null}

  <div style={{display:'grid',gap:12,marginTop:16}}>
   {items.map(a=><article className="card tight" key={a.id}>
    <div className="split-header">
     <div><b>{a.title}</b><div className="sub" style={{marginTop:2}}>{a.createdBy} • {new Date(a.createdAt).toLocaleString('en-IN')}</div></div>
     {canPublish?<button type="button" className="row-action-btn" onClick={()=>retract(a.id)} title="Retract"><Trash2 size={14}/></button>:null}
    </div>
    <p style={{marginTop:10,whiteSpace:'pre-wrap',lineHeight:1.55}}>{a.body}</p>
   </article>)}
   {!items.length?<div className="empty">No announcements yet.</div>:null}
  </div>
 </>;
}
