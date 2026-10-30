import { supabaseServer } from './supabase/server';

export async function currentUser() {
  const supabase = await supabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}
