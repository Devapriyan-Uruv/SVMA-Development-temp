'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {PageHeader} from '@/components/PageHeader';
import {Drawer} from '@/components/Drawer';
import {EmptyState} from '@/components/EmptyState';
import {PartyForm} from '@/components/trade/PartyForm';
import {TradeInsights} from '@/components/trade/TradeInsights';
import {IMPORT_STATUS_LABELS} from '@/lib/trade';
import {PlusCircle,Search,Ship,Users,Settings,FileBarChart} from 'lucide-react';

export default function ImportPage(){
 const router=useRouter();
 const [roles,setRoles]=useState<string[]>([]);
 const [modules,setModules]=useState<string[]>([]);
 const [tab,setTab]=useState<'entries'|'parties'|'cost_categories'>('entries');
 const [entries,setEntries]=useState<any[]>([]);
 const [parties,setParties]=useState<any[]>([]);
 const [commodities,setCommodities]=useState<any[]>([]);
 const [categories,setCategories]=useState<any[]>([]);
 const [statusFilter,setStatusFilter]=useState('');
 const [q,setQ]=useState('');
 const [newOpen,setNewOpen]=useState(false),[partyOpen,setPartyOpen]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');

 function loadEntries(){fetch(`/api/import/entries${statusFilter?`?status=${statusFilter}`:''}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setEntries(j.entries||[])}).catch(()=>{})}
 function loadParties(){fetch('/api/trade/parties?type=supplier',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setParties(j.parties||[])}).catch(()=>{})}
 function loadCommodities(){fetch('/api/trade/commodities',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setCommodities(j.commodities||[])}).catch(()=>{})}
 function loadCategories(){fetch('/api/trade/cost-categories?module=import',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setCategories(j.categories||[])}).catch(()=>{})}

 useEffect(()=>{
  fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.roles)setRoles(j.roles);if(j?.modules)setModules(j.modules)}).catch(()=>{});
  loadEntries();loadParties();loadCommodities();loadCategories();
  const sweep=setInterval(()=>{void fetch('/api/trade/sla-sweep',{cache:'no-store'}).catch(()=>{})},60000);
  return ()=>clearInterval(sweep);
 },[]);
 useEffect(()=>{loadEntries()},[statusFilter]);

 // Anyone with import module access at all (granted per-user from Admin ->
 // Users & Access, or via an import_operator/import_manager/admin/
 // super_admin role) can add parties and create/edit entries — matches
 // how every API route here actually authorizes (moduleAuthorization
 // resolves to plain module-access once a user has ANY explicit grant,
 // same as app/finance/page.tsx's canTransaction/canVendor). Only the cost
 // -category admin tab stays role-gated, since that's a structural config
 // privilege the module-access grid has no way to express.
 const canEdit=modules.includes('import')||roles.some(r=>['import_operator','import_manager','admin','super_admin'].includes(r));
 const canManage=roles.some(r=>['import_manager','admin','super_admin'].includes(r));
 const isLeadership=roles.some(r=>['ceo','management','super_admin'].includes(r));

 const filtered=entries.filter(e=>!q.trim()||[e.ref_code,e.contract_no,e.trade_parties?.name,e.broker_name].filter(Boolean).some((v:string)=>String(v).toLowerCase().includes(q.trim().toLowerCase())));

 return <>
  <PageHeader title="Import" subtitle="Contracts, LC/Buyer's Credit, shipment, customs and landed cost — one shipment per record." backHref="/" backLabel="Home"
   action={<div style={{display:'flex',gap:8}}>
    <a className="btn btn-outline" href="/import/reports"><FileBarChart size={15}/> Reports</a>
    {canEdit?<button className="btn btn-primary" onClick={()=>{setNewOpen(true);setError('')}}><PlusCircle size={16}/> New Import Entry</button>:null}
   </div>}/>

  {isLeadership?<TradeInsights filterModule="import" linkBase={(_m,id)=>`/import/${id}`}/>:null}

  <div className="tabs" style={{marginBottom:16}}>
   <button className={`tab ${tab==='entries'?'active':''}`} onClick={()=>setTab('entries')}><Ship size={14}/> Entries</button>
   <a className="tab" href="/import/contracts" style={{textDecoration:'none'}}><FileBarChart size={14}/> Contracts &amp; Settlement</a>
   <a className="tab" href="/import/status" style={{textDecoration:'none'}}><FileBarChart size={14}/> Status &amp; input needed</a>
   <button className={`tab ${tab==='parties'?'active':''}`} onClick={()=>setTab('parties')}><Users size={14}/> Suppliers</button>
   {canManage?<button className={`tab ${tab==='cost_categories'?'active':''}`} onClick={()=>setTab('cost_categories')}><Settings size={14}/> Cost Categories</button>:null}
  </div>

  {tab==='entries'?<div className="card">
   <div className="split-header" style={{marginBottom:14,flexWrap:'wrap',gap:10}}>
    <div className="search-field" style={{maxWidth:320}}><Search size={14}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search ref, contract, supplier, broker…"/></div>
    <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{maxWidth:220}}>
     <option value="">All statuses</option>
     {Object.entries(IMPORT_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
   </div>
   {!filtered.length?<EmptyState title="No import entries yet" description="Create the first one to start tracking a shipment end to end."/>:
   <div className="table-wrap"><table><thead><tr><th>Ref Code</th><th>Supplier</th><th>Commodity</th><th>Contract No.</th><th>Qty</th><th>Value</th><th>Status</th></tr></thead><tbody>
    {filtered.map(e=><tr key={e.id} style={{cursor:'pointer'}} onClick={()=>router.push(`/import/${e.id}`)}>
     <td><b>{e.ref_code}</b></td><td>{e.trade_parties?.name||'—'}</td><td>{e.trade_commodities?.name||'—'}</td>
     <td>{e.contract_no||'—'}</td><td>{e.contract_qty||'—'} {e.trade_commodities?.unit||''}</td>
     <td>{e.currency} {Number(e.contract_value_fcy||0).toLocaleString('en-IN')}</td>
     <td><span className="pill info">{IMPORT_STATUS_LABELS[e.status]||e.status}</span></td>
    </tr>)}
   </tbody></table></div>}
  </div>:null}

  {tab==='parties'?<div className="card">
   <div className="split-header" style={{marginBottom:14}}><b>Suppliers</b>{canEdit?<button className="btn btn-outline btn-sm" onClick={()=>{setPartyOpen(true);setError('')}}><PlusCircle size={14}/> Add supplier</button>:null}</div>
   <div className="table-wrap"><table><thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Phone</th><th>Email</th></tr></thead><tbody>
    {parties.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.country||'—'}</td><td>{p.contact_person||'—'}</td><td>{p.phone||'—'}</td><td>{p.email||'—'}</td></tr>)}
    {!parties.length?<tr><td colSpan={5} className="sub">No suppliers added yet.</td></tr>:null}
   </tbody></table></div>
  </div>:null}

  {tab==='cost_categories'&&canManage?<CostCategoryAdmin categories={categories} commodities={commodities} onChanged={loadCategories}/>:null}

  <Drawer open={newOpen} onClose={()=>setNewOpen(false)} title="New Import Entry" subtitle="A reference code is generated automatically — everything else can be filled in on the entry page." footer={<><button type="button" className="btn btn-outline" onClick={()=>setNewOpen(false)}>Cancel</button><button type="submit" form="new-import-form" className="btn btn-primary" disabled={busy}>{busy?'Creating…':'Create & open'}</button></>}>
   <NewImportForm parties={parties} commodities={commodities} busy={busy} setBusy={setBusy} error={error} setError={setError} onCreated={id=>router.push(`/import/${id}`)}/>
  </Drawer>
  <Drawer open={partyOpen} onClose={()=>setPartyOpen(false)} title="Add supplier" footer={<><button type="button" className="btn btn-outline" onClick={()=>setPartyOpen(false)}>Cancel</button><button type="submit" form="party-form" className="btn btn-primary" disabled={busy}>{busy?'Saving…':'Save supplier'}</button></>}>
   <PartyForm defaultType="supplier" busy={busy} setBusy={setBusy} onError={setError} onDone={()=>{setPartyOpen(false);loadParties()}}/>
   {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  </Drawer>
 </>;
}

function NewImportForm({parties,commodities,busy,setBusy,error,setError,onCreated}:{parties:any[];commodities:any[];busy:boolean;setBusy:(b:boolean)=>void;error:string;setError:(s:string)=>void;onCreated:(id:string)=>void}){
 const [partyId,setPartyId]=useState(''),[commodityId,setCommodityId]=useState(''),[contractNo,setContractNo]=useState('');
 const [contractDate,setContractDate]=useState(''),[contractQty,setContractQty]=useState(''),[ratePerTon,setRatePerTon]=useState('');
 const [currency,setCurrency]=useState('USD'),[brokerName,setBrokerName]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try{
   const contractValueFcy=Number(contractQty||0)*Number(ratePerTon||0);
   const r=await fetch('/api/import/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({partyId,commodityId,contractNo,contractDate,contractQty:contractQty?Number(contractQty):null,ratePerTon:ratePerTon?Number(ratePerTon):null,currency,contractValueFcy:contractValueFcy||null,brokerName})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   onCreated(j.entry.id);
  }catch(err){setError(err instanceof Error?err.message:'Unable to create import entry')}finally{setBusy(false)}
 }
 return <form id="new-import-form" className="drawer-form" onSubmit={submit}>
  {error?<div className="notice danger">{error}</div>:null}
  <label className="field"><span>Supplier</span><select required value={partyId} onChange={e=>setPartyId(e.target.value)}><option value="">Select…</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label className="field"><span>Commodity</span><select required value={commodityId} onChange={e=>setCommodityId(e.target.value)}><option value="">Select…</option>{commodities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <div className="grid two">
   <label className="field"><span>Broker Name</span><input value={brokerName} onChange={e=>setBrokerName(e.target.value)}/></label>
   <label className="field"><span>Contract No.</span><input value={contractNo} onChange={e=>setContractNo(e.target.value)}/></label>
   <label className="field"><span>Contract Date</span><input type="date" value={contractDate} onChange={e=>setContractDate(e.target.value)}/></label>
   <label className="field"><span>Currency</span><input value={currency} onChange={e=>setCurrency(e.target.value)}/></label>
   <label className="field"><span>Contract Qty</span><input type="number" value={contractQty} onChange={e=>setContractQty(e.target.value)}/></label>
   <label className="field"><span>Rate / Ton</span><input type="number" value={ratePerTon} onChange={e=>setRatePerTon(e.target.value)}/></label>
  </div>
 </form>;
}

function CostCategoryAdmin({categories,commodities,onChanged}:{categories:any[];commodities:any[];onChanged:()=>void}){
 const [name,setName]=useState(''),[commodityId,setCommodityId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(){
  if(!name.trim())return;setBusy(true);setError('');
  try{const r=await fetch('/api/trade/cost-categories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'import',name:name.trim(),commodityId:commodityId||null})});const j=await r.json();if(!r.ok)throw new Error(j.error);setName('');setCommodityId('');onChanged()}
  catch(e){setError(e instanceof Error?e.message:'Unable to add cost category')}finally{setBusy(false)}
 }
 async function toggle(c:any){await fetch('/api/trade/cost-categories',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:c.id,active:!c.active})});onChanged()}
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  <p className="sub" style={{marginBottom:12}}>Leave commodity blank to apply a line to every commodity, or pick one to add a commodity-only extra (e.g. Fumigation just for Soya Bean) — no code change needed.</p>
  <div className="grid two" style={{marginBottom:14}}>
   <label className="field"><span>Cost category name</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Fumigation"/></label>
   <label className="field"><span>Commodity (optional)</span><select value={commodityId} onChange={e=>setCommodityId(e.target.value)}><option value="">Applies to all</option>{commodities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  </div>
  <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!name.trim()} onClick={add}>{busy?'Adding…':'Add cost category'}</button>
  <div className="table-wrap"><table><thead><tr><th>Category</th><th>Scope</th><th>Status</th><th></th></tr></thead><tbody>
   {categories.map(c=><tr key={c.id}><td>{c.name}</td><td>{c.commodity_id?(commodities.find(x=>x.id===c.commodity_id)?.name||'—'):'All commodities'}</td><td><span className={`pill ${c.active?'ok':'neutral'}`}>{c.active?'Active':'Inactive'}</span></td><td><button className="btn btn-outline btn-sm" onClick={()=>toggle(c)}>{c.active?'Deactivate':'Activate'}</button></td></tr>)}
  </tbody></table></div>
 </div>;
}
