
import { NextRequest, NextResponse } from 'next/server';
import {
  authorization,
  moduleAuthorization,
  moduleEditAuthorization,
  INPUT_ROLES,
  QUALITY_INPUT_ROLES
} from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';

function authFor(scope: string, edit = false) {
  const module = scope === 'quality' ? 'quality_input' : 'input';

  const fallbackRoles =
    scope === 'quality' ? QUALITY_INPUT_ROLES : INPUT_ROLES;

  return edit
    ? moduleEditAuthorization(module, fallbackRoles)
    : moduleAuthorization(module, fallbackRoles);
}
function validScope(value: unknown): 'solvent' | 'quality' | null {
  return value === 'solvent' || value === 'quality' ? value : null;
}

export async function GET(req: NextRequest) {
  try {
    const scope = validScope(req.nextUrl.searchParams.get('scope'));
    const shiftSessionId = req.nextUrl.searchParams.get('shiftSessionId');
    const productCode = req.nextUrl.searchParams.get('productCode') || 'PLANT';

    if (!scope || !shiftSessionId) {
      return NextResponse.json(
        { error: 'Scope and shift session are required.' },
        { status: 400 }
      );
    }

    const az = await authFor(scope);
    if (!az.ok) {
      return NextResponse.json(
        { error: 'Input access not assigned.' },
        { status: az.status }
      );
    }

    const db = supabaseAdmin();

    const { data: session, error: sessionError } = await db
      .from('shift_sessions')
      .select('id,scope,active_products')
      .eq('id', shiftSessionId)
      .single();

    if (sessionError) throw sessionError;

    if (session.scope !== scope) {
      return NextResponse.json({ error: 'Invalid shift scope.' }, { status: 400 });
    }

    
const { data, error } = await db
  .from('section_operating_status')
  .select('*')
  .eq('shift_session_id', shiftSessionId)
  .eq('scope', scope)
  .eq('product_code', productCode)
  .eq('status', 'not_operating')
  .order('marked_at', { ascending: false });

// TEMPORARY DEBUG LOG
console.log('===== GET QUERY RESULT =====');
console.log('Shift Session:', shiftSessionId);
console.log('Scope:', scope);
console.log('Product:', productCode);
console.log('Error:', error);
console.log('Count:', data?.length);
console.log('Section IDs:', data?.map(item => item.section_id));
console.log('Records:', data);
console.log('============================');

if (error) throw error;

    console.log('===== SECTION STATUS API GET =====');
console.log('Shift Session:', shiftSessionId);
console.log('Scope:', scope);
console.log('Product:', productCode);
console.log(
  'Returned statuses:',
  JSON.stringify(
    (data || []).map(item => ({
      id: item.id,
      section_id: item.section_id,
      product_code: item.product_code,
      status: item.status
    })),
    null,
    2
  )
);
console.log('===================================');

    return NextResponse.json({ statuses: data || [] });
  } catch (e) {
    logServerError('section-operating-status.GET', e);
    return NextResponse.json(
      { error: errorMessage(e, 'Unable to load section statuses.') },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scope = validScope(body.scope);
    const action = String(body.action || '');
    const shiftSessionId = String(body.shiftSessionId || '');
    const productCode = String(body.productCode || 'PLANT');

    if (!scope || !shiftSessionId) {
      return NextResponse.json(
        { error: 'Scope and shift session are required.' },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    // Undo is strictly Super Admin only.
    if (action === 'undo') {
      const admin = await authorization(['super_admin']);

      if (!admin.ok) {
        return NextResponse.json(
          { error: 'Only Super Admin can undo a Not Operating mark.' },
          { status: admin.status }
        );
      }

      const statusId = String(body.statusId || '');
      const reason = String(body.reason || '').trim();

      if (!statusId || !reason) {
        return NextResponse.json(
          { error: 'Status ID and reversal reason are required.' },
          { status: 400 }
        );
      }

      const { data: existing, error: existingError } = await db
        .from('section_operating_status')
        .select('id,shift_session_id,scope,product_code,status,section_id')
        .eq('id', statusId)
        .eq('shift_session_id', shiftSessionId)
        .eq('scope', scope)
        .eq('product_code', productCode)
        .eq('status', 'not_operating')
        .maybeSingle();

      if (existingError) throw existingError;

      if (!existing) {
        return NextResponse.json(
          { error: 'This Not Operating mark is already reversed or does not exist.' },
          { status: 404 }
        );
      }

      const { data, error } = await db
        .from('section_operating_status')
        .update({
          status: 'reversed',
          reversed_by: admin.user.id,
          reversed_at: new Date().toISOString(),
          reversal_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', statusId)
        .eq('status', 'not_operating')
        .select('*')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return NextResponse.json(
          { error: 'This mark was already reversed.' },
          { status: 409 }
        );
      }

      await db.from('audit_logs').insert({
        user_id: admin.user.id,
        module: scope === 'quality' ? 'quality_input' : 'input',
        action: 'SECTION_NOT_OPERATING_UNDO',
        entity_type: 'section_operating_status',
        entity_id: statusId,
        metadata: {
          shiftSessionId,
          sectionId: existing.section_id,
          productCode,
          reason
        }
      });

      return NextResponse.json({ status: data });
    }

    // Marking requires the relevant input-module access.
    if (action !== 'mark') {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }
    const az = await authFor(scope, true);

    if (!az.ok) {
      return NextResponse.json(
        { error: 'Input access not assigned.' },
        { status: az.status }
      );
    }

    const sectionId = Number(body.sectionId);
    const reason = String(body.reason || '').trim();
    const note = String(body.note || '').trim();

    if (!Number.isInteger(sectionId) || sectionId <= 0 || !reason) {
      return NextResponse.json(
        { error: 'Valid section ID and reason are required.' },
        { status: 400 }
      );
    }

    if (reason === 'Other' && !note) {
      return NextResponse.json(
        { error: 'Please provide a note for Other.' },
        { status: 400 }
      );
    }

    const [{ data: session, error: sessionError }, { data: section, error: sectionError }] =
      await Promise.all([
        db.from('shift_sessions')
          .select('id,scope,status,operator_id,active_products')
          .eq('id', shiftSessionId)
          .single(),

        db.from('parameter_sections')
          .select('id,name,module')
          .eq('id', sectionId)
          .eq('active', true)
          .single()
      ]);

    if (sessionError) throw sessionError;
    if (sectionError) throw sectionError;

    if (session.scope !== scope) {
      return NextResponse.json({ error: 'Invalid shift scope.' }, { status: 400 });
    }

    if (session.status !== 'active') {
      return NextResponse.json(
        { error: 'Only an active shift can be marked Not Operating.' },
        { status: 409 }
      );
    }

    if (
      session.operator_id !== az.user.id &&
      !az.roles.some((r: string) =>
        ['super_admin', 'admin', 'solvent_head', 'quality_head'].includes(r)
      )
    ) {
      return NextResponse.json(
        { error: 'You can only update your own shift.' },
        { status: 403 }
      );
    }

    const allowedSection =
      scope === 'quality'
        ? section.module === 'quality'
        : ['solvent', 'boiler'].includes(String(section.module));

    if (!allowedSection) {
      return NextResponse.json(
        { error: 'This section does not belong to the selected workspace.' },
        { status: 400 }
      );
    }

    const activeProducts = Array.isArray(session.active_products)
      ? session.active_products.map(String)
      : [];

    if (scope === 'quality' && productCode === 'PLANT') {
      return NextResponse.json(
        { error: 'Select a Quality product.' },
        { status: 400 }
      );
    }

    if (productCode !== 'PLANT' && !activeProducts.includes(productCode)) {
      return NextResponse.json(
        { error: 'This product is not active in this shift.' },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from('section_operating_status')
      .insert({
        shift_session_id: shiftSessionId,
        section_id: sectionId,
        scope,
        product_code: productCode,
        status: 'not_operating',
        marked_by: az.user.id,
        marked_at: new Date().toISOString(),
        mark_reason: reason,
        mark_note: note || null
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This section is already marked Not Operating.' },
          { status: 409 }
        );
      }
      throw error;
    }

    await db.from('audit_logs').insert({
      user_id: az.user.id,
      module: scope === 'quality' ? 'quality_input' : 'input',
      action: 'SECTION_NOT_OPERATING_MARK',
      entity_type: 'section_operating_status',
      entity_id: data.id,
      metadata: {
        shiftSessionId,
        sectionId,
        productCode,
        reason,
        note
      }
    });

    return NextResponse.json({ status: data });
  } catch (e) {
    logServerError('section-operating-status.POST', e);
    return NextResponse.json(
      { error: errorMessage(e, 'Unable to update section operating status.') },
      { status: 500 }
    );
  }
}
