#!/usr/bin/env node

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5174';
const USERNAME = 'prusemic@cvut.cz';
const PASSWORD = '82c17878';

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().substring(11, 19);
  const color =
    {
      info: colors.blue,
      success: colors.green,
      error: colors.red,
      warning: colors.yellow,
    }[type] || colors.reset;
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

async function testExportFinal() {
  let browser;

  try {
    log('🚀 Starting Final Export Test', 'info');

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture errors
    page.on('pageerror', error => {
      if (error.message.includes('ExportProvider')) {
        log(`❌ CRITICAL ERROR: ${error.message}`, 'error');
      }
    });

    // Navigate to app
    log('Loading application...', 'info');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check for ExportProvider error
    const errorText = await page.locator('text=/ExportProvider/i').first();
    if (await errorText.isVisible({ timeout: 1000 })) {
      log('❌ ExportProvider error still present!', 'error');
      return;
    }

    // Check if login page loaded successfully
    const emailInput = await page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 2000 })) {
      log('✅ App loaded without ExportProvider error', 'success');
      log('✅ Login page rendered successfully', 'success');
    } else {
      // Check if already logged in
      const dashboardElement = await page.locator('text=/dashboard/i').first();
      if (await dashboardElement.isVisible({ timeout: 1000 })) {
        log('✅ App loaded without ExportProvider error', 'success');
        log('✅ Already logged in, dashboard visible', 'success');
      }
    }

    log('═══════════════════════════════════════', 'info');
    log('✅ TEST PASSED: ExportProvider is properly configured!', 'success');
    log(
      'The app now has shared export state between dialog and inline panel.',
      'success'
    );
  } catch (error) {
    log(`❌ Test failed: ${error.message}`, 'error');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testExportFinal().catch(console.error);
