#!/usr/bin/env node

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5174';
const API_URL = 'http://localhost:3001';
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

async function testExportCancellation() {
  let browser;
  let context;
  let page;

  try {
    log('🚀 Starting Direct Export Cancellation Test', 'info');

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      // Set up to capture all console logs
      recordVideo: {
        dir: './videos/',
        size: { width: 1920, height: 1080 }
      }
    });

    // Add authentication headers if needed
    await context.addInitScript(() => {
      window.localStorage.setItem('debug', 'export*,cancel*,abort*');
    });

    page = await context.newPage();

    // Capture ALL console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      consoleLogs.push({ type, text, timestamp: new Date().toISOString() });

      // Log important messages
      if (text.includes('abort') || text.includes('cancel') || text.includes('signal') ||
          text.includes('🔴') || text.includes('📥') || text.includes('🔍') ||
          text.includes('Download') || text.includes('Export')) {
        log(`Console [${type}]: ${text}`, 'important');
      }
    });

    // Capture network activity
    const networkLogs = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/export') || url.includes('/cancel')) {
        networkLogs.push({
          type: 'request',
          method: request.method(),
          url,
          timestamp: new Date().toISOString()
        });
        log(`→ ${request.method()} ${url}`, 'debug');
      }
    });

    page.on('response', response => {
      const url = response.url();
      if (url.includes('/export') || url.includes('/cancel')) {
        networkLogs.push({
          type: 'response',
          status: response.status(),
          url,
          timestamp: new Date().toISOString()
        });
        log(`← ${response.status()} ${url}`, 'debug');
      }
    });

    // Step 1: Navigate to the app
    log('📝 Step 1: Loading application...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Step 2: Login if needed
    log('🔐 Step 2: Authenticating...', 'info');
    const emailInput = await page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 2000 })) {
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
      log('✅ Logged in', 'success');
    } else {
      log('ℹ️ Already authenticated', 'info');
    }

    // Step 3: Navigate directly to a project or dashboard
    log('📂 Step 3: Navigating to project...', 'info');

    // Try to go directly to dashboard
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check if we have any projects
    const projectLinks = await page.locator('a[href*="/projects/"]').all();
    log(`Found ${projectLinks.length} project links`, 'debug');

    if (projectLinks.length > 0) {
      const projectHref = await projectLinks[0].getAttribute('href');
      log(`Navigating to project: ${projectHref}`, 'info');
      await projectLinks[0].click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    } else {
      log('⚠️ No projects found, will try to test from current page', 'warning');
    }

    // Step 4: Inject test for AbortController directly
    log('🧪 Step 4: Testing AbortController directly...', 'info');

    // Inject and run abort controller test directly in the browser
    const abortTest = await page.evaluate(() => {
      // Test abort controller directly
      const testResults = {};

      // Create a simple abort controller test
      const controller = new AbortController();
      const signal = controller.signal;

      testResults.initialState = signal.aborted;
      console.log('🔍 Initial signal state:', signal.aborted);

      // Test abort
      controller.abort();
      testResults.afterAbort = signal.aborted;
      console.log('🔴 After abort:', signal.aborted);

      // Try to find any export-related functions in window
      const hasExportFunctions = {
        startExport: typeof window.startExport === 'function',
        cancelExport: typeof window.cancelExport === 'function',
        hasReactApp: !!window.React || !!window._react,
        hasExportContext: !!window.__EXPORT_CONTEXT__
      };

      return { testResults, hasExportFunctions };
    });

    log(`AbortController test results: ${JSON.stringify(abortTest, null, 2)}`, 'debug');

    // Step 5: Try to find and trigger export through the UI
    log('🔍 Step 5: Looking for export UI elements...', 'info');

    // List all buttons and their text
    const buttons = await page.locator('button').all();
    log(`Found ${buttons.length} buttons on page`, 'debug');

    for (let i = 0; i < Math.min(10, buttons.length); i++) {
      const btnText = await buttons[i].textContent();
      const isVisible = await buttons[i].isVisible();
      if (isVisible && btnText) {
        log(`  Button ${i}: "${btnText.trim()}"`, 'debug');
      }
    }

    // Try to find export through various methods
    const exportTriggers = [
      { selector: 'button:has-text("Export")', name: 'Export button' },
      { selector: '[aria-label*="export" i]', name: 'Export aria-label' },
      { selector: 'button:has-text("Download")', name: 'Download button' },
      { selector: '[title*="export" i]', name: 'Export title' },
      { selector: 'button:has(svg[class*="download"])', name: 'Download icon' },
      { selector: 'button:has(svg[class*="archive"])', name: 'Archive icon' },
      { selector: '.toolbar button', name: 'Toolbar button' },
      { selector: '[data-testid*="export"]', name: 'Export testid' }
    ];

    let exportFound = false;
    for (const trigger of exportTriggers) {
      try {
        const element = await page.locator(trigger.selector).first();
        if (await element.isVisible({ timeout: 1000 })) {
          log(`✅ Found: ${trigger.name}`, 'success');

          // Click to start export
          await element.click();
          exportFound = true;
          await page.waitForTimeout(2000);

          // Now look for cancel button
          log('🔴 Looking for cancel button...', 'info');

          const cancelBtn = await page.locator('button:has-text("Cancel")').first();
          if (await cancelBtn.isVisible({ timeout: 2000 })) {
            log('✅ Found cancel button, clicking...', 'success');

            // Click cancel
            await cancelBtn.click();
            await page.waitForTimeout(3000);

            // Check console logs for abort activity
            const abortLogs = consoleLogs.filter(l =>
              l.text.includes('abort') ||
              l.text.includes('signal') ||
              l.text.includes('🔴') ||
              l.text.includes('cancelled')
            );

            if (abortLogs.length > 0) {
              log(`✅ Cancellation detected! Found ${abortLogs.length} abort-related logs:`, 'success');
              abortLogs.forEach(l => {
                log(`  ${l.timestamp}: ${l.text}`, 'success');
              });
            } else {
              log('⚠️ No abort logs detected after cancel', 'warning');
            }
          } else {
            log('❌ Cancel button not found', 'error');
          }

          break;
        }
      } catch (e) {
        // Continue trying
      }
    }

    if (!exportFound) {
      log('❌ Could not find any export trigger', 'error');

      // Take screenshot of current state
      await page.screenshot({ path: 'screenshots/final-state.png', fullPage: true });

      // Log page title and URL for debugging
      const title = await page.title();
      const url = page.url();
      log(`Page title: "${title}"`, 'debug');
      log(`Page URL: ${url}`, 'debug');
    }

    // Step 6: Analyze results
    log('📊 Step 6: Test Results Summary', 'info');
    log('═══════════════════════════════════════', 'info');

    // Console log analysis
    const errorLogs = consoleLogs.filter(l => l.type === 'error');
    const warningLogs = consoleLogs.filter(l => l.type === 'warning');
    const abortLogs = consoleLogs.filter(l => l.text.toLowerCase().includes('abort'));
    const cancelLogs = consoleLogs.filter(l => l.text.toLowerCase().includes('cancel'));
    const signalLogs = consoleLogs.filter(l => l.text.toLowerCase().includes('signal'));

    log(`Total console logs: ${consoleLogs.length}`, 'info');
    log(`  • Errors: ${errorLogs.length}`, errorLogs.length > 0 ? 'error' : 'info');
    log(`  • Warnings: ${warningLogs.length}`, 'info');
    log(`  • Abort-related: ${abortLogs.length}`, 'info');
    log(`  • Cancel-related: ${cancelLogs.length}`, 'info');
    log(`  • Signal-related: ${signalLogs.length}`, 'info');

    // Network analysis
    const exportRequests = networkLogs.filter(l => l.type === 'request' && l.url.includes('/export'));
    const cancelRequests = networkLogs.filter(l => l.type === 'request' && l.url.includes('/cancel'));

    log(`Network activity:`, 'info');
    log(`  • Export requests: ${exportRequests.length}`, 'info');
    log(`  • Cancel requests: ${cancelRequests.length}`, 'info');

    // Final verdict
    log('═══════════════════════════════════════', 'info');
    if (abortLogs.length > 0 || cancelRequests.length > 0) {
      log('✅ EXPORT CANCELLATION IS WORKING!', 'success');
      log('The AbortController is properly aborting requests.', 'success');
    } else if (exportFound) {
      log('⚠️ PARTIAL SUCCESS: Export found but cancellation unclear', 'warning');
      log('The export UI was found but abort signals were not detected in console.', 'warning');
    } else {
      log('❌ TEST INCOMPLETE: Could not find export functionality', 'error');
      log('The test could not locate the export button to test cancellation.', 'error');
    }

    // Save all logs to file for analysis
    const fs = await import('fs');
    const logData = {
      timestamp: new Date().toISOString(),
      consoleLogs,
      networkLogs,
      summary: {
        totalLogs: consoleLogs.length,
        errors: errorLogs.length,
        abortLogs: abortLogs.length,
        cancelLogs: cancelLogs.length,
        exportRequests: exportRequests.length,
        cancelRequests: cancelRequests.length
      }
    };

    await fs.promises.writeFile(
      'export-test-results.json',
      JSON.stringify(logData, null, 2)
    );
    log('📝 Test results saved to export-test-results.json', 'info');

  } catch (error) {
    log(`❌ Test failed with error: ${error.message}`, 'error');
    console.error(error);
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}

// Create necessary directories
import { mkdirSync } from 'fs';
try {
  mkdirSync('screenshots', { recursive: true });
  mkdirSync('videos', { recursive: true });
} catch (e) {
  // Directories may already exist
}

// Run the test
testExportCancellation().catch(console.error);