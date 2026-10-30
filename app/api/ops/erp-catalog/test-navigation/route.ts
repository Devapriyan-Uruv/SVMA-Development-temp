import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES, OPS_ERP_PUSH_ROLES } from '@/lib/authorize';
import { currentUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { chromium } from 'playwright';
import { executeSteps } from '@/lib/ops/erpNavigator/executeSteps';
import type { NavigationStep } from '@/lib/ops/erpNavigator/types';
import { istYesterdayDate } from '@/lib/time';

export const runtime = 'nodejs';
// Confirmed live: this ERP's report generation is genuinely slow — a
// single "Show Report" click can take well over a minute before the
// download starts. This route awaits the whole navigation synchronously
// (unlike the real push, which runs in the background), so it needs
// enough headroom for that, on top of whatever timeoutMs an individual
// step sets.
export const maxDuration = 180;

/** Test Navigation — the primary tool for turning an empty navigation
 * config into a real, VERIFIED one, since I cannot log into the live ERP
 * myself. Runs ONE draft NavigationStep[] (not necessarily saved yet)
 * through a fresh, single-report Playwright session — logging in first
 * using whatever __LOGIN__ config is currently active, unless the report
 * being tested IS the login sequence itself. Returns detailed step-by-step
 * failure info (which step, what was visible) so the admin can iterate.
 * Never part of a full sync run — this never touches ops_erp_sync_runs. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    if (!OPS_ERP_PUSH_ROLES.some(r => az.roles?.includes(r))) return NextResponse.json({ error: 'Only Operations admins can test ERP navigation.' }, { status: 403 });

    const body = await req.json();
    const reportCatalogId = String(body.reportCatalogId || '');
    const navigationSteps = Array.isArray(body.navigationSteps) ? body.navigationSteps as NavigationStep[] : null;
    const dateSelectorConfig = body.dateSelectorConfig || {};
    const promote = Boolean(body.promote);
    if (!reportCatalogId) return NextResponse.json({ error: 'A reportCatalogId is required.' }, { status: 400 });

    const db = supabaseAdmin();
    const { data: catalog } = await db.from('ops_erp_report_catalog').select('id,report_code,report_name').eq('id', reportCatalogId).maybeSingle();
    if (!catalog) return NextResponse.json({ error: 'Unknown report.' }, { status: 404 });
    const isLoginTest = (catalog as any).report_code === '__LOGIN__';

    let steps = navigationSteps;
    if (!steps) {
      const { data: activeNav } = await db.from('ops_erp_report_navigation').select('navigation_steps').eq('report_catalog_id', reportCatalogId).eq('active', true).maybeSingle();
      steps = ((activeNav as any)?.navigation_steps || []) as NavigationStep[];
    }
    if (!steps.length) return NextResponse.json({ error: 'No navigation steps to test yet — add some first.' }, { status: 400 });

    const baseUrl = process.env.SVMA_ERP_BASE_URL;
    const username = process.env.SVMA_ERP_USERNAME;
    const password = process.env.SVMA_ERP_PASSWORD;
    if (!baseUrl || !username || !password) return NextResponse.json({ error: 'SVMA ERP credentials are not configured on the server.' }, { status: 500 });
    const substitute = (s: NavigationStep) => ({ ...s, url: s.url?.replace('{{baseUrl}}', baseUrl), value: s.value === '{{username}}' ? username : s.value === '{{password}}' ? password : s.value });

    const browser = await chromium.launch({ headless: true });
    let result;
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      if (!isLoginTest) {
        const { data: loginCatalog } = await db.from('ops_erp_report_catalog').select('id').eq('report_code', '__LOGIN__').maybeSingle();
        const { data: loginNav } = loginCatalog ? await db.from('ops_erp_report_navigation').select('navigation_steps').eq('report_catalog_id', (loginCatalog as any).id).eq('active', true).maybeSingle() : { data: null };
        const loginSteps = ((loginNav as any)?.navigation_steps || []) as NavigationStep[];
        if (!loginSteps.length) { await browser.close(); return NextResponse.json({ error: 'ERP login is not configured/tested yet — test the login sequence first.' }, { status: 400 }); }
        const loginResult = await executeSteps(page, loginSteps.map(substitute), '');
        if (!loginResult.success) { await browser.close(); return NextResponse.json({ error: `Login failed at step ${loginResult.failedStepIndex}: ${loginResult.error}`, visibleLabels: loginResult.visibleLabels }, { status: 200 }); }
      }
      result = await executeSteps(page, steps.map(substitute), istYesterdayDate(), dateSelectorConfig.dateFormat);
    } finally {
      await browser.close().catch(() => {});
    }

    if (result.success) {
      const user = await currentUser();
      await db.from('ops_erp_report_navigation').update({ active: false }).eq('report_catalog_id', reportCatalogId).eq('active', true);
      await db.from('ops_erp_report_navigation').insert({
        report_catalog_id: reportCatalogId, navigation_steps: steps, date_selector_config: dateSelectorConfig,
        expected_page_heading: result.pageHeading || null, status: promote ? 'VERIFIED' : 'TESTED', active: true,
        verified_at: promote ? new Date().toISOString() : null, verified_by: promote ? user?.id || null : null,
      });
    }
    return NextResponse.json({ ...result, reportCode: (catalog as any).report_code, reportName: (catalog as any).report_name });
  } catch (e) {
    logServerError('ops/erp-catalog/test-navigation', e);
    return NextResponse.json({ error: errorMessage(e, 'Navigation test failed.') }, { status: 500 });
  }
}
