
import { NextRequest, NextResponse } from 'next/server';
import {
  moduleEditAuthorization,
  IMPORT_EDIT_ROLES,
} from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ensureImportEntry } from '@/lib/importMaster/fromContract';
import {
  errorMessage,
  logServerError,
} from '@/lib/errors';

export const runtime = 'nodejs';

// Contracts live under the existing Import module (same access, same roles) — no separate module key.
const MODULE_KEY = 'import';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result === '' ? null : result;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getField(
  fields: Record<string, unknown>,
  camelName: string,
  snakeName: string,
): unknown {
  return fields[camelName] ?? fields[snakeName] ?? null;
}

export async function PATCH(
  req: NextRequest,
  context: RouteContext,
) {
  try {
    const az = await moduleEditAuthorization(
      MODULE_KEY,
      IMPORT_EDIT_ROLES,
    );

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'You do not have permission to edit import contracts.',
        },
        { status: az.status },
      );
    }

    const { id } = await context.params;

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      return NextResponse.json(
        { error: 'Invalid contract ID.' },
        { status: 400 },
      );
    }

    const body = await req.json();

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: 'Invalid contract request body.' },
        { status: 400 },
      );
    }

    // Confirm a contract that was saved for review (no field edits): it becomes Confirmed and gets its Import record.
    if (body.confirm === true && !body.fields) {
      const cdb = supabaseAdmin();
      const { data: cur, error: ce } = await cdb.from('import_contracts').select('id,status,contract_number,supplier_name').eq('id', id).maybeSingle();
      if (ce) throw ce;
      if (!cur) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
      if (!cur.contract_number || !cur.supplier_name || /^UNKNOWN/i.test(cur.supplier_name)) return NextResponse.json({ error: 'Add the contract number and supplier name (Edit) before confirming.' }, { status: 400 });
      const { error: ue } = await cdb.from('import_contracts').update({ status: 'Confirmed', updated_by: az.user.id, updated_at: new Date().toISOString() }).eq('id', id);
      if (ue) throw ue;
      await cdb.from('import_contract_audit').insert({ contract_id: id, action: 'CONFIRMED', changed_by: az.user.id, details: { previousStatus: cur.status } });
      let importRecord: string | null = null;
      try { importRecord = (await ensureImportEntry(cdb, id, az.user.id))?.refCode ?? null; } catch (e) { logServerError('import-contracts/confirm-record', e); }
      return NextResponse.json({ success: true, importRecord });
    }

    if (
      !body.fields ||
      typeof body.fields !== 'object' ||
      Array.isArray(body.fields)
    ) {
      return NextResponse.json(
        { error: 'Contract fields are required.' },
        { status: 400 },
      );
    }

    const fields = body.fields as Record<string, unknown>;
    const materials = Array.isArray(body.materials)
      ? body.materials
      : [];

    const contractNumber = textValue(
      getField(fields, 'contractNumber', 'contract_number'),
    );

    const supplierName = textValue(
      getField(fields, 'supplierName', 'supplier_name'),
    );

    if (!contractNumber || !supplierName) {
      return NextResponse.json(
        {
          error: 'Contract number and supplier name are required.',
        },
        { status: 400 },
      );
    }

    const quantity = numberValue(
      getField(fields, 'quantity', 'quantity'),
    );

    const unitPrice = numberValue(
      getField(fields, 'unitPrice', 'unit_price'),
    );

    const totalContractValue = numberValue(
      getField(
        fields,
        'totalContractValue',
        'total_contract_value',
      ),
    );

    if (
      [quantity, unitPrice, totalContractValue].some(
        (value) => value !== null && value < 0,
      )
    ) {
      return NextResponse.json(
        {
          error:
            'Quantity, unit price, and contract value cannot be negative.',
        },
        { status: 400 },
      );
    }

    const uom = textValue(getField(fields, 'uom', 'uom'));

    if (uom && !['MT', 'KG'].includes(uom)) {
      return NextResponse.json(
        { error: 'Unit of measure must be MT or KG.' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const db = supabaseAdmin();

    // Validate and prepare every material before changing the database.
    const materialRows = materials.map(
      (item: Record<string, unknown>) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item)
        ) {
          throw new Error('Invalid material item.');
        }

        const materialUom = textValue(
          item.uom ?? item.unitOfMeasure,
        );

        if (materialUom && !['MT', 'KG'].includes(materialUom)) {
          throw new Error(
            `Unsupported material unit of measure: ${materialUom}`,
          );
        }

        const materialQuantity = numberValue(item.quantity);
        const materialUnitPrice = numberValue(
          item.unitPrice ?? item.unit_price,
        );
        const materialValue = numberValue(
          item.contractValue ??
            item.totalContractValue ??
            item.contract_value,
        );

        if (
          [materialQuantity, materialUnitPrice, materialValue].some(
            (value) => value !== null && value < 0,
          )
        ) {
          throw new Error(
            'Material quantity, unit price, and contract value cannot be negative.',
          );
        }

        return {
          material_name: textValue(
            item.materialName ??
              item.material_name ??
              item.productMaterialName ??
              item.name,
          ),
          grade_description: textValue(
            item.gradeDescription ?? item.grade_description,
          ),
          quantity: materialQuantity,
          uom: materialUom,
          unit_price: materialUnitPrice,
          currency:
            textValue(item.currency) ??
            textValue(getField(fields, 'currency', 'currency')),
          contract_value: materialValue,
          updated_at: now,
        };
      },
    );

    // Confirm the contract exists before attempting the update.
    const { data: existing, error: lookupError } = await db
      .from('import_contracts')
      .select('id, import_id, status')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (!existing) {
      return NextResponse.json(
        { error: 'Contract not found.' },
        { status: 404 },
      );
    }

    const { data: updated, error: updateError } = await db
      .from('import_contracts')
      .update({
        contract_number: contractNumber,
        contract_date: textValue(
          getField(fields, 'contractDate', 'contract_date'),
        ),
        supplier_name: supplierName,
        supplier_country: textValue(
          getField(fields, 'supplierCountry', 'supplier_country'),
        ),
        buyer_name: textValue(
          getField(fields, 'buyerName', 'buyer_name'),
        ),
        product_material_name: textValue(
          getField(
            fields,
            'productMaterialName',
            'product_material_name',
          ),
        ),
        grade_description: textValue(
          getField(
            fields,
            'gradeDescription',
            'grade_description',
          ),
        ),
        quantity,
        uom,
        unit_price: unitPrice,
        currency: textValue(
          getField(fields, 'currency', 'currency'),
        ),
        total_contract_value: totalContractValue,
        shipment_date_period: textValue(
          getField(
            fields,
            'shipmentDatePeriod',
            'shipment_date_period',
          ),
        ),
        port_of_loading: textValue(
          getField(fields, 'portOfLoading', 'port_of_loading'),
        ),
        port_of_destination: textValue(
          getField(
            fields,
            'portOfDestination',
            'port_of_destination',
          ),
        ),
        payment_terms: textValue(
          getField(fields, 'paymentTerms', 'payment_terms'),
        ),
        incoterms: textValue(
          getField(fields, 'incoterms', 'incoterms'),
        ),
        other_conditions: textValue(
          getField(fields, 'otherConditions', 'other_conditions'),
        ),
        updated_by: az.user.id,
        updated_at: now,
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError) {
      if (updateError.code === '23505') {
        return NextResponse.json(
          {
            error:
              'A contract with this supplier and contract number already exists.',
            code: 'DUPLICATE_CONTRACT',
          },
          { status: 409 },
        );
      }

      throw updateError;
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Contract not found or could not be updated.' },
        { status: 404 },
      );
    }

    // Replace the material rows with the submitted material list.
    const { error: deleteError } = await db
      .from('import_contract_materials')
      .delete()
      .eq('contract_id', id);

    if (deleteError) throw deleteError;

    if (materialRows.length > 0) {
      const rowsToInsert = materialRows.map((item: Record<string, unknown>) => ({
        ...item,
        contract_id: id,
        created_at: now,
      }));

      const { error: materialError } = await db
        .from('import_contract_materials')
        .insert(rowsToInsert);

      if (materialError) throw materialError;
    }

    const { error: auditError } = await db
      .from('import_contract_audit')
      .insert({
        contract_id: id,
        action: 'UPDATED',
        changed_by: az.user.id,
        details: {
          importId: existing.import_id,
          contractNumber,
          supplierName,
          materialsUpdated: materialRows.length,
        },
      });

    if (auditError) throw auditError;

    return NextResponse.json({
      success: true,
      message: 'Contract updated successfully.',
      contract: updated,
    });
  } catch (error) {
    logServerError('import-contracts/update', error);

    const message =
      error instanceof Error ? error.message : '';

    if (
      message.startsWith('Unsupported material unit of measure:') ||
      message ===
        'Material quantity, unit price, and contract value cannot be negative.' ||
      message === 'Invalid material item.'
    ) {
      return NextResponse.json(
        { error: message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          'Could not update contract.',
        ),
      },
      { status: 500 },
    );
  }
}
