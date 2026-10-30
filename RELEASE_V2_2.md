# SVMA Intelligent Operations V2.2 — Modern E2E UAT

This package implements the V2.2 navigation, Finance reconciliation corrections, Solvent management intelligence, Safety & Parameter Input operator workspace, role-aware access, Super Admin configuration, and Powered by AIX3 branding.

For an existing V2.1 database, run `sql/000_RUN_THIS_NOW_V2_2.sql` once before UAT.

Copy `.env.example` to `.env.local`, add your existing environment values, then run:

```cmd
npm install
npm run build
npm start
```
