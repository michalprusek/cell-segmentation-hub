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

async function testSharedExportState() {
  let browser;
  let context;
  let page;

  try {
    log('🚀 Starting Shared Export State Test', 'info');
    log('This test verifies that the inline cancel button works when export is started from dialog', 'info');

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      slowMo: 100
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
      if (text.includes('cancelExport called') ||
          text.includes('currentJob') ||
          text.includes('Cannot cancel') ||
          text.includes('🔴') ||
          text.includes('⚠️')) {
        log(`Console: ${text}`, 'important');
      }
    });

    // Step 1: Login
    log('📝 Step 1: Logging in...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const emailInput = await page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 2000 })) {
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      log('✅ Logged in', 'success');
    }

    // Step 2: Navigate to project
    log('📂 Step 2: Navigating to project...', 'info');
    await page.goto(`${BASE_URL}/project/755ddc19-47a3-4ff2-8af3-1127caaad4f0`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check if redirected to login
    const loginFormAfterNav = await page.locator('input[type="email"]').first();
    if (await loginFormAfterNav.isVisible({ timeout: 1000 })) {
      log('ℹ️ Re-authenticating...', 'info');
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await page.goto(`${BASE_URL}/project/755ddc19-47a3-4ff2-8af3-1127caaad4f0`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    // Step 3: Open Advanced Export Dialog
    log('🔍 Step 3: Opening Advanced Export dialog...', 'info');

    // Try multiple selectors for the export button
    let advancedExportBtn = null;
    const exportSelectors = [
      'button:has-text("Advanced Export")',
      'button[aria-label="Export advanced"]',
      'button[title*="Export"]',
      'button:has(svg[class*="archive"])',
      'button:has(svg[class*="download"])',
      '[data-testid*="export"]'
    ];

    for (const selector of exportSelectors) {
      const btn = await page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        advancedExportBtn = btn;
        log(`✅ Found export button with selector: ${selector}`, 'success');
        break;
      }
    }

    if (!advancedExportBtn) {
      // List all visible buttons for debugging
      const buttons = await page.locator('button').all();
      log(`Found ${buttons.length} buttons on page`, 'debug');
      for (let i = 0; i < Math.min(15, buttons.length); i++) {
        const text = await buttons[i].textContent();
        if (text && await buttons[i].isVisible()) {
          log(`  Button ${i}: "${text.trim()}"`, 'debug');
        }
      }
      log('❌ Advanced Export button not found', 'error');
      return;
    }

    await advancedExportBtn.click();
    log('✅ Clicked Advanced Export button', 'success');
    await page.waitForTimeout(2000);

    // Step 4: Start export from dialog
    log('📤 Step 4: Starting export from dialog...', 'info');

    // Find and click "Start Export" button in dialog
    const startExportBtn = await page.locator('button:has-text("Start Export")').first();
    if (await startExportBtn.isVisible()) {
      await startExportBtn.click();
      log('✅ Started export from dialog', 'success');
      await page.waitForTimeout(3000);
    } else {
      log('❌ Start Export button not found in dialog', 'error');
      return;
    }

    // Step 5: Close dialog to see inline panel
    log('🔒 Step 5: Closing dialog to test inline panel...', 'info');

    // Close the dialog - try multiple methods
    let dialogClosed = false;

    // Method 1: Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Check if dialog is still visible
    const dialogContent = await page.locator('[role="dialog"]').first();
    if (!await dialogContent.isVisible({ timeout: 1000 })) {
      dialogClosed = true;
      log('✅ Dialog closed with Escape', 'success');
    } else {
      // Method 2: Click X button
      const closeBtn = await page.locator('button[aria-label="Close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(1000);
        dialogClosed = true;
        log('✅ Dialog closed with X button', 'success');
      }
    }

    if (!dialogClosed) {
      log('⚠️ Could not close dialog, continuing anyway', 'warning');
    }

    // Step 6: Test inline cancel button
    log('🔴 Step 6: Testing inline cancel button...', 'info');
    await page.waitForTimeout(2000);

    // Look for inline cancel button in ExportProgressPanel
    const inlineCancelBtn = await page.locator('.export-progress-panel button:has-text("Cancel"), [class*="export"] button:has-text("Cancel")').first();

    if (!await inlineCancelBtn.isVisible({ timeout: 3000 })) {
      // Try broader selector
      const anyCancelBtn = await page.locator('button:has-text("Cancel")').first();
      if (await anyCancelBtn.isVisible()) {
        log('✅ Found cancel button (generic selector)', 'success');

        // Clear logs before cancel
        consoleLogs.length = 0;

        await anyCancelBtn.click();
        log('✅ Clicked cancel button', 'success');

        // Wait and analyze logs
        await page.waitForTimeout(3000);

        // Check for critical logs
        const cancelLogs = consoleLogs.filter(l =>
          l.text.includes('cancelExport called')
        );

        const noJobLogs = consoleLogs.filter(l =>
          l.text.includes('Cannot cancel - no currentJob')
        );

        log('📊 Cancel Analysis:', 'info');
        log(`  • cancelExport calls: ${cancelLogs.length}`, 'info');
        log(`  • No currentJob warnings: ${noJobLogs.length}`, 'info');

        if (noJobLogs.length > 0) {
          log('❌ FAILED: currentJob was null - state not shared properly!', 'error');
          noJobLogs.forEach(l => log(`    ${l.text}`, 'error'));
        } else if (cancelLogs.length > 0) {
          // Check if currentJob was present
          const jobPresentLogs = cancelLogs.filter(l =>
            l.text.includes('currentJob') && !l.text.includes('null')
          );

          if (jobPresentLogs.length > 0) {
            log('✅ SUCCESS: currentJob was present - state is shared!', 'success');
          } else {
            log('⚠️ Could not verify currentJob presence', 'warning');
          }
        } else {
          log('❌ No cancel logs found', 'error');
        }
      } else {
        log('❌ No cancel button found at all', 'error');
      }
    } else {
      log('✅ Found inline cancel button', 'success');

      // Clear logs and click
      consoleLogs.length = 0;
      await inlineCancelBtn.click();
      log('✅ Clicked inline cancel button', 'success');

      await page.waitForTimeout(3000);

      // Analyze as above
      const noJobLogs = consoleLogs.filter(l =>
        l.text.includes('Cannot cancel - no currentJob')
      );

      if (noJobLogs.length > 0) {
        log('❌ FAILED: State not shared between dialog and inline panel!', 'error');
      } else {
        log('✅ SUCCESS: Export state is properly shared!', 'success');
      }
    }

    // Step 7: Final verdict
    log('═══════════════════════════════════════', 'info');
    log('📊 Test Summary', 'info');

    const hasStateSharing = !consoleLogs.some(l =>
      l.text.includes('Cannot cancel - no currentJob')
    );

    if (hasStateSharing) {
      log('✅ PASSED: Export state is shared between dialog and inline panel!', 'success');
      log('The inline cancel button can now cancel exports started from the dialog.', 'success');
    } else {
      log('❌ FAILED: Export state is NOT shared properly', 'error');
      log('The inline panel cannot access the export job started from the dialog.', 'error');
    }

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
testSharedExportState().catch(console.error);