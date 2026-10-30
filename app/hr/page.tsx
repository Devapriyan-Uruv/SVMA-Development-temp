'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Drawer} from '@/components/Drawer';
import {EmptyState} from '@/components/EmptyState';
import {Briefcase,CalendarClock,DollarSign,ShieldCheck,UserPlus,Users,User,Package,Target,Search,Upload,Trash2,Download,PlusCircle,FileText,Wallet,PartyPopper,LayoutGrid} from 'lucide-react';

const roles=['admin','ceo','management','finance_user','finance_manager','solvent_operator','solvent_head','safety_user','quality_operator','quality_head','hr_admin','import_operator','import_manager','export_operator','export_manager','ops_operator','viewer'];
const documentCategoryLabels:Record<string,string>={aadhaar:'Aadhaar',pan:'PAN Card',passport:'Passport',address_proof:'Address Proof',education_certificate:'Education Certificate',resume:'Resume',offer_letter:'Offer Letter',experience_letter:'Experience Letter',relieving_letter:'Relieving Letter',photo:'Photo',other:'Other'};
const workletDefs:{key:string;label:string;icon:string;tone:string}[]=[
 {key:'employees',label:'Employees',icon:'Users',tone:'navy'},
 {key:'directory',label:'Directory',icon:'Search',tone:'blue'},
 {key:'profile',label:'Profile',icon:'User',tone:'blue'},
 {key:'departments',label:'Departments',icon:'Briefcase',tone:'purple'},
 {key:'compensation',label:'Compensation',icon:'DollarSign',tone:'green'},
 {key:'insurance',label:'Insurance',icon:'ShieldCheck',tone:'teal'},
 {key:'roster',label:'Shift Roster',icon:'CalendarClock',tone:'amber'},
 {key:'leave',label:'Leave',icon:'Wallet',tone:'rose'},
 {key:'assets',label:'Assets',icon:'Package',tone:'amber'},
 {key:'performance',label:'Performance',icon:'Target',tone:'rose'},
 {key:'company_docs',label:'Company Docs',icon:'FileText',tone:'red'},
 {key:'leave_balances',label:'Leave Balances',icon:'Wallet',tone:'green'},
 {key:'holidays',label:'Holidays',icon:'PartyPopper',tone:'purple'},
];
const workletIcons:Record<string,any>={Users,Search,User,Briefcase,DollarSign,ShieldCheck,CalendarClock,Wallet,Package,Target,FileText,PartyPopper};

function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function money(n:number|null|undefined,currency='INR'){if(n==null)return '—';return `${currency==='INR'?'₹':currency+' '}${Number(n).toLocaleString('en-IN')}`}

export default function HrConsole(){
 const [tab,setTab]=useState<'employees'|'departments'|'profile'|'compensation'|'insurance'|'roster'|'leave'|'directory'|'assets'|'performance'|'company_docs'|'leave_balances'|'holidays'>('employees');
 const [myRoles,setMyRoles]=useState<string[]>([]);
 const [employees,setEmployees]=useState<any[]>([]);
 const [departments,setDepartments]=useState<any[]>([]);
 const [shifts,setShifts]=useState<any[]>([]);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [addOpen,setAddOpen]=useState(false);
 const [selectedEmployee,setSelectedEmployee]=useState('');
 const [compRecords,setCompRecords]=useState<any[]>([]);
 const [insRecords,setInsRecords]=useState<any[]>([]);
 const [roster,setRoster]=useState<any[]>([]);
 const [leave,setLeave]=useState<{mine:any[];awaitingMyApproval:any[];all:any[]|null}|null>(null);
 const [busy,setBusy]=useState(false);

 function loadCore(){
  fetch('/api/admin/users',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setEmployees(j.users||[])}).catch(()=>{});
  fetch('/api/hr/departments',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setDepartments(j.departments||[])}).catch(()=>{});
  fetch('/api/admin/shifts',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setShifts(j.shifts||[])}).catch(()=>{});
 }
 useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.roles)setMyRoles(j.roles)}).catch(()=>{});loadCore()},[]);
 useEffect(()=>{if(tab==='roster')fetch('/api/hr/roster',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRoster(j.roster||[])}).catch(()=>{})},[tab]);
 useEffect(()=>{if(tab==='leave')fetch('/api/hr/leave',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setLeave(j)}).catch(()=>{})},[tab]);
 useEffect(()=>{
  if(!selectedEmployee||(tab!=='compensation'&&tab!=='insurance'))return;
  if(tab==='compensation')fetch(`/api/hr/compensation?profileId=${selectedEmployee}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setCompRecords(j.records||[])}).catch(()=>{});
  if(tab==='insurance')fetch(`/api/hr/insurance?profileId=${selectedEmployee}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setInsRecords(j.records||[])}).catch(()=>{});
 },[selectedEmployee,tab]);

 const canGrantSuperAdmin=myRoles.includes('super_admin');
 const roleOptions=canGrantSuperAdmin?['super_admin',...roles]:roles;

 const activeDeptCount=departments.filter((d:any)=>d.active).length;

 return <>
  <PageHeader title="HR" subtitle="Employees, compensation, insurance, shift rosters and reporting structure." backHref="/" backLabel="Home" action={<button className="btn btn-primary" onClick={()=>{setAddOpen(true);setError('')}}><UserPlus size={16}/> Add employee</button>}/>
  {notice?<div className="notice" style={{marginBottom:12}}>{notice}</div>:null}
  {error&&!addOpen?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}

  <div className="module-hero hr-hero">
   <div className="hr-hero-inner">
    <div className="hr-hero-profile">
     <div className="hr-avatar"><LayoutGrid size={24}/></div>
     <div className="hr-hero-meta">
      <h2>HR Admin Console</h2>
      <p>Manage the whole workforce — records, pay, benefits, rosters and policy.</p>
     </div>
    </div>
    <div className="hr-hero-stats">
     <div className="hr-hero-stat"><span>Employees</span><b>{employees.length}</b></div>
     <div className="hr-hero-stat"><span>Departments</span><b>{activeDeptCount}</b></div>
     <div className="hr-hero-stat"><span>Shifts</span><b>{shifts.length}</b></div>
    </div>
   </div>
  </div>

  <div className="worklet-grid">
   {workletDefs.map(w=>{
    const Icon=workletIcons[w.icon]||Users;
    return <div key={w.key} className={`worklet worklet-${w.tone} ${tab===w.key?'active':''}`} onClick={()=>setTab(w.key as typeof tab)}>
     <div className="worklet-icon"><Icon size={20}/></div><span>{w.label}</span>
    </div>;
   })}
  </div>

  {tab==='employees'?<EmployeesTab employees={employees} departments={departments} onChanged={loadCore}/>:null}
  {tab==='directory'?<DirectoryTab employees={employees}/>:null}
  {tab==='profile'?<ProfileTab employees={employees} selected={selectedEmployee} onSelect={setSelectedEmployee}/>:null}
  {tab==='departments'?<DepartmentsTab departments={departments} onChanged={loadCore}/>:null}
  {tab==='compensation'?<CompensationTab employees={employees} selected={selectedEmployee} onSelect={setSelectedEmployee} records={compRecords} onSaved={()=>selectedEmployee&&fetch(`/api/hr/compensation?profileId=${selectedEmployee}`,{cache:'no-store'}).then(r=>r.json()).then(j=>setCompRecords(j.records||[]))}/>:null}
  {tab==='insurance'?<InsuranceTab employees={employees} selected={selectedEmployee} onSelect={setSelectedEmployee} records={insRecords} onSaved={()=>selectedEmployee&&fetch(`/api/hr/insurance?profileId=${selectedEmployee}`,{cache:'no-store'}).then(r=>r.json()).then(j=>setInsRecords(j.records||[]))}/>:null}
  {tab==='roster'?<RosterTab employees={employees} departments={departments} shifts={shifts} roster={roster} onChanged={()=>fetch('/api/hr/roster',{cache:'no-store'}).then(r=>r.json()).then(j=>setRoster(j.roster||[]))}/>:null}
  {tab==='leave'?<LeaveTab leave={leave} onChanged={()=>fetch('/api/hr/leave',{cache:'no-store'}).then(r=>r.json()).then(j=>setLeave(j))}/>:null}
  {tab==='assets'?<AssetsTab employees={employees} selected={selectedEmployee} onSelect={setSelectedEmployee}/>:null}
  {tab==='performance'?<PerformanceTab employees={employees} selected={selectedEmployee} onSelect={setSelectedEmployee}/>:null}
  {tab==='company_docs'?<CompanyDocsTab/>:null}
  {tab==='leave_balances'?<LeaveBalancesTab employees={employees}/>:null}
  {tab==='holidays'?<HolidaysTab/>:null}

  <Drawer open={addOpen} onClose={()=>setAddOpen(false)} title="Add employee" subtitle="Creates their portal login and employment record." footer={<><button type="button" className="btn btn-outline" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" form="add-employee-form" className="btn btn-primary">Create employee</button></>}>
   <AddEmployeeForm departments={departments} employees={employees} roleOptions={roleOptions} busy={busy} setBusy={setBusy} onError={setError} onDone={()=>{setAddOpen(false);setNotice('Employee added.');loadCore()}}/>
  </Drawer>
 </>;
}

