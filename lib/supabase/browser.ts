'use client';
import {createBrowserClient} from '@supabase/ssr';

// Browser-side client used ONLY for Supabase Realtime (Section AI) — every
// other read/write in this app already goes through server API routes with
// server-side authorization, which is unchanged. Realtime subscriptions are
// scoped per-recipient (filter: user_id=eq.<self>) and rely on the existing
// `notifications_self` RLS policy, so a signed-in user can only ever
// receive postgres_changes events for their own notification rows.
let client:ReturnType<typeof createBrowserClient>|null=null;
export function supabaseBrowser(){
 if(client)return client;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new Error('Supabase public environment variables are missing.');
 client=createBrowserClient(url,key);
 return client;
}
