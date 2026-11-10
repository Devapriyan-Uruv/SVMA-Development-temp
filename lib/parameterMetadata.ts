import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Metadata used to render historical parameter readings.
 * Active definitions win; archived definitions fill IDs no longer in the
 * active master. Section metadata is fetched separately so this does not
 * depend on PostgREST foreign-key relationships to parameter_master.
 */
export type ResolvedParameterMetadata = Record<string, any> & {
  id: number;
  parameter_sections?: { id: number; name: string; module: string; sort_order?: number | null } | null;
};

export async function resolveParameterMetadata(
  db: SupabaseClient,
  parameterIds: Array<number | string | null | undefined>,
): Promise<Map<number, ResolvedParameterMetadata>> {
  const ids = [...new Set(parameterIds
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (!ids.length) return new Map();

  const [activeResult, archiveResult] = await Promise.all([
    db.from('parameter_master').select('*').in('id', ids),
    db.from('parameter_master_archive').select('*').in('id', ids),
  ]);
  if (activeResult.error) throw activeResult.error;
  if (archiveResult.error) throw archiveResult.error;

  const byId = new Map<number, ResolvedParameterMetadata>();
  for (const row of archiveResult.data || []) {
    byId.set(Number(row.id), row as ResolvedParameterMetadata);
  }
  // The active master is authoritative if an ID exists in both places.
  for (const row of activeResult.data || []) {
    byId.set(Number(row.id), row as ResolvedParameterMetadata);
  }

  const sectionIds = [...new Set([...byId.values()]
    .map((row) => Number(row.section_id))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  const sectionsResult = sectionIds.length
    ? await db.from('parameter_sections')
        .select('id,name,module,sort_order')
        .in('id', sectionIds)
    : { data: [], error: null };
  if (sectionsResult.error) throw sectionsResult.error;

  const sections = new Map<number, any>();
  for (const section of sectionsResult.data || []) sections.set(Number(section.id), section);
  for (const [id, row] of byId) {
    byId.set(id, {
      ...row,
      parameter_sections: sections.get(Number(row.section_id)) || null,
    });
  }
  return byId;
}
