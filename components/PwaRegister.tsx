'use client';
import { useEffect } from 'react';
import { resyncPushIfGranted } from '@/lib/pushClient';
export function PwaRegister(){useEffect(()=>{if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(()=>void resyncPushIfGranted()).catch(()=>undefined)},[]);return null}
