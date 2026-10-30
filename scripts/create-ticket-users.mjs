// One-off: creates the accounts named in the Plant Safety "Reporting and Ticket Closure" tracker (the ones that do not exist yet).
//   TEMP_PASSWORD='...' node scripts/create-ticket-users.mjs            # dry run (lists what would be created)
//   TEMP_PASSWORD='...' node scripts/create-ticket-users.mjs --apply    # creates them
// The temporary password is read from the environment and never stored. Every account is flagged must_change_password, so the app
// sends the person to "My Profile" to set their own password at first sign-in. Safe to re-run: existing e-mails are skipped.
// Mr. Sekar, Mr. Murugesan (MD Office), Mrs. Leela (Leelavathi) and Mr. Jagadeesan (= jegadeesh@svma.app) already have accounts and are not touched.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/package.json'); const { createClient } = req('@supabase/supabase-js');
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = process.env.TEMP_PASSWORD, apply = process.argv.includes('--apply');
if (!password || password.length < 8) { console.error('Set TEMP_PASSWORD (at least 8 characters).'); process.exit(1); }

const USERS = [
  { name: 'Mamachan', email: 'mamachan@svma.app', designation: 'Plant Incharge', department: 'Plant' },
  { name: 'Tamil', email: 'tamil@svma.app', designation: 'Refinery / Factory Incharge', department: 'Refinery' },
  { name: 'Prabahar', email: 'prabahar@svma.app', designation: 'Safety Officer', department: 'Safety' },
  { name: 'Murugasen', email: 'murugasen.godown@svma.app', designation: 'Godown Incharge', department: 'Godown' },
  { name: 'Mohan', email: 'mohan@svma.app', designation: 'Commercial Manager / GM', department: 'Purchase' },
  { name: 'Raghu', email: 'raghu@svma.app', designation: null, department: 'Purchase' },
  { name: 'Saravanan', email: 'saravanan@svma.app', designation: null, department: 'Purchase' },
  { name: 'Subramani', email: 'subramani@svma.app', designation: null, department: 'Purchase' },
  { name: 'Sahul', email: 'sahul@svma.app', designation: 'Soya Incharge', department: 'Soya' },
  { name: 'Pandiyaraj', email: 'pandiyaraj@svma.app', designation: 'Boiler Incharge', department: 'Boiler' },
];
const { data: existing } = await db.from('profiles').select('email'); const have = new Set((existing || []).map(x => (x.email || '').toLowerCase()));
for (const u of USERS) {
  if (have.has(u.email)) { console.log('exists   ', u.email); continue; }
  if (!apply) { console.log('would create', u.email, '—', u.name, '/', u.department); continue; }
  const { data, error } = await db.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name, must_change_password: true } });
  if (error) { console.log('FAILED   ', u.email, error.message); continue; }
  const id = data.user.id;
  const p = await db.from('profiles').upsert({ id, email: u.email, full_name: u.name, department: u.department, designation: u.designation, is_active: true });
  await db.from('user_roles').delete().eq('user_id', id);
  const r = await db.from('user_roles').insert({ user_id: id, role: 'viewer' });
  console.log(p.error || r.error ? 'PARTIAL  ' : 'created  ', u.email, p.error?.message || r.error?.message || '');
}
process.exit(0);
