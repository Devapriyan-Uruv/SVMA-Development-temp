# SVMA V5 SQL execution order

## Existing database already on V4

Run exactly one file in Supabase SQL Editor:

`sql/000_RUN_THIS_NOW_V5.sql`

It contains the full V5 additive migration and is directly pasteable into Supabase SQL Editor. It does not rely on the psql-only `\\i` command.

After it completes, check:

```sql
select * from public.data_entry_target_gaps order by module, source_group, source_serial;
```

Any returned row is retained for audit/configuration but is intentionally inactive for live data entry until a business-approved target is entered in Administration -> Parameters & Targets and the parameter is re-activated.

## Brand-new database

Apply the base schema/seed and additive migrations in order:

1. `sql/001_schema.sql`
2. `sql/002_seed.sql`
3. `sql/005_v2_parameter_expansion.sql`
4. `sql/006_source_target_validation.sql`
5. `sql/007_v2_2_module_access.sql`
6. `sql/008_v2_3_quality_exact_source.sql`
7. `sql/009_v2_4_product_intelligence.sql`
8. `sql/010_v3_operational_intelligence.sql`
9. `sql/011_v3_quality_full_import.sql`
10. `sql/012_v4_quality_report_realign.sql`
11. `sql/013_v5_industrial_glass_finance_quality.sql`

Then create the first Supabase Auth user and apply `sql/003_first_admin.sql` after replacing the placeholder user/email as documented inside that file.

`sql/004_upgrade_from_v1.sql` is an upgrade path for an older V1 database and is not part of the clean fresh-database path above.
