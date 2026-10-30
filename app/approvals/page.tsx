'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {CheckCircle2, Clock3, Paperclip, PlusCircle, XCircle} from 'lucide-react';

type Req={id:string;title:string;description:string|null;status:string;decisionComment:string|null;decidedAt:string|null;createdAt:string;requestedBy:string;approverId:string;requesterName:string;approverName:string;attachmentUrl:string|null;attachmentName:string|null};

function statusPill(s:string){if(s==='approved')return'ok';if(s==='rejected')return'danger';return'warn'}

export default function ApprovalsPage(){
 const [data,setData]=useState<{mine:Req[];pendingMyApproval:Req[];all:Req[]|null}|null>(null);
 const [tab,setTab]=useState<'pending'|'mine'|'all'>('pending');
 const [profiles,setProfiles]=useState<{id:string;full_name:string;email:string}[]>([]);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[approverId,setApproverId]=useState(''),[file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[showForm,setShowForm]=useState(false);
 const [decisionBusy,setDecisionBusy]=useState<string>(''),[comments,setComments]=useState<Record<string,string>>({});

 function load(){fetch('/api/approvals',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setData(j)}).catch(()=>{})}
 useEffect(()=>{load();fetch('/api/directory',{cache:'no-store'}).then(r=>r.json()).then(j=>setProfiles(j.profiles||[])).catch(()=>{})},[]);
 useEffect(()=>{if(data&&!data.pendingMyApproval.length&&tab==='pending')setTab('mine')},[data]);

 async function submit(){
  if(!title.trim()||!approverId){setError('Title and approver are required.');return}
  setBusy(true);setError('');
  try{
   const fd=new FormData();fd.append('title',title);fd.append('description',description);fd.append('approverId',approverId);if(file)fd.append('file',file);
   const r=await fetch('/api/approvals',{method:'POST',body:fd}),j=await r.json();if(!r.ok)throw new Error(j.error);
   setTitle('');setDescription('');setApproverId('');setFile(null);setShowForm(false);setTab('mine');load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to create request')}finally{setBusy(false)}
 }
 async function decide(id:string,decision:'approved'|'rejected'){
  setDecisionBusy(id);setError('');
  try{const r=await fetch('/api/approvals',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision,comment:comments[id]||''})}),j=await r.json();if(!r.ok)throw new Error(j.error);load()}
  catch(e){setError(e instanceof Error?e.message:'Unable to record decision')}finally{setDecisionBusy('')}
 }

 const rows=tab==='pending'?data?.pendingMyApproval||[]:tab==='mine'?data?.mine||[]:data?.all||[];

 return <>
  <PageHeader title="Approvals" subtitle="Request approval from a colleague, or decide requests sent to you." backHref="/" backLabel="Home" action={<button className="btn btn-primary" onClick={()=>setShowForm(x=>!x)}><PlusCircle size={16}/> New request</button>}/>

  {showForm?<div className="card" style={{marginTop:16,maxWidth:640}}>
   <div className="section-title">New approval request</div>
   {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
   <div className="field" style={{marginTop:12}}><label>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs approval?"/></div>
   <div className="field" style={{marginTop:12}}><label>Details (optional)</label><textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Any context the approver should know"/></div>
   <div className="field" style={{marginTop:12}}><label>Approver</label><select value={approverId} onChange={e=>setApproverId(e.target.value)}><option value="">Select a person</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
   <div className="field" style={{marginTop:12}}><label>Photo or file (optional)</label><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></div>
   <button className="btn btn-primary" style={{marginTop:14}} disabled={busy} onClick={submit}>{busy?'Sending…':'Send request'}</button>
  </div>:null}

  <div className="tabs" style={{marginTop:16}}>
   <button className={`tab ${tab==='pending'?'active':''}`} onClick={()=>setTab('pending')}>Pending my approval {data?.pendingMyApproval.length?`(${data.pendingMyApproval.length})`:''}</button>
   <button className={`tab ${tab==='mine'?'active':''}`} onClick={()=>setTab('mine')}>My requests</button>
   {data?.all?<button className={`tab ${tab==='all'?'active':''}`} onClick={()=>setTab('all')}>All requests</button>:null}
  </div>

  {error&&!showForm?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}

  {!rows.length?<div className="empty">No requests here.</div>:<div className="grid" style={{gap:12}}>
   {rows.map(r=><article className="card tight" key={r.id}>
    <div className="split-header">
     <div>
      <b>{r.title}</b>
      <div className="sub" style={{marginTop:2}}>Requested by <b>{r.requesterName}</b> → <b>{r.approverName}</b> • {new Date(r.createdAt).toLocaleString('en-IN')}</div>
     </div>
     <span className={`pill ${statusPill(r.status)}`}>{r.status==='pending'?<Clock3 size={12}/>:r.status==='approved'?<CheckCircle2 size={12}/>:<XCircle size={12}/>} {r.status}</span>
    </div>
    {r.description?<p className="sub" style={{marginTop:8}}>{r.description}</p>:null}
    {r.attachmentUrl?<a href={r.attachmentUrl} target="_blank" rel="noreferrer" className="chat-attachment" style={{marginTop:8}}><Paperclip size={13}/> {r.attachmentName}</a>:null}
    {r.status!=='pending'?<div className="notice" style={{marginTop:10}}>Decided {r.decidedAt?new Date(r.decidedAt).toLocaleString('en-IN'):''}{r.decisionComment?`: ${r.decisionComment}`:''}</div>:null}
    {tab==='pending'&&r.status==='pending'?<div style={{marginTop:12}}>
     <input placeholder="Optional comment" value={comments[r.id]||''} onChange={e=>setComments(x=>({...x,[r.id]:e.target.value}))} style={{width:'100%',marginBottom:10}}/>
     <div style={{display:'flex',gap:10}}>
      <button className="btn btn-success" disabled={decisionBusy===r.id} onClick={()=>decide(r.id,'approved')}>Approve</button>
      <button className="btn btn-danger" disabled={decisionBusy===r.id} onClick={()=>decide(r.id,'rejected')}>Reject</button>
     </div>
    </div>:null}
   </article>)}
  </div>}
 </>;
}
