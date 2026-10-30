import { INPUT_ROLES, QUALITY_INPUT_ROLES } from '@/lib/authorize';
import { fetchAllRows } from '@/lib/supabase/fetchAll';

// Who can take over a shift. This is the same rule the entry pages apply through moduleAuthorization: a super admin always can;
// a user with explicit module-access rows can when their Input (or Quality Input) row allows viewing; a user with no
// module-access rows at all falls back to their role. Looking at roles alone (as the hand-off picker used to) left out people
// who were given Input access directly on a viewer account.

type Db = { from: (t: string) => any };
const moduleOf = (scope: string) => (scope === 'quality' ? 'quality_input' : 'input');
const rolesOf = (scope: string) => (scope === 'quality' ? QUALITY_INPUT_ROLES : INPUT_ROLES);

export async function eligibleOperatorIds(db: Db, scope: string): Promise<Set<string>> {
  const module = moduleOf(scope), roles = rolesOf(scope);
  const { data: roleRows, error: roleErr } = await fetchAllRows<{ user_id: string; role: string }>((a, b) => db.from('user_roles').select('user_id,role').order('user_id').range(a, b));
  if (roleErr) throw roleErr;
  const { data: accessRows } = await fetchAllRows<{ user_id: string; module: string; can_view: boolean }>((a, b) => db.from('user_module_access').select('user_id,module,can_view').order('user_id').range(a, b));
  const rolesBy = new Map<string, string[]>(), accessBy = new Map<string, { module: string; can_view: boolean }[]>();
  for (const r of roleRows) (rolesBy.get(r.user_id) || rolesBy.set(r.user_id, []).get(r.user_id)!).push(String(r.role));
  for (const r of accessRows || []) (accessBy.get(r.user_id) || accessBy.set(r.user_id, []).get(r.user_id)!).push(r);
  const out = new Set<string>();
  for (const [id, rs] of rolesBy) {
    const access = accessBy.get(id);
    if (rs.includes('super_admin')) out.add(id);
    else if (access?.length ? access.some(a => a.module === module && a.can_view) : rs.some(r => roles.includes(r))) out.add(id);
  }
  // Users who hold module access but no role row at all.
  for (const [id, access] of accessBy) if (!rolesBy.has(id) && access.some(a => a.module === module && a.can_view)) out.add(id);
  return out;
}

export async function canOperate(db: Db, userId: string, scope: string): Promise<boolean> {
  return (await eligibleOperatorIds(db, scope)).has(userId);
}
