'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download,FileUp} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import type {DaySummary,Row,Issue} from '@/lib/daySummary/build';
import type {LoadsSummary} from '@/lib/daySummary/loads';
import {buildTieOut} from '@/lib/daySummary/tie';

const inr=(n:number)=>`${n<0?'-':''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)?new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).replace(/ /g,'-'):d;
const MONEY=/amount|paid|value|difference|total|loss|settlement/i;
const isMoneyCol=(k:string)=>MONEY.test(k)&&!/notes for|ref|check|result|date|note$/i.test(k);
const TABS=[['loads','Loads summary'],['purchases','Purchases'],['sales','Sales'],['receipts','Received'],['payments','Sent from bank'],['firewood','Firewood'],['settlementCheck','Settlement check'],['notes','Notes & journals'],['erpChecks','Tally vs ERP'],['issues','Issues'],['hygiene','Data checks'],['orders','Orders'],['contra','Contra']] as const;
type Tab=typeof TABS[number][0];

function Table({rows}:{rows:Row[]|Issue[]}){
 if(!rows.length)return <div className="empty">Nothing to show for this day.</div>;
 const keys=Object.keys(rows[0]);
 return <div className="table-wrap" style={{maxHeight:'58vh',overflow:'auto'}}><table><thead><tr>{keys.map(k=><th key={k} style={{textAlign:isMoneyCol(k)?'right':undefined}}>{k.replace(/_/g,' ')}</th>)}</tr></thead><tbody>
  {(rows as Row[]).map((r,i)=><tr key={i}>{keys.map(k=>{const v=r[k];const bad=typeof v==='string'&&/(short|overpaid|differs|no erp|earlier|not in)/i.test(v)&&/(check|result|status)/i.test(k);return <td key={k} style={{textAlign:isMoneyCol(k)?'right':undefined,color:bad?'#b54708':(k==='severity'&&v==='high')?'#b42318':undefined,maxWidth:340}}>{v==null||v===''?'—':typeof v==='number'&&isMoneyCol(k)?inr(v):String(v)}</td>})}</tr>)}
 </tbody></table></div>;
}

function LoadsView({l}:{l:LoadsSummary}){
 const sections:[string,Row[],number][]=[['Purchase',l.purchase,l.totals.purchase],['Purchase D.C. (from Soya / Maxi Bio)',l.purchaseDc,l.totals.purchaseDc],['Sales',l.sales,l.totals.sales],['Sales D.C. (to Soya Foods / Maxi Bio)',l.salesDc,l.totals.salesDc],['Others',l.others,l.totals.others]];
 return <div style={{padding:12,display:'grid',gap:14}}>
  <div style={{display:'flex',gap:22,flexWrap:'wrap'}}>{sections.map(([t,,n])=><div key={t}><div className="kpi-label">{t.split(' (')[0]}</div><b style={{fontSize:20}}>{n}</b><span className="sub"> loads</span></div>)}</div>
  {sections.map(([t,rows])=><div key={t}><div className="section-title" style={{fontSize:14,marginBottom:4}}>{t}</div><Table rows={rows.filter(r=>r['Tally bills']!==0||r['ERP loads']!==0||r['No. of loads']!==0||/TOTAL|Pending|Inner|40-foot|Outer|Tuticorin|Export/.test(String(r.Particulars)))}/></div>)}
  <ul className="sub" style={{margin:'0 0 0 18px',display:'grid',gap:4}}>{l.notes.map((n,i)=><li key={i}>{n}</li>)}</ul>
 </div>;
}

export default function DaySummaryPage(){
 const [dates,setDates]=useState<{date:string;vouchers:number}[]>([]),[date,setDate]=useState(''),[sum,setSum]=useState<DaySummary|null>(null),[loads,setLoads]=useState<LoadsSummary|null>(null),[tab,setTab]=useState<Tab>('loads');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[notSetUp,setNotSetUp]=useState(false),[loading,setLoading]=useState(false);

 async function loadDates(select?:string){
  const r=await fetch('/api/finance/day-summary?dates=1',{cache:'no-store'});const j=await r.json().catch(()=>({}));
  if(r.status===503){setNotSetUp(true);return}if(!r.ok){setError(j.error||'Could not load the days.');return}
  setNotSetUp(false);setDates(j.dates);const pick=select||(j.dates[0]?.date)||'';setDate(pick);return pick;
 }
 async function loadSummary(d:string){
  if(!d)return;setLoading(true);setError('');
  try{const r=await fetch(`/api/finance/day-summary?date=${d}`,{cache:'no-store'});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Could not build the summary (HTTP ${r.status}).`);setSum(j.summary);setLoads(j.loads||null)}
  catch(e){setError(e instanceof Error?e.message:'Could not build the summary.');setSum(null);setLoads(null)}finally{setLoading(false)}
 }
 useEffect(()=>{void loadDates().then(d=>{if(d)void loadSummary(d)})},[]);

 async function gz(obj:unknown){const json=JSON.stringify(obj);const h:Record<string,string>={'Content-Type':'application/json'};let body:BodyInit=json;if(typeof CompressionStream!=='undefined'){body=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();h['Content-Type']='application/octet-stream';h['x-body-encoding']='gzip'}return {body,headers:h}}
 async function upload(file:File|undefined){
  if(!file)return;setError('');setNotice('');setBusy('Reading the Day Book…');
  try{
   await new Promise(r=>setTimeout(r,30));
   const [XLSX,engine]=await Promise.all([import('xlsx'),import('@/lib/outstanding/engine')]);
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
   let vouchers:ReturnType<typeof engine.parseDayBookRows>|null=null,last='';
   for(const n of wb.SheetNames){try{const v=engine.parseDayBookRows(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n],{header:1,raw:true,defval:null}));if(v.length){vouchers=v;break}}catch(e){last=e instanceof Error?e.message:String(e)}}
   if(!vouchers)throw new Error(last||'No vouchers were found in this file.');
   const maxDate=vouchers.reduce((m,v)=>v.date>m?v.date:m,'');const cutoff=new Date(Date.parse(`${maxDate}T00:00:00Z`)-45*86400000).toISOString().slice(0,10);
   const recent=vouchers.filter(v=>v.date>=cutoff);
   setBusy('Saving the days…');
   const a=await gz({fileName:file.name,vouchers:recent});const r1=await fetch('/api/finance/day-summary',{method:'POST',headers:a.headers,body:a.body});const j1=await r1.json().catch(()=>({}));
   if(!r1.ok)throw new Error(j1.error||`Could not save the days (HTTP ${r1.status}).`);
   // The same upload also updates Creditors / Debtors (the bills), exactly as uploading there does.
   setBusy('Updating Creditors / Debtors…');
   const c=engine.compactVouchers(vouchers);let credNote='';
   if(c.vouchers.length){const b=await gz({fileName:file.name,periodFrom:c.from,periodTo:c.to,totalVouchers:c.total,vouchers:c.vouchers});const r2=await fetch('/api/finance/outstanding',{method:'POST',headers:b.headers,body:b.body});credNote=r2.ok?' Creditors / Debtors updated.':' (Creditors / Debtors could not be updated — upload there if needed.)'}
   const saved=(j1.dates as any[]).map(d=>`${day(d.date)}: ${d.vouchers} vouchers${d.kept?' — kept (filtered export)':d.replaced?' (replaced)':''}`);
   setNotice(`Saved ${saved.length} day${saved.length===1?'':'s'}: ${saved.slice(0,4).join(' • ')}${saved.length>4?' …':''}.${credNote}`);
   const pick=await loadDates(maxDate);if(pick)await loadSummary(pick);
  }catch(e){const m=e instanceof Error?e.message:'Could not read the Day Book.';setError(/failed to load chunk|loading chunk|dynamically imported module/i.test(m)?'The tool was updated while this page was open. Refresh the page (Cmd + Shift + R) and upload again.':m)}finally{setBusy('')}
 }

 async function download(){
  if(!sum)return;const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();const h=sum.headline;
  const rows:(string|number|null)[][]=[['DAY SUMMARY LEDGER — '+day(sum.date)],[`${sum.vouchers} vouchers in the Day Book. ERP data used: receipts to ${sum.erpAsOf.receipts||'—'}, sales register ${sum.erpAsOf.salesFrom||'—'} to ${sum.erpAsOf.sales||'—'}, credit/debit notes to ${sum.erpAsOf.notes||'—'}.`],[],
   ['HEADLINE','Count','Amount (₹)'],['Sales booked',h.sales.n,h.sales.amount],['Purchases booked',h.purchases.n,h.purchases.amount],['Received (receipts)',h.received.n,h.received.amount],['Sent from the bank (payments)',h.sent.n,h.sent.amount],['Net bank movement','',h.netBank],['Firewood purchases',h.firewoodPurchases.n,h.firewoodPurchases.amount],['Firewood payments',h.firewoodPayments.n,h.firewoodPayments.amount],['Firewood sales',h.firewoodSales.n,h.firewoodSales.amount],[],
   ['TIE-OUT — SUMMARY VS SHEETS (same bills, same numbers)'],['Figure','Summary','By category / purpose','Sheet','Loads sheets','Status'],...buildTieOut(sum,loads).map(t=>[t.Figure,t.Summary,t['By category / purpose'],t.Sheet,t['Loads sheets'],t.Status]),[],
   ['PURCHASES BY CATEGORY','Count','Amount (₹)'],...sum.byCategory.purchases.map(c=>[c.category,c.n,c.amount]),[],['SALES BY CATEGORY','Count','Amount (₹)'],...sum.byCategory.sales.map(c=>[c.category,c.n,c.amount]),[],['PAYMENTS BY PURPOSE','Count','Amount (₹)'],...sum.byCategory.payments.map(c=>[c.purpose,c.n,c.amount]),[],
   ['WHAT WENT WELL'],...sum.management.wentWell.map(x=>[x]),[],['NEEDS ATTENTION'],...(sum.management.attention.length?sum.management.attention.map(x=>[x]):[['Nothing']])];
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:60},{wch:12},{wch:20},{wch:12},{wch:14},{wch:14}];XLSX.utils.book_append_sheet(wb,ws,'Summary');
  const D=day(sum.date);
  // Every sheet opens with its own heading and a line saying what it holds; the column headings follow.
  const sheet=(name:string,title:string,about:string,blocks:{heading?:string;rows:Row[]|Issue[]}[],foot:string[]=[])=>{
   const aoa:(string|number|null)[][]=[[`${title} — ${D}`],[about],[]];let cols:string[]=[];
   for(const b of blocks){const data=b.rows as Row[];if(b.heading)aoa.push([b.heading.toUpperCase()]);
    if(!data.length){aoa.push(['Nothing for this day']);aoa.push([]);continue}
    const keys=Object.keys(data[0]);if(keys.length>cols.length)cols=keys;aoa.push(keys.map(k=>{const t=k.replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1)}));for(const r of data)aoa.push(keys.map(k=>r[k]??null));aoa.push([])}
   if(foot.length){aoa.push(['NOTES']);for(const f of foot)aoa.push([f])}
   const s2=XLSX.utils.aoa_to_sheet(aoa);s2['!cols']=cols.map((k,i)=>({wch:i===0&&/S\.No/.test(k)?7:Math.min(52,Math.max(12,k.length+4))}));
   s2['!merges']=[{s:{r:0,c:0},e:{r:0,c:Math.max(cols.length-1,5)}},{s:{r:1,c:0},e:{r:1,c:Math.max(cols.length-1,5)}}];
   XLSX.utils.book_append_sheet(wb,s2,name);
  };
  if(loads){
   const T=loads.tie,sm=(t:typeof T.purchase)=>t.lines.n+t.dc.n+t.others.n;
   const tieP=`TIE-OUT: Tally bills on this report — template lines ${T.purchase.lines.n} + D.C. ${T.purchase.dc.n} + Others (purchase side) ${T.purchase.others.n} = ${sm(T.purchase)}; the Purchases sheet has ${sum.purchases.length}.`;
   const tieS=`TIE-OUT: Tally invoices on this report — template lines ${T.sales.lines.n} + D.C. ${T.sales.dc.n} + Others (sales side) ${T.sales.others.n} = ${sm(T.sales)}; the Sales sheet has ${sum.sales.length}.`;
   sheet('Loads - Purchase','NUMBER OF LOADS — PURCHASE','Purchase and purchase D.C. loads of the day: ERP weighments (physical loads) beside the Tally bills. Rice Bran is Direct only for Sri Amman Traders, M.M. Rice Mill and Sri Thiruchendur Murugan Traders.',[{heading:'Purchase',rows:loads.purchase},{heading:'Purchase D.C.',rows:loads.purchaseDc}],[tieP,...loads.notes]);
   sheet('Loads - Sales','NUMBER OF LOADS — SALES','Sales and sales D.C. loads of the day: ERP weighments (physical loads) beside the Tally invoices.',[{heading:'Sales',rows:loads.sales},{heading:'Sales D.C.',rows:loads.salesDc}],[tieS,...loads.notes]);
   sheet('Loads - Others','NUMBER OF LOADS — OTHERS','Firewood, broken rice, job work, service bills and anything that fits no template line, plus inner shifting, 40-foot containers, outer godown, direct sale from Tuticorin and export (shown when found).',[{rows:loads.others}],[`Others holds ${T.purchase.others.n} purchase-side bills and ${T.sales.others.n} sales-side invoices; they are part of the Purchases and Sales sheets and of the tie-out on the Purchase and Sales reports.`]);
  }
  sheet('Issues','ISSUES TO LOOK AT','Every exception found for the day, most serious first, with the action to take.',[{rows:sum.issues}]);
  sheet('Purchases','PURCHASES','Every purchase bill in the Tally Day Book (orders excluded), checked against the ERP purchase receipt.',[{rows:sum.purchases}]);
  sheet('Sales','SALES','Every sales invoice in the Tally Day Book (orders excluded), checked against the ERP Sales Register.',[{rows:sum.sales}]);
  sheet('Received','RECEIVED — RECEIPTS','Money received from customers, with the invoice each receipt is against and whether the ERP has that invoice.',[{rows:sum.receipts}]);
  sheet('Sent from bank','SENT FROM THE BANK — PAYMENTS','Every payment made from the bank, its purpose and, for supplier lots, whether the settlement paid is right.',[{rows:sum.payments}]);
  sheet('Firewood','FIREWOOD','Firewood purchases, payments to firewood suppliers and firewood sales, kept apart from the rest.',[{rows:sum.firewood}]);
  sheet('Settlement check','SETTLEMENT CHECK','For each lot paid today: total paid (earlier + today) against the ERP final settlement value.',[{rows:sum.settlementCheck}]);
  sheet('Notes & journals','DEBIT / CREDIT NOTES AND JOURNALS','Debit notes, credit notes and journals of the day, checked against the ERP Credit/Debit Note report.',[{rows:sum.notes}]);
  sheet('Tally vs ERP','TALLY VS ERP','Purchase and sales amounts in Tally against the ERP receipt / invoice, one line per voucher.',[{rows:sum.erpChecks}]);
  sheet('Data checks','DATA CHECKS — IS THE INFORMATION IN TALLY RIGHT','Possible duplicates, missing bill references, names that differ from the ERP and similar data-quality points.',[{rows:sum.hygiene}]);
  sheet('Orders','ORDERS','Purchase and sales order vouchers booked today. Orders are not counted as purchases or sales.',[{rows:sum.orders}]);
  sheet('Contra','CONTRA','Transfers between bank / cash accounts.',[{rows:sum.contra}]);
  XLSX.writeFile(wb,`Day_Summary_Ledger_${sum.date}.xlsx`);
 }

 const counts=useMemo(()=>sum?{loads:loads?loads.totals.purchase+loads.totals.purchaseDc+loads.totals.sales+loads.totals.salesDc+loads.totals.others:0,purchases:sum.purchases.length,sales:sum.sales.length,receipts:sum.receipts.length,payments:sum.payments.length,firewood:sum.firewood.length,settlementCheck:sum.settlementCheck.length,notes:sum.notes.length,erpChecks:sum.erpChecks.length,issues:sum.issues.length,hygiene:sum.hygiene.length,orders:sum.orders.length,contra:sum.contra.length}:null,[sum,loads]);
 const h=sum?.headline;
 const tie=useMemo(()=>sum?buildTieOut(sum,loads):[],[sum,loads]);
 const erpOld=sum&&[sum.erpAsOf.receipts,sum.erpAsOf.sales,sum.erpAsOf.notes].some(d=>d&&d<sum.date);
 return <>
  <PageHeader title="Day Summary Ledger" subtitle="Upload a day's Tally Day Book — purchases, sales, receipts, payments (firewood separate), checked against the ERP" backHref="/finance" backLabel="Finance"/>
  <div className="card tight" style={{marginTop:6,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
   <label className="btn btn-primary" style={{cursor:busy?'wait':'pointer'}}><FileUp size={16}/>Add a Day Book<input type="file" accept=".xlsx,.xls" style={{display:'none'}} disabled={!!busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label>
   {dates.length?<div className="field compact-field"><select value={date} onChange={e=>{setDate(e.target.value);void loadSummary(e.target.value)}}>{dates.map(d=><option key={d.date} value={d.date}>{day(d.date)} — {d.vouchers} vouchers</option>)}</select></div>:null}
   <button type="button" className="btn btn-outline" disabled={!sum} onClick={()=>void download()}><Download size={16}/>Download Excel</button>
   <span className="sub">{busy||(notSetUp?'Not set up yet — run sql/074_day_summary.sql in Supabase.':'Use the detailed Day Book (with bill lines). A one-day file or any period works; a date uploaded again is replaced.')}</span>
  </div>
  {notice?<div className="notice" style={{marginTop:10}}>{notice}</div>:null}
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {loading?<div className="empty" style={{marginTop:14}}>Building the summary…</div>:null}
  {sum&&h?<>
   {erpOld?<div className="notice warn" style={{marginTop:10}}>The ERP reports loaded run only to {[sum.erpAsOf.receipts,sum.erpAsOf.sales,sum.erpAsOf.notes].filter(Boolean).sort()[0]}, which is before {day(sum.date)} — upload the ERP reports for this day so purchases, sales and settlements can be checked.</div>:null}
   <div className="grid two" style={{marginTop:12}}>
    <div className="card tight"><div className="section-title">What went well</div><ul style={{margin:'8px 0 0 18px',display:'grid',gap:6}}>{sum.management.wentWell.map((x,i)=><li key={i}>{x}</li>)}</ul></div>
    <div className="card tight"><div className="section-title">Needs attention</div>{sum.management.attention.length?<ul style={{margin:'8px 0 0 18px',display:'grid',gap:6}}>{sum.management.attention.map((x,i)=><li key={i}>{x}</li>)}</ul>:<div className="sub" style={{marginTop:8}}>Nothing — every check passed for this day.</div>}</div>
   </div>
   <div className="grid four" style={{marginTop:10}}>
    <div className="card tight"><div className="kpi-label">Sales booked</div><b style={{fontSize:22}}>{inr(h.sales.amount)}</b><div className="sub">{h.sales.n} invoices</div></div>
    <div className="card tight"><div className="kpi-label">Purchases booked</div><b style={{fontSize:22}}>{inr(h.purchases.amount)}</b><div className="sub">{h.purchases.n} bills</div></div>
    <div className="card tight"><div className="kpi-label">Received</div><b style={{fontSize:22,color:'#067647'}}>{inr(h.received.amount)}</b><div className="sub">{h.received.n} receipts</div></div>
    <div className="card tight"><div className="kpi-label">Sent from the bank</div><b style={{fontSize:22,color:'#b42318'}}>{inr(h.sent.amount)}</b><div className="sub">{h.sent.n} payments • net {inr(h.netBank)}</div></div>
   </div>
   {tie.some(t=>t.Status!=='Ties')?<div className="notice danger" style={{marginTop:10}}>These figures do not tie across the Summary, the sheets and the Loads reports: {tie.filter(t=>t.Status!=='Ties').map(t=>t.Figure).join('; ')}. See the tie-out block on the Summary sheet of the Excel.</div>:<div className="sub" style={{marginTop:8}}>Tie-out: purchases, sales, receipts and payments give the same count and amount in the Summary, the category tables, the sheets and the Loads reports.</div>}
   <div className="grid three" style={{marginTop:10}}>
    {([['Purchases by category',sum.byCategory.purchases.map(c=>[c.category,c.n,c.amount])],['Sales by category',sum.byCategory.sales.map(c=>[c.category,c.n,c.amount])],['Sent from the bank, by purpose',sum.byCategory.payments.map(c=>[c.purpose,c.n,c.amount])]] as [string,(string|number)[][]][]).map(([t,list])=><div key={t} className="card tight"><div className="section-title" style={{fontSize:14}}>{t}</div><table><tbody>{list.map((r,i)=><tr key={i}><td>{r[0]}</td><td style={{textAlign:'right'}}>{r[1]}</td><td style={{textAlign:'right'}}>{inr(r[2] as number)}</td></tr>)}{!list.length?<tr><td className="sub">None</td></tr>:null}</tbody></table></div>)}
   </div>
   <div className="card tight" style={{marginTop:10}}><div className="section-title" style={{fontSize:14}}>Firewood</div><div style={{display:'flex',gap:26,flexWrap:'wrap',marginTop:6}}><div><div className="kpi-label">Purchases</div><b>{h.firewoodPurchases.n} • {inr(h.firewoodPurchases.amount)}</b></div><div><div className="kpi-label">Payments to firewood suppliers</div><b>{h.firewoodPayments.n} • {inr(h.firewoodPayments.amount)}</b></div><div><div className="kpi-label">Sales</div><b>{h.firewoodSales.n} • {inr(h.firewoodSales.amount)}</b></div></div></div>
   <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:14}}>{TABS.map(([k,l])=><button key={k} type="button" className={`btn ${tab===k?'btn-primary':'btn-outline'}`} onClick={()=>setTab(k)}>{l} • {counts?.[k]??0}</button>)}</div>
   <div className="card" style={{marginTop:8,padding:0}}>{tab==='loads'?(loads?<LoadsView l={loads}/>:<div className="empty">Loads are not available for this day.</div>):<Table rows={(sum as any)[tab]}/>}</div>
   <div className="sub" style={{marginTop:6}}>Checked against the ERP as last uploaded: receipts to {sum.erpAsOf.receipts||'—'}, sales register {sum.erpAsOf.salesFrom||'—'} to {sum.erpAsOf.sales||'—'}, credit/debit notes to {sum.erpAsOf.notes||'—'}. A lot is "right" when what has been paid in total equals the ERP final settlement value (before any advance).</div>
  </>:null}
 </>;
}
