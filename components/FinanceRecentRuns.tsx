'use client';
import {useEffect,useState} from 'react';
import {Download,FileSpreadsheet} from 'lucide-react';

export function FinanceRecentRuns({type,title,note}:{type:'transaction'|'vendor_payment'|'ai_transaction';title?:string;note?:string}){
 const [date,setDate]=useState(''),[rows,setRows]=useState<any[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[downloading,setDownloading]=useState('');
 useEffect(()=>{const c=new AbortController();setBusy(true);setError('');fetch(`/api/reconcile/history?type=${type}&date=${date}`,{signal:c.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error);return j}).then(j=>setRows(j.runs)).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});return()=>c.abort()},[type,date]);
 async function download(id:string){setDownloading(id);setError('');try{const r=await fetch(`/api/reconcile/history?type=${type}&id=${id}`),j=await r.json();if(!r.ok)throw Error(j.error);const endpoint=type==='transaction'?'export-transaction':type==='ai_transaction'?'ai-transaction/export':'export-amount';const response=await fetch(`/api/reconcile/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(j)});if(!response.ok)throw Error('Unable to download. Please try again.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`SVMA_${type}_${j.reconciliationDate}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(e instanceof Error?e.message:'Unable to download.')}finally{setDownloading('')}}
 return <div className="card" style={{marginTop:16}}>
  <div className="split-header"><div><div className="section-title">{title||'Previous runs'}</div>{note?<div className="sub" style={{marginTop:4}}>{note}</div>:null}</div><label className="sub">Filter by date<input type="date" value={date} onChange={e=>setDate(e.target.value)} aria-label="Filter previous runs by date"/></label></div>
  {error?<div className="notice warn" role="alert">{error}</div>:null}
  {busy?<div className="empty">Loading…</div>:rows.length?<div className="report-list">{rows.map(r=><article className="report-row-card" key={r.id}><div className="report-type-icon"><FileSpreadsheet size={20}/></div><div><span className="eyebrow">{r.reconciliation_date}</span><p className="sub">Saved {new Date(r.created_at).toLocaleString('en-IN')}</p></div>{r.downloadable?<button className="btn btn-outline" disabled={!!downloading} onClick={()=>download(r.id)}><Download size={15}/>{downloading===r.id?'Downloading…':'Download'}</button>:<span className="sub">No saved detail</span>}</article>)}</div>:<div className="empty">No previous runs{date?` for ${date}`:''}.</div>}
 </div>;
}
