'use client';
import {useEffect,useRef,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Camera,KeyRound,User} from 'lucide-react';

export default function ProfilePage(){
 const [profile,setProfile]=useState<any>(null),[fullName,setFullName]=useState(''),[phone,setPhone]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[pwBusy,setPwBusy]=useState(false),[pwMessage,setPwMessage]=useState(''),[pwError,setPwError]=useState('');
 const [forced,setForced]=useState(false);useEffect(()=>{setForced(new URLSearchParams(window.location.search).get('force')==='1')},[]);
 const [photoBusy,setPhotoBusy]=useState(false),fileInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{fetch('/api/profile',{cache:'no-store'}).then(r=>r.json()).then(j=>{setProfile(j.profile);setFullName(j.profile?.full_name||'');setPhone(j.profile?.phone||'')}).catch(()=>{})},[]);
 async function saveProfile(){setBusy(true);setMessage('');setError('');try{const r=await fetch('/api/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({fullName,phone})}),j=await r.json();if(!r.ok)throw new Error(j.error);setProfile(j.profile);setMessage('Profile updated.')}catch(e){setError(e instanceof Error?e.message:'Unable to update profile')}finally{setBusy(false)}}
 async function changePassword(){setPwBusy(true);setPwMessage('');setPwError('');try{if(newPassword!==confirmPassword)throw new Error('Passwords do not match.');const r=await fetch('/api/profile/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({newPassword})}),j=await r.json();if(!r.ok)throw new Error(j.error);setPwMessage('Password changed.');setNewPassword('');setConfirmPassword('');if(forced)window.location.replace('/')}catch(e){setPwError(e instanceof Error?e.message:'Unable to change password')}finally{setPwBusy(false)}}
 async function uploadPhoto(file:File){setPhotoBusy(true);setError('');try{const fd=new FormData();fd.append('file',file);const r=await fetch('/api/profile/photo',{method:'POST',body:fd}),j=await r.json();if(!r.ok)throw new Error(j.error);setProfile(j.profile)}catch(e){setError(e instanceof Error?e.message:'Unable to upload photo')}finally{setPhotoBusy(false)}}
 const initial=(profile?.full_name||profile?.email||'?').slice(0,1).toUpperCase();
 return <><div style={{maxWidth:640,width:'100%',margin:'0 auto'}}>
  {forced?<div className="notice warn" role="alert" style={{marginBottom:12}}><b>Set your own password to continue.</b> You signed in with a temporary password — choose a new one below.</div>:null}
  <PageHeader title="My Profile" subtitle="Update your details, photo and password." backHref="/" backLabel="Home"/>
</div>
<div className="card" style={{marginTop:16,maxWidth:640,marginInline:'auto',width:'100%',boxSizing:'border-box'}}>
   <div className="split-header">
    <div style={{display:'flex',alignItems:'center',gap:16}}>
     <div style={{position:'relative'}}>
      {profile?.avatar_url?<img src={profile.avatar_url} alt="" style={{width:72,height:72,borderRadius:'50%',objectFit:'cover'}}/>:<div style={{width:72,height:72,borderRadius:'50%',background:'#2b6fec',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:700}}>{initial}</div>}
      <button type="button" className="btn btn-outline" style={{position:'absolute',bottom:-6,right:-6,padding:6,borderRadius:'50%'}} onClick={()=>fileInput.current?.click()} disabled={photoBusy} aria-label="Change photo"><Camera size={15}/></button>
      <input ref={fileInput} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)uploadPhoto(f)}}/>
     </div>
     <div><b>{profile?.full_name||'—'}</b><div className="sub">{profile?.email}</div>{photoBusy?<div className="sub">Uploading photo…</div>:null}</div>
    </div>
   </div>
  </div>
  <div className="card" style={{marginTop:16,maxWidth:640,marginInline:'auto',width:'100%',boxSizing:'border-box'}}>
   <div className="section-title"><User size={16} style={{verticalAlign:-2,marginRight:6}}/>Your details</div>
   {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
   {message?<div className="notice" role="status" style={{marginTop:10}}>{message}</div>:null}
   <div className="grid two" style={{marginTop:12}}>
    <div className="field"><label>Full name</label><input value={fullName} onChange={e=>{setFullName(e.target.value);setMessage('')}}/></div>
    <div className="field"><label>Phone</label><input value={phone} onChange={e=>{setPhone(e.target.value);setMessage('')}} placeholder="Optional"/></div>
   </div>
   <button className="btn btn-primary" style={{marginTop:14}} disabled={busy||!fullName.trim()} onClick={saveProfile}>{busy?'Saving…':'Save changes'}</button>
  </div>
  <div className="card" style={{marginTop:16,maxWidth:640,marginInline:'auto',width:'100%',boxSizing:'border-box'}}>
   <div className="section-title"><KeyRound size={16} style={{verticalAlign:-2,marginRight:6}}/>Change password</div>
   {pwError?<div className="notice danger" style={{marginTop:10}}>{pwError}</div>:null}
   {pwMessage?<div className="notice" role="status" style={{marginTop:10}}>{pwMessage}</div>:null}
   <div className="grid two" style={{marginTop:12}}>
    <div className="field"><label>New password</label><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 8 characters"/></div>
    <div className="field"><label>Confirm new password</label><input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div>
   </div>
   <button className="btn btn-primary" style={{marginTop:14}} disabled={pwBusy||!newPassword||!confirmPassword} onClick={changePassword}>{pwBusy?'Changing…':'Change password'}</button>
  </div>
 </>;
}
