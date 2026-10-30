import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type CookieToSet = {
  name: string;
  value: string;
  options?: any;
};

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { ok: false, error: 'Application authentication is not configured.' },
      { status: 500 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid login request.' }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password ?? '';

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: 'Email and password are required.' },
      { status: 400 },
    );
  }

  // Keep a single response object so the Set-Cookie headers written by
  // Supabase are returned to the browser with the successful login response.
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  if (!data.session || !data.user) {
    return NextResponse.json(
      { ok: false, error: 'Authentication succeeded but no session was created.' },
      { status: 401 },
    );
  }

  return response;
}