function AddEmployeeForm({departments,employees,roleOptions,busy,setBusy,onError,onDone}:{departments:any[];employees:any[];roleOptions:string[];busy:boolean;setBusy:(b:boolean)=>void;onError:(s:string)=>void;onDone:()=>void}){
 const [fullName,setFullName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('viewer');
 const [departmentId,setDepartmentId]=useState(''),[designation,setDesignation]=useState(''),[supervisorId,setSupervisorId]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();onError('');setBusy(true);
  try{
   const r=await fetch('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fullName,email,password,role,departmentId:departmentId||null,designation,supervisorId:supervisorId||null})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   onDone();
  }catch(err){onError(err instanceof Error?err.message:'Unable to create employee')}finally{setBusy(false)}
 }
 return <form id="add-employee-form" className="drawer-form" onSubmit={submit}>
  <Field label="Full name"><input required value={fullName} onChange={e=>setFullName(e.target.value)}/></Field>
  <Field label="Email"><input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
  <Field label="Temporary password"><input required type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></Field>
  <div className="grid two">
   <Field label="Department"><select value={departmentId} onChange={e=>setDepartmentId(e.target.value)}><option value="">—</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
   <Field label="Designation"><input value={designation} onChange={e=>setDesignation(e.target.value)}/></Field>
  </div>
  <Field label="Reports to (approves their leave)"><select value={supervisorId} onChange={e=>setSupervisorId(e.target.value)}><option value="">—</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></Field>
  <Field label="Role"><select value={role} onChange={e=>setRole(e.target.value)}>{roleOptions.map(r=><option key={r} value={r}>{r.replaceAll('_',' ')}</option>)}</select></Field>
  {busy?null:null}
 </form>;
}

function EmployeesTab({employees,departments,onChanged}:{employees:any[];departments:any[];onChanged:()=>void}){
 const [editing,setEditing]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){
  if(!editing)return;setBusy(true);setError('');
  try{
   const r=await fetch('/api/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({userId:editing.id,departmentId:editing.department_id||null,designation:editing.designation,supervisorId:editing.supervisor_id||null})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setEditing(null);onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Unable to update employee')}finally{setBusy(false)}
 }
 if(!employees.length)return <EmptyState title="No employees yet" description="Add the first employee to get started."/>;
 return <>
  <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Designation</th><th>Reports to</th><th>Role</th><th></th></tr></thead><tbody>
   {employees.map(u=><tr key={u.id}>
    <td>{u.full_name||'—'}</td><td>{u.email}</td><td>{u.departmentName||'—'}</td><td>{u.designation||'—'}</td>
    <td>{employees.find(e=>e.id===u.supervisor_id)?.full_name||'—'}</td>
    <td>{u.user_roles?.[0]?.role?.replaceAll('_',' ')||'—'}</td>
    <td><button type="button" className="btn btn-outline btn-sm" onClick={()=>setEditing({...u})}>Edit</button></td>
   </tr>)}
  </tbody></table></div>
  <Drawer open={!!editing} onClose={()=>setEditing(null)} title={editing?.full_name||'Edit employee'} subtitle="Department, designation and reporting line." footer={<><button type="button" className="btn btn-outline" onClick={()=>setEditing(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save changes'}</button></>}>
   {editing?<div className="drawer-form">
    {error?<div className="notice danger">{error}</div>:null}
    <Field label="Department"><select value={editing.department_id||''} onChange={e=>setEditing({...editing,department_id:e.target.value})}><option value="">—</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    <Field label="Designation"><input value={editing.designation||''} onChange={e=>setEditing({...editing,designation:e.target.value})}/></Field>
    <Field label="Reports to"><select value={editing.supervisor_id||''} onChange={e=>setEditing({...editing,supervisor_id:e.target.value})}><option value="">—</option>{employees.filter(e=>e.id!==editing.id).map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></Field>
   </div>:null}
  </Drawer>
 </>;
}

function DepartmentsTab({departments,onChanged}:{departments:any[];onChanged:()=>void}){
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(){
  if(!name.trim())return;setBusy(true);setError('');
  try{const r=await fetch('/api/hr/departments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.trim()})});const j=await r.json();if(!r.ok)throw new Error(j.error);setName('');onChanged()}
  catch(e){setError(e instanceof Error?e.message:'Unable to add department')}finally{setBusy(false)}
 }
 async function toggle(d:any){await fetch('/api/hr/departments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:d.id,name:d.name,active:!d.active})});onChanged()}
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  <div style={{display:'flex',gap:8,marginBottom:14}}><input value={name} onChange={e=>setName(e.target.value)} placeholder="New department name" style={{flex:1}}/><button className="btn btn-primary" disabled={busy||!name.trim()} onClick={add}>Add</button></div>
  <div className="table-wrap"><table><thead><tr><th>Department</th><th>Status</th><th></th></tr></thead><tbody>
   {departments.map(d=><tr key={d.id}><td>{d.name}</td><td><span className={`pill ${d.active?'ok':'neutral'}`}>{d.active?'Active':'Inactive'}</span></td><td><button type="button" className="btn btn-outline btn-sm" onClick={()=>toggle(d)}>{d.active?'Deactivate':'Activate'}</button></td></tr>)}
  </tbody></table></div>
 </div>;
}

function CompensationTab({employees,selected,onSelect,records,onSaved}:{employees:any[];selected:string;onSelect:(id:string)=>void;records:any[];onSaved:()=>void}){
 const [effectiveDate,setEffectiveDate]=useState(''),[baseSalary,setBaseSalary]=useState(''),[payFrequency,setPayFrequency]=useState('monthly'),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(){
  if(!selected||!effectiveDate||!baseSalary)return;setBusy(true);setError('');
  try{const r=await fetch('/api/hr/compensation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:selected,effectiveDate,baseSalary:Number(baseSalary),payFrequency,notes})});const j=await r.json();if(!r.ok)throw new Error(j.error);setEffectiveDate('');setBaseSalary('');setNotes('');onSaved()}
  catch(e){setError(e instanceof Error?e.message:'Unable to save compensation record')}finally{setBusy(false)}
 }
 return <div className="card">
  <div className="field" style={{marginBottom:14,maxWidth:340}}><label>Employee</label><select value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
  {!selected?<EmptyState title="Choose an employee" description="Select someone above to view or record compensation."/>:<>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <div className="grid two" style={{alignItems:'end',marginBottom:16}}>
    <Field label="Effective date"><input type="date" value={effectiveDate} onChange={e=>setEffectiveDate(e.target.value)}/></Field>
    <Field label="Base salary"><input type="number" min={0} value={baseSalary} onChange={e=>setBaseSalary(e.target.value)}/></Field>
    <Field label="Pay frequency"><select value={payFrequency} onChange={e=>setPayFrequency(e.target.value)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option></select></Field>
    <Field label="Notes"><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. annual review"/></Field>
   </div>
   <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!effectiveDate||!baseSalary} onClick={add}>{busy?'Saving…':'Add compensation record'}</button>
   <div className="table-wrap"><table><thead><tr><th>Effective</th><th>Base salary</th><th>Frequency</th><th>Notes</th></tr></thead><tbody>
    {records.map(r=><tr key={r.id}><td>{r.effective_date}</td><td>{money(r.base_salary,r.currency)}</td><td>{r.pay_frequency}</td><td>{r.notes||'—'}</td></tr>)}
    {!records.length?<tr><td colSpan={4} className="sub">No compensation history yet.</td></tr>:null}
   </tbody></table></div>
  </>}
 </div>;
}

function InsuranceTab({employees,selected,onSelect,records,onSaved}:{employees:any[];selected:string;onSelect:(id:string)=>void;records:any[];onSaved:()=>void}){
 const [policyType,setPolicyType]=useState(''),[provider,setProvider]=useState(''),[policyNumber,setPolicyNumber]=useState(''),[coverageAmount,setCoverageAmount]=useState(''),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(){
  if(!selected||!policyType.trim())return;setBusy(true);setError('');
  try{
   const fd=new FormData();fd.append('profileId',selected);fd.append('policyType',policyType);fd.append('provider',provider);fd.append('policyNumber',policyNumber);if(coverageAmount)fd.append('coverageAmount',coverageAmount);if(startDate)fd.append('startDate',startDate);if(endDate)fd.append('endDate',endDate);if(file)fd.append('file',file);
   const r=await fetch('/api/hr/insurance',{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.error);
   setPolicyType('');setProvider('');setPolicyNumber('');setCoverageAmount('');setStartDate('');setEndDate('');setFile(null);onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save insurance record')}finally{setBusy(false)}
 }
 return <div className="card">
  <div className="field" style={{marginBottom:14,maxWidth:340}}><label>Employee</label><select value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
  {!selected?<EmptyState title="Choose an employee" description="Select someone above to view or record insurance."/>:<>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <div className="grid two" style={{marginBottom:16}}>
    <Field label="Policy type"><input value={policyType} onChange={e=>setPolicyType(e.target.value)} placeholder="Health / Life / Accident"/></Field>
    <Field label="Provider"><input value={provider} onChange={e=>setProvider(e.target.value)}/></Field>
    <Field label="Policy number"><input value={policyNumber} onChange={e=>setPolicyNumber(e.target.value)}/></Field>
    <Field label="Coverage amount"><input type="number" min={0} value={coverageAmount} onChange={e=>setCoverageAmount(e.target.value)}/></Field>
    <Field label="Start date"><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></Field>
    <Field label="End date"><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></Field>
    <Field label="Policy document (optional)"><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field>
   </div>
   <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!policyType.trim()} onClick={add}>{busy?'Saving…':'Add insurance record'}</button>
   <div className="table-wrap"><table><thead><tr><th>Type</th><th>Provider</th><th>Coverage</th><th>Valid</th><th>Document</th></tr></thead><tbody>
    {records.map(r=><tr key={r.id}><td>{r.policy_type}</td><td>{r.provider||'—'}</td><td>{money(r.coverage_amount)}</td><td>{r.start_date||'—'} – {r.end_date||'ongoing'}</td><td>{r.documentUrl?<a href={r.documentUrl} target="_blank" rel="noreferrer">View</a>:'—'}</td></tr>)}
    {!records.length?<tr><td colSpan={5} className="sub">No insurance records yet.</td></tr>:null}
   </tbody></table></div>
  </>}
 </div>;
}

function RosterTab({employees,departments,shifts,roster,onChanged}:{employees:any[];departments:any[];shifts:any[];roster:any[];onChanged:()=>void}){
 const [profileId,setProfileId]=useState(''),[departmentId,setDepartmentId]=useState(''),[shiftId,setShiftId]=useState(''),[rosterDate,setRosterDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(){
  if(!profileId||!departmentId||!shiftId||!rosterDate)return;setBusy(true);setError('');
  try{const r=await fetch('/api/hr/roster',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,departmentId:Number(departmentId),shiftId:Number(shiftId),rosterDate})});const j=await r.json();if(!r.ok)throw new Error(j.error);setRosterDate('');onChanged()}
  catch(e){setError(e instanceof Error?e.message:'Unable to save roster entry')}finally{setBusy(false)}
 }
 return <div style={{display:'grid',gap:16}}>
  <AiRosterSuggest departments={departments} shifts={shifts} onSaved={onChanged}/>
  <div className="card">
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <div className="section-title" style={{fontSize:15}}>Assign one shift</div>
   <div className="grid two" style={{alignItems:'end',marginBottom:16,marginTop:10}}>
    <Field label="Employee"><select value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">Select</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></Field>
    <Field label="Department"><select value={departmentId} onChange={e=>setDepartmentId(e.target.value)}><option value="">Select</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    <Field label="Shift"><select value={shiftId} onChange={e=>setShiftId(e.target.value)}><option value="">Select</option>{shifts.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <Field label="Date"><input type="date" value={rosterDate} onChange={e=>setRosterDate(e.target.value)}/></Field>
   </div>
   <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!profileId||!departmentId||!shiftId||!rosterDate} onClick={add}>{busy?'Saving…':'Assign shift'}</button>
   <div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th>Status</th></tr></thead><tbody>
    {roster.map((r:any)=><tr key={r.id}><td>{r.roster_date}</td><td>{r.profiles?.full_name||r.profiles?.email||'—'}</td><td>{r.department_master?.name||'—'}</td><td>{r.shift_master?.name||'—'}</td><td><span className="pill neutral">{r.status}</span></td></tr>)}
    {!roster.length?<tr><td colSpan={5} className="sub">No shifts scheduled yet.</td></tr>:null}
   </tbody></table></div>
  </div>
 </div>;
}

// AI proposes a roster across every selected department/shift/date at once
// (so nobody gets double-booked across, say, Solvent and Refinery on the
// same day) — deterministic round-robin fallback keeps this usable if no
// OpenAI key is configured. Nothing is saved until reviewed here and
// confirmed; accepted rows go through the same POST /api/hr/roster a
// manual entry uses.
function AiRosterSuggest({departments,shifts,onSaved}:{departments:any[];shifts:any[];onSaved:()=>void}){
 const [open,setOpen]=useState(false);
 const [selectedDepts,setSelectedDepts]=useState<number[]>([]);
 const [selectedShifts,setSelectedShifts]=useState<number[]>([]);
 const [fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
 const [suggestions,setSuggestions]=useState<any[]|null>(null);
 const [aiUsed,setAiUsed]=useState(false);
 const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 function toggle(list:number[],setList:(x:number[])=>void,id:number){setList(list.includes(id)?list.filter(x=>x!==id):[...list,id])}
 async function generate(){
  if(!selectedDepts.length||!selectedShifts.length||!fromDate||!toDate)return;
  setBusy(true);setError('');setSuggestions(null);
  try{
   const r=await fetch('/api/hr/roster/suggest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({departmentIds:selectedDepts,shiftIds:selectedShifts,fromDate,toDate})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setSuggestions(j.suggestions||[]);setAiUsed(!!j.aiUsed);
  }catch(e){setError(e instanceof Error?e.message:'Unable to generate suggestions')}finally{setBusy(false)}
 }
 function remove(i:number){setSuggestions(x=>x?x.filter((_,idx)=>idx!==i):x)}
 async function confirmAll(){
  if(!suggestions?.length)return;setSaving(true);setError('');
  try{
   for(const s of suggestions){
    const r=await fetch('/api/hr/roster',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:s.profileId,departmentId:s.departmentId,shiftId:s.shiftId,rosterDate:s.date})});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'A suggestion failed to save')}
   }
   setSuggestions(null);setOpen(false);onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Some suggestions could not be saved — check the roster table and retry the rest.')}finally{setSaving(false)}
 }
 return <div className="card">
  <div className="split-header"><div className="section-title" style={{fontSize:15}}>AI shift scheduling</div><button type="button" className="btn btn-outline" onClick={()=>setOpen(x=>!x)}>{open?'Close':'Plan with AI'}</button></div>
  {open?<div style={{marginTop:14}}>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <p className="sub" style={{marginBottom:10}}>Pick every department/plant to schedule together — the same person is never double-booked across them on one day.</p>
   <div className="field" style={{marginBottom:10}}><span>Departments / plants</span><div style={{display:'flex',flexWrap:'wrap',gap:7,marginTop:6}}>{departments.map(d=><button type="button" key={d.id} className={`tab ${selectedDepts.includes(d.id)?'active':''}`} onClick={()=>toggle(selectedDepts,setSelectedDepts,d.id)}>{d.name}</button>)}</div></div>
   <div className="field" style={{marginBottom:14}}><span>Shifts</span><div style={{display:'flex',flexWrap:'wrap',gap:7,marginTop:6}}>{shifts.map((s:any)=><button type="button" key={s.id} className={`tab ${selectedShifts.includes(s.id)?'active':''}`} onClick={()=>toggle(selectedShifts,setSelectedShifts,s.id)}>{s.name}</button>)}</div></div>
   <div className="grid two" style={{marginBottom:14}}>
    <Field label="From"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></Field>
    <Field label="To (max 31 days)"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></Field>
   </div>
   <button className="btn btn-primary" disabled={busy||!selectedDepts.length||!selectedShifts.length||!fromDate||!toDate} onClick={generate}>{busy?'Planning…':'Generate suggestions'}</button>

   {suggestions?<div style={{marginTop:18}}>
    <div className="split-header" style={{marginBottom:10}}><b>{suggestions.length} suggested assignment{suggestions.length===1?'':'s'}</b><span className="sub">{aiUsed?'AI-planned':'Rotated automatically (no AI configured)'}</span></div>
    {suggestions.length?<div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th></th></tr></thead><tbody>
     {suggestions.map((s,i)=><tr key={`${s.profileId}-${s.date}-${s.shiftId}-${i}`}><td>{s.date}</td><td>{s.employeeName}</td><td>{s.departmentName}</td><td>{s.shiftName}</td><td><button type="button" className="btn btn-outline btn-sm" onClick={()=>remove(i)}>Remove</button></td></tr>)}
    </tbody></table></div>:<p className="sub">Nothing left to suggest — everyone in range is already scheduled.</p>}
    {suggestions.length?<button className="btn btn-success" style={{marginTop:14}} disabled={saving} onClick={confirmAll}>{saving?'Saving…':`Confirm & save ${suggestions.length} shift${suggestions.length===1?'':'s'}`}</button>:null}
   </div>:null}
  </div>:null}
 </div>;
}

function LeaveTab({leave,onChanged}:{leave:{mine:any[];awaitingMyApproval:any[];all:any[]|null}|null;onChanged:()=>void}){
 const [comments,setComments]=useState<Record<string,string>>({});
 async function decide(id:string,decision:'approved'|'rejected'){
  await fetch('/api/hr/leave',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision,comment:comments[id]||''})});
  onChanged();
 }
 if(!leave)return null;
 return <div style={{display:'grid',gap:16}}>
  {leave.awaitingMyApproval.length?<div className="card"><div className="section-title">Awaiting my approval</div>
   {leave.awaitingMyApproval.map(r=><div key={r.id} className="card tight" style={{marginTop:10}}>
    <b>{r.employee?.full_name||r.employee?.email}</b> — {r.leave_type} leave, {r.start_date} to {r.end_date} ({r.days_count} day{r.days_count===1?'':'s'})
    {r.reason?<p className="sub" style={{marginTop:4}}>{r.reason}</p>:null}
    <input placeholder="Optional comment" value={comments[r.id]||''} onChange={e=>setComments(x=>({...x,[r.id]:e.target.value}))} style={{width:'100%',margin:'8px 0'}}/>
    <div style={{display:'flex',gap:10}}><button className="btn btn-success" onClick={()=>decide(r.id,'approved')}>Approve</button><button className="btn btn-danger" onClick={()=>decide(r.id,'rejected')}>Reject</button></div>
   </div>)}
  </div>:null}
  <div className="card">
   <div className="section-title">Company-wide leave{leave.all?'':' (HR view only)'}</div>
   <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Approver</th></tr></thead><tbody>
    {(leave.all||[]).map((r:any)=><tr key={r.id}><td>{r.employee?.full_name||r.employee?.email}</td><td>{r.leave_type}</td><td>{r.start_date} – {r.end_date}</td><td>{r.days_count}</td><td><span className={`pill ${r.status==='approved'?'ok':r.status==='rejected'?'danger':'warn'}`}>{r.status}</span></td><td>{r.approver?.full_name||r.approver?.email||'—'}</td></tr>)}
    {leave.all&&!leave.all.length?<tr><td colSpan={6} className="sub">No leave requests yet.</td></tr>:null}
   </tbody></table></div>
  </div>
 </div>;
}

function DirectoryTab({employees}:{employees:any[]}){
 const [q,setQ]=useState('');
 const byId=new Map(employees.map(e=>[e.id,e]));
 const filtered=employees.filter(e=>!q.trim()||[e.full_name,e.email,e.departmentName,e.designation].filter(Boolean).some((v:string)=>v.toLowerCase().includes(q.trim().toLowerCase())));
 return <div className="card">
  <div className="search-field" style={{maxWidth:360,marginBottom:14}}><Search size={14}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, email, department, designation…"/></div>
  <div className="table-wrap"><table><thead><tr><th>Name</th><th>Designation</th><th>Department</th><th>Reports to</th><th>Email</th></tr></thead><tbody>
   {filtered.map(e=><tr key={e.id}><td><b>{e.full_name||'—'}</b></td><td>{e.designation||'—'}</td><td>{e.departmentName||'—'}</td><td>{byId.get(e.supervisor_id)?.full_name||'—'}</td><td>{e.email}</td></tr>)}
   {!filtered.length?<tr><td colSpan={5} className="sub">No employees match this search.</td></tr>:null}
  </tbody></table></div>
 </div>;
}

function ProfileTab({employees,selected,onSelect}:{employees:any[];selected:string;onSelect:(id:string)=>void}){
 const [profile,setProfile]=useState<any>(null),[form,setForm]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [education,setEducation]=useState<any[]>([]),[documents,setDocuments]=useState<any[]>([]),[docCategories,setDocCategories]=useState<string[]>([]);
 const [eduLevel,setEduLevel]=useState(''),[eduInstitution,setEduInstitution]=useState(''),[eduField,setEduField]=useState(''),[eduStart,setEduStart]=useState(''),[eduEnd,setEduEnd]=useState(''),[eduGrade,setEduGrade]=useState('');
 const [docCategory,setDocCategory]=useState('other'),[docLabel,setDocLabel]=useState(''),[docFile,setDocFile]=useState<File|null>(null);
 function loadProfile(){if(!selected)return;fetch(`/api/hr/personal?profileId=${selected}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error){setProfile(j.profile);const f:Record<string,string>={};for(const k of personalFieldKeys)f[k]=j.profile?.[k]||'';setForm(f)}})}
 function loadEducation(){if(!selected)return;fetch(`/api/hr/education?profileId=${selected}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setEducation(j.records||[])})}
 function loadDocuments(){if(!selected)return;fetch(`/api/hr/documents?profileId=${selected}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error){setDocuments(j.records||[]);setDocCategories(j.categories||[])}})}
 useEffect(()=>{loadProfile();loadEducation();loadDocuments()},[selected]);
 async function save(){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/hr/personal',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:selected,...form})});const j=await r.json();if(!r.ok)throw new Error(j.error);setProfile(j.profile);setNotice('Saved.')}catch(e){setError(e instanceof Error?e.message:'Unable to save')}finally{setBusy(false)}}
 async function addEducation(){if(!eduLevel.trim())return;await fetch('/api/hr/education',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:selected,level:eduLevel,institution:eduInstitution,fieldOfStudy:eduField,startYear:eduStart,endYear:eduEnd,grade:eduGrade})});setEduLevel('');setEduInstitution('');setEduField('');setEduStart('');setEduEnd('');setEduGrade('');loadEducation()}
 async function removeEducation(id:number){await fetch(`/api/hr/education?id=${id}`,{method:'DELETE'});loadEducation()}
 async function uploadDoc(){if(!docFile)return;const fd=new FormData();fd.append('profileId',selected);fd.append('category',docCategory);fd.append('label',docLabel);fd.append('file',docFile);await fetch('/api/hr/documents',{method:'POST',body:fd});setDocFile(null);setDocLabel('');loadDocuments()}
 async function removeDoc(id:number){await fetch(`/api/hr/documents?id=${id}`,{method:'DELETE'});loadDocuments()}
 return <div style={{display:'grid',gap:16}}>
  <div className="card">
   <div className="field" style={{maxWidth:340}}><label>Employee</label><select value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
  </div>
  {!selected?<div className="card"><EmptyState title="Choose an employee" description="Select someone above to view or edit their profile."/></div>:<>
   <div className="card">
    <div className="section-title"><User size={15} style={{verticalAlign:-2,marginRight:5}}/>Personal details</div>
    {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
    {notice?<div className="notice" style={{marginTop:10}}>{notice}</div>:null}
    <div className="grid two" style={{marginTop:12}}>
     {personalFieldDefs.map(f=><Field label={f.label} key={f.key}><input type={f.type||'text'} value={form[f.key]||''} onChange={e=>setForm(x=>({...x,[f.key]:e.target.value}))}/></Field>)}
     <Field label="Date of joining"><input type="date" value={form.date_of_joining||''} onChange={e=>setForm(x=>({...x,date_of_joining:e.target.value}))}/></Field>
    </div>
    <Field label="Current address"><textarea rows={2} value={form.current_address||''} onChange={e=>setForm(x=>({...x,current_address:e.target.value}))}/></Field>
    <Field label="Permanent address"><textarea rows={2} value={form.permanent_address||''} onChange={e=>setForm(x=>({...x,permanent_address:e.target.value}))}/></Field>
    <button className="btn btn-primary" style={{marginTop:14}} disabled={busy} onClick={save}>{busy?'Saving…':'Save personal details'}</button>
   </div>

   <div className="card">
    <div className="section-title">Education</div>
    <div className="grid two" style={{marginTop:12}}>
     <Field label="Level"><input value={eduLevel} onChange={e=>setEduLevel(e.target.value)}/></Field>
     <Field label="Institution"><input value={eduInstitution} onChange={e=>setEduInstitution(e.target.value)}/></Field>
     <Field label="Field of study"><input value={eduField} onChange={e=>setEduField(e.target.value)}/></Field>
     <Field label="Grade / %"><input value={eduGrade} onChange={e=>setEduGrade(e.target.value)}/></Field>
     <Field label="Start year"><input type="number" value={eduStart} onChange={e=>setEduStart(e.target.value)}/></Field>
     <Field label="End year"><input type="number" value={eduEnd} onChange={e=>setEduEnd(e.target.value)}/></Field>
    </div>
    <button className="btn btn-secondary" style={{marginTop:10}} disabled={!eduLevel.trim()} onClick={addEducation}><PlusCircle size={15}/> Add</button>
    <div style={{display:'grid',gap:10,marginTop:14}}>
     {education.map(r=><div key={r.id} className="card tight split-header"><div><b>{r.level}</b><p className="sub" style={{marginTop:2}}>{r.institution||'—'}{r.field_of_study?` • ${r.field_of_study}`:''}{r.start_year||r.end_year?` • ${r.start_year||''}–${r.end_year||''}`:''}{r.grade?` • ${r.grade}`:''}</p></div><button className="row-action-btn" onClick={()=>removeEducation(r.id)}><Trash2 size={13}/></button></div>)}
     {!education.length?<p className="sub">No education records yet.</p>:null}
    </div>
   </div>

   <div className="card">
    <div className="section-title">Documents</div>
    <div className="grid two" style={{marginTop:12}}>
     <Field label="Category"><select value={docCategory} onChange={e=>setDocCategory(e.target.value)}>{docCategories.map(c=><option key={c} value={c}>{documentCategoryLabels[c]||c}</option>)}</select></Field>
     <Field label="Label (optional)"><input value={docLabel} onChange={e=>setDocLabel(e.target.value)}/></Field>
    </div>
    <Field label="File"><input type="file" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></Field>
    <button className="btn btn-secondary" style={{marginTop:10}} disabled={!docFile} onClick={uploadDoc}><Upload size={15}/> Upload</button>
    <div style={{display:'grid',gap:10,marginTop:14}}>
     {documents.map(r=><div key={r.id} className="card tight split-header"><div><b>{documentCategoryLabels[r.category]||r.category}</b>{r.label?<p className="sub" style={{marginTop:2}}>{r.label}</p>:null}<p className="sub" style={{marginTop:2}}>{r.file_name}</p></div><div style={{display:'flex',gap:8}}>{r.documentUrl?<a className="row-action-btn" href={r.documentUrl} target="_blank" rel="noreferrer"><Download size={13}/></a>:null}<button className="row-action-btn" onClick={()=>removeDoc(r.id)}><Trash2 size={13}/></button></div></div>)}
     {!documents.length?<p className="sub">No documents uploaded yet.</p>:null}
    </div>
   </div>
  </>}
 </div>;
}
const personalFieldDefs:{key:string;label:string;type?:string}[]=[
 {key:'date_of_birth',label:'Date of birth',type:'date'},{key:'gender',label:'Gender'},{key:'marital_status',label:'Marital status'},{key:'blood_group',label:'Blood group'},
 {key:'personal_email',label:'Personal email'},{key:'alternate_phone',label:'Alternate phone'},
 {key:'emergency_contact_name',label:'Emergency contact name'},{key:'emergency_contact_phone',label:'Emergency contact phone'},{key:'emergency_contact_relation',label:'Relation'},
 {key:'bank_account_name',label:'Bank account holder name'},{key:'bank_account_number',label:'Bank account number'},{key:'bank_ifsc',label:'IFSC code'},{key:'bank_name',label:'Bank name'},
 {key:'pan_number',label:'PAN number'},{key:'aadhaar_number',label:'Aadhaar number'},
];
const personalFieldKeys=['current_address','permanent_address','date_of_joining',...personalFieldDefs.map(f=>f.key)];

// Issuing now pulls from the central asset registry (see /assets) instead
// of free-typing type/name/serial each time. Rows issued before the
// registry existed (asset_id null) keep working — their "Mark returned"
// falls back to the original PATCH /api/hr/assets path since there's no
// registry asset to flip back to 'available'.
function AssetsTab({employees,selected,onSelect}:{employees:any[];selected:string;onSelect:(id:string)=>void}){
 const [records,setRecords]=useState<any[]>([]),[available,setAvailable]=useState<any[]>([]);
 const [assetId,setAssetId]=useState(''),[issuedDate,setIssuedDate]=useState(''),[conditionNotes,setConditionNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){if(!selected)return;fetch(`/api/hr/assets?profileId=${selected}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])})}
 function loadAvailable(){fetch('/api/assets?status=available',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setAvailable(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load()},[selected]);
 useEffect(()=>{loadAvailable()},[]);
 async function add(){
  if(!selected||!assetId)return;setBusy(true);setError('');
  try{const r=await fetch('/api/assets/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',assetId:Number(assetId),profileId:selected,issuedDate,conditionNotes})});const j=await r.json();if(!r.ok)throw new Error(j.error);setAssetId('');setIssuedDate('');setConditionNotes('');load();loadAvailable()}
  catch(e){setError(e instanceof Error?e.message:'Unable to assign asset')}finally{setBusy(false)}
 }
 async function markReturned(r:any){
  if(r.asset_id)await fetch('/api/assets/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'return',employeeAssetId:r.id})});
  else await fetch('/api/hr/assets',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:r.id,returnDate:new Date().toISOString().slice(0,10)})});
  load();loadAvailable();
 }
 return <div className="card">
  <div className="field" style={{marginBottom:14,maxWidth:340}}><label>Employee</label><select value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
  {!selected?<EmptyState title="Choose an employee" description="Select someone above to view or issue assets."/>:<>
   {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
   <div className="grid two" style={{marginBottom:14}}>
    <Field label="Asset"><select value={assetId} onChange={e=>setAssetId(e.target.value)}><option value="">Select an available asset</option>{available.map(a=><option key={a.id} value={a.id}>{a.asset_tag} — {a.name} ({a.type})</option>)}</select></Field>
    <Field label="Issued date"><input type="date" value={issuedDate} onChange={e=>setIssuedDate(e.target.value)}/></Field>
    <Field label="Condition notes"><input value={conditionNotes} onChange={e=>setConditionNotes(e.target.value)}/></Field>
   </div>
   {!available.length?<p className="sub" style={{marginBottom:14}}>No available assets in the registry — <a href="/assets">register one</a> first.</p>:null}
   <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!assetId} onClick={add}>{busy?'Assigning…':'Issue asset'}</button>
   <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Type</th><th>Serial</th><th>Issued</th><th>Status</th><th></th></tr></thead><tbody>
    {records.map(r=><tr key={r.id}><td>{r.asset_name}</td><td>{r.asset_type}</td><td>{r.serial_number||'—'}</td><td>{r.issued_date}</td><td><span className={`pill ${r.return_date?'neutral':'ok'}`}>{r.return_date?`Returned ${r.return_date}`:'With employee'}</span></td><td>{!r.return_date?<button className="btn btn-outline btn-sm" onClick={()=>markReturned(r)}>Mark returned</button>:null}</td></tr>)}
    {!records.length?<tr><td colSpan={6} className="sub">No assets issued yet.</td></tr>:null}
   </tbody></table></div>
  </>}
 </div>;
}

