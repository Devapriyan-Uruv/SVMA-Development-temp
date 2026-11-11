
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { loadRouting, rolesFor, peopleFor, scopeOfModule, TICKET_ALL_ROLES, type Routing } from '@/lib/ticketRouting';
import { resolveParameterMetadata } from '@/lib/parameterMetadata';

export const runtime = 'nodejs';

const CLOSED = ['closed', 'resolved'];
const ACTIONS: Record<string, string> = {
  acknowledge: 'acknowledged',
  start: 'in_progress',
  wait: 'waiting',
  close: 'closed',
  reopen: 'open'
};

async function who() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) return null;

  const { data } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  return {
    id: user.id,
    roles: (data || []).map((x: { role: string }) => String(x.role))
  };
}

function seesAll(roles: string[], scope: string) {
  return roles.some(r => TICKET_ALL_ROLES.includes(r)) ||
    (scope === 'solvent' && roles.includes('solvent_head')) ||
    (scope === 'quality' && roles.includes('quality_head'));
}

type Row = {
  id: string;
  ticket_no: string;
  status: string;
  due_at: string | null;
  created_at: string;
  closed_at: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  closure_comments: string | null;
  ticket_evidence?: {
    id: string;
    storage_path: string;
    file_name: string;
    mime_type: string | null;
    created_at: string;
  }[];
  deviations: {
    id?: number;
    parameter_id: number;
    severity: string;
    target_text: string | null;
    actual_text: string | null;
    created_at: string;
    occurrence_count?: number | null;
    parameter_master: {
      name: string;
      section_id: number;
      parameter_sections: {
        id: number;
        name: string;
        module: string;
      };
    };
  };
};

function deviationOf(row: any) {
  return Array.isArray(row.deviations)
    ? row.deviations[0]
    : row.deviations;
}

function attachMetadata(row: any, metadata: Map<number, any>): Row {
  const deviation = deviationOf(row);
  const parameter = metadata.get(Number(deviation?.parameter_id)) || null;

  return {
    ...row,
    deviations: deviation
      ? {
          ...deviation,
          parameter_master: parameter
        }
      : null
  } as Row;
}

function belongsToScope(row: Row, modules: string[], sectionIds?: number[]) {
  const parameter = row.deviations?.parameter_master;
  const section = parameter?.parameter_sections;

  if (!parameter || !section) return false;
  if (!modules.includes(String(section.module))) return false;

  if (sectionIds && !sectionIds.includes(Number(parameter.section_id))) {
    return false;
  }

  return true;
}

