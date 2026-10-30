import type { Page } from 'playwright';
import type { NavigationStep, NavigationResult } from './types';

const DEFAULT_TIMEOUT_MS = 15000;

/** Resolves a step's selector to a Playwright Locator using role/label/text
 * — never raw coordinates. This is the one place a NavigationStep becomes an
 * actual Playwright action, so every report's navigation_steps (edited via
 * the ERP Configuration admin screen) goes through the same, auditable
 * execution path. */
function locate(page: Page, step: NavigationStep) {
  const timeout = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  switch (step.selectorType) {
    case 'role': return page.getByRole(step.roleName as any, step.selector ? { name: step.selector } : undefined);
    case 'label': return page.getByLabel(step.selector || '', { exact: false });
    case 'text': return page.getByText(step.selector || '', { exact: false });
    case 'placeholder': return page.getByPlaceholder(step.selector || '');
    case 'css':
    default: return page.locator(step.selector || '');
  }
  // eslint-disable-next-line no-unreachable
  void timeout;
}

/** Substitutes {{date}}/{{fromDate}}/{{toDate}} placeholders in a step's
 * value with the actual target date(s), formatted per dateSelectorConfig
 * (defaults to DD/MM/YYYY, the format every real ERP export title this
 * session inspected uses). */
export function resolveDateValue(value: string, targetDate: string, format = 'DD/MM/YYYY'): string {
  const [y, m, d] = targetDate.split('-');
  const formatted = format === 'YYYY-MM-DD' ? targetDate : `${d}/${m}/${y}`;
  return value.replace(/\{\{date\}\}|\{\{fromDate\}\}|\{\{toDate\}\}/g, formatted);
}

/** Captures menu/heading/button TEXT ONLY (never full HTML, never a
 * screenshot) — this is the "non-sensitive structured labels" spec section
 * 13 requires before anything is ever sent to AIX3 for recovery
 * suggestions. Capped to keep the payload small. */
async function captureVisibleLabels(page: Page): Promise<string[]> {
  try {
    const labels = await page.locator('a, button, [role="menuitem"], [role="button"], h1, h2, h3').allTextContents();
    return labels.map(l => l.trim()).filter(Boolean).slice(0, 80);
  } catch { return []; }
}

export type PageInspection = {
  url: string; heading: string | null;
  inputs: { type: string; placeholder: string | null; id: string; name: string | null; formcontrolname: string | null; ariaLabel: string | null; disabled: boolean }[];
  dropdowns: { tag: string; placeholder: string | null; id: string; ariaLabel: string | null; role: string | null }[];
  buttons: string[];
};

/** Structured field dump of the CURRENT page — every input/dropdown/button
 * with its real selector-relevant attributes, so a report's fields can be
 * mapped in one read instead of right-click-Inspect per field. Text
 * content only (labels, placeholders, ids, form control names) — never
 * full HTML, never a screenshot, never field VALUES (so nothing a user
 * might have typed into an unrelated field leaks through). */
export async function inspectPage(page: Page): Promise<PageInspection> {
  const [inputs, dropdowns, buttonsRaw, heading] = await Promise.all([
    page.locator('input:visible').evaluateAll((els: any[]) => els.map(el => ({
      type: el.type || 'text', placeholder: el.getAttribute('placeholder'), id: el.id || '',
      name: el.getAttribute('name'), formcontrolname: el.getAttribute('formcontrolname'), ariaLabel: el.getAttribute('aria-label'),
      disabled: !!el.disabled,
    }))).catch(() => []),
    page.locator('select:visible, mat-select:visible, [role="combobox"]:visible').evaluateAll((els: any[]) => els.map(el => ({
      tag: el.tagName.toLowerCase(), placeholder: el.getAttribute('placeholder'), id: el.id || '', ariaLabel: el.getAttribute('aria-label'), role: el.getAttribute('role'),
    }))).catch(() => []),
    page.locator('button:visible, [role="button"]:visible, a:visible').allTextContents().catch(() => []),
    page.locator('h1, h2, h3').first().textContent().catch(() => null),
  ]);
  const buttons = [...new Set(buttonsRaw.map(t => t.trim()).filter(Boolean))].slice(0, 60);
  return { url: page.url(), heading: heading || null, inputs, dropdowns, buttons };
}

