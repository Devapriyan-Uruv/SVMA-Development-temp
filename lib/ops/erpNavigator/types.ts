// Declarative, JSON-serializable navigation steps — stored in
// ops_erp_report_navigation.navigation_steps and edited via the ERP
// Configuration admin screen, never hardcoded per-report logic in code.
// Deliberately restricted to role/label/text selectors (Playwright's
// getByRole/getByLabel/getByText) — never raw x/y coordinates, per the
// "avoid brittle clicking" requirement.

export type SelectorType = 'role' | 'label' | 'text' | 'css' | 'placeholder';

export type NavigationStep = {
  action: 'goto' | 'click' | 'fill' | 'select' | 'waitFor' | 'setDate' | 'download';
  selectorType?: SelectorType;
  selector?: string;          // css selector, or text/label to match
  roleName?: string;          // for selectorType 'role': the ARIA role, e.g. 'button','link','textbox'
  value?: string;             // for fill/select: literal value, or '{{date}}'/'{{fromDate}}'/'{{toDate}}' placeholders
  url?: string;                // for 'goto'
  timeoutMs?: number;
  description?: string;        // human-readable note shown in Test Navigation results
};

export type DateSelectorConfig = {
  fromFieldSelectorType?: SelectorType;
  fromFieldSelector?: string;
  toFieldSelectorType?: SelectorType;
  toFieldSelector?: string;
  dateFormat?: string;         // e.g. 'DD/MM/YYYY' — how the target date string must be typed
};

export type ExportConfig = {
  triggerStep?: NavigationStep;   // the click that produces/starts the download
  expectedExtension?: string;      // 'xlsx' | 'pdf'
};

export type NavigationResult = {
  success: boolean;
  downloadedFilePath?: string;
  downloadedFileName?: string;
  pageHeading?: string;
  visibleLabels?: string[];        // menu/heading/button text captured on failure — never full HTML/screenshots
  failedStepIndex?: number;
  error?: string;
};

export type ErpDateFilterType = 'SINGLE_DATE' | 'FROM_TO' | 'AS_ON_DATE' | 'FINANCIAL_YEAR_AND_DATE' | 'NO_DATE';