/** GET — tickets routed to the signed-in user, plus MD Office statistics. */
export async function GET(req: NextRequest) {
  try {
    const me = await who();

    if (!me) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams;
    const scope = q.get('scope') === 'quality' ? 'quality' : 'solvent';
    const view = q.get('view') || 'open';

    const db = supabaseAdmin();
    const routing = await loadRouting(db);

    const all = seesAll(me.roles, scope);
    const modules = scope === 'quality' ? ['quality'] : ['solvent', 'boiler'];

    const mine = new Set(
      routing.people
        .filter(p => p.user_id === me.id)
        .map(p => p.area_id)
    );

    const mdAreas = new Set(
      routing.people
        .filter(p => p.user_id === me.id && p.role === 'md')
        .map(p => p.area_id)
    );

    const sectionIds = [
      ...routing.sectionArea.entries()
    ]
      .filter(([, areaId]) => mine.has(areaId))
      .map(([sectionId]) => sectionId);

    const base = {
      routingReady: routing.ready,
      canSeeAll: all,
      hasRouting: mine.size > 0,
      isMd: all || mdAreas.size > 0
    };

    if (!all && !sectionIds.length) {
      return NextResponse.json({
        ...base,
        tickets: [],
        stats: null,
        areas: []
      });
    }

    // Fetch ticket/deviation data without a parameter_master FK join.
    const selectColumns = (
      rec: boolean,
      statsOnly = false
    ) => statsOnly
      ? 'id,ticket_no,status,due_at,deviations!inner(parameter_id)'
      : `id,ticket_no,status,due_at,created_at,closed_at,root_cause,corrective_action,closure_comments,ticket_evidence(id,storage_path,file_name,mime_type,created_at),deviations!inner(id,parameter_id,severity,target_text,actual_text,created_at${rec ? 'occurrence_count,' : ''})`;

    const pull = async (rec: boolean, statsOnly = false) => {
      let result: {
  data: any[];
  error: any;
} = await fetchAllRows<any>((from, to) =>
  db
    .from('deviation_tickets')
    .select(selectColumns(rec, statsOnly))
    .order('created_at', { ascending: false })
    .range(from, to)
);

      if (
  result.error &&
  rec &&
  /occurrence_count/.test(String(result.error?.message || result.error))
) {
        result = await fetchAllRows<any>((from, to) =>
          db
            .from('deviation_tickets')
            .select(selectColumns(false, statsOnly))
            .order('created_at', { ascending: false })
            .range(from, to)
        );
      }

      if (result.error) throw result.error;

      return result.data || [];
    };

    const [rawRows, rawStatRows] = await Promise.all([
      pull(true, false),
      base.isMd ? pull(false, true) : Promise.resolve([])
    ]);

    const parameterIds = [
      ...rawRows.map((r: any) => deviationOf(r)?.parameter_id),
      ...rawStatRows.map((r: any) => deviationOf(r)?.parameter_id)
    ];

    const metadata = await resolveParameterMetadata(db, parameterIds);

    const enrichedRows: Row[] = rawRows.map((r: any) =>
      attachMetadata(r, metadata)
    );

    const enrichedStatRows: Row[] = rawStatRows.map((r: any) =>
      attachMetadata(r, metadata)
    );

    const visibleRows = enrichedRows.filter(r =>
      belongsToScope(r, modules, all ? undefined : sectionIds)
    );

    const filteredRows = visibleRows.filter(r => {
      if (view === 'open') return !CLOSED.includes(r.status);
      if (view === 'closed') return CLOSED.includes(r.status);
      return true;
    });

    // Keep the latest 300 visible tickets.
    const rows = filteredRows.slice(0, 300);

    const statRows = enrichedStatRows.filter(r =>
      belongsToScope(r, modules)
    );

    const ids = rows.map(r => r.id);

    const [fu, ev, reopened] = await Promise.all([
  ids.length
    ? db.from('ticket_md_followup').select('*').in('ticket_id', ids)
    : Promise.resolve({ data: [] as any[], error: null }),

  ids.length
    ? db.from('ticket_events')
        .select('ticket_id,event,to_status,note,at,by_user')
        .in('ticket_id', ids)
        .order('at', { ascending: false })
    : Promise.resolve({ data: [] as any[], error: null }),

  base.isMd
    ? db.from('ticket_events').select('ticket_id').eq('event', 'reopened')
    : Promise.resolve({ data: [] as any[], error: null })
]);

if (fu.error) throw fu.error;
if (ev.error) throw ev.error;
if (reopened.error) throw reopened.error;

    const followup = new Map((fu.data || []).map((x: any) => [x.ticket_id, x]));

    const events = new Map<string, any[]>();

    for (const e of ev.data || []) {
      const list = events.get(e.ticket_id) || [];
      list.push(e);
      events.set(e.ticket_id, list);
    }

    const reopenedIds = new Set(
      (reopened.data || []).map((x: any) => x.ticket_id)
    );

    const sign = async (path: string) =>
      (await db.storage.from('svma-ticket-evidence').createSignedUrl(path, 3600)).data?.signedUrl || null;

    const now = Date.now();

    const tickets = await Promise.all(rows.map(async r => {
      const sec = r.deviations.parameter_master.parameter_sections;
      const areaId = routing.sectionArea.get(sec.id);
      const roles = rolesFor(routing, me.id, areaId);
      const closers = peopleFor(routing, areaId, 'closer');
      const isCloser = roles.has('closer') || me.roles.includes('super_admin');

      return {
        id: r.id,
        ticketNo: r.ticket_no,
        status: r.status,
        dueAt: r.due_at,
        createdAt: r.created_at,
        closedAt: r.closed_at,
        overdue: !CLOSED.includes(r.status) && !!r.due_at && Date.parse(r.due_at) < now,

        severity: r.deviations.severity,
        parameter: r.deviations.parameter_master.name,
        target: r.deviations.target_text,
        actual: r.deviations.actual_text,
        occurrences: r.deviations.occurrence_count ?? 1,

        section: sec.name,
        area: areaId ? routing.areas.get(areaId)?.area || null : null,
        scope: scopeOfModule(sec.module),

        rootCause: r.root_cause,
        correctiveAction: r.corrective_action,
        closureComments: r.closure_comments,

        closers: closers.map(c => c.name),
        myRoles: [...roles],
        canAct: isCloser && !!areaId,
        canMd: me.roles.some(x => TICKET_ALL_ROLES.includes(x)) || roles.has('md'),

        reopened: reopenedIds.has(r.id),
        followup: followup.get(r.id) || null,
        history: (events.get(r.id) || []).slice(0, 8),

        evidence: await Promise.all(
          (r.ticket_evidence || []).map(async e => ({
            id: e.id,
            name: e.file_name,
            mime: e.mime_type,
            at: e.created_at,
            url: await sign(e.storage_path)
          }))
        )
      };
    }));

    // MD Office statistics.
    let stats: any = null;

    if (base.isMd) {
      const mine2 = statRows.filter(r => {
        const s = r.deviations.parameter_master.parameter_sections;
        return all || mdAreas.has(routing.sectionArea.get(s.id) ?? -1);
      });

      const t = {
        total: 0,
        open: 0,
        inProgress: 0,
        reopened: 0,
        overdue: 0,
        closed: 0
      };

      const byArea = new Map<string, typeof t>();
      const byPerson = new Map<string, typeof t>();

      const tally = (c: typeof t, r: Row) => {
        c.total++;

        const closed = CLOSED.includes(r.status);

        if (closed) {
          c.closed++;
        } else {
          c.open++;
          if (r.status === 'in_progress') c.inProgress++;
          if (reopenedIds.has(r.id)) c.reopened++;
          if (r.due_at && Date.parse(r.due_at) < now) c.overdue++;
        }
      };

      const bump = (m: Map<string, typeof t>, k: string, r: Row) => {
        const c = m.get(k) || m.set(k, {
          total: 0,
          open: 0,
          inProgress: 0,
          reopened: 0,
          overdue: 0,
          closed: 0
        }).get(k)!;

        tally(c, r);
      };

      for (const r of mine2) {
        tally(t, r);

        const section = r.deviations.parameter_master.parameter_sections;
        const areaId = routing.sectionArea.get(section.id);

        bump(
          byArea,
          routing.areas.get(areaId ?? -1)?.area || section.name,
          r
        );

        const closers = peopleFor(routing, areaId, 'closer');

        for (const c of closers.length ? closers : [{ id: '', name: 'Not assigned' }]) {
          bump(byPerson, c.name || 'Not assigned', r);
        }
      }

      const rows2 = (m: Map<string, typeof t>) =>
        [...m.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.open - a.open || b.total - a.total);

      stats = {
        ...t,
        byArea: rows2(byArea),
        byPerson: rows2(byPerson)
      };

      void sweepOverdue(db, routing, mine2).catch(() => undefined);
    }

    return NextResponse.json({
      ...base,
      tickets,
      stats,
      areas: [...routing.areas.values()].map(a => a.area)
    });

  } catch (e) {
    logServerError('ticket-desk:get', e);

    return NextResponse.json({
      error: errorMessage(e, 'Unable to load your tickets.')
    }, { status: 500 });
  }
}