/** Runs a NavigationStep[] against a live Playwright Page in order. Stops
 * and returns failure detail on the first step that doesn't complete within
 * its timeout — never retries silently, since a silent retry loop is
 * exactly what spec section 17 rules out ("do not use infinite retry
 * loops"). The caller (erpSync.ts) decides what NEEDS_NAVIGATION_REVIEW vs
 * FAILED means for the overall report run. */
export async function executeSteps(page: Page, steps: NavigationStep[], targetDate: string, dateFormat?: string): Promise<NavigationResult> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const timeout = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (step.action === 'goto') {
        if (!step.url) throw new Error('goto step is missing a url');
        await page.goto(step.url, { timeout, waitUntil: 'domcontentloaded' });
      } else if (step.action === 'click') {
        await locate(page, step).click({ timeout });
      } else if (step.action === 'fill' || step.action === 'setDate') {
        const raw = step.value || '';
        const value = raw.includes('{{') ? resolveDateValue(raw, targetDate, dateFormat) : raw;
        await locate(page, step).fill(value, { timeout });
      } else if (step.action === 'select') {
        // Confirmed live against the real ERP: its dropdowns (e.g. "Select
        // Format") are Angular Material mat-select components — role=
        // "combobox" backed by a listbox popup, NOT a native <select>.
        // Playwright's selectOption() only works on the latter. Try native
        // first (cheap, works for any plain HTML <select> elsewhere in the
        // app), and fall back to the open-then-click-the-option pattern
        // mat-select needs.
        const el = locate(page, step);
        try {
          await el.selectOption(step.value || '', { timeout: 3000 });
        } catch {
          await el.click({ timeout });
          await page.getByRole('option', { name: step.value || '' }).click({ timeout });
        }
      } else if (step.action === 'waitFor') {
        await locate(page, step).waitFor({ timeout });
      } else if (step.action === 'download') {
        // Confirmed live: this ERP's "Show Report" can open the generated
        // file in a NEW TAB rather than firing a download event on the
        // current page — Playwright's waitForEvent('download') only ever
        // fires on the page it's registered against, so a same-page-only
        // listener misses that case entirely. Race three outcomes: a
        // same-page download, a new tab/popup (which itself may then also
        // trigger a download shortly after opening), and give the new tab
        // a moment to fire its own download before giving up.
        const context = page.context();
        const clickPromise = locate(page, step).click({ timeout });
        const samePageDownload = page.waitForEvent('download', { timeout }).catch(() => null);
        const newPagePromise = context.waitForEvent('page', { timeout }).catch(() => null);
        await clickPromise;
        const [download, newPage] = await Promise.all([samePageDownload, newPagePromise]);
        let finalDownload = download;
        let finalPage = page;
        if (!finalDownload && newPage) {
          finalPage = newPage;
          finalDownload = await newPage.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        }
        if (!finalDownload) {
          // No download event anywhere, but a new tab DID open — that tab's
          // URL (e.g. a direct .xlsx/.pdf link, or an inline viewer) is
          // itself useful diagnostic info even though nothing was captured
          // as a Playwright "download".
          if (newPage) throw new Error(`"Show Report" opened a new tab (${newPage.url()}) but no browser download followed within 10s — it may render inline rather than downloading, or need an extra click on that page.`);
          throw new Error('"Show Report" was clicked but no download started within the timeout.');
        }
        const downloadedFileName = finalDownload.suggestedFilename();
        const downloadedFilePath = await finalDownload.path();
        const pageHeading = await finalPage.locator('h1, h2').first().textContent().catch(() => null);
        return { success: true, downloadedFilePath: downloadedFilePath || undefined, downloadedFileName, pageHeading: pageHeading || undefined };
      }
    } catch (e) {
      return {
        success: false,
        failedStepIndex: i,
        error: e instanceof Error ? e.message : String(e),
        visibleLabels: await captureVisibleLabels(page),
      };
    }
  }
  // Steps completed with no explicit 'download' step — treat as a
  // successful navigation with nothing to download (e.g. a login sequence).
  const pageHeading = await page.locator('h1, h2').first().textContent().catch(() => null);
  return { success: true, pageHeading: pageHeading || undefined };
}