function CompanyDocsTab(){
 const [records,setRecords]=useState<any[]>([]),[title,setTitle]=useState(''),[category,setCategory]=useState(''),[content,setContent]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){fetch('/api/hr/company-documents?all=1',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function add(){
  if(!title.trim()||!content.trim())return;setBusy(true);setError('');
  try{
   const fd=new FormData();fd.append('title',title);fd.append('content',content);if(category)fd.append('category',category);if(file)fd.append('file',file);
   const r=await fetch('/api/hr/company-documents',{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.error);
   setTitle('');setCategory('');setContent('');setFile(null);load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to add document')}finally{setBusy(false)}
 }
 async function toggleActive(r:any){await fetch('/api/hr/company-documents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:r.id,active:!r.active})});load()}
 async function remove(id:string){await fetch(`/api/hr/company-documents?id=${id}`,{method:'DELETE'});load()}
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  <div className="grid two" style={{marginBottom:12}}>
   <Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Leave Policy"/></Field>
   <Field label="Category (optional)"><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Policy / Handbook / Circular"/></Field>
  </div>
  <Field label="Content"><textarea rows={5} value={content} onChange={e=>setContent(e.target.value)} placeholder="Plain text the chatbot can read and answer questions from."/></Field>
  <Field label="Attach original file (optional)"><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field>
  <button className="btn btn-primary" style={{marginTop:10,marginBottom:18}} disabled={busy||!title.trim()||!content.trim()} onClick={add}>{busy?'Saving…':'Add document'}</button>
  <div style={{display:'grid',gap:10}}>
   {records.map((r:any)=><div key={r.id} className="card tight">
    <div className="split-header"><b>{r.title}</b><span className={`pill ${r.active?'ok':'neutral'}`}>{r.active?'Active':'Inactive'}</span></div>
    {r.category?<p className="sub" style={{marginTop:4}}>{r.category}</p>:null}
    <p className="sub" style={{marginTop:4,whiteSpace:'pre-wrap'}}>{r.content.length>240?`${r.content.slice(0,240)}…`:r.content}</p>
    <div style={{display:'flex',gap:8,marginTop:8}}>
     {r.documentUrl?<a className="btn btn-outline btn-sm" href={r.documentUrl} target="_blank" rel="noreferrer"><Download size={13}/> File</a>:null}
     <button className="btn btn-outline btn-sm" onClick={()=>toggleActive(r)}>{r.active?'Deactivate':'Activate'}</button>
     <button className="btn btn-outline btn-sm" onClick={()=>remove(r.id)}><Trash2 size={13}/> Remove</button>
    </div>
   </div>)}
   {!records.length?<p className="sub">No company documents yet.</p>:null}
  </div>
 </div>;
}

function LeaveBalancesTab({employees}:{employees:any[]}){
 const year=new Date().getFullYear();
 const [balances,setBalances]=useState<any[]>([]);
 const [profileId,setProfileId]=useState(''),[leaveType,setLeaveType]=useState('casual'),[allocatedDays,setAllocatedDays]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){fetch(`/api/hr/leave-balances?year=${year}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setBalances(j.balances||[])}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function save(){
  if(!profileId||!leaveType.trim()||!allocatedDays)return;setBusy(true);setError('');
  try{const r=await fetch('/api/hr/leave-balances',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,leaveType,year,allocatedDays:Number(allocatedDays)})});const j=await r.json();if(!r.ok)throw new Error(j.error);setAllocatedDays('');load()}
  catch(e){setError(e instanceof Error?e.message:'Unable to save allocation')}finally{setBusy(false)}
 }
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  <div className="grid two" style={{marginBottom:14}}>
   <Field label="Employee"><select value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></Field>
   <Field label="Leave type"><select value={leaveType} onChange={e=>setLeaveType(e.target.value)}><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option><option value="unpaid">Unpaid</option></select></Field>
   <Field label={`Allocated days (${year})`}><input type="number" min={0} value={allocatedDays} onChange={e=>setAllocatedDays(e.target.value)}/></Field>
  </div>
  <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!profileId||!allocatedDays} onClick={save}>{busy?'Saving…':'Set allocation'}</button>
  <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Allocated</th></tr></thead><tbody>
   {balances.map((b:any)=><tr key={b.id}><td>{b.profile?.full_name||b.profile?.email||'—'}</td><td>{b.leave_type}</td><td>{b.allocated_days}</td></tr>)}
   {!balances.length?<tr><td colSpan={3} className="sub">No allocations set for {year} yet.</td></tr>:null}
  </tbody></table></div>
 </div>;
}

function HolidaysTab(){
 const [holidays,setHolidays]=useState<any[]>([]),[name,setName]=useState(''),[holidayDate,setHolidayDate]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){fetch('/api/hr/holidays',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setHolidays(j.holidays||[])}).catch(()=>{})}
 useEffect(()=>{load()},[]);
 async function add(){
  if(!name.trim()||!holidayDate)return;setBusy(true);setError('');
  try{const r=await fetch('/api/hr/holidays',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,holidayDate,description})});const j=await r.json();if(!r.ok)throw new Error(j.error);setName('');setHolidayDate('');setDescription('');load()}
  catch(e){setError(e instanceof Error?e.message:'Unable to add holiday')}finally{setBusy(false)}
 }
 async function remove(id:number){await fetch(`/api/hr/holidays?id=${id}`,{method:'DELETE'});load()}
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  <div className="grid two" style={{marginBottom:14}}>
   <Field label="Holiday name"><input value={name} onChange={e=>setName(e.target.value)}/></Field>
   <Field label="Date"><input type="date" value={holidayDate} onChange={e=>setHolidayDate(e.target.value)}/></Field>
  </div>
  <Field label="Description (optional)"><input value={description} onChange={e=>setDescription(e.target.value)}/></Field>
  <button className="btn btn-primary" style={{marginTop:10,marginBottom:18}} disabled={busy||!name.trim()||!holidayDate} onClick={add}>{busy?'Saving…':'Add holiday'}</button>
  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Holiday</th><th>Description</th><th></th></tr></thead><tbody>
   {holidays.map((h:any)=><tr key={h.id}><td>{h.holiday_date}</td><td>{h.name}</td><td>{h.description||'—'}</td><td><button className="btn btn-outline btn-sm" onClick={()=>remove(h.id)}><Trash2 size={13}/></button></td></tr>)}
   {!holidays.length?<tr><td colSpan={4} className="sub">No holidays added yet.</td></tr>:null}
  </tbody></table></div>
 </div>;
}

function PerformanceTab({employees,selected,onSelect}:{employees:any[];selected:string;onSelect:(id:string)=>void}){
 const [records,setRecords]=useState<any[]>([]),[periodLabel,setPeriodLabel]=useState(''),[periodStart,setPeriodStart]=useState(''),[periodEnd,setPeriodEnd]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){if(!selected)return;fetch(`/api/hr/performance?profileId=${selected}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setRecords((j.all||[]).filter((r:any)=>r.profile_id===selected))})}
 useEffect(()=>{load()},[selected]);
 async function add(){if(!selected||!periodLabel.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/hr/performance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:selected,periodLabel,periodStart,periodEnd})});const j=await r.json();if(!r.ok)throw new Error(j.error);setPeriodLabel('');setPeriodStart('');setPeriodEnd('');load()}catch(e){setError(e instanceof Error?e.message:'Unable to start review')}finally{setBusy(false)}}
 return <div style={{display:'grid',gap:16}}>
  <div className="card">
   <div className="field" style={{marginBottom:14,maxWidth:340}}><label>Employee</label><select value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Select an employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></div>
   {!selected?<EmptyState title="Choose an employee" description="Select someone above to start or view a performance review."/>:<>
    {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
    <div className="grid two" style={{marginBottom:14}}>
     <Field label="Review period"><input value={periodLabel} onChange={e=>setPeriodLabel(e.target.value)} placeholder="e.g. 2026 H1"/></Field>
     <Field label="Period start"><input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></Field>
     <Field label="Period end"><input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></Field>
    </div>
    <button className="btn btn-primary" style={{marginBottom:18}} disabled={busy||!periodLabel.trim()} onClick={add}>{busy?'Starting…':'Start review'}</button>
    <div style={{display:'grid',gap:10}}>
     {records.map((r:any)=><div key={r.id} className="card tight">
      <div className="split-header"><b>{r.period_label}</b><span className={`pill ${r.status==='completed'?'ok':r.status==='submitted'?'warn':'neutral'}`}>{r.status}</span></div>
      <p className="sub" style={{marginTop:4}}>Reviewer: {r.reviewer?.full_name||r.reviewer?.email||'—'}</p>
      {r.self_assessment?<p className="sub" style={{marginTop:4}}><b>Self-assessment:</b> {r.self_assessment}</p>:null}
      {r.reviewer_assessment?<p className="sub" style={{marginTop:4}}><b>Reviewer:</b> {r.reviewer_assessment}{r.rating?` • ${r.rating}`:''}</p>:null}
     </div>)}
     {!records.length?<p className="sub">No reviews yet for this employee.</p>:null}
    </div>
   </>}
  </div>
  {selected?<GoalsPanel profileId={selected} canManage={true}/>:null}
 </div>;
}

