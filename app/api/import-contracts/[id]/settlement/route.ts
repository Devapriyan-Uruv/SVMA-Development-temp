
import { NextRequest, NextResponse } from 'next/server';

import {
  moduleAuthorization,
  moduleEditAuthorization,
  IMPORT_VIEW_ROLES,
  IMPORT_EDIT_ROLES,
} from '@/lib/authorize';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';

import {
  loadSettlement,
  CONTRACT_DATE_FIELDS,
} from '@/lib/importSettlement/load';

import { ensureImportEntry } from '@/lib/importMaster/fromContract';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODULE = 'import';

const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value);

const numOrNull = (value: unknown): number | null =>
  value === '' || value == null
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;

const textOrNull = (
  value: unknown,
  maxLength = 120,
): string | null => {
  const text = String(value ?? '')
    .trim()
    .slice(0, maxLength);

  return text || null;
};

const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value !== 'new';

/**
 * GET — settlement sheet of one contract.
 * Returns contract, invoices, BOEs and the calculated settlement.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = await moduleAuthorization(
      MODULE,
      IMPORT_VIEW_ROLES,
    );

    if (!authorization.ok) {
      return NextResponse.json(
        {
          error:
            authorization.status === 401
              ? 'Authentication required.'
              : 'Import access is required.',
        },
        { status: authorization.status },
      );
    }

    const { id } = await ctx.params;

    const [loaded, editAuthorization] = await Promise.all([
      loadSettlement(supabaseAdmin(), id),
      moduleEditAuthorization(MODULE, IMPORT_EDIT_ROLES),
    ]);

    if (!loaded) {
      return NextResponse.json(
        { error: 'Contract not found.' },
        { status: 404 },
      );
    }

    const contract = loaded.contract;

    const canEdit =
      (editAuthorization.ok &&
        IMPORT_EDIT_ROLES.some(role =>
          editAuthorization.roles.includes(role),
        )) ||
      authorization.roles.includes('super_admin');

    return NextResponse.json({
      contract: {
        id: contract.id,
        importId: contract.import_id,
        status: contract.status,
        contractNumber: contract.contract_number,
        contractDate: contract.contract_date,
        supplierName: contract.supplier_name,
        product: contract.product_material_name,
        quantity: contract.quantity,
        uom: contract.uom,
        unitPrice: contract.unit_price,
        currency: contract.currency,
        shipmentPeriod: contract.shipment_date_period,
        paymentTerms: contract.payment_terms,
        erpSupplier: contract.erp_supplier,
        erpProduct: contract.erp_product,
      },

      invoices: loaded.invoices,
      boes: loaded.boes,
      record: loaded.record,
      settlement: loaded.settlement,
      dayBook: loaded.dayBook,
      keyDates: loaded.keyDates,
      canEdit,
    });
  } catch (error) {
    logServerError('import-contracts/settlement:get', error);

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          'Unable to build the settlement sheet.',
        ),
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH supports:
 *
 * invoices  — create, update and delete invoices
 * boes      — create, update and delete BOEs
 * dates     — update contract dates and ERP names
 * links     — confirm, exclude or remove Tally / ERP links
 * overrides — save manual values against a BOE
 * createRecord — create the linked Import record
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = await moduleEditAuthorization(
      MODULE,
      IMPORT_EDIT_ROLES,
    );

    if (!authorization.ok) {
      return NextResponse.json(
        {
          error:
            authorization.status === 401
              ? 'Authentication required.'
              : 'Import edit access is required.',
        },
        { status: authorization.status },
      );
    }

    const { id } = await ctx.params;
    const body = await req.json();

    const db = supabaseAdmin();
    const userId = authorization.user?.id ?? null;
    const now = new Date().toISOString();

    const { data: exists, error: existsError } = await db
      .from('import_contracts')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (existsError) throw existsError;

    if (!exists) {
      return NextResponse.json(
        { error: 'Contract not found.' },
        { status: 404 },
      );
    }

    // ---------------------------------------------------------
    // 1. Create linked Import record
    // ---------------------------------------------------------

    if (body.createRecord === true) {
      const result = await ensureImportEntry(db, id, userId);

      if (!result) {
        return NextResponse.json(
          { error: 'Contract not found.' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        importRecord: result.refCode,
        created: result.created,
      });
    }

    // ---------------------------------------------------------
    // 2. Invoice creation / update / deletion
    // ---------------------------------------------------------

    if (Array.isArray(body.invoices)) {
      for (const [index, invoice] of (
        body.invoices as any[]
      ).entries()) {
        if (
          invoice.delete &&
          validId(invoice.id)
        ) {
          const { error } = await db
            .from('import_contract_invoices')
            .delete()
            .eq('id', invoice.id)
            .eq('contract_id', id);

          if (error) throw error;

          // Associated BOEs are removed through the database
          // foreign-key cascade.
          continue;
        }

        const invoiceNumber = textOrNull(invoice.invNo);

        if (!invoiceNumber) continue;

        const row = {
          contract_id: id,
          inv_no: invoiceNumber,
          inv_qty: numOrNull(invoice.invQty),
          rate_per_ton: numOrNull(invoice.ratePerTon),
          inv_value_usd: numOrNull(invoice.invValueUsd),
          adv_paid_usd: numOrNull(invoice.advPaidUsd),

          // Legacy invoice BOE fields are retained for backward
          // compatibility. New BOE editing uses the BOE table.
          boe_no: textOrNull(invoice.boeNo, 40),
          boe_date: isDate(invoice.boeDate)
            ? invoice.boeDate
            : null,
          assessable_value: numOrNull(
            invoice.assessableValue,
          ),

          sort_order: index,
          updated_at: now,
        };

        const result = validId(invoice.id)
          ? await db
              .from('import_contract_invoices')
              .update(row)
              .eq('id', invoice.id)
              .eq('contract_id', id)
          : await db
              .from('import_contract_invoices')
              .upsert(row, {
                onConflict: 'contract_id,inv_no',
              });

        if (result.error) {
          if (result.error.code === '23505') {
            return NextResponse.json(
              {
                error: `Invoice ${invoiceNumber} is already on this contract.`,
              },
              { status: 409 },
            );
          }

          throw result.error;
        }
      }
    }

    // ---------------------------------------------------------
    // 3. BOE creation / update / deletion
    // ---------------------------------------------------------

    if (Array.isArray(body.boes)) {
      for (const [index, boe] of (
        body.boes as any[]
      ).entries()) {
        if (
          boe.delete &&
          validId(boe.id)
        ) {
          const { error } = await db
            .from('import_contract_boes')
            .delete()
            .eq('id', boe.id)
            .eq('contract_id', id);

          if (error) throw error;

          // BOE-specific cells and links are removed by
          // their foreign-key cascade.
          continue;
        }

        const invoiceId = validId(boe.invoiceId)
          ? boe.invoiceId
          : null;

        if (!invoiceId) {
          return NextResponse.json(
            {
              error:
                'Every BOE must be associated with a saved invoice.',
            },
            { status: 400 },
          );
        }

        // Validate the invoice belongs to this contract.
        const {
          data: invoice,
          error: invoiceError,
        } = await db
          .from('import_contract_invoices')
          .select('id')
          .eq('id', invoiceId)
          .eq('contract_id', id)
          .maybeSingle();

        if (invoiceError) throw invoiceError;

        if (!invoice) {
          return NextResponse.json(
            {
              error:
                'The selected invoice does not belong to this contract.',
            },
            { status: 400 },
          );
        }

        const row = {
          contract_id: id,
          invoice_id: invoiceId,
          boe_no: textOrNull(boe.boeNo, 40),
          boe_date: isDate(boe.boeDate)
            ? boe.boeDate
            : null,
          inv_qty: numOrNull(boe.invQty),
          rate_per_ton: numOrNull(boe.ratePerTon),
          inv_value_usd: numOrNull(boe.invValueUsd),
          adv_paid_usd: numOrNull(boe.advPaidUsd),
          assessable_value: numOrNull(
            boe.assessableValue,
          ),
          sort_order: index,
          updated_at: now,
        };

        const result = validId(boe.id)
          ? await db
              .from('import_contract_boes')
              .update(row)
              .eq('id', boe.id)
              .eq('contract_id', id)
          : await db
              .from('import_contract_boes')
              .insert(row);

        if (result.error) throw result.error;
      }
    }

    // ---------------------------------------------------------
    // 4. Contract dates and ERP names
    // ---------------------------------------------------------

    if (
      body.dates &&
      typeof body.dates === 'object'
    ) {
      const update: Record<string, unknown> = {
        updated_by: userId,
        updated_at: now,
      };

      for (const key of CONTRACT_DATE_FIELDS) {
        if (key in body.dates) {
          update[key] = isDate(body.dates[key])
            ? body.dates[key]
            : null;
        }
      }

      if ('erpSupplier' in body.dates) {
        update.erp_supplier = textOrNull(
          body.dates.erpSupplier,
          120,
        );
      }

      if ('erpProduct' in body.dates) {
        update.erp_product = textOrNull(
          body.dates.erpProduct,
          120,
        );
      }

      const { error } = await db
        .from('import_contracts')
        .update(update)
        .eq('id', id);

      if (error) throw error;
    }

    // ---------------------------------------------------------
    // 5. Tally / ERP link decisions
    // ---------------------------------------------------------

    if (Array.isArray(body.links)) {
      for (const link of body.links as any[]) {
        if (
          !['tally', 'erp'].includes(link.kind) ||
          !link.refKey
        ) {
          continue;
        }

        const refKey = String(link.refKey);

        // Remove an existing decision.
        if (link.status == null) {
          const { error } = await db
            .from('import_contract_links')
            .delete()
            .eq('contract_id', id)
            .eq('kind', link.kind)
            .eq('ref_key', refKey);

          if (error) throw error;

          continue;
        }

        let boeId: string | null = null;

        if (validId(link.boeId)) {
          boeId = link.boeId;

          // Ensure the selected BOE belongs to this contract.
          const {
            data: boe,
            error: boeError,
          } = await db
            .from('import_contract_boes')
            .select('id')
            .eq('id', boeId)
            .eq('contract_id', id)
            .maybeSingle();

          if (boeError) throw boeError;

          if (!boe) {
            return NextResponse.json(
              {
                error:
                  'The selected BOE does not belong to this contract.',
              },
              { status: 400 },
            );
          }
        }

        const { error } = await db
          .from('import_contract_links')
          .upsert(
            {
              contract_id: id,
              kind: link.kind,
              ref_key: refKey,
              col_key: textOrNull(link.colKey, 40),
              invoice_id: null,
              boe_id: boeId,
              status:
                link.status === 'excluded'
                  ? 'excluded'
                  : 'confirmed',
              decided_by: userId,
              decided_at: now,
            },
            {
              onConflict: 'contract_id,kind,ref_key',
            },
          );

        if (error) {
          if (error.code === '23505') {
            return NextResponse.json(
              {
                error:
                  'This Tally voucher is already confirmed against another contract.',
              },
              { status: 409 },
            );
          }

          throw error;
        }
      }
    }

    // ---------------------------------------------------------
    // 6. BOE-specific manual overrides
    // ---------------------------------------------------------

    if (Array.isArray(body.overrides)) {
      for (const override of body.overrides as any[]) {
        const boeId = validId(override.boeId)
          ? override.boeId
          : null;

        const colKey = textOrNull(
          override.colKey,
          80,
        );

        if (!colKey) continue;

        if (boeId) {
          const {
            data: boe,
            error: boeError,
          } = await db
            .from('import_contract_boes')
            .select('id')
            .eq('id', boeId)
            .eq('contract_id', id)
            .maybeSingle();

          if (boeError) throw boeError;

          if (!boe) {
            return NextResponse.json(
              {
                error:
                  'The selected BOE does not belong to this contract.',
              },
              { status: 400 },
            );
          }
        }

        // Remove the previous value for this BOE and column.
        let deleteQuery = db
          .from('import_contract_cells')
          .delete()
          .eq('contract_id', id)
          .eq('col_key', colKey);

        deleteQuery = boeId
          ? deleteQuery.eq('boe_id', boeId)
          : deleteQuery.is('boe_id', null);

        const { error: deleteError } = await deleteQuery;

        if (deleteError) throw deleteError;

        const value = numOrNull(override.value);

        if (value != null) {
          const { error } = await db
            .from('import_contract_cells')
            .insert({
              contract_id: id,
              invoice_id: null,
              boe_id: boeId,
              col_key: colKey,
              value,
              note: textOrNull(override.note, 200),
              updated_by: userId,
            });

          if (error) throw error;
        }
      }
    }

    // ---------------------------------------------------------
    // 7. Audit log
    // ---------------------------------------------------------

    const { error: auditError } = await db
      .from('import_contract_audit')
      .insert({
        contract_id: id,
        action: 'SETTLEMENT_UPDATED',
        changed_by: userId,
        details: {
          invoices: !!body.invoices,
          boes: !!body.boes,
          dates: !!body.dates,
          links: Array.isArray(body.links)
            ? body.links.length
            : 0,
          overrides: Array.isArray(body.overrides)
            ? body.overrides.length
            : 0,
        },
      });

    if (auditError) throw auditError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError(
      'import-contracts/settlement:patch',
      error,
    );

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          'Unable to save the settlement changes.',
        ),
      },
      { status: 500 },
    );
  }
}
