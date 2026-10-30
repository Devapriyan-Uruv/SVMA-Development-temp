# SVMA AI Intelligence Platform V2.4.2

Runtime + visual stabilization patch on top of V2.4.1.

## Fixed
- Restored the complete V2.4 SaaS design layer that was missing from `globals.css`.
- `/api/me` no longer hard-fails just because the service-role key is unavailable for read-only session bootstrap; it falls back to the authenticated Supabase client.
- Added visible access/session diagnostics instead of silently showing zero workspaces.
- Solvent and Quality dashboards now handle failed API payloads safely instead of throwing on missing dashboard objects.
- Preserves the V2.4.1 TypeScript fixes for ProductCode and AI inference lookups.
- Finance reconciliation source files and logic are unchanged.

## Important
The full Admin user-creation workflow still requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The fallback only makes ordinary session/module reads resilient.
