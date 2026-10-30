'use client';
import {useCallback,useEffect,useState} from 'react';
import {FileUp} from 'lucide-react';

// Import-side upload of the Tally Day Book (detailed layout). It is read in the browser and saved by day through /api/import-contracts/daybook —
// the same store the Finance Day Summary Ledger uses — so the Settlement sheets can find each contract's duty, clearing and supplier vouchers.
async function gz(obj:unknown){const json=JSON.stringify(obj);const h:Record<string,string>={'Content-Type':'application/json'};let body:BodyInit=json;if(typeof CompressionStream!=='undefined'){body=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();h['Content-Type']='application/octet-stream';h['x-body-encoding']='gzip'}return {body,headers:h}}
const fmt=(d?:string|null)=>d?new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'—';

export function DayBookUpload({onDone,className}:{onDone?:()=>void;className?:string}){
 const [status,setStatus]=useState<{from:string|null;to:string|null;vouchers:number}|null>(null),[busy,setBusy]=useState(''),[msg,setMsg]=useState(''),[err,setErr]=useState('');
 const refresh=useCallback(()=>{fetch('/api/import-contracts/daybook',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setStatus(j)}).catch(()=>{})},[]);
 useEffect(refresh,[refresh]);
 async function upload(file?:File){
  if(!file)return;setErr('');setMsg('');setBusy('Reading the Day Book…');
  try{
   await new Promise(r=>setTimeout(r,30));
   const [XLSX,engine]=await Promise.all([import('xlsx'),import('@/lib/outstanding/engine')]);
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
   let vouchers:ReturnType<typeof engine.parseDayBookRows>|null=null,last='';
   for(const n of wb.SheetNames){try{const v=engine.parseDayBookRows(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n],{header:1,raw:true,defval:null}));if(v.length){vouchers=v;break}}catch(e){last=e instanceof Error?e.message:String(e)}}
   if(!vouchers)throw new Error(last||'No vouchers were found in this file. Export the Day Book in the detailed layout (with the ledger lines).');
   const byDate=new Map<string,typeof vouchers>();for(const v of vouchers)(byDate.get(v.date)||byDate.set(v.date,[]).get(v.date)!).push(v);
   const dates=[...byDate.keys()].sort();let saved=0,kept=0;
   // Saved in batches of days so a full-year Day Book never exceeds one request's time or size.
   for(let i=0;i<dates.length;i+=12){
    const part=dates.slice(i,i+12);setBusy(`Saving days ${i+1}–${Math.min(i+12,dates.length)} of ${dates.length}…`);
    const a=await gz({fileName:file.name,vouchers:part.flatMap(d=>byDate.get(d)!)});
    const r=await fetch('/api/import-contracts/daybook',{method:'POST',headers:a.headers,body:a.body}),j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`Could not save the Day Book (HTTP ${r.status}).`);
    for(const d of j.dates||[]){if(d.kept)kept++;else saved++}
   }
   setMsg(`Saved ${saved} day${saved===1?'':'s'} (${vouchers.length.toLocaleString('en-IN')} vouchers, ${fmt(dates[0])} to ${fmt(dates[dates.length-1])}).${kept?` ${kept} day(s) kept as saved — the file held far fewer vouchers for them.`:''}`);
   refresh();onDone?.();
  }catch(e){const m=e instanceof Error?e.message:'Could not read the Day Book.';setErr(/failed to load chunk|loading chunk|dynamically imported module/i.test(m)?'The tool was updated while this page was open. Refresh the page (Cmd + Shift + R) and upload again.':m)}finally{setBusy('')}
 }
 return <div className={className}>
  <label className="btn btn-outline" style={{display:'inline-flex',gap:6,cursor:busy?'wait':'pointer'}}><FileUp size={15}/>{busy||'Upload Tally Day Book'}<input type="file" accept=".xlsx,.xls" style={{display:'none'}} disabled={!!busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label>
  <span className="sub" style={{marginLeft:10}}>{status?(status.vouchers?`Saved: ${fmt(status.from)} to ${fmt(status.to)} • ${status.vouchers.toLocaleString('en-IN')} vouchers`:'No Day Book saved yet'):''}</span>
  {msg?<div className="notice" role="status" style={{marginTop:8}}>{msg}</div>:null}
  {err?<div className="notice danger" style={{marginTop:8}}>{err}</div>:null}
 </div>;
}