/** Overdue notices go to the closer and MD Office of the area. */
async function sweepOverdue(
  db: ReturnType<typeof supabaseAdmin>,
  routing: Routing,
  rows: Row[]
) {
  const now = Date.now();
  const out: Record<string, unknown>[] = [];

  for (const r of rows) {
    if (CLOSED.includes(r.status) || !r.due_at || Date.parse(r.due_at) >= now) continue;

    const section = r.deviations.parameter_master.parameter_sections;
    const areaId = routing.sectionArea.get(section.id);

    if (!areaId) continue;

    const to = routing.people.filter(
      p => p.area_id === areaId && (p.role === 'closer' || p.role === 'md')
    );

    for (const u of new Set(to.map(p => p.user_id))) {
      out.push({
        user_id: u,
        event_type: 'ticket_overdue',
        title: `Overdue ticket • ${routing.areas.get(areaId)?.area}`,
        body: `Ticket ${r.ticket_no} passed its target time and is still ${r.status.replace('_', ' ')}.`,
        severity: 'warning',
        entity_type: 'ticket',
        entity_id: r.id,
        dedupe_key: `ticket_overdue:${r.id}:${u}`
      });
    }

    if (out.length >= 200) break;
  }

  if (out.length) {
    await db.from('notifications').upsert(out, {
      onConflict: 'dedupe_key',
      ignoreDuplicates: true
    });
  }
}

