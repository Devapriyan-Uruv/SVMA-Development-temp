'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {CalendarClock,DollarSign,PlusCircle,ShieldCheck,User,GraduationCap,FileText,Package,Target,Upload,Trash2,Download,Users,PartyPopper,Wallet,LayoutGrid,BookOpen} from 'lucide-react';

function money(n:number|null|undefined,currency='INR'){if(n==null)return '—';return `${currency==='INR'?'₹':currency+' '}${Number(n).toLocaleString('en-IN')}`}
const leaveTypes=['casual','sick','earned','unpaid'];
const documentCategoryLabels:Record<string,string>={aadhaar:'Aadhaar',pan:'PAN Card',passport:'Passport',address_proof:'Address Proof',education_certificate:'Education Certificate',resume:'Resume',offer_letter:'Offer Letter',experience_letter:'Experience Letter',relieving_letter:'Relieving Letter',photo:'Photo',other:'Other'};
function initials(name:string){const parts=name.trim().split(/\s+/).filter(Boolean);if(!parts.length)return '?';return (parts[0][0]+(parts[1]?.[0]||'')).toUpperCase()}

export default function MyHrPage(){
 const [tab,setTab]=useState<'overview'|'personal'|'education'|'documents'|'assets'|'performance'|'team'|'company_docs'>('overview');
 const [compRecords,setCompRecords]=useState<any[]>([]);
 const [insRecords,setInsRecords]=useState<any[]>([]);
 const [roster,setRoster]=useState<any[]>([]);
 const [leave,setLeave]=useState<{mine:any[];awaitingMyApproval:any[]}|null>(null);
 const [showLeaveForm,setShowLeaveForm]=useState(false);
 const [leaveType,setLeaveType]=useState('casual'),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[reason,setReason]=useState('');
 const [comments,setComments]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 // "My Team" only shows up for someone who actually has direct reports —
 // discovered from the goals endpoint's own myReports list rather than a
 // separate lookup, same as how "Awaiting my approval" leave already shows
 // up for any supervisor without a dedicated HR-role gate.
 const [myReports,setMyReports]=useState<{id:string;full_name:string;email:string}[]>([]);
 const [holidays,setHolidays]=useState<any[]>([]);
 const [leaveBalances,setLeaveBalances]=useState<any[]>([]);
 const [me,setMe]=useState<{full_name?:string;email?:string;phone?:string;designation?:string}|null>(null);

 function loadLeave(){fetch('/api/hr/leave',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setLeave(j)}).catch(()=>{})}
 useEffect(()=>{
  fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.profile)setMe(j.profile)}).catch(()=>{});
  fetch('/api/hr/compensation',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setCompRecords(j.records||[])}).catch(()=>{});
  fetch('/api/hr/insurance',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setInsRecords(j.records||[])}).catch(()=>{});
  fetch('/api/hr/roster',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRoster(j.roster||[])}).catch(()=>{});
  fetch('/api/hr/goals',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setMyReports(j.myReports||[])}).catch(()=>{});
  fetch('/api/hr/holidays',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setHolidays(j.holidays||[])}).catch(()=>{});
  fetch(`/api/hr/leave-balances?year=${new Date().getFullYear()}&self=1`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setLeaveBalances(j.balances||[])}).catch(()=>{});
  loadLeave();
 },[]);
 const today=new Date().toISOString().slice(0,10);
 const upcomingHolidays=holidays.filter(h=>h.holiday_date>=today).slice(0,5);

 const daysCount=startDate&&endDate?Math.max(1,Math.round((new Date(endDate).getTime()-new Date(startDate).getTime())/86400000)+1):0;
 async function submitLeave(){
  if(!startDate||!endDate)return;setBusy(true);setError('');
  try{
   const r=await fetch('/api/hr/leave',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leaveType,startDate,endDate,daysCount,reason})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setShowLeaveForm(false);setStartDate('');setEndDate('');setReason('');loadLeave();
  }catch(e){setError(e instanceof Error?e.message:'Unable to submit leave request')}finally{setBusy(false)}
 }
 async function decide(id:string,decision:'approved'|'rejected'){
  await fetch('/api/hr/leave',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision,comment:comments[id]||''})});
  loadLeave();
 }

 const latestComp=compRecords[0]||null;
 const activeInsurance=insRecords.filter(r=>!r.end_date||r.end_date>=new Date().toISOString().slice(0,10));

 const pendingApprovals=leave?.awaitingMyApproval.length||0;
 const totalLeaveLeft=leaveBalances.reduce((s,b:any)=>s+(b.remainingDays||0),0);

 return <>
  <PageHeader title="My HR" subtitle="Your profile, compensation, insurance, shift schedule and leave." backHref="/" backLabel="Home"/>

  <div className="module-hero hr-hero" style={{marginTop:14}}>
   <div className="hr-hero-inner">
    <div className="hr-hero-profile">
     <div className="hr-avatar">{initials(me?.full_name||'?')}</div>
     <div className="hr-hero-meta">
      <h2>{me?.full_name||'—'}</h2>
      <p>{me?.designation||'Employee'}</p>
      <div className="hr-hero-chips">
       {me?.email?<span>{me.email}</span>:null}
       {me?.phone?<span>{me.phone}</span>:null}
      </div>
     </div>
    </div>
    <div className="hr-hero-stats">
     <div className="hr-hero-stat"><span>Leave left</span><b>{totalLeaveLeft}d</b></div>
     <div className="hr-hero-stat"><span>Next holiday</span><b>{upcomingHolidays[0]?.holiday_date?.slice(5)||'—'}</b></div>
     <div className="hr-hero-stat"><span>Approvals</span><b>{pendingApprovals}</b></div>
    </div>
   </div>
  </div>

  <div className="worklet-grid">
   <div className={`worklet worklet-navy ${tab==='overview'?'active':''}`} onClick={()=>setTab('overview')}>
    <div className="worklet-icon"><LayoutGrid size={20}/></div><span>Overview</span>
    {pendingApprovals?<span className="worklet-badge">{pendingApprovals}</span>:null}
   </div>
   <div className={`worklet worklet-blue ${tab==='personal'?'active':''}`} onClick={()=>setTab('personal')}><div className="worklet-icon"><User size={20}/></div><span>Personal Details</span></div>
   <div className={`worklet worklet-purple ${tab==='education'?'active':''}`} onClick={()=>setTab('education')}><div className="worklet-icon"><GraduationCap size={20}/></div><span>Education</span></div>
   <div className={`worklet worklet-teal ${tab==='documents'?'active':''}`} onClick={()=>setTab('documents')}><div className="worklet-icon"><FileText size={20}/></div><span>Documents</span></div>
   <div className={`worklet worklet-amber ${tab==='assets'?'active':''}`} onClick={()=>setTab('assets')}><div className="worklet-icon"><Package size={20}/></div><span>My Assets</span></div>
   <div className={`worklet worklet-rose ${tab==='performance'?'active':''}`} onClick={()=>setTab('performance')}><div className="worklet-icon"><Target size={20}/></div><span>Performance</span></div>
   <div className={`worklet worklet-red ${tab==='company_docs'?'active':''}`} onClick={()=>setTab('company_docs')}><div className="worklet-icon"><BookOpen size={20}/></div><span>Company Docs</span></div>
   {myReports.length?<div className={`worklet worklet-green ${tab==='team'?'active':''}`} onClick={()=>setTab('team')}><div className="worklet-icon"><Users size={20}/></div><span>My Team</span></div>:null}
  </div>

  {tab==='overview'?<>
   {leave?.awaitingMyApproval.length?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Awaiting my approval</div>
    {leave.awaitingMyApproval.map(r=><div key={r.id} className="card tight" style={{marginTop:10}}>
     <b>{r.employee?.full_name||r.employee?.email}</b> — {r.leave_type} leave, {r.start_date} to {r.end_date} ({r.days_count} day{r.days_count===1?'':'s'})
     {r.reason?<p className="sub" style={{marginTop:4}}>{r.reason}</p>:null}
     <input placeholder="Optional comment" value={comments[r.id]||''} onChange={e=>setComments(x=>({...x,[r.id]:e.target.value}))} style={{width:'100%',margin:'8px 0'}}/>
     <div style={{display:'flex',gap:10}}><button className="btn btn-success" onClick={()=>decide(r.id,'approved')}>Approve</button><button className="btn btn-danger" onClick={()=>decide(r.id,'rejected')}>Reject</button></div>
    </div>)}
   </section>:null}

   <div className="grid two" style={{gap:16,marginTop:14}}>
    <section className="card">
     <div className="section-title"><DollarSign size={15} style={{verticalAlign:-2,marginRight:5}}/>My compensation</div>
     {latestComp?<>
      <div className="mini-stat" style={{marginTop:10}}><span className="kpi-label">Base salary • {latestComp.pay_frequency}</span><b style={{fontSize:20}}>{money(latestComp.base_salary,latestComp.currency)}</b></div>
      <p className="sub" style={{marginTop:8}}>Effective {latestComp.effective_date}</p>
     </>:<p className="sub" style={{marginTop:10}}>No compensation record yet — contact HR.</p>}
    </section>

    <section className="card">
     <div className="section-title"><ShieldCheck size={15} style={{verticalAlign:-2,marginRight:5}}/>My insurance</div>
     {activeInsurance.length?<div style={{display:'grid',gap:10,marginTop:10}}>
      {activeInsurance.map(r=><div key={r.id} className="card tight"><b>{r.policy_type}</b><p className="sub" style={{marginTop:2}}>{r.provider||'—'} • {money(r.coverage_amount)} cover{r.end_date?` • valid to ${r.end_date}`:''}</p>{r.documentUrl?<a href={r.documentUrl} target="_blank" rel="noreferrer">View policy document</a>:null}</div>)}
     </div>:<p className="sub" style={{marginTop:10}}>No active insurance record — contact HR.</p>}
    </section>
   </div>

   <section className="card" style={{marginTop:16}}>
    <div className="section-title"><CalendarClock size={15} style={{verticalAlign:-2,marginRight:5}}/>My upcoming shifts</div>
    {roster.length?<div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>Date</th><th>Department</th><th>Shift</th></tr></thead><tbody>
     {roster.map((r:any)=><tr key={r.id}><td>{r.roster_date}</td><td>{r.department_master?.name||'—'}</td><td>{r.shift_master?.name||'—'}</td></tr>)}
    </tbody></table></div>:<p className="sub" style={{marginTop:10}}>No shifts scheduled yet.</p>}
   </section>

   <div className="grid two" style={{gap:16,marginTop:16}}>
    <section className="card">
     <div className="section-title"><Wallet size={15} style={{verticalAlign:-2,marginRight:5}}/>My leave balance ({new Date().getFullYear()})</div>
     {leaveBalances.length?<div style={{display:'grid',gap:8,marginTop:10}}>
      {leaveBalances.map((b:any)=><div key={b.id} className="split-header"><span className="sub" style={{textTransform:'capitalize'}}>{b.leave_type}</span><b>{b.remainingDays} / {b.allocated_days} days left</b></div>)}
     </div>:<p className="sub" style={{marginTop:10}}>No leave allocation set yet — contact HR.</p>}
    </section>
    <section className="card">
     <div className="section-title"><PartyPopper size={15} style={{verticalAlign:-2,marginRight:5}}/>Upcoming holidays</div>
     {upcomingHolidays.length?<div style={{display:'grid',gap:8,marginTop:10}}>
      {upcomingHolidays.map((h:any)=><div key={h.id} className="split-header"><span className="sub">{h.name}</span><b>{h.holiday_date}</b></div>)}
     </div>:<p className="sub" style={{marginTop:10}}>No upcoming holidays scheduled.</p>}
    </section>
   </div>

   <section className="card" style={{marginTop:16}}>
    <div className="split-header"><div className="section-title">My leave</div><button type="button" className="btn btn-primary" onClick={()=>{setShowLeaveForm(x=>!x);setError('')}}><PlusCircle size={15}/> Request leave</button></div>
    {showLeaveForm?<div style={{marginTop:14}}>
     {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
     <div className="grid two">
      <label className="field"><span>Leave type</span><select value={leaveType} onChange={e=>setLeaveType(e.target.value)}>{leaveTypes.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      <label className="field"><span>Days</span><input disabled value={daysCount||''}/></label>
      <label className="field"><span>Start date</span><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
      <label className="field"><span>End date</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
     </div>
     <label className="field" style={{marginTop:10}}><span>Reason (optional)</span><textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <button className="btn btn-primary" style={{marginTop:12}} disabled={busy||!startDate||!endDate} onClick={submitLeave}>{busy?'Submitting…':'Submit request'}</button>
    </div>:null}
    <div className="table-wrap" style={{marginTop:16}}><table><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Comment</th></tr></thead><tbody>
     {(leave?.mine||[]).map((r:any)=><tr key={r.id}><td>{r.leave_type}</td><td>{r.start_date} – {r.end_date}</td><td>{r.days_count}</td><td><span className={`pill ${r.status==='approved'?'ok':r.status==='rejected'?'danger':'warn'}`}>{r.status}</span></td><td>{r.decision_comment||'—'}</td></tr>)}
     {leave&&!leave.mine.length?<tr><td colSpan={5} className="sub">No leave requests yet.</td></tr>:null}
    </tbody></table></div>
   </section>
  </>:null}

  {tab==='personal'?<PersonalDetailsTab/>:null}
  {tab==='education'?<EducationTab/>:null}
  {tab==='documents'?<DocumentsTab/>:null}
  {tab==='assets'?<MyAssetsTab/>:null}
  {tab==='performance'?<MyPerformanceTab/>:null}
  {tab==='company_docs'?<CompanyDocsReadOnlyTab/>:null}
  {tab==='team'?<MyTeamTab reports={myReports}/>:null}
 </>;
}

function CompanyDocsReadOnlyTab(){
 const [records,setRecords]=useState<any[]>([]);
 useEffect(()=>{fetch('/api/hr/company-documents',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])}).catch(()=>{})},[]);
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">Company documents</div>
  <div style={{display:'grid',gap:10,marginTop:12}}>
   {records.map((r:any)=><div key={r.id} className="card tight">
    <div className="split-header"><b>{r.title}</b>{r.documentUrl?<a className="row-action-btn" href={r.documentUrl} target="_blank" rel="noreferrer"><Download size={13}/></a>:null}</div>
    {r.category?<p className="sub" style={{marginTop:2}}>{r.category}</p>:null}
    <p className="sub" style={{marginTop:6,whiteSpace:'pre-wrap'}}>{r.content}</p>
   </div>)}
   {!records.length?<p className="sub">No company documents published yet.</p>:null}
  </div>
 </section>;
}

