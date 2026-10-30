const CACHE='svma-ops-v5';
const SHELL=['/login','/ceo','/finance','/finance/transaction','/finance/amount','/solvent','/solvent/data-entry','/solvent/data-entry/hourly','/solvent/data-entry/inspection','/solvent/boiler'];
// Without skipWaiting/clients.claim, a new SW build sits in "waiting" until
// every open tab/PWA instance is fully closed — on a phone that's rarely
// closed rather than just backgrounded, a stale SW (and its stale cached
// shell pages) can stay in control for days, silently missing whatever this
// deploy changed (new push/badge handling included). Both calls force every
// open client onto the new SW — and its fresh cache — the moment it installs.
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL).catch(()=>undefined)))});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const clone=response.clone();caches.open(CACHE).then(c=>c.put(event.request,clone)).catch(()=>undefined);return response}).catch(()=>caches.match(event.request)))});

// Real OS-level push — fires even while the app is fully closed, unlike the
// in-app bell (which only polls while a tab is open). Also updates the
// app-icon badge from here (not just from the open-app JS in
// components/NotificationBell.tsx), since the Badging API is available in
// a service worker too and this is the only code that ever runs while the
// app isn't open.
self.addEventListener('push',event=>{
 let data={title:'SVMA',body:'You have a new notification.'};
 try{if(event.data)data={...data,...event.data.json()}}catch{}
 event.waitUntil((async()=>{
  await self.registration.showNotification(data.title,{
   body:data.body,
   icon:'/icon-192.png',
   badge:'/icon-192.png',
   tag:data.tag||undefined,
   data:{url:data.url||'/'},
  });
  // The server computes the true unread count and puts it right on the
  // push payload — no fetch needed here, which matters because a fetch
  // from inside the service worker isn't guaranteed to carry the same
  // session cookie a page-context fetch would. setAppBadge from a service
  // worker (rather than an open page) is also inconsistently supported
  // across browsers, so this is best-effort and never blocks the
  // notification itself from showing.
  if(typeof data.badge==='number'){
   try{if('setAppBadge' in self)await self.setAppBadge(data.badge)}catch{}
   try{if(self.navigator&&'setAppBadge' in self.navigator)await self.navigator.setAppBadge(data.badge)}catch{}
   try{if(self.registration&&'setAppBadge' in self.registration)await self.registration.setAppBadge(data.badge)}catch{}
  }
 })());
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=event.notification.data?.url||'/';
 event.waitUntil((async()=>{
  const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const c of clientsList){if('focus' in c){await c.focus();if('navigate' in c)try{await c.navigate(url)}catch{};return}}
  await self.clients.openWindow(url);
 })());
});
