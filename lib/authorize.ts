import { supabaseServer } from './supabase/server';

type AuthResult={ok:boolean;status:number;user:any;roles:string[];modules?:string[]};

export async function authorization(allowed:string[]):Promise<AuthResult>{
  const sb=await supabaseServer();
  const {data:{user}}=await sb.auth.getUser();
  if(!user)return {ok:false,status:401,user:null,roles:[]};
  const {data}=await sb.from('user_roles').select('role').eq('user_id',user.id);
  const roles=(data||[]).map((x:any)=>String(x.role));
  const ok=roles.some(r=>allowed.includes(r));
  return {ok,status:ok?200:403,user,roles};
}

export async function moduleAuthorization(module:string,fallbackRoles:string[]):Promise<AuthResult>{
  const sb=await supabaseServer();
  const {data:{user}}=await sb.auth.getUser();
  if(!user)return {ok:false,status:401,user:null,roles:[],modules:[]};
  const {data:roleRows}=await sb.from('user_roles').select('role').eq('user_id',user.id);
  const roles=(roleRows||[]).map((x:any)=>String(x.role));
  if(roles.includes('super_admin'))return {ok:true,status:200,user,roles,modules:[module]};
  let accessRows:any[]=[];let accessReadable=true;
  try{const r=await sb.from('user_module_access').select('module,can_view').eq('user_id',user.id);if(r.error)accessReadable=false;else accessRows=r.data||[]}catch{accessReadable=false}
  const modules=accessRows.filter(x=>x.can_view).map(x=>String(x.module));
  const ok=accessReadable&&accessRows.length>0?modules.includes(module):roles.some(r=>fallbackRoles.includes(r));
  return {ok,status:ok?200:403,user,roles,modules};
}

// Same module-access check as moduleAuthorization, but requires the
// user_module_access row's can_edit flag (granted per-user from the User
// Management "Edit" checkbox next to that module, approved the same way as
// any other module access change) rather than just can_view. Used for
// actions that write/trigger something (e.g. an ERP push) so that "View and
// Edit" access to a module is what unlocks it — not a separate hard-coded
// role list. fallbackRoles is only consulted for a user with NO
// user_module_access rows at all (the legacy role-default case), same as
// moduleAuthorization.
export async function moduleEditAuthorization(module:string,fallbackRoles:string[]):Promise<AuthResult>{
  const sb=await supabaseServer();
  const {data:{user}}=await sb.auth.getUser();
  if(!user)return {ok:false,status:401,user:null,roles:[],modules:[]};
  const {data:roleRows}=await sb.from('user_roles').select('role').eq('user_id',user.id);
  const roles=(roleRows||[]).map((x:any)=>String(x.role));
  if(roles.includes('super_admin'))return {ok:true,status:200,user,roles,modules:[module]};
  let accessRows:any[]=[];let accessReadable=true;
  try{const r=await sb.from('user_module_access').select('module,can_view,can_edit').eq('user_id',user.id);if(r.error)accessReadable=false;else accessRows=r.data||[]}catch{accessReadable=false}
  const modules=accessRows.filter(x=>x.can_view).map(x=>String(x.module));
  const row=accessRows.find(x=>String(x.module)===module);
  const ok=accessReadable&&accessRows.length>0?!!row?.can_edit:roles.some(r=>fallbackRoles.includes(r));
  return {ok,status:ok?200:403,user,roles,modules};
}

export async function anyModuleAuthorization(modules:{module:string;fallbackRoles:string[]}[]):Promise<AuthResult>{
  const sb=await supabaseServer();
  const {data:{user}}=await sb.auth.getUser();
  if(!user)return {ok:false,status:401,user:null,roles:[],modules:[]};
  const {data:roleRows}=await sb.from('user_roles').select('role').eq('user_id',user.id);
  const roles=(roleRows||[]).map((x:any)=>String(x.role));
  if(roles.includes('super_admin'))return {ok:true,status:200,user,roles,modules:modules.map(x=>x.module)};
  let accessRows:any[]=[];let accessReadable=true;
  try{const r=await sb.from('user_module_access').select('module,can_view').eq('user_id',user.id);if(r.error)accessReadable=false;else accessRows=r.data||[]}catch{accessReadable=false}
  const granted=accessRows.filter(x=>x.can_view).map(x=>String(x.module));
  const ok=accessReadable&&accessRows.length>0?modules.some(x=>granted.includes(x.module)):modules.some(x=>roles.some(r=>x.fallbackRoles.includes(r)));
  return {ok,status:ok?200:403,user,roles,modules:granted};
}

export const CEO_ROLES=['super_admin','ceo','management'];
export const FINANCE_ROLES=['super_admin','admin','ceo','management','finance_user','finance_manager'];
export const SOLVENT_MANAGEMENT_ROLES=['super_admin','admin','ceo','management','solvent_head'];
export const INPUT_ROLES=['super_admin','admin','solvent_operator','solvent_head','safety_user'];
export const QUALITY_INPUT_ROLES=['super_admin','admin','quality_operator','quality_head'];
export const QUALITY_MANAGEMENT_ROLES=['super_admin','admin','ceo','management','quality_head'];
export const SOLVENT_ROLES=Array.from(new Set([...SOLVENT_MANAGEMENT_ROLES,...INPUT_ROLES]));
export const QUALITY_ROLES=Array.from(new Set([...QUALITY_INPUT_ROLES,...QUALITY_MANAGEMENT_ROLES]));
export const SUPER_ADMIN_ROLES=['super_admin'];
export const ADMIN_ROLES=SUPER_ADMIN_ROLES;
export const HR_ROLES=['super_admin','admin','hr_admin'];
// Import and Export are deliberately two separate role sets (not one
// "trade" role) so permission boundaries stay clean for someone who only
// ever touches one side. CEO/Management see both, read-only — they get
// the shared party master, reports and intelligence panel on either
// module, but entry/cost-line edits and the cost-category admin list stay
// with the module's own operator/manager roles (plus admin/super_admin).
export const IMPORT_EDIT_ROLES=['super_admin','admin','import_operator','import_manager'];
export const IMPORT_VIEW_ROLES=[...IMPORT_EDIT_ROLES,'ceo','management'];
export const EXPORT_EDIT_ROLES=['super_admin','admin','export_operator','export_manager'];
export const EXPORT_VIEW_ROLES=[...EXPORT_EDIT_ROLES,'ceo','management'];
// Approves/rejects module-access change requests (see module_access_requests,
// sql/027). Reuses the existing 'management' role rather than adding a new
// one; super_admin is also in this set so they can self-approve immediately
// instead of waiting, without needing separate override logic.
export const ACCESS_APPROVAL_ROLES=['super_admin','management'];
export const OPS_ROLES=['super_admin','admin','ceo','management','ops_operator'];
// Credential-sensitive: logs into the live SVMA ERP with stored server-side
// credentials. Deliberately narrower than OPS_ROLES — everyone with
// Operations Intelligence access can view the ERP Push card and history,
// but only admins can actually trigger a push or edit navigation config.
export const OPS_ERP_PUSH_ROLES=['super_admin','admin'];