/** PATCH — closer updates ticket status; MD Office records JMD follow-up. */
export async function PATCH(req: NextRequest) {
  try {
    const me = await who();

    if (!me) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const b = await req.json();
    const id = String(b.id || '');

    if (!id) {
      return NextResponse.json({ error: 'Ticket is required.' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const routing = await loadRouting(db);

    const { data: t, error } = await db
      .from('deviation_tickets')
      .select('id,ticket_no,status,deviations(parameter_id)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!t) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const deviation = Array.isArray((t as any).deviations)
      ? (t as any).deviations[0]
      : (t as any).deviations;

    if (!deviation) {
      return NextResponse.json({
        error: 'The deviation associated with this ticket could not be found.'
      }, { status: 409 });
    }

    const metadata = await resolveParameterMetadata(
      db,
      [deviation.parameter_id]
    );

    const parameter = metadata.get(Number(deviation.parameter_id));

    if (!parameter?.parameter_sections) {
      return NextResponse.json({
        error: 'Parameter metadata could not be found. Ticket update cannot be processed safely.',
        code: 'PARAMETER_METADATA_NOT_FOUND'
      }, { status: 409 });
    }

    const areaId = routing.sectionArea.get(parameter.section_id);
    const roles = rolesFor(routing, me.id, areaId);
    const admin = me.roles.includes('super_admin');
    const out: Record<string, unknown> = {};

    if (b.action) {
      const to = ACTIONS[String(b.action)];

      if (!to) {
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
      }

      if (!areaId) {
        return NextResponse.json({
          error: 'This ticket is not routed to a plant area, so it cannot be changed here.'
        }, { status: 403 });
      }

      if (!roles.has('closer') && !admin) {
        return NextResponse.json({
          error: `Only ${peopleFor(routing, areaId, 'closer').map(c => c.name).join(' / ') || 'the designated closer'} can update this ticket.`
        }, { status: 403 });
      }

      const update: Record<string, unknown> = { status: to };

      for (const [k, col] of [
        ['rootCause', 'root_cause'],
        ['correctiveAction', 'corrective_action'],
        ['closureComments', 'closure_comments']
      ] as const) {
        if (b[k] !== undefined) {
          update[col] = String(b[k] || '').trim() || null;
        }
      }

      if (to === 'closed') {
        const { data: cur } = await db
          .from('deviation_tickets')
          .select('corrective_action,closure_comments')
          .eq('id', id)
          .single();

        const { count } = await db
          .from('ticket_evidence')
          .select('id', { count: 'exact', head: true })
          .eq('ticket_id', id);

        const action = (update.corrective_action ?? cur?.corrective_action) as string | null;
        const remark = (update.closure_comments ?? cur?.closure_comments) as string | null;

        if (!action) {
          return NextResponse.json({
            error: 'Record the corrective action before closing the ticket.'
          }, { status: 400 });
        }

        if (!remark && !(count || 0)) {
          return NextResponse.json({
            error: 'Add a closing remark or at least one photograph as evidence before closing the ticket.'
          }, { status: 400 });
        }

        update.closed_by = me.id;
        update.closed_at = new Date().toISOString();

      } else {
        update.closed_by = null;
        update.closed_at = null;
      }

      const { error: ue } = await db
        .from('deviation_tickets')
        .update(update)
        .eq('id', id);

      if (ue) throw ue;

      const wasClosed = CLOSED.includes(String((t as any).status));

      await db.from('ticket_events').insert({
        ticket_id: id,
        event: b.action === 'reopen' && wasClosed ? 'reopened' : String(b.action),
        from_status: (t as any).status,
        to_status: to,
        note: String(b.closureComments || b.correctiveAction || '').slice(0, 500) || null,
        by_user: me.id
      });

      await db.from('audit_logs').insert({
        user_id: me.id,
        module: 'tickets',
        action: `TICKET_${String(b.action).toUpperCase()}`,
        entity_type: 'deviation_ticket',
        entity_id: id,
        before_data: { status: (t as any).status },
        after_data: update
      });

      out.status = to;
    }

    if (b.followup) {
      if (!(admin || me.roles.some(r => TICKET_ALL_ROLES.includes(r)) || roles.has('md'))) {
        return NextResponse.json({
          error: 'Only the MD Office can record JMD follow-up.'
        }, { status: 403 });
      }

      const f = b.followup;
      const date = (v: unknown) =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? v
          : null;

      const { error: fe } = await db.from('ticket_md_followup').upsert({
        ticket_id: id,
        reported_to_jmd: !!f.reportedToJmd,
        jmd_report_date: date(f.jmdReportDate),
        target_closure: date(f.targetClosure),
        md_remarks: String(f.mdRemarks || '').slice(0, 1000) || null,
        updated_by: me.id,
        updated_at: new Date().toISOString()
      });

      if (fe) throw fe;

      out.followup = true;
    }

    return NextResponse.json({ ok: true, ...out });

  } catch (e) {
    logServerError('ticket-desk:patch', e);

    return NextResponse.json({
      error: errorMessage(e, 'Unable to update the ticket.')
    }, { status: 500 });
  }
}
