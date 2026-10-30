'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {PageHeader} from '@/components/PageHeader';
import {TradeFieldGrid} from '@/components/trade/TradeFieldGrid';
import {CostLinesEditor} from '@/components/trade/CostLinesEditor';
import {exportTabs,valuesFromEntry} from '@/lib/tradeFields';
import {EXPORT_STATUSES,EXPORT_STATUS_LABELS} from '@/lib/trade';

export default function ExportEntryPage(){
 const params=useParams<{id:string}>();
 const id=params.id as string;
 const [entry,setEntry]=useState<any>(null);
 const [parties,setParties]=useState<any[]>([]);
 const [commodities,setCommodities]=useState<any[]>([]);
 const [roles,setRoles]=useState<string[]>([]);
 const [modules,setModules]=useState<string[]>([]);
 const [values,setValues]=useState<Record<string,any>>({});
 const [activeTab,setActiveTab]=useState('contract');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');

 function load(){
  fetch(`/api/export/entries?id=${id}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.error){setError(j.error);return}setEntry(j.entry)}).catch(()=>setError('Unable to load entry'));
 }
 useEffect(()=>{
  load();
  fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.roles)setRoles(j.roles);if(j?.modules)setModules(j.modules)}).catch(()=>{});
  fetch('/api/trade/parties?type=customer',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setParties(j.parties||[])}).catch(()=>{});
  fetch('/api/trade/commodities',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setCommodities(j.commodities||[])}).catch(()=>{});
 },[id]);

 const partyOptions=parties.map(p=>({value:String(p.id),label:p.name}));
 const commodityOptions=commodities.map(c=>({value:String(c.id),label:c.name}));
 const tabs=exportTabs(partyOptions,commodityOptions);

 useEffect(()=>{if(entry)setValues(valuesFromEntry(entry,tabs))},[entry]);

 // See app/import/page.tsx for why this checks module access, not just role.
 const canEdit=modules.includes('export')||roles.some(r=>['export_operator','export_manager','admin','super_admin'].includes(r));

 async function save(){
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/export/entries',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,...values})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setEntry(j.entry);setNotice('Saved.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save')}finally{setBusy(false)}
 }
 async function changeStatus(status:string){
  setBusy(true);setError('');
  try{const r=await fetch('/api/export/entries',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,status})});const j=await r.json();if(!r.ok)throw new Error(j.error);setEntry(j.entry)}
  catch(e){setError(e instanceof Error?e.message:'Unable to change status')}finally{setBusy(false)}
 }

 if(error&&!entry)return <><PageHeader title="Export Entry" backHref="/export" backLabel="Export"/><div className="notice danger">{error}</div></>;
 if(!entry)return <div className="empty">Loading…</div>;

 return <>
  <PageHeader title={entry.ref_code} subtitle={`${entry.trade_parties?.name||'—'} • ${entry.trade_commodities?.name||'—'}`} backHref="/export" backLabel="Export"
   action={canEdit?<select value={entry.status} disabled={busy} onChange={e=>changeStatus(e.target.value)}>{EXPORT_STATUSES.map(s=><option key={s} value={s}>{EXPORT_STATUS_LABELS[s]}</option>)}</select>:<span className="pill info">{EXPORT_STATUS_LABELS[entry.status]}</span>}/>

  {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  {notice?<div className="notice" style={{marginBottom:12}}>{notice}</div>:null}

  <div className="tabs" style={{marginBottom:16}}>
   {tabs.map(t=><button key={t.key} className={`tab ${activeTab===t.key?'active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
   <button className={`tab ${activeTab==='costing'?'active':''}`} onClick={()=>setActiveTab('costing')}>Costing</button>
  </div>

  {activeTab!=='costing'
   ?<div className="card">
    {tabs.filter(t=>t.key===activeTab).map(t=><TradeFieldGrid key={t.key} fields={t.fields} values={values} onChange={(k,v)=>setValues(x=>({...x,[k]:v}))} disabled={!canEdit}/>)}
    {canEdit?<button className="btn btn-primary" style={{marginTop:16}} disabled={busy} onClick={save}>{busy?'Saving…':'Save changes'}</button>:null}
   </div>
   :<CostLinesEditor apiBase={`/api/export/entries/${id}/cost-lines`} quantity={Number(entry.contract_qty||0)} unit={entry.trade_commodities?.unit||'MT'} canEdit={canEdit}/>}
 </>;
}
