'use client';
import {useEffect,useMemo,useState,type ChangeEvent,type ReactNode,type FormEvent} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Drawer} from '@/components/Drawer';
import {Modal} from '@/components/Modal';
import {EmptyState} from '@/components/EmptyState';
import {AlertTriangle,Plus,Radio,Search,Settings2,ShieldCheck,SlidersHorizontal,UserCog,UserPlus} from 'lucide-react';
import {ShiftControlList} from '@/components/ShiftControlList';

const roles=['super_admin','admin','ceo','management','finance_user','finance_manager','solvent_operator','solvent_head','safety_user','quality_operator','quality_head','hr_admin','import_operator','import_manager','export_operator','export_manager','ops_operator','viewer'];
const modules=[
 {id:'ceo',label:'CEO Cockpit'},
 {id:'solvent_management',label:'Solvent Production & Safety'},
 {id:'quality_management',label:'Quality – Analytics & AI'},
 {id:'finance_transaction',label:'Finance – Transaction Reconciliation'},
 {id:'finance_vendor_payment',label:'Finance – Vendor Payment Reconciliation'},
 {id:'input',label:'Solvent Parameter Input'},
 {id:'quality_input',label:'Quality Data Entry'},
 {id:'import',label:'Import'},
 {id:'export',label:'Export'},
 {id:'hr',label:'HR'},
 {id:'assets',label:'Asset Management'},
 {id:'admin',label:'Administration'},
 {id:'operations_intelligence',label:'Operations Intelligence'}
];
const roleDefaults:Record<string,string[]>={super_admin:modules.map(m=>m.id),admin:['solvent_management','quality_management','finance_transaction','finance_vendor_payment','input','quality_input','import','export','hr','admin','operations_intelligence'],ceo:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],management:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],finance_user:['finance_transaction','finance_vendor_payment'],finance_manager:['finance_transaction','finance_vendor_payment'],solvent_operator:['input'],solvent_head:['solvent_management','input'],safety_user:['input'],quality_operator:['quality_input'],quality_head:['quality_management','quality_input'],hr_admin:['hr'],import_operator:['import'],import_manager:['import'],export_operator:['export'],export_manager:['export'],ops_operator:['operations_intelligence'],viewer:[]};
const frequencies=['hourly','every_two_hours','every_4_hours','once_per_shift','daily','first_shift_only','conditional','no_entry'];
const inputs=['number','check','select','text','time'];

type Perm={view:boolean;edit:boolean;delete:boolean};
type ModulePerms=Record<string,Perm>;
function blankPerms():ModulePerms{const o:ModulePerms={};for(const m of modules)o[m.id]={view:false,edit:false,delete:false};return o}
function permsFromViewList(list:string[]):ModulePerms{const o=blankPerms();for(const m of list)o[m]={view:true,edit:false,delete:false};return o}

type NewUser={fullName:string;email:string;password:string;department:string;designation:string;role:string;modulePerms:ModulePerms};
type NewParam={module:string;productCode:string;sectionName:string;sourceSerial:string;sourceGroup:string;name:string;unit:string;targetText:string;inputType:string;frequency:string;sampleFrequency:string;resultLatencyMinutes:string;mandatory:boolean;alertEnabled:boolean;ticketEnabled:boolean;warningLow:string;warningHigh:string;criticalLow:string;criticalHigh:string};
const blankUser:NewUser={fullName:'',email:'',password:'',department:'',designation:'',role:'viewer',modulePerms:blankPerms()};
const blankParam:NewParam={module:'solvent',productCode:'PLANT',sectionName:'',sourceSerial:'',sourceGroup:'',name:'',unit:'',targetText:'',inputType:'number',frequency:'hourly',sampleFrequency:'',resultLatencyMinutes:'',mandatory:true,alertEnabled:true,ticketEnabled:true,warningLow:'',warningHigh:'',criticalLow:'',criticalHigh:''};
const blankShift={name:'',startTime:'06:00',endTime:'14:00',crossesMidnight:false};

