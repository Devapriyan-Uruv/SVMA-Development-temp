'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {ChevronDown,ChevronRight,Download,FileUp,Search} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import type {OpenBill,PartyOutstanding,Scope,Side} from '@/lib/outstanding/engine';

type Source={kind:'tally_bills'|'tally_summary'|'daybook'|'none';asOf:string;fileName:string};

type LastUpload={fileName:string;at:string;from:string;to:string;inFile:number;added:number;changed:number;unchanged:number;removed?:number;missingFromFile?:number};
type Data={id?:string;fileName?:string|null;createdAt?:string;periodFrom:string;periodTo:string;vouchers:number;warnings:string[];parties:PartyOutstanding[];bills:OpenBill[];lastUpload?:LastUpload|null;ranges?:{from:string;to:string}[];sources?:Record<Side,Source>;resettlement?:Record<string,{lots:number;change:number;creditNotes:number;creditNoteAmount:number}>};
// Whole rupees everywhere on screen (paise only clutter the reading); big totals on the cards are shown in lakh / crore.
const inr=(n:number)=>{const r=Math.round(Math.abs(n));return `${n<0&&r>0?'-':''}₹${r.toLocaleString('en-IN')}`};
const short=(n:number)=>{const a=Math.abs(n),sign=n<0&&Math.round(a)>0?'-':'';return a>=1e7?`${sign}₹${(a/1e7).toFixed(2)} Cr`:a>=1e5?`${sign}₹${(a/1e5).toFixed(2)} L`:inr(n)};
const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)?new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).replace(/ /g,'-'):d;
const SCOPES:{key:Scope;label:string}[]=[{key:'local',label:'Local'},{key:'international',label:'International'}];
const SIDES:{key:Side;label:string;owe:string}[]=[{key:'creditor',label:'Creditors',owe:'We owe'},{key:'debtor',label:'Debtors',owe:'Owed to us'}];

