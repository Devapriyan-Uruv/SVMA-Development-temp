'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {Drawer} from '@/components/Drawer';
import {OperationsNav} from '@/components/ops/OperationsNav';

const NAV_STATUS_TONE:Record<string,string>={DISCOVERED:'neutral',TESTED:'info',VERIFIED:'ok',REJECTED:'danger'};

function defaultStepsJson(){return JSON.stringify([{action:'goto',url:'{{baseUrl}}'}],null,1)}

export default function ErpConfigPage(){
 const [catalog,setCatalog]=useState<any[]>([]);
 const [login,setLogin]=useState<any>(null);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [editing,setEditing]=useState<any>(null);
 const [stepsJson,setStepsJson]=useState('');
 const [dateFormat,setDateFormat]=useState('DD/MM/YYYY');
 const [testing,setTesting]=useState(false);
 const [testResult,setTestResult]=useState<any>(null);
 const [inspecting,setInspecting]=useState(false);
 const [inspection,setInspection]=useState<any>(null);

 function load(){
  setBusy(true);setError('');
  fetch('/api/ops/erp-catalog').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(j=>{setCatalog(j.catalog||[]);setLogin(j.login||null)}).catch(e=>setError(e.message)).finally(()=>setBusy(false));
 }
 useEffect(load,[]);

 function openEditor(row:any){
  setEditing(row);
  setStepsJson(JSON.stringify(row.ops_erp_report_navigation?.navigation_steps?.length?row.ops_erp_report_navigation.navigation_steps:JSON.parse(defaultStepsJson()),null,1));
  setDateFormat(row.ops_erp_report_navigation?.date_selector_config?.dateFormat||'DD/MM/YYYY');
  setTestResult(null);setInspection(null);
 }

 async function inspectPage(){
  let steps;
  try{steps=JSON.parse(stepsJson)}catch{setInspection({error:'navigation_steps is not valid JSON.'});return}
  setInspecting(true);setInspection(null);
  try{
   const r=await fetch('/api/ops/erp-catalog/inspect-page',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({navigationSteps:steps,dateFormat})});
   const j=await r.json();
   setInspection(j);
  }catch(e){setInspection({error:e instanceof Error?e.message:'Inspection failed'})}
  finally{setInspecting(false)}
 }

 async function toggle(row:any,field:string,value:boolean){
  await fetch('/api/ops/erp-catalog',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:row.id,[field]:value})});
  load();
 }

 async function testNavigation(promote:boolean){
  if(!editing)return;
  let steps;
  try{steps=JSON.parse(stepsJson)}catch{setTestResult({error:'navigation_steps is not valid JSON.'});return}
  setTesting(true);setTestResult(null);
  try{
   const r=await fetch('/api/ops/erp-catalog/test-navigation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reportCatalogId:editing.id,navigationSteps:steps,dateSelectorConfig:{dateFormat},promote})});
   const j=await r.json();
   setTestResult(j);
   if(r.ok&&j.success)load();
  }catch(e){setTestResult({error:e instanceof Error?e.message:'Test failed'})}
  finally{setTesting(false)}
 }

 return <>
  <PageHeader title="ERP Configuration" subtitle="The AIX3 ERP Navigator's report catalogue and navigation paths. Test Navigation is how a report goes from unconfigured to Verified — I can't log into the live ERP myself, so this is done here, live." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}

  {login?<section className="card" style={{marginTop:14}}>
   <div className="split-header">
    <div><div className="section-title">ERP Login</div><p className="sub">The login sequence every push and Test Navigation uses first. Configure this before any individual report.</p></div>
    <StatusBadge status={NAV_STATUS_TONE[login.ops_erp_report_navigation?.status]||'neutral'} label={login.ops_erp_report_navigation?.status||'DISCOVERED'}/>
   </div>
   <button className="btn btn-outline" style={{marginTop:8}} onClick={()=>openEditor(login)}>Configure Login</button>
  </section>:null}

  <section className="card" style={{marginTop:14,padding:0}}>
   {busy?<div className="empty">Loading…</div>:
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Report</th><th>Section</th><th>Module</th><th>Required</th><th>Enabled</th><th>Auto-Fetch</th><th>Date Filter</th><th>Navigation</th><th>Last Validated</th><th>Action</th></tr></thead><tbody>
    {catalog.map((row:any)=><tr key={row.id}>
     <td>{row.report_name}{!row.has_parser?<span className="pill neutral" style={{marginLeft:6}}>no processor yet</span>:null}</td>
     <td>{row.erp_section}</td>
     <td>{row.operations_module}</td>
     <td><input type="checkbox" checked={row.is_required} onChange={e=>toggle(row,'is_required',e.target.checked)}/></td>
     <td><input type="checkbox" checked={row.enabled} onChange={e=>toggle(row,'enabled',e.target.checked)}/></td>
     <td><input type="checkbox" checked={row.auto_download} onChange={e=>toggle(row,'auto_download',e.target.checked)}/></td>
     <td>{row.date_filter_type}</td>
     <td><StatusBadge status={NAV_STATUS_TONE[row.ops_erp_report_navigation?.status]||'neutral'} label={row.ops_erp_report_navigation?.status||'DISCOVERED'}/></td>
     <td>{row.ops_erp_report_navigation?.verified_at?new Date(row.ops_erp_report_navigation.verified_at).toLocaleDateString('en-IN'):'—'}</td>
     <td><button className="btn btn-outline" onClick={()=>openEditor(row)}>Configure</button></td>
    </tr>)}
   </tbody></table></div>}
  </section>

  <Drawer open={!!editing} onClose={()=>setEditing(null)} title={editing?.report_name||editing?.report_code||''} subtitle="Navigation steps (JSON) — role/label/text selectors only, no coordinates." wide
   footer={<>
    <button className="btn btn-outline" disabled={inspecting} onClick={inspectPage}>{inspecting?'Inspecting…':'Inspect Page'}</button>
    <button className="btn btn-outline" disabled={testing} onClick={()=>testNavigation(false)}>{testing?'Testing…':'Test Navigation'}</button>
    <button className="btn btn-primary" disabled={testing} onClick={()=>testNavigation(true)}>{testing?'Testing…':'Test & Promote to Verified'}</button>
   </>}>
   {editing?<>
    <div className="field"><label>Date format</label>
     <select value={dateFormat} onChange={e=>setDateFormat(e.target.value)}><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select>
    </div>
    <div className="field">
     <label>navigation_steps</label>
     <textarea value={stepsJson} onChange={e=>setStepsJson(e.target.value)} rows={16} style={{fontFamily:'monospace',fontSize:11}}/>
     <p className="sub" style={{marginTop:4}}>Each step: {`{action, selectorType, selector, roleName, value, url}`}. action: goto|click|fill|select|waitFor|setDate|download. selectorType: role|label|text|css|placeholder. Use <code>{'{{date}}'}</code>/<code>{'{{fromDate}}'}</code>/<code>{'{{toDate}}'}</code> in a fill value for the target date, and <code>{'{{username}}'}</code>/<code>{'{{password}}'}</code> in the login sequence. "Inspect Page" runs these steps (no need for a final download step) and lists every field it finds on the resulting page — the fastest way to find real selectors without DevTools.</p>
    </div>
    {inspection?<div className={`notice ${inspection.error?'danger':''}`} style={{marginTop:10}}>
     {inspection.error?<div>{inspection.error}{inspection.visibleLabels?.length?<div style={{marginTop:6}}><div className="sub">Visible on the page:</div><div style={{fontSize:11}}>{inspection.visibleLabels.slice(0,30).join(', ')}</div></div>:null}</div>:null}
     {inspection.success?<div>
      <div><b>{inspection.inspection.heading||inspection.inspection.url}</b></div>
      {inspection.inspection.inputs?.length?<div style={{marginTop:8}}><div className="sub">Inputs</div><table style={{width:'100%',fontSize:11}}><tbody>
       {inspection.inspection.inputs.map((inp:any,i:number)=><tr key={i}><td>{inp.type}</td><td>{inp.placeholder?`placeholder="${inp.placeholder}"`:''}</td><td>{inp.formcontrolname?`formcontrolname="${inp.formcontrolname}"`:''}</td><td>{inp.id?`#${inp.id}`:''}</td><td>{inp.disabled?<span className="pill neutral">disabled</span>:null}</td></tr>)}
      </tbody></table></div>:null}
      {inspection.inspection.dropdowns?.length?<div style={{marginTop:8}}><div className="sub">Dropdowns</div><table style={{width:'100%',fontSize:11}}><tbody>
       {inspection.inspection.dropdowns.map((d:any,i:number)=><tr key={i}><td>{d.tag}</td><td>{d.placeholder?`placeholder="${d.placeholder}"`:''}</td><td>{d.role?`role="${d.role}"`:''}</td><td>{d.id?`#${d.id}`:''}</td></tr>)}
      </tbody></table></div>:null}
      {inspection.inspection.buttons?.length?<div style={{marginTop:8}}><div className="sub">Buttons / links</div><div style={{fontSize:11}}>{inspection.inspection.buttons.join(', ')}</div></div>:null}
     </div>:null}
    </div>:null}
    {testResult?<div className={`notice ${testResult.success?'':'danger'}`} style={{marginTop:10}}>
     {testResult.error?<div>{testResult.error}</div>:null}
     {testResult.success?<div>Navigation succeeded{testResult.pageHeading?` — page heading: "${testResult.pageHeading}"`:''}.</div>:null}
     {!testResult.success&&testResult.failedStepIndex!==undefined?<div>Failed at step {testResult.failedStepIndex}: {testResult.error}</div>:null}
     {testResult.visibleLabels?.length?<div style={{marginTop:6}}><div className="sub">Visible on the page at failure:</div><div style={{fontSize:11}}>{testResult.visibleLabels.slice(0,30).join(', ')}</div></div>:null}
    </div>:null}
   </>:null}
  </Drawer>
 </>;
}
