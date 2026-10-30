import {authorization,HR_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {sendPushToUser} from '@/lib/push';
import {errorMessage,logServerError} from '@/lib/errors';

const validModules=['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','input','quality_input','hr','admin','assets','import','export','operations_intelligence'];
const defaultByRole:Record<string,string[]>={super_admin:validModules,admin:['solvent_management','quality_management','finance_transaction','finance_vendor_payment','input','quality_input','hr','admin','assets','import','export','operations_intelligence'],ceo:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],management:['ceo','solvent_management','quality_management','finance_transaction','finance_vendor_payment','import','export','operations_intelligence'],finance_user:['finance_transaction','finance_vendor_payment'],finance_manager:['finance_transaction','finance_vendor_payment'],solvent_operator:['input'],solvent_head:['solvent_management','input'],safety_user:['input'],quality_operator:['quality_input'],quality_head:['quality_management','quality_input'],hr_admin:['hr','assets'],import_operator:['import'],import_manager:['import'],export_operator:['export'],export_manager:['export'],ops_operator:['operations_intelligence'],viewer:[]};
type Perm={view:boolean;edit:boolean;delete:boolean};
function safePerms(modulePerms:any,modules:any,role:string):Record<string,Perm>{
 const out:Record<string,Perm>={};
 if(modulePerms&&typeof modulePerms==='object'){
  for(const m of validModules){const p=modulePerms[m]||{};out[m]={view:!!p.view,edit:!!p.edit,delete:!!p.delete}}
  return out;
 }
 // Legacy flat array (view-only) or role default, same as before this change.
 const viewOnly=Array.isArray(modules)?modules.map(String).filter(x=>validModules.includes(x)):defaultByRole[role]||[];
 for(const m of validModules)out[m]={view:viewOnly.includes(m),edit:false,delete:false};
 return out;
}
// Section: opening account creation to HR Admin/Admin (previously Super
// Admin only) is a real widening of who can provision accounts — this is
// the one guard that keeps it safe: only an existing Super Admin can ever
// grant the Super Admin role to someone else, regardless of who is calling.
function blockedSuperAdminGrant(callerRoles:string[],requestedRole:string){return requestedRole==='super_admin'&&!callerRoles.includes('super_admin')}

// Every module-access grant or change goes through Management approval —
// access is revoked (or, for a brand-new user, simply never turned on)
// immediately, and a pending request is filed capturing exactly what it
// was before and what was asked for, so a rejection can restore the
// previous state precisely rather than guessing. Super Admin is also an
// approver (see lib/authorize.ts ACCESS_APPROVAL_ROLES), so they can
// self-approve immediately instead of waiting on someone else.
async function requestModuleAccess(db:ReturnType<typeof supabaseAdmin>,userId:string,requestedBy:string,perms:Record<string,Perm>){
 const {data:existingRows}=await db.from('user_module_access').select('module,can_view,can_edit,can_delete').eq('user_id',userId);
 const current=new Map((existingRows||[]).map((r:any)=>[r.module,{view:!!r.can_view,edit:!!r.can_edit,delete:!!r.can_delete}]));
 const requests:any[]=[];
 for(const m of validModules){
  const requested=perms[m]||{view:false,edit:false,delete:false};
  const prev=current.get(m)||{view:false,edit:false,delete:false};
  if(prev.view===requested.view&&prev.edit===requested.edit&&prev.delete===requested.delete)continue; // no actual change requested
  await db.from('user_module_access').upsert({user_id:userId,module:m,can_view:false,can_edit:false,can_delete:false,updated_at:new Date().toISOString()},{onConflict:'user_id,module'});
  requests.push({user_id:userId,module:m,requested_by:requestedBy,previous_view:prev.view,previous_edit:prev.edit,previous_delete:prev.delete,requested_view:requested.view,requested_edit:requested.edit,requested_delete:requested.delete,status:'pending'});
 }
 if(!requests.length)return 0;
 await db.from('module_access_requests').insert(requests);
 try{
  const {data:targetProfile}=await db.from('profiles').select('full_name,email').eq('id',userId).maybeSingle();
  const {data:approvers}=await db.from('user_roles').select('user_id').in('role',['super_admin','management']);
  const who=targetProfile?.full_name||targetProfile?.email||'A user';
  const title='Module access needs approval',body=`${who}'s access to ${requests.length} module${requests.length===1?'':'s'} is waiting for your decision.`;
  const recipientIds=Array.from(new Set((approvers||[]).map((a:any)=>a.user_id).filter(Boolean)));
  if(recipientIds.length){
   await db.from('notifications').insert(recipientIds.map(uid=>({user_id:uid,event_type:'access_request',title,body,severity:'info',entity_type:'module_access_request',entity_id:userId,push_sent_at:new Date().toISOString()})));
   await Promise.all(recipientIds.map(uid=>sendPushToUser(db,uid,{title,body,severity:'info',tag:'access_request',url:'/admin/access-requests'}).catch(()=>{})));
  }
 }catch{/* the access change is still correctly pending either way — notification delivery is best-effort */}
 return requests.length;
}

