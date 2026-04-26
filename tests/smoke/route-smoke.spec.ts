/**
 * Route smoke tests — fast bundle-execution gate.
 *
 * These tests are NOT about user flows. They verify that the production
 * frontend bundle loads and the React tree mounts on each public route
 * without throwing. They are designed to run against `vite preview`
 * (built bundle) WITHOUT a real backend: API calls 401/network-fail,
 * but the bundle itself must not crash.
 *
 * Catches the class of regression where a tree-shaken / minified
 * bundle silently loses a method (e.g. PR #128: `R.getProjectImages is
 * not a function`) — those don't show up in tsc but kill the page on
 * load.
 *
 * Runtime budget: ~30s for the whole file in CI. Keep it fast.
 */
import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

// Routes that must mount cleanly. Auth-gated routes will redirect to
// /sign-in (which is fine — that's a successful render, not a crash).
const ROUTES = [
  '/',
  '/sign-in',
  '/sign-up',
  '/dashboard',
  '/profile',
  '/settings',
];

/** Console messages we ignore — expected fetch failures from the
 * absent backend, dev-mode warnings, third-party noise. */
const IGNORE_PATTERNS: RegExp[] = [
  // Expected: API calls fail with 401/Network Error when smoke-test
  // runs without a backend. These are not bundle bugs.
  /Failed to load resource/i,
  /401 \(Unauthorized\)/,
  /Network Error/,
  /ERR_CONNECTION_REFUSED/,
  /ERR_FAILED/,
  /AxiosError/,
  /\[axios\]/i,
  // React DevTools recommendation in dev — irrelevant for smoke.
  /Download the React DevTools/,
  // i18next missing-key warnings should fail loudly in unit tests; in
  // a smoke we only care about catastrophic crashes.
  /i18next::translator/,
];

function capturePageErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORE_PATTERNS.some(re => re.test(text))) return;
    errors.push(`[console.error] ${text}`);
  });
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.name}: ${err.message}`);
  });
  return { errors };
}

for (const route of ROUTES) {
  test(`mounts without bundle errors: ${route}`, async ({ page }) => {
    const { errors } = capturePageErrors(page);

    // Block all network requests to /api/** so the bundle's runtime
    // doesn't sit in retry loops and doesn't depend on a backend.
    await page.route('**/api/**', route => route.abort());

    const response = await page.goto(route, { waitUntil: 'load' });
    expect(response, `navigation to ${route} must succeed`).not.toBeNull();
    expect(response!.status(), `${route} returned non-OK`).toBeLessThan(500);

    // Allow any deferred React effects / lazy chunks to mount.
    // (waitForLoadState 'networkidle' is the default-ish "page is settled".)
    await page.waitForLoadState('networkidle', { timeout: 5_000 });

    // Page must show *something* — empty body suggests the React tree
    // failed to render even if no console error fired. (Some bundle
    // bugs swallow themselves silently.)
    const bodyText = await page.locator('body').textContent();
    expect(
      bodyText?.trim().length ?? 0,
      `${route} body is empty`
    ).toBeGreaterThan(0);

    // Critical assertion: no real console errors / page exceptions.
    expect(errors, `bundle errors on ${route}:\n${errors.join('\n')}`).toEqual(
      []
    );
  });
}
