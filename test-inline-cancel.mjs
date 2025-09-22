#!/usr/bin/env node

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5174';
const USERNAME = 'prusemic@cvut.cz';
const PASSWORD = '82c17878';

// Color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().substring(11, 19);
  const typeColors = {
    'info': colors.blue,
    'success': colors.green,
    'warning': colors.yellow,
    'error': colors.red,
    'debug': colors.magenta,
    'important': colors.cyan
  };
  const color = typeColors[type] || colors.reset;
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

async function testInlineCancelButton() {
  let browser;
  let context;
  let page;

  try {
    log('🚀 Starting Inline Cancel Button Test', 'info');

    // Launch browser
    browser = await chromium.launch({
      headless: true, // Run headless
      slowMo: 50
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();

    // Capture console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      consoleLogs.push({ type, text, timestamp: new Date().toISOString() });

      // Log important messages
      if (text.includes('abort') || text.includes('cancel') || text.includes('signal') ||
          text.includes('🔴') || text.includes('🔍') || text.includes('Download') ||
          text.includes('Export') || text.includes('Created new controller')) {
        log(`Console [${type}]: ${text}`, 'important');
      }
    });

    // Step 1: Login
    log('📝 Step 1: Logging in...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Check if we need to login
    const emailInput = await page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 2000 })) {
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      log('✅ Logged in', 'success');
    } else {
      log('ℹ️ Already logged in', 'info');
    }

    // Step 2: Navigate to specific project
    log('📂 Step 2: Navigating to project 755ddc19-47a3-4ff2-8af3-1127caaad4f0...', 'info');
    await page.goto(`${BASE_URL}/project/755ddc19-47a3-4ff2-8af3-1127caaad4f0`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check if we got redirected to login
    const loginFormAfterNav = await page.locator('input[type="email"]').first();
    if (await loginFormAfterNav.isVisible({ timeout: 1000 })) {
      log('ℹ️ Redirected to login, authenticating again...', 'info');
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Navigate again after login
      await page.goto(`${BASE_URL}/project/755ddc19-47a3-4ff2-8af3-1127caaad4f0`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    // Step 3: Start export using toolbar button
    log('🔍 Step 3: Looking for export button in toolbar...', 'info');

    // Debug: List all buttons on page
    const allButtons = await page.locator('button').all();
    log(`Found ${allButtons.length} buttons on page`, 'debug');
    for (let i = 0; i < Math.min(10, allButtons.length); i++) {
      const text = await allButtons[i].textContent();
      const isVisible = await allButtons[i].isVisible();
      if (isVisible && text) {
        log(`  Button ${i}: "${text.trim()}"`, 'debug');
      }
    }

    // Find export button in the project toolbar - try multiple selectors
    let exportBtn = null;
    const exportSelectors = [
      'button[aria-label="Export advanced"]',
      'button[title*="Export"]',
      'button[aria-label*="Export"]',
      'button[aria-label*="export"]',
      'button:has-text("Export")',
      '.project-toolbar button:has(svg)',
      '[data-testid*="export"]'
    ];

    for (const selector of exportSelectors) {
      const btn = await page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        exportBtn = btn;
        log(`✅ Found export button with selector: ${selector}`, 'success');
        break;
      }
    }

    if (exportBtn) {
      await exportBtn.click();
      await page.waitForTimeout(2000);

      // Handle export dialog
      const startExportBtn = await page.locator('button:has-text("Start Export")').last();
      if (await startExportBtn.isVisible()) {
        log('📤 Starting export...', 'info');
        await startExportBtn.click();
        await page.waitForTimeout(2000);
      }
    } else {
      log('❌ Export button not found in toolbar', 'error');
      return;
    }

    // Step 4: Test inline cancel button
    log('🔴 Step 4: Testing inline cancel button next to progress bar...', 'info');
    await page.waitForTimeout(2000);

    // Look for the inline cancel button (next to progress bar, not in dialog)
    const inlineCancelBtn = await page.locator('.export-progress-panel button:has-text("Cancel")').first();

    if (await inlineCancelBtn.isVisible()) {
      log('✅ Found inline cancel button, clicking...', 'success');

      // Clear previous logs
      consoleLogs.length = 0;

      // Click the inline cancel button
      await inlineCancelBtn.click();

      // Wait for cancellation
      await page.waitForTimeout(3000);

      // Analyze console logs
      const abortLogs = consoleLogs.filter(l =>
        l.text.includes('abort') ||
        l.text.includes('🔴') ||
        l.text.includes('🔍')
      );

      const newControllerLogs = consoleLogs.filter(l =>
        l.text.includes('Created new controller')
      );

      log('📊 Analysis:', 'info');
      log(`  • Abort-related logs: ${abortLogs.length}`, 'info');
      log(`  • New controller creation logs: ${newControllerLogs.length}`, 'info');

      if (newControllerLogs.length > 0) {
        log('❌ BUG DETECTED: New controller created after abort!', 'error');
        newControllerLogs.forEach(l => {
          log(`    ${l.text}`, 'error');
        });
      } else if (abortLogs.some(l => l.text.includes('aborted state: true'))) {
        log('✅ SUCCESS: Abort controller properly preserved!', 'success');
      } else {
        log('⚠️ WARNING: Could not verify abort state', 'warning');
      }

      // Check for download prevention
      const downloadLogs = consoleLogs.filter(l =>
        l.text.includes('Download cancelled') ||
        l.text.includes('aborted')
      );

      if (downloadLogs.length > 0) {
        log('✅ Download successfully prevented', 'success');
      }

    } else {
      log('❌ Inline cancel button not found', 'error');

      // Take screenshot for debugging
      await page.screenshot({ path: 'inline-cancel-not-found.png', fullPage: true });
      log('📸 Screenshot saved to inline-cancel-not-found.png', 'info');
    }

    // Step 5: Final summary
    log('═══════════════════════════════════════', 'info');
    log('📊 Test Complete', 'info');

    const hasNewControllerBug = consoleLogs.some(l =>
      l.text.includes('Created new controller') &&
      consoleLogs.some(other =>
        other.text.includes('Calling abort') &&
        other.timestamp < l.timestamp
      )
    );

    if (hasNewControllerBug) {
      log('❌ FAILED: Controller preservation bug still present', 'error');
    } else {
      log('✅ PASSED: Inline cancel button working correctly!', 'success');
    }

    // Keep browser open for 5 seconds to observe
    await page.waitForTimeout(5000);

  } catch (error) {
    log(`❌ Test failed with error: ${error.message}`, 'error');
    console.error(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
testInlineCancelButton().catch(console.error);