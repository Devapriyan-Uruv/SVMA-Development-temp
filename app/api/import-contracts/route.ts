
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  moduleAuthorization,
  moduleEditAuthorization,
  IMPORT_VIEW_ROLES,
  IMPORT_EDIT_ROLES,
} from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  errorMessage,
  logServerError,
} from '@/lib/errors';
import { ensureImportEntry } from '@/lib/importMaster/fromContract';

export const runtime = 'nodejs';

// Contracts live under the existing Import module (same access, same roles) — no separate module key.
const MODULE_KEY = 'import';

const ALLOWED_STATUSES = [
  'Draft',
  'Pending Review',
  'Confirmed',
] as const;

const ALLOWED_SORT_COLUMNS = [
  'created_at',
  'updated_at',
  'contract_date',
  'contract_number',
  'supplier_name',
  'total_contract_value',
  'status',
] as const;

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const valueText = String(value).trim();
  return valueText === '' ? null : valueText;
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

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization(
      MODULE_KEY,
      IMPORT_VIEW_ROLES,
    );

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'Import Contract Portal access is required.',
        },
        { status: az.status },
      );
    }

    const params = req.nextUrl.searchParams;

    const page = Math.max(
      1,
      Number.parseInt(params.get('page') || '1', 10) || 1,
    );

    const pageSize = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(params.get('pageSize') || '20', 10) || 20,
      ),
    );

    const search = (params.get('search') || '')
      .trim()
      .slice(0, 100);

    const status = params.get('status') || '';
    const sortBy = params.get('sortBy') || 'created_at';
    const sortOrder = params.get('sortOrder') === 'asc';

    if (
      status &&
      !ALLOWED_STATUSES.includes(
        status as (typeof ALLOWED_STATUSES)[number],
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid contract status.' },
        { status: 400 },
      );
    }

    if (
      !ALLOWED_SORT_COLUMNS.includes(
        sortBy as (typeof ALLOWED_SORT_COLUMNS)[number],
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid sort column.' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    let query = db
      .from('import_contracts')
      .select('*', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    // Remove characters that could alter PostgREST filter syntax.
    const safeSearch = search.replace(/[\\%_,().]/g, '');

    if (safeSearch) {
      query = query.or(
        `contract_number.ilike.%${safeSearch}%,` +
          `supplier_name.ilike.%${safeSearch}%,` +
          `product_material_name.ilike.%${safeSearch}%,` +
          `import_id.ilike.%${safeSearch}%`,
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await query
      .order(sortBy, { ascending: sortOrder })
      .range(from, to);

    if (error) throw error;

    const total = count ?? 0;

    // The edit screen saves by replacing a contract's material lines, so the list must carry them (and the audit trail) —
    // otherwise saving an edit would wipe the materials.
    const ids = (data ?? []).map((row: any) => row.id);
    const [materialRes, auditRes] = ids.length
      ? await Promise.all([
          db.from('import_contract_materials').select('*').in('contract_id', ids).order('created_at', { ascending: true }),
          db.from('import_contract_audit').select('contract_id,action,changed_by,changed_at').in('contract_id', ids).order('changed_at', { ascending: false }),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
    const materialsBy = new Map<string, any[]>();
    for (const m of materialRes.data ?? []) (materialsBy.get(m.contract_id) ?? materialsBy.set(m.contract_id, []).get(m.contract_id)!).push(m);
    const historyBy = new Map<string, any[]>();
    for (const a of auditRes.data ?? []) (historyBy.get(a.contract_id) ?? historyBy.set(a.contract_id, []).get(a.contract_id)!).push(a);

    
const contracts = (data ?? []).map((row: any) => ({
    id: String(row.id),
    importId: row.import_id ?? "",
    status: row.status ?? "Pending Review",

    fields: {
        contractNumber: row.contract_number ?? "",
        contractDate: row.contract_date ?? "",
        supplierName: row.supplier_name ?? "",
        supplierCountry: row.supplier_country ?? "",
        buyerName: row.buyer_name ?? "",
        productMaterialName: row.product_material_name ?? "",
        gradeDescription: row.grade_description ?? "",
        quantity: row.quantity == null ? "" : String(row.quantity),
        uom: row.uom ?? "",
        unitPrice: row.unit_price == null ? "" : String(row.unit_price),
        currency: row.currency ?? "",
        totalContractValue:
            row.total_contract_value == null
                ? ""
                : String(row.total_contract_value),
        shipmentDatePeriod: row.shipment_date_period ?? "",
        portOfLoading: row.port_of_loading ?? "",
        portOfDestination: row.port_of_destination ?? "",
        paymentTerms: row.payment_terms ?? "",
        incoterms: row.incoterms ?? "",
        otherConditions: row.other_conditions ?? "",
    },

    // Map the fields used by the existing frontend.
    documentName: row.original_file_name ?? "",
    documentPath: row.storage_path ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",

    warnings: row.warnings ?? [],
    missingFields: row.missing_fields ?? [],
    uncertainFields: row.uncertain_fields ?? [],
    materials: (materialsBy.get(row.id) ?? []).map((m: any) => ({
        materialName: m.material_name ?? "",
        gradeDescription: m.grade_description ?? "",
        quantity: m.quantity == null ? "" : String(m.quantity),
        uom: m.uom ?? "",
        unitPrice: m.unit_price == null ? "" : String(m.unit_price),
        currency: m.currency ?? "",
        contractValue: m.contract_value == null ? "" : String(m.contract_value),
    })),
    history: (historyBy.get(row.id) ?? []).map((a: any) => ({ action: a.action, by: a.changed_by ?? undefined, at: a.changed_at })),
}));

return NextResponse.json({
    contracts,
    pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    },
});

  } catch (e) {
    logServerError('import-contracts/list', e);

    return NextResponse.json(
      {
        error: errorMessage(
          e,
          'Unable to load import contracts.',
        ),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let createdContractId: string | null = null;

  try {
    // Confirmation requires edit permission for the new module.
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
              : 'You do not have permission to create import contracts.',
        },
        { status: az.status },
      );
    }

    const body = await req.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Invalid contract request body.' },
        { status: 400 },
      );
    }

    // The UI sends fields nested inside the contract object.
    const fields =
      body.fields &&
      typeof body.fields === 'object' &&
      !Array.isArray(body.fields)
        ? body.fields as Record<string, unknown>
        : body as Record<string, unknown>;

    const materials = Array.isArray(body.materials)
      ? body.materials
      : [];

    const confirm = body.confirm === true;

    const contractNumber = textValue(
      getField(fields, 'contractNumber', 'contract_number'),
    );

    const supplierName = textValue(
      getField(fields, 'supplierName', 'supplier_name'),
    );

    if (!contractNumber || !supplierName) {
      return NextResponse.json(
        {
          error:
            'Contract number and supplier name are required. Please review the fields before confirming.',
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
      getField(fields, 'totalContractValue', 'total_contract_value'),
    );

    if (
      (quantity !== null && quantity < 0) ||
      (unitPrice !== null && unitPrice < 0) ||
      (totalContractValue !== null && totalContractValue < 0)
    ) {
      return NextResponse.json(
        { error: 'Quantity, unit price, and total contract value cannot be negative.' },
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

    const db = supabaseAdmin();

    // Do not infer a contractual total from quantity × unit price.
    // A missing stated total is allowed; its validation warning is preserved.
    const now = new Date().toISOString();
    const importId = `IMP-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')}-${randomUUID()
      .replace(/-/g, '')
      .slice(0, 8)
      .toUpperCase()}`;

    const contractRow = {
      import_id: importId,
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
        getField(fields, 'productMaterialName', 'product_material_name'),
      ),
      grade_description: textValue(
        getField(fields, 'gradeDescription', 'grade_description'),
      ),
      quantity,
      uom,
      unit_price: unitPrice,
      currency: textValue(getField(fields, 'currency', 'currency')),
      total_contract_value: totalContractValue,
      shipment_date_period: textValue(
        getField(fields, 'shipmentDatePeriod', 'shipment_date_period'),
      ),
      port_of_loading: textValue(
        getField(fields, 'portOfLoading', 'port_of_loading'),
      ),
      port_of_destination: textValue(
        getField(fields, 'portOfDestination', 'port_of_destination'),
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
      status: confirm ? 'Confirmed' : 'Pending Review',
      original_file_name:
        textValue(body.originalFileName) ??
        textValue(body.fileName) ??
        textValue(body.original_file_name),
      storage_path:
        textValue(body.documentPath) ??
        textValue(body.storagePath) ??
        textValue(body.storage_path),
      warnings: jsonArray(body.warnings),
      missing_fields:
        body.missingFields ??
        body.missing_fields ??
        [],
      uncertain_fields:
        body.uncertainFields ??
        body.uncertain_fields ??
        [],
      created_by: az.user.id,
      updated_by: az.user.id,
      created_at: now,
      updated_at: now,
    };

    const { data: created, error: insertError } = await db
      .from('import_contracts')
      .insert(contractRow)
      .select('*')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          {
            error:
              'A contract with this supplier and contract number already exists.',
            code: 'DUPLICATE_CONTRACT',
          },
          { status: 409 },
        );
      }

      throw insertError;
    }

    createdContractId = created.id;

    // Save material line items associated with the new contract.
    if (materials.length > 0) {
      const materialRows = materials.map(
        (item: Record<string, unknown>) => {
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
            (materialQuantity !== null && materialQuantity < 0) ||
            (materialUnitPrice !== null && materialUnitPrice < 0) ||
            (materialValue !== null && materialValue < 0)
          ) {
            throw new Error(
              'Material quantity, unit price, and contract value cannot be negative.',
            );
          }

          return {
            contract_id: created.id,
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
            currency: textValue(item.currency) ??
              contractRow.currency,
            contract_value: materialValue,
            created_at: now,
            updated_at: now,
          };
        },
      );

      const { error: materialError } = await db
        .from('import_contract_materials')
        .insert(materialRows);

      if (materialError) throw materialError;
    }

    // Record who created/confirmed the contract.
    const { error: auditError } = await db
      .from('import_contract_audit')
      .insert({
        contract_id: created.id,
        action: confirm ? 'CONFIRMED' : 'CREATED',
        changed_by: az.user.id,
        details: {
          importId,
          contractNumber,
          supplierName,
          status: contractRow.status,
          warnings: contractRow.warnings,
          totalContractValueStated:
            totalContractValue !== null,
        },
      });

    if (auditError) throw auditError;

    // A confirmed contract becomes an Import record straight away (never blocks the confirmation if that step fails).
    let importRecord: string | null = null;
    if (confirm) { try { importRecord = (await ensureImportEntry(db, created.id, az.user.id))?.refCode ?? null; } catch (e) { logServerError('import-contracts/create-record', e); } }

    return NextResponse.json(
      {
        success: true,
        message: confirm
          ? 'Contract confirmed successfully.'
          : 'Contract saved for review.',
        contract: created,
        importId,
        importRecord,
      },
      { status: 201 },
    );
  } catch (e) {
    logServerError('import-contracts/create', e);

    // Best-effort cleanup if a related insert failed after the contract
    // row was created. The foreign-key cascade removes dependent rows.
    if (createdContractId) {
      try {
        const db = supabaseAdmin();
        await db
          .from('import_contracts')
          .delete()
          .eq('id', createdContractId);
      } catch (cleanupError) {
        logServerError(
          'import-contracts/create-cleanup',
          cleanupError,
        );
      }
    }

    return NextResponse.json(
      {
        error: errorMessage(
          e,
          'Could not confirm this contract.',
        ),
      },
      { status: 500 },
    );
  }
}
