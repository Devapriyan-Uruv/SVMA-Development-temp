# SVMA AI Intelligence Platform V2.4

This release restructures the platform around role-based business modules while preserving the existing Finance reconciliation logic from V2.3.1.

## Modules
- CEO Cockpit
- Solvent Production & Safety
- Quality Intelligence
- Finance
- Solvent Parameter Input
- Quality Data Entry
- Administration

## V2.4 additions
- Product-aware Solvent and Quality shifts for Rice Bran, Copra and Palm Kernel.
- Separate Solvent and Quality operator workspaces.
- Separate Solvent Head and Quality Head intelligence/analytics views.
- Consolidated CEO intelligence from Solvent + Quality.
- Immediate target validation, deviations, notifications and action tickets.
- Timeline and critical-parameter analytics.
- Quality sampling frequency and result-latency configuration.
- Modern module-card navigation and refreshed dashboard visual language.
- Powered by AIX3 branding.
- Mobile/web responsive structure designed for future module expansion.

## Finance
Finance reconciliation logic is intentionally unchanged from V2.3.1.

## Upgrade
For an existing V2.3/V2.3.1 database run once:

`sql/000_RUN_THIS_NOW_V2_4.sql`

Then copy the existing `.env.local` and run:

```cmd
npm install
npm run verify
npm start
```

## Validation note
The source was checked for TypeScript/TSX parse errors before packaging. The build environment used for packaging could not complete dependency installation, so the full Next.js production build should still be run locally with `npm run verify` after `npm install`.
