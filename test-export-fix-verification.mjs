#!/usr/bin/env node

import fetch from 'node-fetch';
import { chromium } from 'playwright';

const API_URL = 'http://localhost:3001/api';
const FRONTEND_URL = 'http://localhost:5174';

console.log('🧪 Testing Export Fix Verification');
console.log('=====================================\n');

async function testExportFlow() {
  console.log('📦 Testing Complete Export Flow...\n');

  const browser = await chromium.launch({
    headless: false,  // Run with UI to see the behavior
    slowMo: 500       // Slow down actions to observe
  });

  const context = await browser.newContext({
    // Record downloads to verify single download
    acceptDownloads: true,
    recordVideo: { dir: './test-recordings' }
  });

  const page = await context.newPage();

  // Track console logs
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('download') || text.includes('Export') || text.includes('dismiss')) {
      consoleLogs.push(`[${msg.type()}] ${text}`);
    }
  });

  // Track download events
  const downloads = [];
  page.on('download', download => {
    downloads.push({
      filename: download.suggestedFilename(),
      time: new Date().toISOString()
    });
    console.log(`📥 Download triggered: ${download.suggestedFilename()}`);
  });

  try {
    // 1. Login
    console.log('1️⃣ Logging in...');
    await page.goto(`${FRONTEND_URL}/sign-in`);
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful\n');

    // 2. Navigate to project
    console.log('2️⃣ Navigating to project...');
    await page.click('.project-card:first-child');
    await page.waitForURL('**/projects/*', { timeout: 10000 });
    console.log('✅ Project loaded\n');

    // 3. Clear any existing localStorage
    console.log('3️⃣ Clearing localStorage...');
    await page.evaluate(() => {
      Object.keys(localStorage).forEach(key => {
        if (key.includes('export') || key.includes('Export')) {
          localStorage.removeItem(key);
        }
      });
    });
    console.log('✅ localStorage cleared\n');

    // 4. Start export
    console.log('4️⃣ Starting export...');
    await page.click('button:has-text("Export Project")');
    await page.waitForSelector('text=/Export Settings|Export Options/', { timeout: 5000 });
    await page.click('button:has-text("Start Export")');
    console.log('✅ Export started\n');

    // 5. Wait for export to complete
    console.log('5️⃣ Waiting for export to complete...');
    await page.waitForSelector('text=/Export completed|Download completed/', {
      timeout: 60000
    });
    console.log('✅ Export completed\n');

    // 6. Wait a bit to see if duplicate downloads occur
    console.log('6️⃣ Monitoring for duplicate downloads (5 seconds)...');
    await page.waitForTimeout(5000);

    // 7. Check download count
    console.log(`\n📊 Download Summary:`);
    console.log(`Total downloads triggered: ${downloads.length}`);
    downloads.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.filename} at ${d.time}`);
    });

    if (downloads.length === 1) {
      console.log('✅ SUCCESS: Only one download triggered!');
    } else if (downloads.length > 1) {
      console.log('❌ ISSUE: Multiple downloads detected!');
    } else {
      console.log('⚠️ WARNING: No downloads detected!');
    }

    // 8. Check if export panel is still visible
    console.log('\n7️⃣ Checking export panel persistence...');
    await page.waitForTimeout(5000); // Wait 5 more seconds

    const exportPanelVisible = await page.locator('[data-testid="export-progress-panel"]').count() > 0;
    const exportStatusVisible = await page.locator('text=/Export completed|Download completed/').count() > 0;

    console.log(`Export panel visible: ${exportPanelVisible}`);
    console.log(`Export status visible: ${exportStatusVisible}`);

    if (exportPanelVisible || exportStatusVisible) {
      console.log('✅ SUCCESS: Export panel did not auto-dismiss!');

      // Test dismiss button
      console.log('\n8️⃣ Testing dismiss button...');
      const dismissBtn = page.locator('button:has-text("Dismiss")');
      if (await dismissBtn.count() > 0) {
        await dismissBtn.click();
        await page.waitForTimeout(1000);

        const panelAfterDismiss = await page.locator('[data-testid="export-progress-panel"]').count() > 0;
        if (!panelAfterDismiss) {
          console.log('✅ Dismiss button works correctly!');
        } else {
          console.log('❌ Panel still visible after dismiss!');
        }
      }
    } else {
      console.log('❌ ISSUE: Export panel auto-dismissed!');
    }

    // 9. Test page reload behavior
    console.log('\n9️⃣ Testing page reload behavior...');
    await page.reload();
    await page.waitForTimeout(3000);

    const reloadDownloads = [];
    page.on('download', download => {
      reloadDownloads.push(download.suggestedFilename());
    });

    await page.waitForTimeout(5000);

    if (reloadDownloads.length === 0) {
      console.log('✅ SUCCESS: No auto-download after page reload!');
    } else {
      console.log(`❌ ISSUE: ${reloadDownloads.length} downloads after reload!`);
    }

    // 10. Print relevant console logs
    console.log('\n📋 Relevant Console Logs:');
    consoleLogs.slice(-20).forEach(log => console.log(log));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
(async () => {
  await testExportFlow();
  console.log('\n✨ Export Fix Verification Complete\n');
})();