const personalFields:{key:string;label:string;type?:string}[]=[
 {key:'date_of_birth',label:'Date of birth',type:'date'},{key:'gender',label:'Gender'},{key:'marital_status',label:'Marital status'},{key:'blood_group',label:'Blood group'},
 {key:'personal_email',label:'Personal email'},{key:'alternate_phone',label:'Alternate phone'},
 {key:'emergency_contact_name',label:'Emergency contact name'},{key:'emergency_contact_phone',label:'Emergency contact phone'},{key:'emergency_contact_relation',label:'Relation'},
 {key:'bank_account_name',label:'Bank account holder name'},{key:'bank_account_number',label:'Bank account number'},{key:'bank_ifsc',label:'IFSC code'},{key:'bank_name',label:'Bank name'},
 {key:'pan_number',label:'PAN number'},{key:'aadhaar_number',label:'Aadhaar number'},
];
function PersonalDetailsTab(){
 const [profile,setProfile]=useState<any>(null),[form,setForm]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/hr/personal',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error){setProfile(j.profile);const f:Record<string,string>={};for(const k of ['current_address','permanent_address',...personalFields.map(x=>x.key)])f[k]=j.profile?.[k]||'';setForm(f)}}).catch(()=>{})},[]);
 async function save(){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/hr/personal',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(form)});const j=await r.json();if(!r.ok)throw new Error(j.error);setProfile(j.profile);setNotice('Saved.')}catch(e){setError(e instanceof Error?e.message:'Unable to save')}finally{setBusy(false)}}
 if(!profile)return <div className="empty" style={{marginTop:14}}>Loading…</div>;
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">Personal details</div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {notice?<div className="notice" style={{marginTop:10}}>{notice}</div>:null}
  <div className="grid two" style={{marginTop:12}}>
   {personalFields.map(f=><label className="field" key={f.key}><span>{f.label}</span><input type={f.type||'text'} value={form[f.key]||''} onChange={e=>setForm(x=>({...x,[f.key]:e.target.value}))}/></label>)}
  </div>
  <label className="field" style={{marginTop:12}}><span>Current address</span><textarea rows={2} value={form.current_address||''} onChange={e=>setForm(x=>({...x,current_address:e.target.value}))}/></label>
  <label className="field" style={{marginTop:12}}><span>Permanent address</span><textarea rows={2} value={form.permanent_address||''} onChange={e=>setForm(x=>({...x,permanent_address:e.target.value}))}/></label>
  <button className="btn btn-primary" style={{marginTop:14}} disabled={busy} onClick={save}>{busy?'Saving…':'Save personal details'}</button>
 </section>;
}

function EducationTab(){
 const [records,setRecords]=useState<any[]>([]),[showForm,setShowForm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [level,setLevel]=useState(''),[institution,setInstitution]=useState(''),[fieldOfStudy,setFieldOfStudy]=useState(''),[startYear,setStartYear]=useState(''),[endYear,setEndYear]=useState(''),[grade,setGrade]=useState('');
 function load(){fetch('/api/hr/education',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function add(){if(!level.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/hr/education',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({level,institution,fieldOfStudy,startYear,endYear,grade})});const j=await r.json();if(!r.ok)throw new Error(j.error);setLevel('');setInstitution('');setFieldOfStudy('');setStartYear('');setEndYear('');setGrade('');setShowForm(false);load()}catch(e){setError(e instanceof Error?e.message:'Unable to save')}finally{setBusy(false)}}
 async function remove(id:number){await fetch(`/api/hr/education?id=${id}`,{method:'DELETE'});load()}
 return <section className="card" style={{marginTop:14}}>
  <div className="split-header"><div className="section-title">Education</div><button type="button" className="btn btn-primary" onClick={()=>setShowForm(x=>!x)}><PlusCircle size={15}/> Add</button></div>
  {showForm?<div style={{marginTop:14}}>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <div className="grid two">
    <label className="field"><span>Level (e.g. Bachelor's, 12th)</span><input value={level} onChange={e=>setLevel(e.target.value)}/></label>
    <label className="field"><span>Institution</span><input value={institution} onChange={e=>setInstitution(e.target.value)}/></label>
    <label className="field"><span>Field of study</span><input value={fieldOfStudy} onChange={e=>setFieldOfStudy(e.target.value)}/></label>
    <label className="field"><span>Grade / %</span><input value={grade} onChange={e=>setGrade(e.target.value)}/></label>
    <label className="field"><span>Start year</span><input type="number" value={startYear} onChange={e=>setStartYear(e.target.value)}/></label>
    <label className="field"><span>End year</span><input type="number" value={endYear} onChange={e=>setEndYear(e.target.value)}/></label>
   </div>
   <button className="btn btn-primary" style={{marginTop:12}} disabled={busy||!level.trim()} onClick={add}>{busy?'Saving…':'Save'}</button>
  </div>:null}
  <div style={{display:'grid',gap:10,marginTop:14}}>
   {records.map(r=><div key={r.id} className="card tight split-header"><div><b>{r.level}</b><p className="sub" style={{marginTop:2}}>{r.institution||'—'}{r.field_of_study?` • ${r.field_of_study}`:''}{r.start_year||r.end_year?` • ${r.start_year||''}–${r.end_year||''}`:''}{r.grade?` • ${r.grade}`:''}</p></div><button className="row-action-btn" onClick={()=>remove(r.id)}><Trash2 size={13}/></button></div>)}
   {!records.length?<p className="sub">No education records yet.</p>:null}
  </div>
 </section>;
}

function DocumentsTab(){
 const [records,setRecords]=useState<any[]>([]),[categories,setCategories]=useState<string[]>([]),[category,setCategory]=useState('other'),[label,setLabel]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){fetch('/api/hr/documents',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error){setRecords(j.records||[]);setCategories(j.categories||[])}}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function upload(){if(!file)return;setBusy(true);setError('');try{const fd=new FormData();fd.append('category',category);fd.append('label',label);fd.append('file',file);const r=await fetch('/api/hr/documents',{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.error);setFile(null);setLabel('');load()}catch(e){setError(e instanceof Error?e.message:'Unable to upload')}finally{setBusy(false)}}
 async function remove(id:number){await fetch(`/api/hr/documents?id=${id}`,{method:'DELETE'});load()}
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">Documents</div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  <div className="grid two" style={{marginTop:12}}>
   <label className="field"><span>Category</span><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c} value={c}>{documentCategoryLabels[c]||c}</option>)}</select></label>
   <label className="field"><span>Label (optional)</span><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. 10th marksheet"/></label>
  </div>
  <label className="field" style={{marginTop:12}}><span>File</span><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
  <button className="btn btn-primary" style={{marginTop:12}} disabled={busy||!file} onClick={upload}><Upload size={15}/> {busy?'Uploading…':'Upload document'}</button>
  <div style={{display:'grid',gap:10,marginTop:16}}>
   {records.map(r=><div key={r.id} className="card tight split-header"><div><b>{documentCategoryLabels[r.category]||r.category}</b>{r.label?<p className="sub" style={{marginTop:2}}>{r.label}</p>:null}<p className="sub" style={{marginTop:2}}>{r.file_name} • {new Date(r.uploaded_at).toLocaleDateString('en-IN')}</p></div><div style={{display:'flex',gap:8}}>{r.documentUrl?<a className="row-action-btn" href={r.documentUrl} target="_blank" rel="noreferrer"><Download size={13}/></a>:null}<button className="row-action-btn" onClick={()=>remove(r.id)}><Trash2 size={13}/></button></div></div>)}
   {!records.length?<p className="sub">No documents uploaded yet.</p>:null}
  </div>
 </section>;
}

function MyAssetsTab(){
 const [records,setRecords]=useState<any[]>([]);
 useEffect(()=>{fetch('/api/hr/assets',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])}).catch(()=>{})},[]);
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">My assets</div>
  <div style={{display:'grid',gap:10,marginTop:12}}>
   {records.map(r=><div key={r.id} className="card tight"><div className="split-header"><b>{r.asset_name}</b><span className={`pill ${r.return_date?'neutral':'ok'}`}>{r.return_date?'Returned':'With me'}</span></div><p className="sub" style={{marginTop:4}}>{r.asset_type}{r.serial_number?` • S/N ${r.serial_number}`:''} • Issued {r.issued_date}{r.return_date?` • Returned ${r.return_date}`:''}</p>{r.condition_notes?<p className="sub" style={{marginTop:2}}>{r.condition_notes}</p>:null}</div>)}
   {!records.length?<p className="sub">No assets issued to you yet.</p>:null}
  </div>
 </section>;
}

// Every direct report gets their own goal list here — I set/remove goals
// for them (core fields); they're the only one who can update progress/
// status on their side (see MyGoalsPanel in MyPerformanceTab).
function MyTeamTab({reports}:{reports:{id:string;full_name:string;email:string}[]}){
 const [selected,setSelected]=useState('');
 const [goals,setGoals]=useState<any[]>([]),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[targetDate,setTargetDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(id:string){if(!id)return;fetch(`/api/hr/goals?profileId=${id}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setGoals(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load(selected)},[selected]);
 async function add(){if(!selected||!title.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/hr/goals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:selected,title,description,targetDate})});const j=await r.json();if(!r.ok)throw new Error(j.error);setTitle('');setDescription('');setTargetDate('');load(selected)}catch(e){setError(e instanceof Error?e.message:'Unable to add goal')}finally{setBusy(false)}}
 async function remove(id:string){await fetch(`/api/hr/goals?id=${id}`,{method:'DELETE'});load(selected)}
 const statusTone:Record<string,string>={not_started:'neutral',in_progress:'warn',completed:'ok',missed:'danger'};
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">My team's goals</div>
  <div className="field" style={{maxWidth:340,marginTop:10}}><label>Team member</label><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select a direct report</option>{reports.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
  {!selected?null:<>
   {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
   <div className="grid two" style={{marginTop:14}}>
    <label className="field"><span>Goal title</span><input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="field"><span>Target date</span><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)}/></label>
   </div>
   <label className="field" style={{marginTop:10}}><span>Description (optional)</span><textarea rows={2} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <button className="btn btn-primary" style={{marginTop:10}} disabled={busy||!title.trim()} onClick={add}>{busy?'Adding…':'Add goal'}</button>
   <div style={{display:'grid',gap:10,marginTop:16}}>
    {goals.map(g=><div key={g.id} className="card tight">
     <div className="split-header"><b>{g.title}</b><span className={`pill ${statusTone[g.status]||'neutral'}`}>{String(g.status).replaceAll('_',' ')}</span></div>
     {g.description?<p className="sub" style={{marginTop:4}}>{g.description}</p>:null}
     <div className="progress" style={{marginTop:8}}><span style={{width:`${g.progress}%`}}/></div>
     <p className="sub" style={{marginTop:4}}>{g.progress}% complete{g.target_date?` • Target ${g.target_date}`:''}</p>
     <button className="btn btn-outline btn-sm" style={{marginTop:8}} onClick={()=>remove(g.id)}>Remove</button>
    </div>)}
    {!goals.length?<p className="sub">No goals set for this person yet.</p>:null}
   </div>
  </>}
 </section>;
}

// The employee's own view: progress/status only, title/description/target
// date were set by HR or their manager and aren't editable here.
function MyGoalsPanel(){
 const [goals,setGoals]=useState<any[]>([]);
 function load(){fetch('/api/hr/goals',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setGoals(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function update(id:string,fields:{status?:string;progress?:number}){await fetch('/api/hr/goals',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,...fields})});load()}
 const statusTone:Record<string,string>={not_started:'neutral',in_progress:'warn',completed:'ok',missed:'danger'};
 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">My goals</div>
  <div style={{display:'grid',gap:10,marginTop:12}}>
   {goals.map(g=><div key={g.id} className="card tight">
    <div className="split-header"><b>{g.title}</b><span className={`pill ${statusTone[g.status]||'neutral'}`}>{String(g.status).replaceAll('_',' ')}</span></div>
    {g.description?<p className="sub" style={{marginTop:4}}>{g.description}</p>:null}
    <div className="progress" style={{marginTop:8}}><span style={{width:`${g.progress}%`}}/></div>
    <div className="grid two" style={{marginTop:10,alignItems:'end'}}>
     <label className="field"><span>Progress %</span><input type="number" min={0} max={100} defaultValue={g.progress} onBlur={e=>{const v=Math.max(0,Math.min(100,Number(e.target.value)||0));update(g.id,{progress:v})}}/></label>
     <label className="field"><span>Status</span><select value={g.status} onChange={e=>update(g.id,{status:e.target.value})}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="missed">Missed</option></select></label>
    </div>
    {g.target_date?<p className="sub" style={{marginTop:4}}>Target {g.target_date}</p>:null}
   </div>)}
   {!goals.length?<p className="sub">No goals assigned yet — your manager or HR sets these.</p>:null}
  </div>
 </section>;
}

function MyPerformanceTab(){
 const [data,setData]=useState<{mine:any[];pendingMyReview:any[]}|null>(null),[busy,setBusy]=useState<string>(''),[drafts,setDrafts]=useState<Record<string,{self:string;reviewer:string;rating:string}>>({});
 function load(){fetch('/api/hr/performance',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setData(j)}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 function draft(id:string){return drafts[id]||{self:'',reviewer:'',rating:''}}
 async function submitSelf(id:string){setBusy(id);await fetch('/api/hr/performance',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,selfAssessment:draft(id).self,submit:true})});setBusy('');load()}
 async function complete(id:string){setBusy(id);await fetch('/api/hr/performance',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,reviewerAssessment:draft(id).reviewer,rating:draft(id).rating,complete:true})});setBusy('');load()}
 if(!data)return <div className="empty" style={{marginTop:14}}>Loading…</div>;
 return <>
  <MyGoalsPanel/>
  {data.pendingMyReview.length?<section className="card" style={{marginTop:14}}>
   <div className="section-title">Reviews awaiting my input</div>
   {data.pendingMyReview.map(r=><div key={r.id} className="card tight" style={{marginTop:10}}>
    <b>{r.profile?.full_name||r.profile?.email}</b> — {r.period_label}
    {r.self_assessment?<p className="sub" style={{marginTop:6}}><b>Self-assessment:</b> {r.self_assessment}</p>:null}
    <label className="field" style={{marginTop:8}}><span>Reviewer assessment</span><textarea rows={2} value={draft(r.id).reviewer} onChange={e=>setDrafts(x=>({...x,[r.id]:{...draft(r.id),reviewer:e.target.value}}))}/></label>
    <label className="field" style={{marginTop:8}}><span>Rating</span><input value={draft(r.id).rating} onChange={e=>setDrafts(x=>({...x,[r.id]:{...draft(r.id),rating:e.target.value}}))} placeholder="e.g. Exceeds expectations"/></label>
    <button className="btn btn-primary" style={{marginTop:8}} disabled={busy===r.id} onClick={()=>complete(r.id)}>Complete review</button>
   </div>)}
  </section>:null}
  <section className="card" style={{marginTop:14}}>
   <div className="section-title">My performance reviews</div>
   <div style={{display:'grid',gap:10,marginTop:12}}>
    {data.mine.map(r=><div key={r.id} className="card tight">
     <div className="split-header"><b>{r.period_label}</b><span className={`pill ${r.status==='completed'?'ok':r.status==='submitted'?'warn':'neutral'}`}>{r.status}</span></div>
     {Array.isArray(r.goals)&&r.goals.length?<ul style={{marginTop:8}}>{r.goals.map((g:any,i:number)=><li key={i}>{g.title||g}</li>)}</ul>:null}
     {r.status==='draft'?<><label className="field" style={{marginTop:8}}><span>Self-assessment</span><textarea rows={2} value={draft(r.id).self||r.self_assessment||''} onChange={e=>setDrafts(x=>({...x,[r.id]:{...draft(r.id),self:e.target.value}}))}/></label><button className="btn btn-primary" style={{marginTop:8}} disabled={busy===r.id} onClick={()=>submitSelf(r.id)}>Submit self-assessment</button></>:null}
     {r.self_assessment&&r.status!=='draft'?<p className="sub" style={{marginTop:6}}><b>My self-assessment:</b> {r.self_assessment}</p>:null}
     {r.reviewer_assessment?<p className="sub" style={{marginTop:4}}><b>Reviewer:</b> {r.reviewer_assessment}{r.rating?` • ${r.rating}`:''}</p>:null}
    </div>)}
    {!data.mine.length?<p className="sub">No performance reviews yet.</p>:null}
   </div>
  </section>
 </>;
}
