
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { loadRouting, rolesFor } from '@/lib/ticketRouting';

export const runtime = 'nodejs';

const BUCKET = 'svma-ticket-evidence';
const MAX_SIZE = 15 * 1024 * 1024;

/** POST — add new evidence or replace an existing evidence file. */
export async function POST(req: NextRequest) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

  
const fd = await req.formData();
const ticketId = String(fd.get('ticketId') || '');
const evidenceId = String(fd.get('evidenceId') || '');
const mode = String(fd.get('mode') || 'add');
const file = fd.get('file');

if (mode !== 'add' && mode !== 'replace') {
  return NextResponse.json(
    { error: 'Invalid evidence upload mode.' },
    { status: 400 }
  );
}

if (mode === 'replace' && !evidenceId) {
  return NextResponse.json(
    { error: 'Evidence ID is required for replacement.' },
    { status: 400 }
  );
}

if (mode === 'add' && evidenceId) {
  return NextResponse.json(
    { error: 'Unexpected evidence ID for a new upload.' },
    { status: 400 }
  );
}

if (!ticketId || !(file instanceof File)) {
  return NextResponse.json(
    { error: 'Ticket and evidence file are required.' },
    { status: 400 }
  );
}

if (file.size > MAX_SIZE) {
  return NextResponse.json(
    { error: 'Evidence file exceeds 15 MB.' },
    { status: 400 }
  );
}


    const db = supabaseAdmin();

    const [{ data: roleRows }, routing, { data: ticket }] = await Promise.all([
      sb.from('user_roles').select('role').eq('user_id', user.id),
      loadRouting(db),
      db.from('deviation_tickets')
        .select('id,status,deviations(parameter_master(section_id))')
        .eq('id', ticketId)
        .maybeSingle(),
    ]);

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const admin = (roleRows || []).some(
      (r: { role: string }) => r.role === 'super_admin'
    );

    const areaId = routing.sectionArea.get(
      (ticket as any).deviations?.parameter_master?.section_id
    );

    if (!admin && !rolesFor(routing, user.id, areaId).has('closer')) {
      return NextResponse.json(
        { error: 'Only the designated closer can manage evidence.' },
        { status: 403 }
      );
    }

    // If evidenceId is provided, verify that the file belongs to this ticket.
    let oldEvidence: any = null;

    if (mode === 'replace') {
      const { data, error } = await db
        .from('ticket_evidence')
        .select('id,ticket_id,storage_path')
        .eq('id', evidenceId)
        .eq('ticket_id', ticketId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return NextResponse.json(
          { error: 'Evidence file not found for this ticket.' },
          { status: 404 }
        );
      }

      oldEvidence = data;
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${ticketId}/${Date.now()}-${safe}`;

    // Upload the new file first. Do not delete the old file yet.
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    if (mode === 'replace' && oldEvidence) {
      // Update the existing evidence record.
      const { data, error } = await db
        .from('ticket_evidence')
        .update({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          uploaded_by: user.id,
        })
        .eq('id', evidenceId)
        .eq('ticket_id', ticketId)
        .select('*')
        .single();

      if (error) {
        // Preserve the old evidence and clean up the newly uploaded file.
        await db.storage.from(BUCKET).remove([path]);
        throw error;
      }

      // The database now points to the new file. Remove the old file.
      const { error: removeError } = await db.storage
        .from(BUCKET)
        .remove([oldEvidence.storage_path]);

      if (removeError) {
        console.error('Old evidence cleanup failed:', removeError.message);
      }

      return NextResponse.json({
        evidence: data,
        replaced: true,
        message: 'Evidence updated successfully.',
      });
    }

    // Normal new evidence upload.
    const { data, error } = await db
      .from('ticket_evidence')
      .insert({
        ticket_id: ticketId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        uploaded_by: user.id,
      })
      .select('*')
      .single();

    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      throw error;
    }

    return NextResponse.json({
      evidence: data,
      replaced: false,
      message: 'Evidence added successfully.',
    });

  } catch (e) {
    logServerError('ticket-desk/evidence', e);
    return NextResponse.json(
      { error: errorMessage(e, 'Evidence upload failed') },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { ticketId, evidenceId } = await req.json();

    if (!ticketId || !evidenceId) {
      return NextResponse.json(
        { error: 'Ticket and evidence ID are required.' },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    const [{ data: roleRows }, routing, { data: ticket }] =
      await Promise.all([
        sb.from('user_roles').select('role').eq('user_id', user.id),
        loadRouting(db),
        db.from('deviation_tickets')
  .select('id,status,deviations(parameter_master(section_id))')
  .eq('id', ticketId)
  .maybeSingle()
      ]);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found.' },
        { status: 404 }
      );
    }
    const status = String(ticket.status || '').toLowerCase();

if (!['open', 'in_progress'].includes(status)) {
  return NextResponse.json(
    { error: 'Evidence cannot be deleted after the ticket is closed.' },
    { status: 403 }
  );
}

    const admin = (roleRows || []).some(
      (r: { role: string }) => r.role === 'super_admin'
    );

    const areaId = routing.sectionArea.get(
      (ticket as any).deviations?.parameter_master?.section_id
    );

    if (!admin && !rolesFor(routing, user.id, areaId).has('closer')) {
      return NextResponse.json(
        { error: 'Only the designated closer can delete evidence.' },
        { status: 403 }
      );
    }

    const { data: evidence, error } = await db
      .from('ticket_evidence')
      .select('id,ticket_id,storage_path')
      .eq('id', evidenceId)
      .eq('ticket_id', ticketId)
      .maybeSingle();

    if (error) throw error;

    if (!evidence) {
      return NextResponse.json(
        { error: 'Evidence not found.' },
        { status: 404 }
      );
    }

    // Remove the storage object first.
    const { error: storageError } = await db.storage
      .from('svma-ticket-evidence')
      .remove([evidence.storage_path]);

    if (storageError) throw storageError;

    // Remove the database record.
    const { error: deleteError } = await db
      .from('ticket_evidence')
      .delete()
      .eq('id', evidenceId)
      .eq('ticket_id', ticketId);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      ok: true,
      message: 'Evidence deleted successfully.'
    });

  } catch (e) {
    logServerError('ticket-desk/evidence-delete', e);

    return NextResponse.json(
      { error: errorMessage(e, 'Evidence deletion failed.') },
      { status: 500 }
    );
  }
}
