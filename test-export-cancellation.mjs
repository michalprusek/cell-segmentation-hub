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
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().substring(11, 19);
  const typeColors = {
    'info': colors.blue,
    'success': colors.green,
    'warning': colors.yellow,
    'error': colors.red,
    'debug': colors.magenta
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

    // Launch browser with debugging options
    browser = await chromium.launch({
      headless: true, // Run headless since we're on a server
      slowMo: 100, // Slow down actions for better visibility
      // devtools: true // Can't open DevTools in headless mode
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();

    // Enable console log capturing
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push({ type: msg.type(), text, timestamp: new Date() });

      // Log specific debug messages related to export
      if (text.includes('export') || text.includes('cancel') || text.includes('abort') || text.includes('🔴') || text.includes('📥')) {
        log(`Console [${msg.type()}]: ${text}`, 'debug');
      }
    });

    // Capture network requests
    const exportRequests = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/export')) {
        exportRequests.push({
          url,
          method: request.method(),
          timestamp: new Date()
        });
        log(`Network Request: ${request.method()} ${url}`, 'debug');
      }
    });

    page.on('response', response => {
      const url = response.url();
      if (url.includes('/export')) {
        log(`Network Response: ${response.status()} ${url}`, 'debug');
      }
    });

    // Test Phase 1: Login
    log('📝 Phase 1: Logging in...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Check if we're on the login page
    const loginForm = await page.locator('form').first();
    if (await loginForm.isVisible()) {
      // Fill login form
      await page.fill('input[type="email"], input[name="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);

      // Submit login
      await page.click('button[type="submit"]');
      await page.waitForURL(/dashboard|projects/, { timeout: 10000 });
      log('✅ Login successful', 'success');
    } else {
      log('⚠️ Already logged in or no login form found', 'warning');
    }

    // Test Phase 2: Navigate to a project
    log('📂 Phase 2: Navigating to project...', 'info');
    await page.waitForTimeout(2000);

    // Find and click on a project card or create new project
    const projectCards = await page.locator('[data-testid="project-card"], .project-card, [class*="project"]').all();

    if (projectCards.length > 0) {
      await projectCards[0].click();
      log('✅ Opened existing project', 'success');
    } else {
      log('⚠️ No projects found, attempting to create one', 'warning');
      // Try to create a new project
      const newProjectBtn = await page.locator('button:has-text("New Project"), button:has-text("Create Project")').first();
      if (await newProjectBtn.isVisible()) {
        await newProjectBtn.click();
        await page.fill('input[name="name"], input[placeholder*="project"]', 'Test Export Cancel');
        await page.click('button[type="submit"]');
      }
    }

    await page.waitForTimeout(3000);

    // Test Phase 3: Upload test images if needed
    log('🖼️ Phase 3: Checking for images...', 'info');

    const images = await page.locator('img[alt*="image"], [class*="image-card"], [data-testid*="image"]').all();
    if (images.length === 0) {
      log('⚠️ No images found, uploading test images', 'warning');

      // Create test image files
      const uploadInput = await page.locator('input[type="file"]').first();
      if (await uploadInput.isVisible()) {
        // You would need actual image files here
        log('📤 Would upload images here (skipping in test)', 'warning');
      }
    } else {
      log(`✅ Found ${images.length} images in project`, 'success');
    }

    // Test Phase 4: Start Export
    log('📤 Phase 4: Starting export process...', 'info');

    // Find and click export button
    const exportBtn = await page.locator('button:has-text("Export"), [aria-label*="export"]').first();
    if (!await exportBtn.isVisible()) {
      log('❌ Export button not found', 'error');
      return;
    }

    await exportBtn.click();
    log('✅ Clicked export button', 'success');

    // Wait for export dialog
    await page.waitForTimeout(1000);

    // Configure export options if dialog appears
    const exportDialog = await page.locator('[role="dialog"], [class*="dialog"], [class*="modal"]').first();
    if (await exportDialog.isVisible()) {
      log('📋 Export dialog opened', 'info');

      // Start the export
      const startExportBtn = await page.locator('button:has-text("Start Export"), button:has-text("Export")').last();
      await startExportBtn.click();
      log('✅ Started export process', 'success');
    }

    // Test Phase 5: Test Cancel During Processing
    log('🔴 Phase 5: Testing cancel during processing...', 'info');

    // Wait for export progress to appear
    await page.waitForTimeout(2000);

    // Look for cancel button in export progress panel
    const cancelBtn = await page.locator('button:has-text("Cancel"), [aria-label*="cancel"]').first();

    if (await cancelBtn.isVisible()) {
      // Check console logs for abort signal state
      const relevantLogs = consoleLogs.filter(log =>
        log.text.includes('abort') ||
        log.text.includes('cancel') ||
        log.text.includes('🔴') ||
        log.text.includes('📥')
      );

      log('📊 Pre-cancel console logs:', 'debug');
      relevantLogs.forEach(l => console.log(`  ${l.text}`));

      // Click cancel button
      await cancelBtn.click();
      log('✅ Clicked cancel button', 'success');

      // Wait for cancellation to process
      await page.waitForTimeout(3000);

      // Check post-cancel logs
      const postCancelLogs = consoleLogs.filter(log =>
        log.timestamp > new Date(Date.now() - 3000)
      );

      log('📊 Post-cancel console logs:', 'debug');
      postCancelLogs.forEach(l => console.log(`  ${l.text}`));

      // Verify cancellation worked
      const cancelledMessage = await page.locator('text=/cancel/i, text=/abort/i').first();
      if (await cancelledMessage.isVisible()) {
        log('✅ Export cancelled successfully', 'success');
      } else {
        log('⚠️ Could not verify cancellation message', 'warning');
      }
    } else {
      log('❌ Cancel button not found', 'error');
    }

    // Test Phase 6: Start another export to test download phase cancellation
    log('📥 Phase 6: Testing cancel during download phase...', 'info');
    await page.waitForTimeout(2000);

    // Start another export
    const exportBtn2 = await page.locator('button:has-text("Export"), [aria-label*="export"]').first();
    if (await exportBtn2.isVisible()) {
      await exportBtn2.click();
      await page.waitForTimeout(1000);

      const startExportBtn2 = await page.locator('button:has-text("Start Export"), button:has-text("Export")').last();
      if (await startExportBtn2.isVisible()) {
        await startExportBtn2.click();
        log('✅ Started second export for download test', 'success');

        // Wait for download phase (should see 100% or "Download" status)
        await page.waitForTimeout(5000);

        // Look for download indicators
        const downloadIndicator = await page.locator('text=/download/i, text=/100%/').first();
        if (await downloadIndicator.isVisible()) {
          log('📥 Export in download phase', 'info');

          // Try to cancel during download
          const cancelBtn2 = await page.locator('button:has-text("Cancel"), [aria-label*="cancel"]').first();
          if (await cancelBtn2.isVisible()) {
            await cancelBtn2.click();
            log('✅ Clicked cancel during download', 'success');

            await page.waitForTimeout(2000);

            // Check if download was actually cancelled
            const downloadLogs = consoleLogs.filter(log =>
              log.text.includes('Download cancelled') ||
              log.text.includes('aborted')
            );

            if (downloadLogs.length > 0) {
              log('✅ Download cancelled successfully', 'success');
              downloadLogs.forEach(l => console.log(`  ${l.text}`));
            } else {
              log('⚠️ Could not verify download cancellation in logs', 'warning');
            }
          }
        }
      }
    }

    // Test Phase 7: Analyze Results
    log('📊 Phase 7: Analyzing test results...', 'info');

    // Summary of console logs
    const errorLogs = consoleLogs.filter(l => l.type === 'error');
    const abortLogs = consoleLogs.filter(l => l.text.includes('abort'));
    const cancelLogs = consoleLogs.filter(l => l.text.includes('cancel'));

    log(`📈 Test Summary:`, 'info');
    log(`  Total console logs: ${consoleLogs.length}`, 'info');
    log(`  Error logs: ${errorLogs.length}`, errorLogs.length > 0 ? 'warning' : 'info');
    log(`  Abort-related logs: ${abortLogs.length}`, 'info');
    log(`  Cancel-related logs: ${cancelLogs.length}`, 'info');
    log(`  Export requests: ${exportRequests.length}`, 'info');

    if (errorLogs.length > 0) {
      log('❌ Errors found during test:', 'error');
      errorLogs.forEach(l => console.log(`  ${l.text}`));
    }

    // Check for specific abort controller logs
    const abortControllerLogs = consoleLogs.filter(l =>
      l.text.includes('signal aborted:') ||
      l.text.includes('Calling abort')
    );

    if (abortControllerLogs.length > 0) {
      log('🎯 AbortController activity detected:', 'success');
      abortControllerLogs.forEach(l => console.log(`  ${colors.green}${l.text}${colors.reset}`));
    } else {
      log('⚠️ No AbortController activity detected in logs', 'warning');
    }

    log('✅ Export Cancellation Test Completed', 'success');

  } catch (error) {
    log(`❌ Test failed: ${error.message}`, 'error');
    console.error(error);
  } finally {
    // Cleanup
    if (page) {
      // Take a final screenshot
      await page.screenshot({ path: 'export-cancel-test-final.png', fullPage: true });
      log('📸 Final screenshot saved', 'info');
    }

    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
testExportCancellation().catch(console.error);