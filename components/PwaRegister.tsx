'use client';
import { useEffect } from 'react';
import { resyncPushIfGranted } from '@/lib/pushClient';
// The service worker caches pages and assets so the installed app works offline. In local development (`npm run dev`) that is harmful: after the dev server
// restarts or its build folder is rebuilt, a worker left over from an earlier run keeps answering with stale / failed responses and the app will not open.
// So in development it is never registered, and any worker left from an earlier run is removed. Production (Render, the installed phone app) is unchanged.
export function PwaRegister(){useEffect(()=>{
 if(!('serviceWorker' in navigator))return;
 if(process.env.NODE_ENV!=='production'){
  void navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).then(()=>'caches' in window?caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))):undefined).catch(()=>undefined);
  return;
 }
 navigator.serviceWorker.register('/sw.js').then(()=>void resyncPushIfGranted()).catch(()=>undefined);
},[]);return null}