export default function Outstanding(){
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const [scope,setScope]=useState<Scope>('local'),[side,setSide]=useState<Side>('creditor'),[q,setQ]=useState(''),[open,setOpen]=useState<string|null>(null),[showZero,setShowZero]=useState(false),[view,setView]=useState<'dashboard'|'parties'>('dashboard'),[dashScope,setDashScope]=useState<'all'|Scope>('all');

 const load=()=>fetch('/api/finance/outstanding',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Could not load (HTTP ${r.status}).`);setData(j.empty?null:j)}).catch(e=>setError(e instanceof Error?e.message:'Could not load.')).finally(()=>setLoading(false));
 useEffect(()=>{void load()},[]);

 async function upload(file:File|undefined){
  if(!file)return;
  setError('');setBusy('Reading the Day Book…');
  try{
   // The Day Book can cover a whole year, so it is read here in the browser; only the result goes to the server.
   await new Promise(r=>setTimeout(r,30));
   const [XLSX,engine,tallyLib]=await Promise.all([import('xlsx'),import('@/lib/outstanding/engine'),import('@/lib/outstanding/tally')]);
   // A Tally Outstandings export is small and its Dr / Cr marker lives in the cell formats, so those are kept for small files.
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellNF:file.size<3_000_000});
   const report=file.size<3_000_000?tallyLib.detectTallyReport(wb.Sheets[wb.SheetNames[0]]):null;
   if(report){
    setBusy('Saving the Tally report…');
    const r=await fetch('/api/finance/outstanding/tally',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName:file.name,report})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Could not save (HTTP ${r.status}).`);
    setData(j);setOpen(null);setQ('');return;
   }
   let vouchers:ReturnType<typeof engine.parseDayBookRows>|null=null,lastError='';
   for(const name of wb.SheetNames){try{const v=engine.parseDayBookRows(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name],{header:1,raw:true,defval:null}));if(v.length){vouchers=v;break}}catch(e){lastError=e instanceof Error?e.message:String(e)}}
   if(!vouchers)throw new Error(lastError||'No vouchers were found in this file.');
   // Only the vouchers that carry bill references are sent. The server adds the ones it has not seen, updates edited ones and
   // leaves the rest alone, then works the outstanding out from everything stored — so any file can be uploaded again safely.
   setBusy('Preparing…');await new Promise(r=>setTimeout(r,30));
   const c=engine.compactVouchers(vouchers);
   if(!c.vouchers.length)throw new Error(`This Day Book has ${c.total.toLocaleString('en-IN')} vouchers but no bill reference lines (New Ref / Agst Ref), so it cannot show which bill a payment settled. It was exported in Tally's summary layout — export it again as a detailed Day Book with bill-wise details, the same way as the earlier file that worked, and upload that.`);
   const json=JSON.stringify({fileName:file.name,periodFrom:c.from,periodTo:c.to,totalVouchers:c.total,vouchers:c.vouchers});
   let body:BodyInit=json;const headers:Record<string,string>={'Content-Type':'application/json'};
   if(typeof CompressionStream!=='undefined'){body=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();headers['Content-Type']='application/octet-stream';headers['x-body-encoding']='gzip'}
   setBusy('Adding new vouchers and working out the outstanding…');
   const r=await fetch('/api/finance/outstanding',{method:'POST',headers,body});
   const raw=await r.text();let j:any=null;try{j=raw?JSON.parse(raw):null}catch{j=null}
   if(!j)throw new Error(`The server did not return a result (HTTP ${r.status}${raw?'':', empty response'}). Please try again.`);
   if(!r.ok)throw new Error(j.error||`Could not save (HTTP ${r.status}).`);
   setData(j);setOpen(null);setQ('');
  }catch(e){const m=e instanceof Error?e.message:'Could not read the Day Book.';setError(/failed to load chunk|loading chunk|chunkloaderror|dynamically imported module/i.test(m)?'The tool was updated while this page was open, so part of it is out of date. Refresh the page (Cmd + Shift + R) and upload the Day Book again.':m)}finally{setBusy('')}
 }

 const inView=useMemo(()=>(data?.parties||[]).filter(p=>p.scope===scope&&p.side===side&&(showZero||p.openBills>0||Math.abs(p.outstanding)>=0.5)),[data,scope,side,showZero]);
 const term=q.trim().toLowerCase();
 const rows=useMemo(()=>term?inView.filter(p=>p.party.toLowerCase().includes(term)):inView,[inView,term]);
 const billsOf=useMemo(()=>{const m=new Map<string,OpenBill[]>();for(const b of data?.bills||[]){if(b.scope!==scope||b.side!==side)continue;(m.get(b.party)||m.set(b.party,[]).get(b.party)!).push(b)}return m},[data,scope,side]);
 const total=rows.reduce((s,p)=>s+p.outstanding,0),totalDue=rows.reduce((s,p)=>s+p.dueBills,0),totalAdv=rows.reduce((s,p)=>s+p.advances,0),totalBills=rows.reduce((s,p)=>s+p.openBills,0);
 const tabTotal=(sc:Scope,sd:Side)=>(data?.parties||[]).filter(p=>p.scope===sc&&p.side===sd).reduce((s,p)=>s+p.outstanding,0);
 const tabCount=(sc:Scope,sd:Side)=>(data?.parties||[]).filter(p=>p.scope===sc&&p.side===sd&&(p.openBills>0||Math.abs(p.outstanding)>=0.5)).length;
 const sideLabel=SIDES.find(s=>s.key===side)!;
 const BUCKETS=[{label:'0–30 days',from:0,to:30},{label:'31–60 days',from:31,to:60},{label:'61–90 days',from:61,to:90},{label:'Over 90 days',from:91,to:99999}];
 const dash=useMemo(()=>{
  const sc=(x:{scope:Scope})=>dashScope==='all'||x.scope===dashScope;
  const parties=(data?.parties||[]).filter(sc),bills=(data?.bills||[]).filter(sc);
  const card=(sd:Side,sco:Scope)=>{const P=(data?.parties||[]).filter(p=>p.side===sd&&p.scope===sco);return {net:P.reduce((a,p)=>a+p.outstanding,0),due:P.reduce((a,p)=>a+p.dueBills,0),adv:P.reduce((a,p)=>a+p.advances,0),parties:P.filter(p=>p.openBills>0).length,bills:P.reduce((a,p)=>a+p.openBills,0)}};
  const ageing=(sd:Side)=>BUCKETS.map(b=>{const L=bills.filter(x=>x.side===sd&&x.outstanding>0&&x.ageDays>=b.from&&x.ageDays<=b.to);return {...b,amount:L.reduce((a,x)=>a+x.outstanding,0),count:L.length}});
  const top=(sd:Side)=>parties.filter(p=>p.side===sd&&p.dueBills>0).sort((a,b)=>b.dueBills-a.dueBills).slice(0,10);
  const sum=(sd:Side,k:'dueBills'|'advances'|'outstanding')=>parties.filter(p=>p.side===sd).reduce((a,p)=>a+p[k],0);
  // What is really payable / receivable: each party's bills less its OWN advances. A party whose advances exceed its bills is an
  // excess (it does not reduce what is owed to / by anyone else).
  const net=(sd:Side)=>{const P=parties.filter(p=>p.side===sd);const owe=P.filter(p=>p.outstanding>=0.5),exc=P.filter(p=>p.outstanding<=-0.5);const names=new Set(owe.map(p=>p.party));
   const inv=bills.filter(x=>x.side===sd&&x.outstanding>0.5&&names.has(x.party)).length;const due=owe.reduce((a,p)=>a+p.dueBills,0),amount=owe.reduce((a,p)=>a+p.outstanding,0);
   return {amount,parties:owe.length,invoices:inv,gross:due,applied:due-amount,excess:exc.reduce((a,p)=>a+p.outstanding,0),excessParties:exc.length}};
  return {cards:{creditor:{local:card('creditor','local'),international:card('creditor','international')},debtor:{local:card('debtor','local'),international:card('debtor','international')}},ageC:ageing('creditor'),ageD:ageing('debtor'),topC:top('creditor'),topD:top('debtor'),payable:sum('creditor','dueBills'),receivable:sum('debtor','dueBills'),payNet:net('creditor'),recvNet:net('debtor'),advPaid:sum('creditor','advances'),advRecv:sum('debtor','advances')};
 },[data,dashScope]);
 const goParty=(p:PartyOutstanding)=>{setScope(p.scope);setSide(p.side);setQ(p.party);setShowZero(false);setOpen(p.party);setView('parties')};

 async function download(only?:string){
  const XLSX=await import('xlsx');
  const list=only?rows.filter(p=>p.party===only):rows;
  const partySheet=XLSX.utils.json_to_sheet(list.map(p=>({Party:p.party,'Bills due':p.dueBills,'Advance / excess':p.advances,'Net outstanding':p.outstanding,'Open bills':p.openBills,'Oldest (days)':p.oldestDays})));
  const billSheet=XLSX.utils.json_to_sheet(list.flatMap(p=>(billsOf.get(p.party)||[]).map(b=>({Party:b.party,'Bill / Lot reference':b.ref,Date:b.date,'Voucher type':b.voucherType,'Voucher no':b.voucherNo,'Bill value':b.settlementValue!==undefined?b.billValue:b.raised,'Debit / credit note deduction':b.noteDeduction??'','Journal deduction':b.journalDeduction??'','Settlement value':b.settlementValue??'',Paid:b.settlementValue!==undefined?b.paid:b.settled,'Outstanding (negative = advance)':b.outstanding,'Age (days)':b.ageDays}))));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,partySheet,'Parties');XLSX.utils.book_append_sheet(wb,billSheet,'Open bills');
  XLSX.writeFile(wb,`${only?only.replace(/[^A-Za-z0-9]+/g,'_').slice(0,40):`${scope}_${sideLabel.label}`}_outstanding_${data?.periodTo||''}.xlsx`);
 }

 return <>
  <PageHeader title="Creditors / Debtors" subtitle="Upload the Tally Day Book — outstanding by party and by bill / lot, split into Local and International" backHref="/finance" backLabel="Finance"/>
  <div className="card tight" style={{marginTop:6,display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
   <label className="btn btn-primary" style={{cursor:busy?'wait':'pointer'}}><FileUp size={16}/>{data?'Add a file':'Upload a file'}<input type="file" accept=".xlsx,.xls" style={{display:'none'}} disabled={!!busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label>
   <div style={{display:'grid',gap:2}}>
    <span className="sub">{busy||(data?`Covers ${(data.ranges?.length?data.ranges:[{from:data.periodFrom,to:data.periodTo}]).map(r=>`${day(r.from)} to ${day(r.to)}`).join(' and ')}${data.vouchers?` • ${data.vouchers.toLocaleString('en-IN')} vouchers with bills`:''}`:loading?'Loading…':'No Day Book uploaded yet.')}</span>
    {!busy&&data?.sources?<span className="sub">{(['debtor','creditor'] as Side[]).map(sd=>{const so=data.sources![sd];const nm=sd==='debtor'?'Debtors':'Creditors';return `${nm}: ${so.kind==='tally_bills'?'Tally pending bills':so.kind==='tally_summary'?'Tally group summary (party balances only)':so.kind==='daybook'?'worked out from the Day Book':'no data'}${so.asOf?` as of ${day(so.asOf)}`:''}`}).join(' • ')}</span>:null}
    {!busy&&data?.lastUpload?<span className="sub">Last upload {data.lastUpload.fileName} ({new Date(data.lastUpload.at).toLocaleString('en-GB')}): <b>{data.lastUpload.added.toLocaleString('en-IN')} new</b>, {data.lastUpload.unchanged.toLocaleString('en-IN')} already there{data.lastUpload.changed?`, ${data.lastUpload.changed} updated`:''}{data.lastUpload.removed?`, ${data.lastUpload.removed} removed (no longer in Tally)`:''}.</span>:null}
    {!busy?<span className="sub">Upload a Tally Day Book (detailed, with bill lines) or a Tally Outstandings export (Pending Bills / Group Summary). Uploading the same or an overlapping Day Book is safe — only new or edited vouchers are added.</span>:null}
   </div>
  </div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {data?.warnings?.length?<div className="notice warn" style={{marginTop:10}}>{data.warnings.map((w,i)=><div key={i}>{w}</div>)}</div>:null}

  {data?<div style={{display:'flex',gap:8,marginTop:14}}>
   <button type="button" className={`btn ${view==='dashboard'?'btn-primary':'btn-outline'}`} onClick={()=>setView('dashboard')}>Dashboard</button>
   <button type="button" className={`btn ${view==='parties'?'btn-primary':'btn-outline'}`} onClick={()=>setView('parties')}>Parties & bills — search</button>
  </div>:null}

  {data&&view==='dashboard'?<>
   <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap',alignItems:'center'}}>
    <span className="sub">Show:</span>
    {([['all','Local + International'],['local','Local'],['international','International']] as const).map(([k,l])=><button key={k} type="button" className={`btn ${dashScope===k?'btn-primary':'btn-outline'}`} onClick={()=>setDashScope(k)}>{l}</button>)}
    <span className="sub">{data.sources?(['debtor','creditor'] as Side[]).map(sd=>{const so=data.sources![sd];return `${sd==='debtor'?'Debtors':'Creditors'} as of ${so.asOf?day(so.asOf):'—'} (${so.kind==='daybook'?'Day Book':so.kind==='none'?'no data':'Tally'})`}).join(' • '):`As of ${day(data.periodTo)}`}</span>
   </div>
   <div className="grid four" style={{marginTop:10}}>
    <div className="card tight"><div className="kpi-label">You need to pay</div><b style={{fontSize:26}}>{short(dash.payNet.amount)}</b><div style={{fontSize:15,marginTop:2}}><b>{dash.payNet.invoices.toLocaleString('en-IN')}</b> invoices / lots • <b>{dash.payNet.parties}</b> parties</div><div className="sub">Bills {short(dash.payNet.gross)} less advances already paid to the same parties {short(dash.payNet.applied)}</div></div>
    <div className="card tight"><div className="kpi-label">You need to collect</div><b style={{fontSize:26}}>{short(dash.recvNet.amount)}</b><div style={{fontSize:15,marginTop:2}}><b>{dash.recvNet.invoices.toLocaleString('en-IN')}</b> invoices / lots • <b>{dash.recvNet.parties}</b> parties</div><div className="sub">Bills {short(dash.recvNet.gross)} less advances already received from the same parties {short(dash.recvNet.applied)}</div></div>
    <div className="card tight"><div className="kpi-label">Collect − pay</div><b style={{fontSize:26,color:dash.recvNet.amount-dash.payNet.amount<0?'#b42318':undefined}}>{short(dash.recvNet.amount-dash.payNet.amount)}</b><div className="sub">After each party's own advances</div></div>
    <div className="card tight"><div className="kpi-label">Advances in excess of bills</div><b style={{fontSize:20}}>Paid {short(dash.payNet.excess)}</b><div className="sub">{dash.payNet.excessParties} creditors • received {short(dash.recvNet.excess)} from {dash.recvNet.excessParties} debtors</div></div>
   </div>
   <div className="grid four" style={{marginTop:10}}>
    {SIDES.flatMap(sd=>SCOPES.map(sc=>{const c=dash.cards[sd.key][sc.key];return <button key={`${sd.key}${sc.key}`} type="button" className="card tight" style={{textAlign:'left',cursor:'pointer',opacity:dashScope==='all'||dashScope===sc.key?1:.45}} onClick={()=>{setScope(sc.key);setSide(sd.key);setQ('');setOpen(null);setView('parties')}}>
     <div className="kpi-label">{sc.label} {sd.label}</div><b style={{fontSize:20}}>{short(c.net)}</b>
     <div className="sub">Due {short(c.due)} • Advance {short(c.adv)}</div><div className="sub">{c.parties} parties • {c.bills} open bills</div></button>}))}
   </div>
   <div className="grid two" style={{marginTop:10}}>
    {([['Creditors — ageing of bills due',dash.ageC],['Debtors — ageing of bills due',dash.ageD]] as const).map(([title,rowsA])=>{const max=Math.max(1,...rowsA.map(r=>r.amount));return <div key={title} className="card tight"><div className="section-title">{title}</div>
     {rowsA.map(r=><div key={r.label} style={{display:'grid',gridTemplateColumns:'100px 1fr 170px',gap:8,alignItems:'center',marginTop:8}}><span className="sub">{r.label}</span><div style={{background:'#eef2f7',borderRadius:4,height:14}}><div style={{width:`${Math.round(r.amount/max*100)}%`,height:14,borderRadius:4,background:r.from>=91?'#b42318':r.from>=61?'#f79009':'#4f6bed'}}/></div><span style={{textAlign:'right'}}>{short(r.amount)} <span className="sub">({r.count})</span></span></div>)}</div>})}
   </div>
   <div className="grid two" style={{marginTop:10}}>
    {([['Top 10 creditors — we owe',dash.topC],['Top 10 debtors — owed to us',dash.topD]] as const).map(([title,list])=><div key={title} className="card tight"><div className="section-title">{title}</div>
     <table><thead><tr><th>Party</th><th style={{textAlign:'right'}}>Bills due</th><th style={{textAlign:'right'}}>Oldest</th></tr></thead><tbody>
      {list.map(p=><tr key={p.party} style={{cursor:'pointer'}} onClick={()=>goParty(p)}><td>{p.party}{dashScope==='all'&&p.scope==='international'?<span className="sub"> • International</span>:null}</td><td style={{textAlign:'right'}}>{inr(p.dueBills)}</td><td style={{textAlign:'right'}}>{p.oldestDays} d</td></tr>)}
      {!list.length?<tr><td colSpan={3}><div className="empty">Nothing outstanding.</div></td></tr>:null}
     </tbody></table></div>)}
   </div>
  </>:null}

  {data&&view==='parties'?<>
   <div style={{display:'flex',gap:8,marginTop:14,flexWrap:'wrap'}}>
    {SCOPES.map(s=><button key={s.key} type="button" className={`btn ${scope===s.key?'btn-primary':'btn-outline'}`} onClick={()=>{setScope(s.key);setOpen(null)}}>{s.label}</button>)}
    <span style={{width:12}}/>
    {SIDES.map(s=><button key={s.key} type="button" className={`btn ${side===s.key?'btn-primary':'btn-outline'}`} onClick={()=>{setSide(s.key);setOpen(null)}}>{s.label} • {tabCount(scope,s.key)} • {short(tabTotal(scope,s.key))}</button>)}
   </div>
   <div className="card tight" style={{marginTop:10}}>
    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
     <div className="field compact-field" style={{flex:'1 1 280px',display:'flex',alignItems:'center',gap:6}}><Search size={16}/><input value={q} onChange={e=>{setQ(e.target.value);setOpen(null)}} placeholder={`Search ${sideLabel.label.toLowerCase()} by name — e.g. MK Traders`} style={{flex:1}}/></div>
     <label className="sub" style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={showZero} onChange={e=>setShowZero(e.target.checked)}/>Include parties with nothing outstanding</label>
     <button type="button" className="btn btn-outline" disabled={!rows.length} onClick={()=>void download()}><Download size={16}/>Download Excel</button>
    </div>
    <div style={{display:'flex',gap:24,marginTop:12,flexWrap:'wrap'}}>
     <div><div className="kpi-label">{sideLabel.owe} — net {term?'(matching search)':'total'}</div><b style={{fontSize:22}}>{inr(total)}</b></div>
     <div><div className="kpi-label">Bills due</div><b style={{fontSize:22}}>{inr(totalDue)}</b></div>
     <div><div className="kpi-label">Advance / excess</div><b style={{fontSize:22}}>{inr(totalAdv)}</b></div>
     <div><div className="kpi-label">Parties</div><b style={{fontSize:22}}>{rows.length}</b></div>
     <div><div className="kpi-label">Open bills / lots</div><b style={{fontSize:22}}>{totalBills}</b></div>
    </div>
   </div>

   <div className="card" style={{marginTop:10,padding:0}}>
    <div className="table-wrap" style={{maxHeight:'62vh',overflow:'auto'}}>
     <table>
      <thead><tr><th style={{width:28}}/><th>Party</th><th style={{textAlign:'right'}}>Bills due</th><th style={{textAlign:'right'}}>Advance / excess</th><th style={{textAlign:'right'}}>Net outstanding</th><th>Resettlement</th><th style={{textAlign:'right'}}>Open bills</th><th style={{textAlign:'right'}}>Oldest (days)</th></tr></thead>
      <tbody>
       {rows.map(p=>{const isOpen=open===p.party,bl=billsOf.get(p.party)||[];return <Fragment key={p.party}>
        <tr onClick={()=>setOpen(isOpen?null:p.party)} style={{cursor:'pointer'}}>
         <td>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</td>
         <td><b>{p.party}</b>{p.scope==='international'&&p.why?<div className="sub">{p.why}</div>:null}</td>
         <td style={{textAlign:'right'}}>{inr(p.dueBills)}</td><td style={{textAlign:'right',color:p.advances<0?'#b42318':undefined}}>{p.advances?inr(p.advances):'—'}</td>
         <td style={{textAlign:'right',fontWeight:600,color:p.outstanding<0?'#b42318':undefined}}>{inr(p.outstanding)}</td>
         <td>{(()=>{const r=side==='creditor'?data?.resettlement?.[p.party]:undefined;if(!r||(!r.lots&&!r.creditNotes))return <span className="sub">—</span>;return <div style={{fontSize:13}}>{r.lots?<div><b>{r.lots}</b> re-settled lot{r.lots===1?'':'s'}<div className="sub">{r.change>0?'+':''}{inr(r.change)} payable</div></div>:null}{r.creditNotes?<div className="sub">{r.creditNotes} credit note{r.creditNotes===1?'':'s'} • {inr(r.creditNoteAmount)} extra</div>:null}</div>})()}</td>
         <td style={{textAlign:'right'}}>{p.openBills}</td><td style={{textAlign:'right'}}>{p.oldestDays||'—'}</td>
        </tr>
        {isOpen?<tr><td/><td colSpan={7} style={{background:'var(--surface-2,#f8fafc)'}}>
         <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'6px 0'}}><b>{p.party} — {bl.length} open bill{bl.length===1?'':'s'}</b><button type="button" className="btn btn-outline" onClick={e=>{e.stopPropagation();void download(p.party)}}><Download size={14}/>Download this party</button></div>
         <table>
          <thead><tr><th>Bill / Lot reference</th><th>Date</th><th>Voucher</th><th style={{textAlign:'right'}}>Bill value</th><th style={{textAlign:'right'}}>Debit / credit note deduction</th><th style={{textAlign:'right'}}>Journal deduction</th><th style={{textAlign:'right'}}>Settlement value</th><th style={{textAlign:'right'}}>Paid</th><th style={{textAlign:'right'}}>Outstanding</th><th style={{textAlign:'right'}}>Age (days)</th></tr></thead>
          <tbody>
           {bl.map((b,i)=><tr key={`${b.ref}-${i}`}><td>{b.ref}</td><td>{day(b.date)}</td><td>{b.voucherType}{b.voucherNo?` • ${b.voucherNo}`:''}</td>{(()=>{const has=b.settlementValue!==undefined;return <><td style={{textAlign:'right'}}>{inr(has?b.billValue!:b.raised)}</td><td style={{textAlign:'right'}}>{has?inr(b.noteDeduction!):'—'}</td><td style={{textAlign:'right'}}>{has?inr(b.journalDeduction!):'—'}</td><td style={{textAlign:'right',fontWeight:600}}>{has?inr(b.settlementValue!):'—'}</td><td style={{textAlign:'right'}}>{inr(has?b.paid!:b.settled)}</td></>})()}<td style={{textAlign:'right',fontWeight:600,color:b.outstanding<0?'#b42318':undefined}}>{inr(b.outstanding)}</td><td style={{textAlign:'right'}}>{b.ageDays}</td></tr>)}
           <tr><td colSpan={3} style={{textAlign:'right'}}><b>Total</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+(b.settlementValue!==undefined?b.billValue!:b.raised),0))}</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+(b.noteDeduction||0),0))}</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+(b.journalDeduction||0),0))}</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+(b.settlementValue||0),0))}</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+(b.settlementValue!==undefined?b.paid!:b.settled),0))}</b></td><td style={{textAlign:'right'}}><b>{inr(bl.reduce((s,b)=>s+b.outstanding,0))}</b></td><td/></tr>
          </tbody>
         </table>
         {!bl.length?<div className="sub">Only the party's closing balance is known from the Tally Group Summary — upload the Tally Pending Bills export for this group to see the individual bills.</div>:null}
         {p.settledAgainstEarlier>0?<div className="sub" style={{marginTop:6}}>{inr(p.settledAgainstEarlier)} was also paid/adjusted against bills raised before this Day Book starts — those older bills are not in the file, so they are not part of the outstanding above.</div>:null}
        </td></tr>:null}
       </Fragment>})}
       {!rows.length?<tr><td colSpan={8}><div className="empty">{term?`No ${sideLabel.label.toLowerCase()} match “${q}” under ${scope==='local'?'Local':'International'}.`:`No ${sideLabel.label.toLowerCase()} with an outstanding under ${scope==='local'?'Local':'International'}.`}</div></td></tr>:null}
      </tbody>
      {rows.length?<tfoot><tr><td/><td><b>Total ({rows.length} parties)</b></td><td style={{textAlign:'right'}}><b>{inr(totalDue)}</b></td><td style={{textAlign:'right'}}><b>{inr(totalAdv)}</b></td><td style={{textAlign:'right'}}><b>{inr(total)}</b></td><td/><td style={{textAlign:'right'}}><b>{totalBills}</b></td><td/></tr></tfoot>:null}
     </table>
    </div>
   </div>
  </>:!data&&!loading&&!busy?<div className="card" style={{marginTop:14}}><div className="empty">Upload the Tally Day Book to see creditors and debtors, split into Local and International.</div></div>:null}
 </>;
}
