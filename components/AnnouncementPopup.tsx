'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import {Megaphone,X} from 'lucide-react';

// Checked once per app load (not polled) — an announcement is an
// infrequent, deliberate event, not something that needs live pushing to
// an already-open tab. Skips the login page since there's no session yet.
export function AnnouncementPopup(){
 const pathname=usePathname();
 const [item,setItem]=useState<{id:string;title:string;body:string;createdBy:string;createdAt:string}|null>(null);
 const [dismissing,setDismissing]=useState(false);
 useEffect(()=>{
  if(pathname==='/login')return;
  fetch('/api/announcements',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.latestUnread)setItem(j.latestUnread)}).catch(()=>{});
 },[pathname==='/login']);
 async function dismiss(){
  if(!item)return;setDismissing(true);
  try{await fetch(`/api/announcements/${item.id}`,{method:'POST'})}catch{}
  setItem(null);setDismissing(false);
 }
 if(!item)return null;
 // Section: a long announcement was pushing the header and the "Got it"
 // button both outside the viewport with no way to scroll to them — the
 // whole popup was then genuinely unclosable. Header and footer are now
 // pinned in place (flex-shrink:0) and only the body text scrolls; a
 // backdrop click and an explicit X in the header are extra ways out on
 // top of the footer button, so there's never only one way to dismiss it.
 return createPortal(<div className="announcement-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
  <div className="announcement-modal" onClick={e=>e.stopPropagation()}>
   <div className="announcement-modal-head">
    <span className="announcement-modal-icon"><Megaphone size={20}/></span>
    <div><span className="announcement-modal-eyebrow">Announcement</span><h3>{item.title}</h3></div>
    <button type="button" className="announcement-modal-close" aria-label="Close" disabled={dismissing} onClick={dismiss}><X size={16}/></button>
   </div>
   <div className="announcement-modal-body">
    <p>{item.body}</p>
   </div>
   <div className="announcement-modal-foot">
    <span className="announcement-modal-meta">Posted by <b>{item.createdBy}</b> · {new Date(item.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
    <button type="button" className="btn btn-primary" disabled={dismissing} onClick={dismiss}><X size={14}/> Got it</button>
   </div>
  </div>
 </div>,document.body);
}
