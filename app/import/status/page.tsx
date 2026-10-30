'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Download} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {IMPORT_STATUS_LABELS} from '@/lib/trade';

// What the morning status points at: contracts awaiting review, the empty fields on every open import record (fill them here), and today's date alerts.
type Miss={field:string;label:string;stage:string;due:boolean;column:number|null};
type Rec={id:string;refCode:string;commodityId:number|null;supplier:string;contractNo:string|null;status:string;due:Miss[];later:Miss[]};
type Status={today:string;openRecords:number;records:Rec[];recordsNeedingInput:number;fieldsNeeded:number;pendingContracts:{id:string;ref:string;supplier:string;waitingDays:number}[];contractsWithoutRecord:{id:string;ref:string;supplier:string}[];alerts:{title:string;body:string;severity:string;contractId:string}[];canEdit:boolean};
const camel=(s:string)=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
const kind=(f:string)=>/_date$/.test(f)?'date':f==='documents_complete'?'yn':/qty|value|rate|amount|charges|duty|igst|principal|interest|assessable/.test(f)?'number':'text';
const LINK_ONLY=new Set(['supplier','commodity']); // shown with a link to the record instead of an inline box
const day=(d:string)=>new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});

export default function ImportStatusPage(){
 const [d,setD]=useState<Status|null>(null),[err,setErr]=useState(''),[msg,setMsg]=useState(''),[val,setVal]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[open,setOpen]=useState<string|null>(null),[xl,setXl]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch('/api/import/status',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error);setD(j);setErr('')}catch(e){setErr(e instanceof Error?e.message:'Unable to load.')}},[]);
 useEffect(()=>{void load();fetch('/api/import-contracts/alerts').catch(()=>{})},[load]);

 async function save(rec:Rec,m:Miss){
  const k=`${rec.id}|${m.field}`,raw=(val[k]??'').trim();if(!raw)return;setBusy(k);setMsg('');setErr('');
  try{
   if(m.field==='hsn'){if(rec.commodityId==null)throw new Error('Open the record to set its commodity first.');const r=await fetch('/api/trade/commodities',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:rec.commodityId,hsn:raw})}),j=await r.json();if(!r.ok)throw new Error(j.error)}
   else{const v=kind(m.field)==='number'?Number(raw.replace(/,/g,'')):kind(m.field)==='yn'?raw==='Y':raw;const r=await fetch('/api/import/entries',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:rec.id,[camel(m.field)]:v})}),j=await r.json();if(!r.ok)throw new Error(j.error)}
   setMsg(`${m.label} saved on ${rec.refCode}.`);setVal(x=>{const y={...x};delete y[k];return y});await load();
  }catch(e){setErr(e instanceof Error?e.message:'Unable to save.')}finally{setBusy('')}
 }

 async function excel(){
  setXl(true);setErr('');
  try{
   const r=await fetch('/api/import/master',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error);
   const XLSX=await import('xlsx'),wb=XLSX.utils.book_new();
   // Same layout as the Import Tracking sheet: a numbered row, the header row, then one row per invoice / shipment.
   const aoa:(string|number|null)[][]=[j.columns.map((c:any)=>c.no),j.columns.map((c:any)=>c.label),...j.rows.map((x:any)=>x.cells)];
   const ws=XLSX.utils.aoa_to_sheet(aoa);ws['!cols']=j.columns.map((c:any)=>({wch:Math.max(12,Math.min(30,c.label.length+3))}));XLSX.utils.book_append_sheet(wb,ws,'Import Master');
   const need=[['Ref code','Stage of the field','Field','Column no.','Needed now?'],...j.rows.flatMap((x:any)=>x.missing.map((m:any)=>[x.refCode,m.stageLabel,m.label,m.column??'',m.due?'Yes':'Later']))];
   const w2=XLSX.utils.aoa_to_sheet(need);w2['!cols']=[{wch:16},{wch:22},{wch:34},{wch:11},{wch:12}];XLSX.utils.book_append_sheet(wb,w2,'Needs input');
   XLSX.writeFile(wb,`Import_Master_open_contracts_${j.today}.xlsx`);
  }catch(e){setErr(e instanceof Error?e.message:'Unable to build the report.')}finally{setXl(false)}
 }

 if(!d)return <><PageHeader title="Import status" subtitle="" backHref="/import" backLabel="Import"/>{err?<div className="notice danger">{err}</div>:<div className="empty">Loading…</div>}</>;
 const tile=(k:string,v:number,warn?:boolean)=><div key={k}><span>{k}</span><b style={warn&&v?{color:'#c0392b'}:undefined}>{v}</b></div>;
 return <>
  <PageHeader title="Import status" subtitle="" backHref="/import" backLabel="Import" action={<button className="btn btn-outline" disabled={xl} onClick={excel}><Download size={15}/> {xl?'Building…':'Open contracts report (Excel)'}</button>}/>
  {err?<div className="notice danger" style={{marginTop:10}}>{err}</div>:null}{msg?<div className="notice" role="status" style={{marginTop:10}}>{msg}</div>:null}
  <div className="ticket-counts" style={{marginTop:14}}>{tile('Open records',d.openRecords)}{tile('Contracts awaiting review',d.pendingContracts.length,true)}{tile('Records needing input',d.recordsNeedingInput,true)}{tile('Fields to fill',d.fieldsNeeded,true)}{tile('Date alerts',d.alerts.length,true)}</div>

  {d.alerts.length?<section className="card" style={{marginTop:14}}><div className="section-title">Date alerts today</div>{d.alerts.map((a,i)=><div key={i} className={`notice ${a.severity==='critical'?'danger':a.severity==='warning'?'warn':''}`} style={{marginTop:8}}><b>{a.title}</b><div>{a.body}</div><Link href={`/import/contracts/${a.contractId}`}>Open the Settlement sheet</Link></div>)}</section>:null}

  {d.pendingContracts.length||d.contractsWithoutRecord.length?<section className="card" style={{marginTop:14}}>
   <div className="section-title">Contracts to deal with</div>
   {d.pendingContracts.length?<><p className="sub" style={{margin:'6px 0'}}>Awaiting review and confirmation — confirming creates the import record.</p><div className="table-wrap" style={{border:0}}><table><thead><tr><th>Contract</th><th>Supplier</th><th>Waiting</th></tr></thead><tbody>{d.pendingContracts.map(c=><tr key={c.id}><td><Link href="/import/contracts">{c.ref}</Link></td><td>{c.supplier}</td><td>{c.waitingDays} day{c.waitingDays===1?'':'s'}</td></tr>)}</tbody></table></div></>:null}
   {d.contractsWithoutRecord.length?<><p className="sub" style={{margin:'10px 0 6px'}}>Confirmed but with no import record yet:</p>{d.contractsWithoutRecord.map(c=><div key={c.id}><Link href={`/import/contracts/${c.id}`}>{c.ref}</Link> • {c.supplier}</div>)}</>:null}
  </section>:null}

  <section className="card" style={{marginTop:14,padding:0}}>
   <div style={{padding:'14px 16px 0'}}><div className="section-title">Open import records — what is empty</div><p className="sub" style={{margin:'4px 0 8px'}}>“Needed now” fields belong to a stage the record has reached. Fields for later stages are listed but not chased.</p></div>
   {!d.records.length?<div className="empty">No open import records.</div>:d.records.map(r=><div key={r.id} style={{borderTop:'1px solid var(--border,#e5e7eb)',padding:'10px 16px'}}>
    <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',cursor:'pointer'}} onClick={()=>setOpen(open===r.id?null:r.id)}>
     <b>{r.refCode}</b><span>{r.supplier}</span><span className="sub">{r.contractNo||'no contract no'}</span><StatusBadge status="neutral" label={IMPORT_STATUS_LABELS[r.status]||r.status}/>
     <span className={`pill ${r.due.length?'danger':'ok'}`}>{r.due.length?`${r.due.length} needed now`:'Nothing needed now'}</span>{r.later.length?<span className="sub">{r.later.length} for later stages</span>:null}
     <Link href={`/import/${r.id}`} onClick={e=>e.stopPropagation()} style={{marginLeft:'auto'}}>Open record</Link>
    </div>
    {open===r.id||r.due.length&&open===null&&d.records.length===1?<div style={{marginTop:8}}>
     {[...r.due.map(m=>({m,due:true})),...r.later.map(m=>({m,due:false}))].map(({m,due})=>{const k=`${r.id}|${m.field}`,t=kind(m.field);return <div key={m.field} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',opacity:due?1:.6,flexWrap:'wrap'}}>
      <span style={{width:230}}>{m.label}{m.column?<span className="sub"> · col {m.column}</span>:null}</span>
      {LINK_ONLY.has(m.field)?<Link href={`/import/${r.id}`}>Set on the record</Link>:d.canEdit?<>
       {t==='yn'?<select value={val[k]??''} onChange={e=>setVal({...val,[k]:e.target.value})}><option value="">—</option><option value="Y">Yes</option></select>:<input type={t==='date'?'date':t==='number'?'number':'text'} step="any" value={val[k]??''} onChange={e=>setVal({...val,[k]:e.target.value})} style={{width:170}}/>}
       <button className="btn btn-outline" disabled={busy===k||!(val[k]??'').trim()} onClick={()=>save(r,m)}>{busy===k?'Saving…':'Save'}</button></>:<span className="sub">view only</span>}
      {!due?<span className="sub">later</span>:null}
     </div>})}
    </div>:null}
   </div>)}
  </section>
 </>;
}
