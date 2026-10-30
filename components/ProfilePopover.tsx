'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {User,X,Mail,Phone} from 'lucide-react';

// Teams-style "view someone's profile" card — deliberately shows only what
// /api/directory/[id] returns (name/role/email/phone). Reuses the
// announcement modal's overlay/shell CSS rather than inventing new chrome.
export function ProfilePopover({userId,onClose}:{userId:string|null;onClose:()=>void}){
 const [profile,setProfile]=useState<{id:string;full_name:string;email:string;phone:string|null;role:string|null}|null>(null);
 useEffect(()=>{
  if(!userId){setProfile(null);return}
  fetch(`/api/directory/${userId}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j&&!j.error)setProfile(j)}).catch(()=>{});
 },[userId]);
 if(!userId)return null;
 return createPortal(<div className="announcement-overlay" role="dialog" aria-modal="true" onClick={onClose}>
  <div className="announcement-modal" style={{maxWidth:360}} onClick={e=>e.stopPropagation()}>
   <div className="announcement-modal-head">
    <span className="announcement-modal-icon"><User size={20}/></span>
    <div><span className="announcement-modal-eyebrow">Profile</span><h3>{profile?.full_name||'Loading…'}</h3></div>
    <button type="button" className="announcement-modal-close" aria-label="Close" onClick={onClose}><X size={16}/></button>
   </div>
   <div className="announcement-modal-body">
    {profile?<div style={{display:'grid',gap:12}}>
     {profile.role?<div className="profile-popover-row"><span className="sub">Role</span><span className="pill neutral">{profile.role.replaceAll('_',' ')}</span></div>:null}
     <div className="profile-popover-row"><span className="sub"><Mail size={13} style={{verticalAlign:-2,marginRight:5}}/>Email</span><span>{profile.email}</span></div>
     <div className="profile-popover-row"><span className="sub"><Phone size={13} style={{verticalAlign:-2,marginRight:5}}/>Contact</span><span>{profile.phone||'Not shared'}</span></div>
    </div>:<p className="sub">Loading profile…</p>}
   </div>
  </div>
 </div>,document.body);
}