export default function Admin(){
 // ---- All data + mutation logic below is unchanged from the pre-redesign build: same endpoints, same payload shapes. ----
 const [tab,setTab]=useState<'users'|'parameters'|'shifts'|'shift_control'>('users');const [users,setUsers]=useState<any[]>([]);const [params,setParams]=useState<any[]>([]);const [shifts,setShifts]=useState<any[]>([]);const [sections,setSections]=useState<any[]>([]);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [newUser,setNewUser]=useState<NewUser>(blankUser);
 const [newParam,setNewParam]=useState<NewParam>(blankParam);
 const [newShift,setNewShift]=useState(blankShift);
 async function load(){setError('');const [ur,pr,sr]=await Promise.all([fetch('/api/admin/users',{cache:'no-store'}),fetch('/api/admin/parameters',{cache:'no-store'}),fetch('/api/admin/shifts',{cache:'no-store'})]);const [u,p,s]=await Promise.all([ur.json(),pr.json(),sr.json()]);if(!ur.ok||!pr.ok||!sr.ok)throw new Error(u.error||p.error||s.error||'Administration data failed');setUsers(u.users||[]);setParams(p.parameters||[]);setSections(p.sections||[]);setShifts(s.shifts||[])}
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Unable to load administration'))},[]);
 function changeNewRole(role:string){setNewUser(x=>({...x,role,modulePerms:permsFromViewList(roleDefaults[role]||[])}))}
 async function createUser(e:FormEvent){e.preventDefault();setError('');const r=await fetch('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(newUser)});const j=await r.json();if(!r.ok)return setError(j.error);setNotice(j.pendingAccessRequests?`User created. ${j.pendingAccessRequests} module access request${j.pendingAccessRequests===1?'':'s'} sent to Management for approval.`:'User created.');setNewUser(blankUser);await load()}
 async function updateUser(userId:string,payload:any){setError('');const r=await fetch('/api/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({userId,...payload})});const j=await r.json();if(!r.ok)return setError(j.error);setNotice(j.pendingAccessRequests?`Profile updated. ${j.pendingAccessRequests} module access request${j.pendingAccessRequests===1?'':'s'} sent to Management for approval.`:'User profile updated.');await load()}
 async function createParam(e:FormEvent){e.preventDefault();setError('');const payload={...newParam,resultLatencyMinutes:newParam.resultLatencyMinutes===''?null:Number(newParam.resultLatencyMinutes),warningLow:newParam.warningLow===''?null:Number(newParam.warningLow),warningHigh:newParam.warningHigh===''?null:Number(newParam.warningHigh),criticalLow:newParam.criticalLow===''?null:Number(newParam.criticalLow),criticalHigh:newParam.criticalHigh===''?null:Number(newParam.criticalHigh)};const r=await fetch('/api/admin/parameters',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(!r.ok)return setError(j.error);setNotice('Parameter created and available to the applicable input workspace.');setNewParam(blankParam);await load()}
 async function saveParam(p:any){const r=await fetch('/api/admin/parameters',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(p)});const j=await r.json();if(!r.ok)return setError(j.error);setNotice('Parameter and target settings updated.');await load()}
 async function createShift(e:FormEvent){e.preventDefault();const r=await fetch('/api/admin/shifts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(newShift)});const j=await r.json();if(!r.ok)return setError(j.error);setNotice('Shift created.');setNewShift(blankShift);await load()}
 async function updateShift(s:any){const r=await fetch('/api/admin/shifts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:s.id,name:s.name,startTime:String(s.start_time).slice(0,5),endTime:String(s.end_time).slice(0,5),crossesMidnight:s.crosses_midnight,active:s.active})});const j=await r.json();if(!r.ok)return setError(j.error);setNotice('Shift updated.');await load()}

 return <>
  <PageHeader title="Administration" subtitle="" backHref="/" backLabel="Home"/>
  <div className="admin-banner"><ShieldCheck size={24}/><div><b>Super Admin workspace</b><span>User creation and master-data changes are restricted here and recorded in the audit trail.</span></div></div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {notice?<div className="notice" style={{marginTop:10}}>{notice}</div>:null}
  <div className="tabs admin-tabs"><button className={`tab ${tab==='users'?'active':''}`} onClick={()=>setTab('users')}><UserPlus size={15}/> USERS & ACCESS</button><button className={`tab ${tab==='parameters'?'active':''}`} onClick={()=>setTab('parameters')}><SlidersHorizontal size={15}/> PARAMETERS & TARGETS</button><button className={`tab ${tab==='shifts'?'active':''}`} onClick={()=>setTab('shifts')}><Settings2 size={15}/> SHIFTS</button><button className={`tab ${tab==='shift_control'?'active':''}`} onClick={()=>setTab('shift_control')}><Radio size={15}/> SHIFT CONTROL</button></div>
  {tab==='users'?<Users users={users} value={newUser} setValue={setNewUser} create={createUser} update={updateUser} changeRole={changeNewRole}/>
   :tab==='parameters'?<Parameters params={params} sections={sections} value={newParam} setValue={setNewParam} create={createParam} save={saveParam}/>
   :tab==='shifts'?<Shifts rows={shifts} value={newShift} setValue={setNewShift} create={createShift} save={updateShift}/>
   :<ShiftControl/>}
 </>;
}

/* ---------------- Users & Access ---------------- */
function Users({users,value,setValue,create,update,changeRole}:{users:any[];value:NewUser;setValue:(x:NewUser)=>void;create:(e:FormEvent)=>void;update:(id:string,p:any)=>void;changeRole:(r:string)=>void}){
 const [search,setSearch]=useState('');
 const [addOpen,setAddOpen]=useState(false);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [confirmUser,setConfirmUser]=useState<any>(null);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return users;return users.filter(u=>String(u.full_name||'').toLowerCase().includes(q)||String(u.email||'').toLowerCase().includes(q)||String(u.user_roles?.[0]?.role||'').toLowerCase().includes(q))},[users,search]);
 const editing=users.find(u=>u.id===editingId)||null;
 return <>
  <div className="table-toolbar">
   <div className="search-field"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, email or role…"/></div>
   <span className="table-count">{filtered.length} of {users.length} users</span>
   <button type="button" className="btn btn-primary" onClick={()=>setAddOpen(true)}><Plus size={15}/> Add User</button>
  </div>
  {filtered.length?<div className="row-list">{filtered.map(u=>{const initials=String(u.full_name||u.email||'?').trim().split(/\s+/).slice(0,2).map((x:string)=>x[0]).join('').toUpperCase();const tone=u.is_active?['blue','green','purple','cyan'][String(u.id).charCodeAt(0)%4]:'slate';return <div key={u.id} className="row-list-item as-div">
    <span className={`row-list-avatar ${tone}`}>{initials}</span>
    <span className="row-list-main">
     <span className="row-list-title">{u.full_name||'—'}</span>
     <span className="row-list-sub">{u.email} · {String(u.user_roles?.[0]?.role||'viewer').replaceAll('_',' ')}</span>
    </span>
    <span className="row-list-meta">
     <span className="row-list-date">{(u.modules||[]).length} module{(u.modules||[]).length===1?'':'s'}</span>
     {u.pendingAccessRequests?<span className="pill warn" style={{marginLeft:8}}>{u.pendingAccessRequests} pending</span>:null}
    </span>
    <span className={`pill ${u.is_active?'ok':'danger'}`}>{u.is_active?'ACTIVE':'DISABLED'}</span>
    <span className="row-list-actions"><button className="row-action-btn" onClick={()=>setEditingId(u.id)}>Edit</button><button className="row-action-btn" onClick={()=>u.is_active?setConfirmUser(u):update(u.id,{isActive:true})}>{u.is_active?'Disable':'Enable'}</button></span>
   </div>})}</div>
   :<div className="card"><EmptyState icon={<UserCog size={20}/>} title="No users match this search" description="Try a different name, email or role, or add a new user."/></div>}

  <Drawer open={addOpen} onClose={()=>setAddOpen(false)} title="Add User" subtitle="Create a login, business role and exact Home-module access." footer={<><button type="button" className="btn btn-outline" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" form="add-user-form" className="btn btn-primary">Create user</button></>}>
   <form id="add-user-form" className="drawer-form" onSubmit={e=>{create(e);setAddOpen(false)}}>
    <Field label="Full name"><input required value={value.fullName} onChange={e=>setValue({...value,fullName:e.target.value})}/></Field>
    <Field label="Email"><input required type="email" value={value.email} onChange={e=>setValue({...value,email:e.target.value})}/></Field>
    <Field label="Temporary password"><input required type="password" minLength={8} value={value.password} onChange={e=>setValue({...value,password:e.target.value})}/></Field>
    <div className="grid two"><Field label="Department"><input value={value.department} onChange={e=>setValue({...value,department:e.target.value})}/></Field><Field label="Designation"><input value={value.designation} onChange={e=>setValue({...value,designation:e.target.value})}/></Field></div>
    <Field label="Role"><select value={value.role} onChange={e=>changeRole(e.target.value)}>{roles.map(r=><option key={r}>{r}</option>)}</select></Field>
    <div className="drawer-section-title">Module access — View / Edit / Delete</div>
    <div className="pending-access-note">Any access you set here is sent to Management (or Super Admin) for approval before it takes effect.</div>
    <AccessChecks perms={value.modulePerms} onChange={(m,patch)=>setValue({...value,modulePerms:{...value.modulePerms,[m]:{...value.modulePerms[m],...patch}}})}/>
   </form>
  </Drawer>
  <Drawer open={!!editing} onClose={()=>setEditingId(null)} title={editing?.full_name||editing?.email||'Edit user'} subtitle="Update profile, role, module access or password." footer={editing?<><button type="button" className="btn btn-outline" onClick={()=>setEditingId(null)}>Cancel</button><button type="submit" form="edit-user-form" className="btn btn-primary">Save changes</button></>:null}>
   {editing?<UserEditForm key={editing.id} u={editing} onSave={(id,payload)=>{update(id,payload);setEditingId(null)}}/>:null}
  </Drawer>

  <Modal open={!!confirmUser} onClose={()=>setConfirmUser(null)} title="Disable this user?" tone="danger" description={confirmUser?`${confirmUser.full_name||confirmUser.email} will immediately lose sign-in access. You can re-enable the account at any time.`:''} confirmLabel="Disable user" onConfirm={()=>{update(confirmUser.id,{isActive:false});setConfirmUser(null)}}/>
 </>;
}
function AccessChecks({perms,onChange}:{perms:ModulePerms;onChange:(m:string,patch:Partial<Perm>)=>void}){
 return <div className="module-access-grid">{modules.map(m=>{const p=perms[m.id]||{view:false,edit:false,delete:false};const any=p.view||p.edit||p.delete;return <div className={`access-check-row ${any?'selected':''}`} key={m.id}>
  <span className="access-check-label">{m.label}</span>
  <span className="perm-toggles">
   <label className="perm-toggle"><input type="checkbox" checked={p.view} onChange={e=>onChange(m.id,e.target.checked?{view:true}:{view:false,edit:false,delete:false})}/> View</label>
   <label className="perm-toggle"><input type="checkbox" checked={p.edit} disabled={!p.view} onChange={e=>onChange(m.id,{edit:e.target.checked})}/> Edit</label>
   <label className="perm-toggle"><input type="checkbox" checked={p.delete} disabled={!p.view} onChange={e=>onChange(m.id,{delete:e.target.checked})}/> Delete</label>
  </span>
 </div>})}</div>;
}
function UserEditForm({u,onSave}:{u:any;onSave:(id:string,p:any)=>void}){
 const [role,setRole]=useState(String(u.user_roles?.[0]?.role||'viewer'));
 const [perms,setPerms]=useState<ModulePerms>(()=>{const base=blankPerms();const mp=u.modulePerms||{};for(const m of modules)if(mp[m.id])base[m.id]={view:!!mp[m.id].view,edit:!!mp[m.id].edit,delete:!!mp[m.id].delete};return base});
 const [name,setName]=useState(u.full_name||'');const [department,setDepartment]=useState(u.department||'');const [designation,setDesignation]=useState(u.designation||'');const [password,setPassword]=useState('');
 const onChange=(m:string,patch:Partial<Perm>)=>setPerms(x=>({...x,[m]:{...x[m],...patch}}));
 return <form id="edit-user-form" className="drawer-form" onSubmit={e=>{e.preventDefault();onSave(u.id,{role,modulePerms:perms,full_name:name,department,designation,password:password||undefined})}}>
  <Field label="Full name"><input value={name} onChange={e=>setName(e.target.value)}/></Field>
  <div className="grid two"><Field label="Department"><input value={department} onChange={e=>setDepartment(e.target.value)}/></Field><Field label="Designation"><input value={designation} onChange={e=>setDesignation(e.target.value)}/></Field></div>
  <Field label="Role"><select value={role} onChange={e=>{const r=e.target.value;setRole(r);setPerms(permsFromViewList(roleDefaults[r]||[]))}}>{roles.map(r=><option key={r}>{r}</option>)}</select></Field>
  <div className="drawer-section-title">Module access — View / Edit / Delete</div>
  {u.pendingAccessRequests?<div className="pending-access-note">{u.pendingAccessRequests} access request{u.pendingAccessRequests===1?'':'s'} for this user {u.pendingAccessRequests===1?'is':'are'} still waiting on Management approval.</div>:null}
  <div className="pending-access-note">Any change here is sent to Management (or Super Admin) for approval — the module is blocked for this user until it's decided.</div>
  <AccessChecks perms={perms} onChange={onChange}/>
  <Field label="New password (optional)"><input type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Leave blank to keep current"/></Field>
 </form>;
}

/* ---------------- Parameters & Targets ---------------- */
function Parameters({params,sections,value,setValue,create,save}:{params:any[];sections:any[];value:NewParam;setValue:(x:NewParam)=>void;create:(e:FormEvent)=>void;save:(p:any)=>void}){
 const [search,setSearch]=useState('');
 const [addOpen,setAddOpen]=useState(false);
 const [editingId,setEditingId]=useState<number|null>(null);
 const [reviewOnly,setReviewOnly]=useState(false);
 const reviewCount=useMemo(()=>params.filter((p:any)=>p.active&&p.source_review_required).length,[params]);
 const targetGapCount=useMemo(()=>params.filter((p:any)=>['quality','solvent','boiler'].includes(String(p.parameter_sections?.module||''))&&!String(p.target_text||'').trim()).length,[params]);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();let list=params;if(reviewOnly)list=list.filter((p:any)=>p.active&&p.source_review_required);if(!q)return list;return list.filter((p:any)=>String(p.name||'').toLowerCase().includes(q)||String(p.parameter_sections?.name||'').toLowerCase().includes(q)||String(p.parameter_sections?.module||'').toLowerCase().includes(q))},[params,search,reviewOnly]);
 const editing=params.find((p:any)=>p.id===editingId)||null;
 return <>
  {/* Section F/AL: a target imported from a source document that could not
      be parsed without guessing (a bare number with no comparison symbol,
      or an unresolved compound criterion) is flagged for a human to
      confirm rather than silently assumed — this banner is where that
      confirmation happens, across every module, not just the newest QC
      import. */}
  {reviewCount?<button type="button" className={`review-needed-banner ${reviewOnly?'active':''}`} onClick={()=>setReviewOnly(v=>!v)}><AlertTriangle size={15}/><span><b>{reviewCount} parameter{reviewCount===1?'':'s'} need{reviewCount===1?'s':''} review</b> — imported from a source document with a target that could not be parsed without guessing. {reviewOnly?'Showing flagged parameters only — click to show all.':'Click to filter to just these.'}</span></button>:null}
  {targetGapCount?<div className="notice danger" style={{marginBottom:12}}><AlertTriangle size={15}/><span><b>{targetGapCount} active data-entry parameter{targetGapCount===1?'':'s'} {targetGapCount===1?'has':'have'} no target.</b> Entry and shift finalization are locked for those rows until a business-approved target is entered here.</span></div>:null}
  <div className="table-toolbar">
   <div className="search-field"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by parameter, section or area…"/></div>
   <span className="table-count">{filtered.length} of {params.length} configured parameters</span>
   <button type="button" className="btn btn-primary" onClick={()=>setAddOpen(true)}><Plus size={15}/> Add Parameter</button>
  </div>
  <div className="card" style={{padding:0}}>
   {filtered.length?<div className="table-wrap" style={{maxHeight:640,border:0,borderRadius:'var(--radius-md)'}}><table><thead><tr><th>Area</th><th>Product</th><th>Section</th><th>S.No</th><th>Parameter</th><th>Target</th><th>Frequency</th><th>Active</th><th></th></tr></thead><tbody>{filtered.map((p:any)=><tr key={p.id} className={p.active&&p.source_review_required?'row-flagged':''}><td style={{textTransform:'capitalize'}}>{p.parameter_sections?.module}</td><td>{p.product_code||'PLANT'}</td><td>{p.parameter_sections?.name}</td><td>{p.source_serial||'—'}</td><td><b>{p.name}</b>{p.active&&p.source_review_required?<span className="pill warn review-pill">NEEDS REVIEW</span>:null}</td><td>{p.target_text||'—'}</td><td>{String(p.frequency||'').replaceAll('_',' ')}</td><td><span className={`pill ${p.active?'ok':'neutral'}`}>{p.active?'ACTIVE':'INACTIVE'}</span></td><td style={{textAlign:'right'}}><button className="row-action-btn" onClick={()=>setEditingId(p.id)}>Edit</button></td></tr>)}</tbody></table></div>
   :<EmptyState title="No parameters match this search" description="Try a different parameter, section or area, or add a new parameter."/>}
  </div>

  <Drawer open={addOpen} onClose={()=>setAddOpen(false)} title="Add Parameter" subtitle="Create a new hourly reading, shift safety check or Boiler parameter." wide footer={<><button type="button" className="btn btn-outline" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" form="add-param-form" className="btn btn-primary">Create parameter</button></>}>
   <form id="add-param-form" className="drawer-form" onSubmit={e=>{create(e);setAddOpen(false)}}>
    <div className="grid two">
     <Field label="Master area"><select value={value.module} onChange={e=>setValue({...value,module:e.target.value})}><option value="solvent">Solvent</option><option value="quality">Quality</option><option value="boiler">Boiler</option></select></Field>
     <Field label="Product context"><select value={value.productCode} onChange={e=>setValue({...value,productCode:e.target.value})}><option value="PLANT">Plant-wide</option><option value="RB">Rice Bran (RB)</option><option value="COPRA">Copra</option><option value="PK">Palm Kernel (PK)</option></select></Field>
     <Field label="Source S.No"><input value={value.sourceSerial} onChange={e=>setValue({...value,sourceSerial:e.target.value})} placeholder="e.g. 1, 12, A"/></Field>
     <Field label="Source group"><input value={value.sourceGroup} onChange={e=>setValue({...value,sourceGroup:e.target.value})} placeholder="Optional group"/></Field>
     <Field label="Section"><input list="section-list" required value={value.sectionName} onChange={e=>setValue({...value,sectionName:e.target.value})}/><datalist id="section-list">{sections.map((s:any)=><option key={s.id} value={s.name}/>)}</datalist></Field>
     <Field label="Parameter"><input required value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></Field>
     <Field label="Unit"><input value={value.unit} onChange={e=>setValue({...value,unit:e.target.value})}/></Field>
     <Field label="Target / expected (required)"><input required value={value.targetText} onChange={e=>setValue({...value,targetText:e.target.value})}/></Field>
     <Field label="Input type"><select value={value.inputType} onChange={e=>setValue({...value,inputType:e.target.value})}>{inputs.map(x=><option key={x}>{x}</option>)}</select></Field>
     <Field label="Frequency"><select value={value.frequency} onChange={e=>setValue({...value,frequency:e.target.value})}>{frequencies.map(x=><option key={x}>{x}</option>)}</select></Field>
     <Field label="Source sampling label"><input value={value.sampleFrequency} onChange={e=>setValue({...value,sampleFrequency:e.target.value})} placeholder="e.g. Every 2 Hrs."/></Field>
     <Field label="Result expected (minutes)"><input type="number" min="0" value={value.resultLatencyMinutes} onChange={e=>setValue({...value,resultLatencyMinutes:e.target.value})} placeholder="e.g. 45"/></Field>
     <Field label="Warning low"><input type="number" value={value.warningLow} onChange={e=>setValue({...value,warningLow:e.target.value})}/></Field>
     <Field label="Warning high"><input type="number" value={value.warningHigh} onChange={e=>setValue({...value,warningHigh:e.target.value})}/></Field>
     <Field label="Critical low"><input type="number" value={value.criticalLow} onChange={e=>setValue({...value,criticalLow:e.target.value})}/></Field>
     <Field label="Critical high"><input type="number" value={value.criticalHigh} onChange={e=>setValue({...value,criticalHigh:e.target.value})}/></Field>
    </div>
    <div className="action-row master-switches"><label className="check-field"><input type="checkbox" checked={value.mandatory} onChange={e=>setValue({...value,mandatory:e.target.checked})}/> Mandatory</label><label className="check-field"><input type="checkbox" checked={value.alertEnabled} onChange={e=>setValue({...value,alertEnabled:e.target.checked})}/> Alert on deviation</label><label className="check-field"><input type="checkbox" checked={value.ticketEnabled} onChange={e=>setValue({...value,ticketEnabled:e.target.checked})}/> Critical ticket</label></div>
   </form>
  </Drawer>
  <Drawer open={!!editing} onClose={()=>setEditingId(null)} title={editing?.name||'Edit parameter'} subtitle={editing?`${editing.parameter_sections?.name||''} • Target & alert settings`:''} wide footer={editing?<><button type="button" className="btn btn-outline" onClick={()=>setEditingId(null)}>Cancel</button><button type="submit" form="edit-param-form" className="btn btn-primary">Save parameter</button></>:null}>
   {editing?<ParamEditForm key={editing.id} p={editing} onSave={p=>{save(p);setEditingId(null)}}/>:null}
  </Drawer>
 </>;
}

function ParamEditForm({p,onSave}:{p:any;onSave:(p:any)=>void}){const [x,setX]=useState(p);const n=(k:string)=>(e:ChangeEvent<HTMLInputElement>)=>setX({...x,[k]:e.target.value===''?null:Number(e.target.value)});
 return <form id="edit-param-form" className="drawer-form" onSubmit={e=>{e.preventDefault();onSave(x)}}>
  {x.source_review_required?<div className="notice warn review-flag-notice"><AlertTriangle size={14}/><span>This parameter was imported from a source document and its target/frequency could not be parsed with full confidence — double-check <b>Target / expected</b>, <b>Source sampling label</b> and the alert thresholds below before clearing the flag.</span></div>:null}
  <div className="grid two">
   <Field label="Product"><select value={x.product_code||'PLANT'} onChange={e=>setX({...x,product_code:e.target.value})}><option value="PLANT">PLANT</option><option value="RB">RB</option><option value="COPRA">COPRA</option><option value="PK">PK</option></select></Field>
   <Field label="S.No"><input value={x.source_serial||''} onChange={e=>setX({...x,source_serial:e.target.value})}/></Field>
   <Field label="Parameter"><input value={x.name||''} onChange={e=>setX({...x,name:e.target.value})}/></Field>
   <Field label="Unit"><input value={x.unit||''} onChange={e=>setX({...x,unit:e.target.value})}/></Field>
  </div>
  <Field label="Target / expected (required for active data entry)"><input value={x.target_text||''} onChange={e=>setX({...x,target_text:e.target.value})}/></Field>
  <div className="grid two">
   <Field label="Input type"><select value={x.input_type} onChange={e=>setX({...x,input_type:e.target.value})}>{inputs.map(i=><option key={i}>{i}</option>)}</select></Field>
   <Field label="Frequency"><select value={x.frequency} onChange={e=>setX({...x,frequency:e.target.value})}>{frequencies.map(f=><option key={f}>{f}</option>)}</select></Field>
  </div>
  <div className="drawer-section-title">Alert thresholds</div>
  <div className="grid two">
   <Field label="Warning low"><input type="number" value={x.warning_low??''} onChange={n('warning_low')}/></Field>
   <Field label="Warning high"><input type="number" value={x.warning_high??''} onChange={n('warning_high')}/></Field>
   <Field label="Critical low"><input type="number" value={x.critical_low??''} onChange={n('critical_low')}/></Field>
   <Field label="Critical high"><input type="number" value={x.critical_high??''} onChange={n('critical_high')}/></Field>
  </div>
  <Field label="Source sampling label"><input value={x.sample_frequency||''} onChange={e=>setX({...x,sample_frequency:e.target.value})}/></Field>
  <div className="grid two">
   <Field label="Result expected (minutes)"><input type="number" min="0" value={x.result_latency_minutes??''} onChange={n('result_latency_minutes')}/></Field>
   <Field label="Sample grace period (minutes)"><input type="number" min="0" value={x.sample_grace_minutes??15} onChange={n('sample_grace_minutes')}/></Field>
  </div>
  <Field label="Ticket rule"><select value={x.ticket_severity_threshold||'warning'} onChange={e=>setX({...x,ticket_severity_threshold:e.target.value})}><option value="warning">Create ticket on Warning or Critical</option><option value="critical">Create ticket on Critical only</option><option value="none">Never create a ticket</option></select></Field>
  <div className="action-row master-switches">
   <label className="check-field"><input type="checkbox" checked={!!x.mandatory} onChange={e=>setX({...x,mandatory:e.target.checked})}/> Mandatory</label>
   <label className="check-field"><input type="checkbox" checked={!!x.alert_enabled} onChange={e=>setX({...x,alert_enabled:e.target.checked})}/> Alert on deviation</label>
   <label className="check-field"><input type="checkbox" checked={!!x.ticket_enabled} onChange={e=>setX({...x,ticket_enabled:e.target.checked})}/> Ticket enabled</label>
   <label className="check-field"><input type="checkbox" checked={!!x.active} onChange={e=>setX({...x,active:e.target.checked})}/> Active</label>
  </div>
  {x.source_review_required?<label className="check-field review-clear-check"><input type="checkbox" checked={!x.source_review_required} onChange={e=>setX({...x,source_review_required:!e.target.checked})}/> I've checked this parameter against the source document — clear the review flag</label>:null}
 </form>}

/* ---------------- Shifts ---------------- */
function Shifts({rows,value,setValue,create,save}:{rows:any[];value:any;setValue:(x:any)=>void;create:(e:FormEvent)=>void;save:(s:any)=>void}){
 const [addOpen,setAddOpen]=useState(false);
 return <>
  <div className="table-toolbar"><span className="table-count">{rows.length} configured shift{rows.length===1?'':'s'}</span><button type="button" className="btn btn-primary" onClick={()=>setAddOpen(true)}><Plus size={15}/> Add Shift</button></div>
  {rows.length?<div className="grid three">{rows.map(s=><ShiftEditor key={s.id} value={s} save={save}/>)}</div>:<div className="card"><EmptyState title="No shifts configured yet" description="Add a shift to start driving hourly slots and due times."/></div>}
  <Drawer open={addOpen} onClose={()=>setAddOpen(false)} title="Add Shift" subtitle="Shift periods drive hourly slots, due times and active shift sessions." footer={<><button type="button" className="btn btn-outline" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" form="add-shift-form" className="btn btn-primary">Create shift</button></>}>
   <form id="add-shift-form" className="drawer-form" onSubmit={e=>{create(e);setAddOpen(false)}}>
    <Field label="Shift name"><input required value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></Field>
    <div className="grid two"><Field label="Start time"><input type="time" value={value.startTime} onChange={e=>setValue({...value,startTime:e.target.value})}/></Field><Field label="End time"><input type="time" value={value.endTime} onChange={e=>setValue({...value,endTime:e.target.value})}/></Field></div>
    <label className="check-field"><input type="checkbox" checked={value.crossesMidnight} onChange={e=>setValue({...value,crossesMidnight:e.target.checked})}/> Crosses midnight</label>
   </form>
  </Drawer>
 </>;
}
function ShiftEditor({value,save}:{value:any;save:(s:any)=>void}){const [x,setX]=useState(value);return <div className="shift-card"><div className="split-header"><span className={`pill ${x.active?'ok':'neutral'}`}>{x.active?'ACTIVE':'INACTIVE'}</span><label className="check-field"><input type="checkbox" checked={!!x.active} onChange={e=>setX({...x,active:e.target.checked})}/> Enabled</label></div><Field label="Name"><input value={x.name} onChange={e=>setX({...x,name:e.target.value})}/></Field><div className="grid two"><Field label="Start"><input type="time" value={String(x.start_time).slice(0,5)} onChange={e=>setX({...x,start_time:e.target.value})}/></Field><Field label="End"><input type="time" value={String(x.end_time).slice(0,5)} onChange={e=>setX({...x,end_time:e.target.value})}/></Field></div><label className="check-field"><input type="checkbox" checked={!!x.crosses_midnight} onChange={e=>setX({...x,crosses_midnight:e.target.checked})}/> Crosses midnight</label><button className="btn btn-secondary" style={{marginTop:10}} onClick={()=>save(x)}>Save Shift</button></div>}

/* ---------------- Shift Control (live sessions, both scopes) ---------------- */
// Distinct from the "Shifts" tab above, which manages shift_master records
// (name/start/end) — this manages currently-RUNNING shift_sessions.
// The list/Stop/View-as UI itself now lives in components/ShiftControlList
// (shared with the Management dashboard's read-only version of the same
// panel) — Admin renders it with full control (canStop/canViewAs default
// true).
function ShiftControl(){return <ShiftControlList/>}

function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
