import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES, OPS_ERP_PUSH_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { chromium } from 'playwright';
import { executeSteps, inspectPage } from '@/lib/ops/erpNavigator/executeSteps';
import type { NavigationStep } from '@/lib/ops/erpNavigator/types';
import { istYesterdayDate } from '@/lib/time';

export const runtime = 'nodejs';
export const maxDuration = 180;

/** Inspect Page — logs in server-side (same sanctioned credential path as
 * Test Navigation and every real push), runs the DRAFT navigation_steps
 * given (everything up to whatever point you want to look at — no
 * 'download' step needed), and dumps every input/dropdown/button visible
 * on the resulting page: placeholders, ids, formcontrolnames, aria-labels.
 * This is how a report's real field selectors get discovered without
 * manual right-click-Inspect per field, and without anyone but the server
 * ever touching the ERP password. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    if (!OPS_ERP_PUSH_ROLES.some(r => az.roles?.includes(r))) return NextResponse.json({ error: 'Only Operations admins can inspect ERP pages.' }, { status: 403 });

    const body = await req.json();
    const navigationSteps = Array.isArray(body.navigationSteps) ? body.navigationSteps as NavigationStep[] : [];
    if (!navigationSteps.length) return NextResponse.json({ error: 'Add at least a step to reach the page you want to inspect.' }, { status: 400 });

    const baseUrl = process.env.SVMA_ERP_BASE_URL;
    const username = process.env.SVMA_ERP_USERNAME;
    const password = process.env.SVMA_ERP_PASSWORD;
    if (!baseUrl || !username || !password) return NextResponse.json({ error: 'SVMA ERP credentials are not configured on the server.' }, { status: 500 });
    const substitute = (s: NavigationStep) => ({ ...s, url: s.url?.replace('{{baseUrl}}', baseUrl), value: s.value === '{{username}}' ? username : s.value === '{{password}}' ? password : s.value });

    const db = supabaseAdmin();
    const { data: loginCatalog } = await db.from('ops_erp_report_catalog').select('id').eq('report_code', '__LOGIN__').maybeSingle();
    const { data: loginNav } = loginCatalog ? await db.from('ops_erp_report_navigation').select('navigation_steps').eq('report_catalog_id', (loginCatalog as any).id).eq('active', true).maybeSingle() : { data: null };
    const loginSteps = ((loginNav as any)?.navigation_steps || []) as NavigationStep[];
    if (!loginSteps.length) return NextResponse.json({ error: 'ERP login is not configured/verified yet — set that up first.' }, { status: 400 });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      const loginResult = await executeSteps(page, loginSteps.map(substitute), '');
      if (!loginResult.success) return NextResponse.json({ error: `Login failed at step ${loginResult.failedStepIndex}: ${loginResult.error}`, visibleLabels: loginResult.visibleLabels });

      const navResult = await executeSteps(page, navigationSteps.map(substitute), istYesterdayDate(), body.dateFormat);
      if (!navResult.success) return NextResponse.json({ error: `Failed reaching the target page at step ${navResult.failedStepIndex}: ${navResult.error}`, visibleLabels: navResult.visibleLabels });

      const inspection = await inspectPage(page);
      return NextResponse.json({ success: true, inspection });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    logServerError('ops/erp-catalog/inspect-page', e);
    return NextResponse.json({ error: errorMessage(e, 'Page inspection failed.') }, { status: 500 });
  }
}
