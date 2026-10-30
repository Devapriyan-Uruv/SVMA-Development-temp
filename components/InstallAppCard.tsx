'use client';
import {useEffect,useState} from 'react';
import {Bell,Download,Smartphone} from 'lucide-react';
import {subscribeToPush} from '@/lib/pushClient';

// The app is already a full PWA (app/manifest.ts + public/sw.js, registered
// in app/layout.tsx) — what was missing was a visible way to actually
// trigger installation. On Android Chrome/Edge, the browser fires
// `beforeinstallprompt` once its own engagement heuristics are satisfied;
// capturing that event and calling .prompt() from a real button click is
// the only way to show the native "Install app" dialog — there is no way
// to trigger it purely programmatically, and it never fires at all on
// iOS Safari or once the app is already installed, so this degrades to a
// manual-steps hint in those cases rather than disappearing silently.
export function InstallAppCard(){
 const [deferred,setDeferred]=useState<any>(null);
 const [installed,setInstalled]=useState(false);
 // Section: install and notifications are two independent steps with their
 // own dismiss state — they used to share one "dismissed" flag, so
 // dismissing the install nudge (often done long before notifications even
 // existed as a feature) silently hid the notifications step forever too,
 // with no other way in the app to ever turn notifications on again.
 const [installDismissed,setInstallDismissed]=useState(false);
 const [notifDismissed,setNotifDismissed]=useState(false);
 const [notifPermission,setNotifPermission]=useState<string>('default');
 const [notifBusy,setNotifBusy]=useState(false);
 const [notifError,setNotifError]=useState('');

 useEffect(()=>{
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||(navigator as any).standalone===true;
  if(standalone)setInstalled(true);
  try{if(localStorage.getItem('svma-install-dismissed')==='1')setInstallDismissed(true)}catch{}
  try{if(localStorage.getItem('svma-notif-dismissed')==='1')setNotifDismissed(true)}catch{}
  if('Notification' in window)setNotifPermission(Notification.permission);
  const onPrompt=(e:Event)=>{e.preventDefault();setDeferred(e)};
  const onInstalled=()=>{setInstalled(true);setDeferred(null)};
  window.addEventListener('beforeinstallprompt',onPrompt);
  window.addEventListener('appinstalled',onInstalled);
  return ()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)};
 },[]);

 function dismissInstall(){setInstallDismissed(true);try{localStorage.setItem('svma-install-dismissed','1')}catch{}}
 function dismissNotif(){setNotifDismissed(true);try{localStorage.setItem('svma-notif-dismissed','1')}catch{}}
 async function install(){
  if(!deferred)return;
  deferred.prompt();
  await deferred.userChoice.catch(()=>{});
  setDeferred(null);
 }
 async function enableNotifications(){
  setNotifBusy(true);setNotifError('');
  try{
   const ok=await subscribeToPush();
   const perm=('Notification' in window)?Notification.permission:'denied';
   setNotifPermission(ok?'granted':perm);
   if(!ok)setNotifError(perm==='denied'?'Notifications were blocked. Enable them for SVMA in your device settings, then try again.':'Notifications could not be turned on. Please try again.');
  }catch(e){
   setNotifError(e instanceof Error&&e.message?e.message:'Notifications could not be turned on. Please try again.');
   if('Notification' in window)setNotifPermission(Notification.permission);
  }finally{setNotifBusy(false)}
 }

 const needsInstallStep=!installed&&!installDismissed;
 const needsNotifStep=notifPermission!=='granted'&&!notifDismissed;
 if(!needsInstallStep&&!needsNotifStep)return null;

 
 return <div className={`install-app-card ${needsInstallStep?'install-prompt':'notification-prompt'}`}>
  <span className="install-app-icon">{needsInstallStep?<Smartphone size={20}/>:<Bell size={20}/>}</span>
  <div className="install-app-copy">
   {needsInstallStep?<>
    <b>Install SVMA on your phone</b>
    {deferred?<span>Get it on your home screen — opens like an app, works full-screen, no browser bar.</span>
     :<span>On Android Chrome: tap the ⋮ menu → Install app (or Add to Home screen). On iPhone: tap Share → Add to Home Screen.</span>}
   </>:<>
    <b>Turn on notifications</b>
    <span>{notifPermission==='denied'?'Notifications are blocked for SVMA. On iPhone: Settings → SVMA → Notifications → Allow. On Android: site settings → Notifications → Allow.':'Get deviation alerts, chat messages and approvals as real notifications, even when SVMA is closed.'}</span>
    {notifError?<span style={{color:'#ffd9d5'}}>{notifError}</span>:null}
   </>}
  </div>
  <div className="install-app-actions">
   {needsInstallStep&&deferred?<button type="button" className="btn btn-primary" onClick={install}><Download size={15}/> Download &amp; install</button>:null}
   {!needsInstallStep&&needsNotifStep&&notifPermission!=='denied'?<button type="button" className="btn btn-primary" disabled={notifBusy} onClick={enableNotifications}><Bell size={15}/> {notifBusy?'Enabling…':'Enable notifications'}</button>:null}
   {needsInstallStep?<button type="button" className="btn btn-outline" onClick={dismissInstall}>Not now</button>
    :<button type="button" className="btn btn-outline" onClick={dismissNotif}>Not now</button>}
  </div>
 </div>;

}
