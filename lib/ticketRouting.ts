import type { supabaseAdmin } from '@/lib/supabase/admin';

// Plant-area routing for the Tickets module (sql/077_ticket_routing.sql): each area has the people to be intimated, the
// MD Office reporters and the one person allowed to close a ticket. A ticket belongs to an area through the parameter section
// of the parameter that raised it.
export type RouteRole = 'intimate' | 'md' | 'closer';
export type RouteArea = { id: number; area: string; scope: string; sort_order: number };
export type Routing = {
  ready: boolean;
  areas: Map<number, RouteArea>;
  sectionArea: Map<number, number>;
  people: { area_id: number; user_id: string; role: RouteRole }[];
  names: Map<string, string>;
};
type Db = ReturnType<typeof supabaseAdmin>;

/** Roles that see every ticket, in both workspaces. */
export const TICKET_ALL_ROLES = ['super_admin', 'admin', 'ceo', 'management'];

export async function loadRouting(db: Db): Promise<Routing> {
  const empty: Routing = { ready: false, areas: new Map(), sectionArea: new Map(), people: [], names: new Map() };
  const [a, s, p] = await Promise.all([
    db.from('ticket_route_areas').select('id,area,scope,sort_order').order('sort_order'),
    db.from('ticket_route_sections').select('area_id,section_id'),
    db.from('ticket_route_people').select('area_id,user_id,role'),
  ]);
  if (a.error || s.error || p.error) return empty; // sql/077 not run yet
  const people = (p.data || []) as Routing['people'];
  const ids = Array.from(new Set(people.map(x => x.user_id)));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from('profiles').select('id,full_name,email').in('id', ids);
    for (const r of data || []) names.set(r.id, r.full_name || r.email || '');
  }
  return {
    ready: true,
    areas: new Map((a.data || []).map((x: RouteArea) => [x.id, x])),
    sectionArea: new Map((s.data || []).map((x: { area_id: number; section_id: number }) => [x.section_id, x.area_id])),
    people,
    names,
  };
}

export const rolesFor = (r: Routing, userId: string, areaId: number | undefined): Set<RouteRole> =>
  new Set(r.people.filter(x => x.user_id === userId && x.area_id === areaId).map(x => x.role));

export const peopleFor = (r: Routing, areaId: number | undefined, role: RouteRole) =>
  r.people.filter(x => x.area_id === areaId && x.role === role).map(x => ({ id: x.user_id, name: r.names.get(x.user_id) || '' }));

/** The workspace a ticket belongs to, from its parameter section's module (boiler sits with Solvent). */
export const scopeOfModule = (m: string | null | undefined) => (m === 'quality' ? 'quality' : 'solvent');

export const OPEN_STATUSES = ['open', 'acknowledged', 'in_progress', 'waiting', 'overdue'];
