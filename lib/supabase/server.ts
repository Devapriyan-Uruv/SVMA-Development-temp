import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options?: any };

export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase public environment variables are missing.');
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(items: CookieToSet[]) {
        try { items.forEach(({ name, value, options }: CookieToSet) => store.set(name, value, options)); } catch { /* Server Component */ }
      },
    },
  });
}
