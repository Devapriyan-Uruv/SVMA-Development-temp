'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {CheckCircle2, Clock3, ShieldCheck, XCircle} from 'lucide-react';

type Req={
 id:string;user_id:string;module:string;requested_by:string;
 previous_view:boolean;previous_edit:boolean;previous_delete:boolean;
 requested_view:boolean;requested_edit:boolean;requested_delete:boolean;
 status:string;decision_comment:string|null;decided_at:string|null;created_at:string;
 profiles?:{full_name:string|null;email:string|null};
 requester?:{full_name:string|null;email:string|null};
 approver?:{full_name:string|null;email:string|null};
};

function permsLabel(p:{view:boolean;edit:boolean;delete:boolean}){
 if(!p.view&&!p.edit&&!p.delete)return'No access';
 const parts=[];if(p.view)parts.push('View');if(p.edit)parts.push('Edit');if(p.delete)parts.push('Delete');
 return parts.join(' + ');
}
function statusPill(s:string){if(s==='approved')return'ok';if(s==='rejected')return'danger';return'warn'}

export default function AccessRequestsPage(){
 const [data,setData]=useState<{pending:Req[];recent:Req[]}|null>(null);
 const [tab,setTab]=useState<'pending'|'recent'>('pending');
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const [comments,setComments]=useState<Record<string,string>>({});

 function load(){fetch('/api/admin/access-requests',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setData(j)}).catch(()=>{})}
 useEffect(()=>{load()},[]);

 async function decide(id:string,decision:'approved'|'rejected'){
  setBusy(id);setError('');
  try{
   const r=await fetch('/api/admin/access-requests',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision,comment:comments[id]||''})}),j=await r.json();
   if(!r.ok)throw new Error(j.error);
   load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to record decision')}finally{setBusy('')}
 }

 const rows=tab==='pending'?data?.pending||[]:data?.recent||[];

 return <>
  <PageHeader title="Access Requests" subtitle="Every module access change for a user waits here for approval before it takes effect." backHref="/admin" backLabel="Administration"/>

  <div className="tabs" style={{marginTop:16}}>
   <button className={`tab ${tab==='pending'?'active':''}`} onClick={()=>setTab('pending')}>Pending {data?.pending.length?`(${data.pending.length})`:''}</button>
   <button className={`tab ${tab==='recent'?'active':''}`} onClick={()=>setTab('recent')}>Recently decided</button>
  </div>

  {error?<div className="notice danger" style={{margin:'12px 0'}}>{error}</div>:null}

  {!rows.length?<div className="empty">{tab==='pending'?'No access requests waiting on a decision.':'No decisions recorded yet.'}</div>:<div className="grid" style={{gap:12,marginTop:12}}>
   {rows.map(r=>{
    const who=r.profiles?.full_name||r.profiles?.email||'Unknown user';
    const requester=r.requester?.full_name||r.requester?.email||'Someone';
    const prev={view:r.previous_view,edit:r.previous_edit,delete:r.previous_delete};
    const next={view:r.requested_view,edit:r.requested_edit,delete:r.requested_delete};
    return <article className="card tight" key={r.id}>
     <div className="split-header">
      <div>
       <b><ShieldCheck size={14} style={{verticalAlign:-2,marginRight:4}}/>{who}</b>
       <div className="sub" style={{marginTop:2}}>{r.module.replaceAll('_',' ')} • requested by <b>{requester}</b> • {new Date(r.created_at).toLocaleString('en-IN')}</div>
      </div>
      <span className={`pill ${statusPill(r.status)}`}>{r.status==='pending'?<Clock3 size={12}/>:r.status==='approved'?<CheckCircle2 size={12}/>:<XCircle size={12}/>} {r.status}</span>
     </div>
     <div className="sub" style={{marginTop:8}}>Currently: <b>{permsLabel(prev)}</b> → Requested: <b>{permsLabel(next)}</b></div>
     {r.status!=='pending'?<div className="notice" style={{marginTop:10}}>Decided by {r.approver?.full_name||r.approver?.email||'—'} {r.decided_at?new Date(r.decided_at).toLocaleString('en-IN'):''}{r.decision_comment?`: ${r.decision_comment}`:''}</div>:null}
     {tab==='pending'?<div style={{marginTop:12}}>
      <input placeholder="Optional comment" value={comments[r.id]||''} onChange={e=>setComments(x=>({...x,[r.id]:e.target.value}))} style={{width:'100%',marginBottom:10}}/>
      <div style={{display:'flex',gap:10}}>
       <button className="btn btn-success" disabled={busy===r.id} onClick={()=>decide(r.id,'approved')}>Approve</button>
       <button className="btn btn-danger" disabled={busy===r.id} onClick={()=>decide(r.id,'rejected')}>Reject</button>
      </div>
     </div>:null}
    </article>;
   })}
  </div>}
 </>;
}
