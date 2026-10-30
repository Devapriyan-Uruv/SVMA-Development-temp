'use client';

function urlBase64ToUint8Array(base64:string){
 const padding='='.repeat((4-(base64.length%4))%4);
 const base64Safe=(base64+padding).replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(base64Safe);
 return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

// Requests Notification permission (must be called from a real user
// gesture — a click handler, not a page-load effect) and, if granted,
// subscribes this device to Web Push and saves the subscription server
// side. Returns whether a subscription now exists (already granted +
// already subscribed counts as success too).
export async function subscribeToPush():Promise<boolean>{
 if(!('serviceWorker' in navigator)||!('PushManager' in window))return false;
 const vapidKey=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
 if(!vapidKey)throw new Error('Push is not configured on this deployment (missing VAPID key).');
 let permission=Notification.permission;
 if(permission==='default')permission=await Notification.requestPermission();
 if(permission!=='granted')return false;
 const reg=await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(vapidKey)});
 const json=sub.toJSON();
 // Section: this save used to be a fire-and-forget best-effort call — any
 // failure (a 401 because cookies weren't attached in this fetch context, a
 // dropped connection, a server error) was silently swallowed, and the
 // caller still reported success even though nothing was ever saved to
 // push_subscriptions. Throw instead, so a real failure surfaces as one
 // instead of looking identical to "enabled".
 const r=await fetch('/api/push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:json.endpoint,keys:json.keys})});
 if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Could not save this device for notifications.')}
 return true;
}

// Silent, best-effort re-sync — called on every app load so a subscription
// that already has permission stays registered server side (e.g. after
// switching devices or a stale row), without ever prompting the user.
export async function resyncPushIfGranted(){
 try{if(Notification.permission==='granted')await subscribeToPush()}catch{}
}
