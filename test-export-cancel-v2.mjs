#!/usr/bin/env node

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5174';
const USERNAME = 'prusemic@cvut.cz';
const PASSWORD = '82c17878';

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().substring(11, 19);
  const typeColors = {
    info: colors.blue,
    success: colors.green,
    warning: colors.yellow,
    error: colors.red,
    debug: colors.magenta,
  };
  const color = typeColors[type] || colors.reset;
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

async function testExportCancellation() {
  let browser;
  let context;
  let page;

  try {
    log('🚀 Starting Export Cancellation Test', 'info');

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      slowMo: 50,
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    page = await context.newPage();

    // Enable console log capturing
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push({ type: msg.type(), text, timestamp: new Date() });

      // Log specific debug messages
      if (
        text.includes('export') ||
        text.includes('cancel') ||
        text.includes('abort') ||
        text.includes('🔴') ||
        text.includes('📥') ||
        text.includes('signal')
      ) {
        log(`Browser Console: ${text}`, 'debug');
      }
    });

    // Test Phase 1: Login
    log('📝 Phase 1: Logging in...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'screenshots/01-initial.png' });

    // Try to login
    try {
      // Check for email input
      const emailInput = await page.locator('input[type="email"]').first();
      if (await emailInput.isVisible({ timeout: 2000 })) {
        await page.fill('input[type="email"]', USERNAME);
        await page.fill('input[type="password"]', PASSWORD);
        await page.screenshot({ path: 'screenshots/02-login-filled.png' });

        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle');
        log('✅ Login submitted', 'success');
      } else {
        log('ℹ️ Already logged in', 'info');
      }
    } catch (e) {
      log('ℹ️ Login not needed or already authenticated', 'info');
    }

    await page.screenshot({ path: 'screenshots/03-after-login.png' });

    // Test Phase 2: Navigate to Dashboard/Projects
    log('📂 Phase 2: Navigating to projects...', 'info');

    // Check current URL
    const currentUrl = page.url();
    log(`Current URL: ${currentUrl}`, 'debug');

    // If not on dashboard, navigate there
    if (!currentUrl.includes('dashboard') && !currentUrl.includes('projects')) {
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'screenshots/04-dashboard.png' });

    // Find or create a project
    const projectCards = await page
      .locator('[class*="card"], [class*="project"], a[href*="/projects/"]')
      .all();
    log(`Found ${projectCards.length} project cards`, 'debug');

    if (projectCards.length > 0) {
      await projectCards[0].click();
      await page.waitForLoadState('networkidle');
      log('✅ Opened project', 'success');
    } else {
      // Try to create a project
      log('Creating new project...', 'info');
      const createBtn = await page
        .locator('button:has-text("Create"), button:has-text("New")')
        .first();
      if (await createBtn.isVisible()) {
        await createBtn.click();
        await page.fill('input[name="name"]', 'Test Export Project');
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle');
      }
    }

    await page.screenshot({ path: 'screenshots/05-project.png' });

    // Test Phase 3: Find Export Button
    log('🔍 Phase 3: Looking for export functionality...', 'info');

    // Wait a bit for page to fully load
    await page.waitForTimeout(3000);

    // Try multiple selectors for export button
    const exportSelectors = [
      'button:has-text("Export")',
      'button[aria-label*="export"]',
      '[data-testid*="export"]',
      'button[title*="export"]',
      '.export-button',
      'button svg[class*="download"]',
      'button:has(svg[class*="archive"])',
      'text=/export/i',
    ];

    let exportBtn = null;
    for (const selector of exportSelectors) {
      try {
        const btn = await page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          exportBtn = btn;
          log(`✅ Found export button with selector: ${selector}`, 'success');
          break;
        }
      } catch (e) {
        // Continue trying other selectors
      }
    }

    if (!exportBtn) {
      // List all visible buttons for debugging
      const allButtons = await page.locator('button').all();
      log(`Total buttons on page: ${allButtons.length}`, 'debug');

      for (let i = 0; i < Math.min(5, allButtons.length); i++) {
        const text = await allButtons[i].textContent();
        log(`Button ${i}: "${text?.trim()}"`, 'debug');
      }

      await page.screenshot({
        path: 'screenshots/06-no-export-button.png',
        fullPage: true,
      });
      log('❌ Could not find export button', 'error');
      return;
    }

    // Test Phase 4: Start Export
    log('📤 Phase 4: Starting export...', 'info');
    await exportBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/07-export-clicked.png' });

    // Handle export dialog if present
    const dialogSelectors = [
      '[role="dialog"]',
      '[class*="modal"]',
      '[class*="dialog"]',
      '.export-dialog',
    ];

    let dialogFound = false;
    for (const selector of dialogSelectors) {
      const dialog = await page.locator(selector).first();
      if (await dialog.isVisible({ timeout: 1000 })) {
        dialogFound = true;
        log('📋 Export dialog opened', 'info');
        await page.screenshot({ path: 'screenshots/08-export-dialog.png' });

        // Start the export
        const startBtn = await page
          .locator(
            'button:has-text("Start"), button:has-text("Export"), button:has-text("Download")'
          )
          .last();

        if (await startBtn.isVisible()) {
          await startBtn.click();
          log('✅ Export started', 'success');
          await page.waitForTimeout(1000);
        }
        break;
      }
    }

    // Test Phase 5: Test Cancellation
    log('🔴 Phase 5: Testing cancellation...', 'info');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-export-progress.png' });

    // Look for cancel button
    const cancelSelectors = [
      'button:has-text("Cancel")',
      'button[aria-label*="cancel"]',
      '[data-testid*="cancel"]',
      'button[title*="cancel"]',
      '.cancel-button',
    ];

    let cancelBtn = null;
    for (const selector of cancelSelectors) {
      try {
        const btn = await page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          cancelBtn = btn;
          log(`✅ Found cancel button with selector: ${selector}`, 'success');
          break;
        }
      } catch (e) {
        // Continue trying
      }
    }

    if (cancelBtn) {
      // Log current console messages before cancel
      const recentLogs = consoleLogs.slice(-10);
      if (recentLogs.length > 0) {
        log('📊 Recent console logs before cancel:', 'debug');
        recentLogs.forEach(l => console.log(`  ${l.text}`));
      }

      // Click cancel
      await cancelBtn.click();
      log('✅ Clicked cancel button', 'success');

      // Wait for cancellation to process
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'screenshots/10-after-cancel.png' });

      // Check console logs after cancel
      const newLogs = consoleLogs.filter(
        l => l.timestamp > new Date(Date.now() - 3000)
      );

      if (newLogs.length > 0) {
        log('📊 Console logs after cancel:', 'debug');
        newLogs.forEach(l =>
          console.log(`  ${colors.cyan}${l.text}${colors.reset}`)
        );
      }

      // Look for cancellation confirmation
      const cancelMessages = [
        'text=/cancelled/i',
        'text=/abort/i',
        'text=/cancel/i',
      ];

      let cancelConfirmed = false;
      for (const selector of cancelMessages) {
        const msg = await page.locator(selector).first();
        if (await msg.isVisible({ timeout: 1000 })) {
          cancelConfirmed = true;
          const text = await msg.textContent();
          log(`✅ Cancellation confirmed: "${text}"`, 'success');
          break;
        }
      }

      if (!cancelConfirmed) {
        log('⚠️ Could not confirm cancellation visually', 'warning');
      }

      // Check for abort controller logs
      const abortLogs = consoleLogs.filter(
        l =>
          l.text.includes('abort') ||
          l.text.includes('signal') ||
          l.text.includes('🔴') ||
          l.text.includes('Download cancelled')
      );

      if (abortLogs.length > 0) {
        log(`✅ Found ${abortLogs.length} abort-related logs`, 'success');
        abortLogs.forEach(l => {
          log(`  Abort log: ${l.text}`, 'success');
        });
      } else {
        log('⚠️ No abort controller activity detected', 'warning');
      }
    } else {
      log('❌ Cancel button not found', 'error');
      await page.screenshot({
        path: 'screenshots/11-no-cancel.png',
        fullPage: true,
      });
    }

    // Test Summary
    log('📊 Test Summary:', 'info');
    log(`  Total console logs: ${consoleLogs.length}`, 'info');

    const errorLogs = consoleLogs.filter(l => l.type === 'error');
    if (errorLogs.length > 0) {
      log(`  ❌ Errors found: ${errorLogs.length}`, 'error');
      errorLogs.forEach(l => console.log(`    ${l.text}`));
    } else {
      log('  ✅ No errors in console', 'success');
    }

    const abortRelatedLogs = consoleLogs.filter(
      l =>
        l.text.toLowerCase().includes('abort') ||
        l.text.toLowerCase().includes('cancel')
    );
    log(`  Cancel/Abort logs: ${abortRelatedLogs.length}`, 'info');

    log('✅ Test completed', 'success');
  } catch (error) {
    log(`❌ Test failed: ${error.message}`, 'error');
    console.error(error);

    if (page) {
      await page.screenshot({
        path: 'screenshots/error-state.png',
        fullPage: true,
      });
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Create screenshots directory
import { mkdirSync } from 'fs';
try {
  mkdirSync('screenshots', { recursive: true });
} catch (e) {
  // Directory may already exist
}

// Run the test
testExportCancellation().catch(console.error);
