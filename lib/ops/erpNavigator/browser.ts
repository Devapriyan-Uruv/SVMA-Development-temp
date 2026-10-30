import { chromium, type Page } from 'playwright';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { executeSteps } from './executeSteps';
import type { NavigationResult, NavigationStep } from './types';

/** Signs in again and lands on the ERP home page. The ERP is a single-page app that drops
 * its session on any full reload and has no deep links, so every report's steps start
 * from the home page — a report that navigated away has to be followed by this. */
export type ErpRelogin = () => Promise<NavigationResult>;

/** One ERP session per push (spec section 17) — login once, reuse the same
 * authenticated context for every report, close on the way out regardless
 * of success/failure. Credentials come from process.env only, are
 * substituted into the stored login navigation_steps at the last possible
 * moment, and never appear in a thrown error, a log line, or anything
 * persisted to the database — only step index + a generic message ever
 * reach ops_erp_sync_report_runs.error_message. */
export async function withErpSession<T>(fn: (page: Page, relogin: ErpRelogin) => Promise<T>): Promise<T> {
  const baseUrl = process.env.SVMA_ERP_BASE_URL;
  const username = process.env.SVMA_ERP_USERNAME;
  const password = process.env.SVMA_ERP_PASSWORD;
  if (!baseUrl || !username || !password) throw new Error('SVMA ERP credentials are not configured (SVMA_ERP_BASE_URL / SVMA_ERP_USERNAME / SVMA_ERP_PASSWORD).');

  const db = supabaseAdmin();
  const { data: loginCatalog } = await db.from('ops_erp_report_catalog').select('id').eq('report_code', '__LOGIN__').maybeSingle();
  const { data: loginNav } = loginCatalog ? await db.from('ops_erp_report_navigation').select('navigation_steps,status').eq('report_catalog_id', (loginCatalog as any).id).eq('active', true).maybeSingle() : { data: null };
  const rawSteps = ((loginNav as any)?.navigation_steps || []) as NavigationStep[];
  if (!rawSteps.length) throw new Error('ERP login navigation is not configured yet — use "Test Navigation" in ERP Configuration to set it up.');

  // Credential substitution happens here, in memory, immediately before use
  // — never written back to navigation_steps, never logged.
  const steps: NavigationStep[] = rawSteps.map(s => ({
    ...s,
    url: s.url?.replace('{{baseUrl}}', baseUrl),
    value: s.value === '{{username}}' ? username : s.value === '{{password}}' ? password : s.value,
  }));

  // The browser lives in node_modules (PLAYWRIGHT_BROWSERS_PATH=0 in package.json's
  // postinstall/start/dev scripts), because Render doesn't carry the OS cache from
  // build to runtime. Playwright reads that variable once when it is imported, so it
  // must be set when the process starts — assigning it here would be too late.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const loginResult = await executeSteps(page, steps, '');
    if (!loginResult.success) throw new Error(`ERP login failed at step ${loginResult.failedStepIndex}: ${loginResult.error}`);
    const relogin: ErpRelogin = () => executeSteps(page, steps, '');
    return await fn(page, relogin);
  } finally {
    await browser.close().catch(() => {});
  }
}