// Shared between the HR console (always canManage=true, HR is gated by the
// page itself) and My Team on /hr/my (canManage depends on whether the
// viewer is this profile's own reporting manager). Core fields (title/
// description/target date) are only editable when canManage; progress/
// status editing for the OWNER's own view is handled separately by
// MyGoalsPanel on /hr/my, not here.
function GoalsPanel({profileId,canManage}:{profileId:string;canManage:boolean}){
 const [goals,setGoals]=useState<any[]>([]),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[targetDate,setTargetDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function load(){fetch(`/api/hr/goals?profileId=${profileId}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setGoals(j.records||[])}).catch(()=>{})}
 useEffect(()=>{load()},[profileId]);
 async function add(){if(!title.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/hr/goals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,title,description,targetDate})});const j=await r.json();if(!r.ok)throw new Error(j.error);setTitle('');setDescription('');setTargetDate('');load()}catch(e){setError(e instanceof Error?e.message:'Unable to add goal')}finally{setBusy(false)}}
 async function remove(id:string){await fetch(`/api/hr/goals?id=${id}`,{method:'DELETE'});load()}
 const statusTone:Record<string,string>={not_started:'neutral',in_progress:'warn',completed:'ok',missed:'danger'};
 return <div className="card">
  <div className="section-title"><Target size={15} style={{verticalAlign:-2,marginRight:5}}/>Goals</div>
  {canManage?<>
   {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
   <div className="grid two" style={{marginTop:12}}>
    <Field label="Goal title"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field>
    <Field label="Target date"><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)}/></Field>
   </div>
   <Field label="Description (optional)"><textarea rows={2} value={description} onChange={e=>setDescription(e.target.value)}/></Field>
   <button className="btn btn-primary" style={{marginTop:10}} disabled={busy||!title.trim()} onClick={add}>{busy?'Adding…':'Add goal'}</button>
  </>:null}
  <div style={{display:'grid',gap:10,marginTop:16}}>
   {goals.map(g=><div key={g.id} className="card tight">
    <div className="split-header"><b>{g.title}</b><span className={`pill ${statusTone[g.status]||'neutral'}`}>{String(g.status).replaceAll('_',' ')}</span></div>
    {g.description?<p className="sub" style={{marginTop:4}}>{g.description}</p>:null}
    <div className="progress" style={{marginTop:8}}><span style={{width:`${g.progress}%`}}/></div>
    <p className="sub" style={{marginTop:4}}>{g.progress}% complete{g.target_date?` • Target ${g.target_date}`:''}</p>
    {canManage?<button className="btn btn-outline btn-sm" style={{marginTop:8}} onClick={()=>remove(g.id)}>Remove</button>:null}
   </div>)}
   {!goals.length?<p className="sub">No goals set yet.</p>:null}
  </div>
 </div>;
}