export async function GET(){try{const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});const db=supabaseAdmin();const [{data,error},{data:access},{data:departments},{data:pendingReqs}]=await Promise.all([db.from('profiles').select('*,user_roles(role)').order('created_at',{ascending:false}),db.from('user_module_access').select('*'),db.from('department_master').select('id,name').eq('active',true),db.from('module_access_requests').select('user_id').eq('status','pending')]);if(error)throw error;const map=new Map<string,Record<string,Perm>>();for(const x of access||[]){const cur=map.get(x.user_id)||{};cur[x.module]={view:!!x.can_view,edit:!!x.can_edit,delete:!!x.can_delete};map.set(x.user_id,cur)}const pendingCount=new Map<string,number>();for(const r of pendingReqs||[]){pendingCount.set(r.user_id,(pendingCount.get(r.user_id)||0)+1)}const deptMap=new Map((departments||[]).map((d:any)=>[d.id,d.name]));const users=(data||[]).map((u:any)=>{const role=String(u.user_roles?.[0]?.role||'viewer');const perms=map.get(u.id);const modules=perms?Object.keys(perms).filter(m=>perms[m].view):(defaultByRole[role]||[]);return{...u,departmentName:u.department_id?deptMap.get(u.department_id)||null:null,modules,modulePerms:perms||{},pendingAccessRequests:pendingCount.get(u.id)||0}});return NextResponse.json({users,departments:departments||[]})}catch(e){logServerError('admin/users',e);return NextResponse.json({error:errorMessage(e,'Unable to load users')},{status:500})}}

export async function POST(req:NextRequest){try{const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});const b=await req.json();if(!b.email||!b.password||!b.role)return NextResponse.json({error:'Email, temporary password and role are required.'},{status:400});if(blockedSuperAdminGrant(az.roles,String(b.role)))return NextResponse.json({error:'Only a Super Admin can grant the Super Admin role.'},{status:403});const db=supabaseAdmin();const {data:created,error:ce}=await db.auth.admin.createUser({email:String(b.email).trim(),password:String(b.password),email_confirm:true,user_metadata:{full_name:b.fullName||b.email,must_change_password:true}});if(ce)throw ce;const id=created.user.id;const {error:pe}=await db.from('profiles').upsert({id,email:created.user.email,full_name:b.fullName||created.user.email,phone:b.phone||null,department:b.department||null,department_id:b.departmentId||null,designation:b.designation||null,supervisor_id:b.supervisorId||null,is_active:true});if(pe)throw pe;await db.from('user_roles').delete().eq('user_id',id);const {error:re}=await db.from('user_roles').insert({user_id:id,role:b.role});if(re)throw re;const perms=safePerms(b.modulePerms,b.modules,b.role);let requested=0;try{requested=await requestModuleAccess(db,id,az.user!.id,perms)}catch{}await db.from('audit_logs').insert({user_id:az.user?.id||null,module:'admin',action:'CREATE_USER',entity_type:'profile',entity_id:id,after_data:{email:created.user.email,full_name:b.fullName||created.user.email,department:b.department||null,designation:b.designation||null,role:b.role,requestedModules:requested}});return NextResponse.json({ok:true,userId:id,pendingAccessRequests:requested})}catch(e){logServerError('admin/users',e);return NextResponse.json({error:errorMessage(e,'Unable to create user')},{status:500})}}

export async function PATCH(req:NextRequest){try{const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});const b=await req.json();if(b.role&&blockedSuperAdminGrant(az.roles,String(b.role)))return NextResponse.json({error:'Only a Super Admin can grant the Super Admin role.'},{status:403});const db=supabaseAdmin();const update:any={};for(const k of ['full_name','phone','department','designation'])if(k in b)update[k]=b[k];if('departmentId' in b)update.department_id=b.departmentId||null;if('supervisorId' in b)update.supervisor_id=b.supervisorId||null;if(b.isActive!==undefined)update.is_active=!!b.isActive;if(Object.keys(update).length)await db.from('profiles').update(update).eq('id',b.userId);let role=String(b.role||'');if(role){await db.from('user_roles').delete().eq('user_id',b.userId);await db.from('user_roles').insert({user_id:b.userId,role})}else{const {data}=await db.from('user_roles').select('role').eq('user_id',b.userId).limit(1).maybeSingle();role=String(data?.role||'viewer')}let requested=0;if(b.modulePerms||Array.isArray(b.modules)){try{requested=await requestModuleAccess(db,b.userId,az.user!.id,safePerms(b.modulePerms,b.modules,role))}catch{}}if(b.password)await db.auth.admin.updateUserById(b.userId,{password:b.password});await db.from('audit_logs').insert({user_id:az.user?.id||null,module:'admin',action:'UPDATE_USER',entity_type:'profile',entity_id:b.userId,after_data:{...b,password:b.password?'(changed)':undefined}});return NextResponse.json({ok:true,pendingAccessRequests:requested})}catch(e){logServerError('admin/users',e);return NextResponse.json({error:errorMessage(e,'Unable to update user')},{status:500})}}
