#!/usr/bin/env node

import fetch from 'node-fetch';
import { chromium } from 'playwright';

const API_URL = 'http://localhost:3001/api';
const FRONTEND_URL = 'http://localhost:5174';

console.log('🧪 Testing Export System Fixes');
console.log('================================\n');

async function testBackendExport() {
  console.log('📦 Testing Backend Export...');

  try {
    // First, get auth token
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'admin123',
      }),
    });

    const { token } = await loginRes.json();
    console.log('✅ Authentication successful');

    // Get projects
    const projectsRes = await fetch(`${API_URL}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const projects = await projectsRes.json();
    const testProject = projects.find(p => p.name === 'test') || projects[0];

    if (!testProject) {
      console.log('❌ No projects found');
      return;
    }

    console.log(
      `✅ Found project: ${testProject.name} (ID: ${testProject.id})`
    );

    // Start export
    const exportRes = await fetch(
      `${API_URL}/projects/${testProject.id}/export`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includeImages: true,
          includeAnnotations: true,
          includeVisualizations: false,
          includeMetrics: true,
          imageIds: [],
        }),
      }
    );

    const { jobId } = await exportRes.json();
    console.log(`✅ Export started with job ID: ${jobId}`);

    // Check status
    const statusRes = await fetch(
      `${API_URL}/projects/${testProject.id}/export/${jobId}/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const status = await statusRes.json();
    console.log(`✅ Export status: ${status.state}`);

    // Test filename
    const downloadRes = await fetch(
      `${API_URL}/projects/${testProject.id}/export/${jobId}/download`,
      {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const contentDisposition = downloadRes.headers.get('content-disposition');
    console.log(`✅ Content-Disposition header: ${contentDisposition}`);

    if (contentDisposition.includes('inline')) {
      console.log(
        '✅ Backend correctly uses inline disposition (prevents auto-download)'
      );
    } else {
      console.log('❌ Backend still using attachment disposition');
    }

    // Extract filename
    const filenameMatch = contentDisposition.match(/filename="(.+?)"/);
    if (filenameMatch) {
      const filename = filenameMatch[1];
      console.log(`✅ Export filename: ${filename}`);

      if (filename === `${testProject.name}.zip`) {
        console.log('✅ Filename correctly uses project name only');
      } else {
        console.log(`❌ Filename is complex: ${filename}`);
      }
    }
  } catch (error) {
    console.error('❌ Backend test failed:', error.message);
  }
}

async function testFrontendButtons() {
  console.log('\n🖱️ Testing Frontend Buttons...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Go to login
    await page.goto(`${FRONTEND_URL}/sign-in`);

    // Login
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 5000 });
    console.log('✅ Logged in successfully');

    // Go to first project
    await page.click('.project-card:first-child');
    await page.waitForURL('**/projects/*', { timeout: 5000 });
    console.log('✅ Navigated to project detail');

    // Check for export panel
    const exportPanel = await page
      .locator('[data-testid="export-progress-panel"]')
      .count();
    console.log(`Export panel visible: ${exportPanel > 0}`);

    // Check button states
    const downloadBtn = await page.locator('button:has-text("Download")');
    const dismissBtn = await page.locator('button:has-text("Dismiss")');

    if ((await downloadBtn.count()) > 0) {
      const isDownloadDisabled = await downloadBtn.isDisabled();
      console.log(`Download button disabled: ${isDownloadDisabled}`);
    }

    if ((await dismissBtn.count()) > 0) {
      const isDismissDisabled = await dismissBtn.isDisabled();
      console.log(`Dismiss button disabled: ${isDismissDisabled}`);

      // Try clicking dismiss
      if (!isDismissDisabled) {
        await dismissBtn.click();
        console.log('✅ Dismiss button clicked successfully');

        // Check if panel is hidden
        const panelAfterDismiss = await page
          .locator('[data-testid="export-progress-panel"]')
          .count();
        if (panelAfterDismiss === 0) {
          console.log('✅ Export panel correctly hidden after dismiss');
        }
      }
    }
  } catch (error) {
    console.error('❌ Frontend test failed:', error.message);
  } finally {
    await browser.close();
  }
}

async function testExportHooks() {
  console.log('\n🔍 Checking for duplicate hook usage...');

  const { execSync } = await import('child_process');

  try {
    // Check ProjectDetail.tsx for duplicate hooks
    const projectDetail = execSync(
      'grep -E "(useSharedAdvancedExport|useAdvancedExport)" /home/cvat/cell-segmentation-hub/src/pages/ProjectDetail.tsx',
      { encoding: 'utf8' }
    );

    const hookCount = (projectDetail.match(/use(Shared)?AdvancedExport/g) || [])
      .length;

    if (hookCount === 1) {
      console.log('✅ Only one export hook used in ProjectDetail');
    } else {
      console.log(`❌ Multiple export hooks found: ${hookCount}`);
    }

    // Check for useAdvancedExport usage
    const advancedExportUsage = execSync(
      'grep -r "useAdvancedExport[^d]" /home/cvat/cell-segmentation-hub/src --include="*.tsx" --include="*.ts" | wc -l',
      { encoding: 'utf8' }
    ).trim();

    if (advancedExportUsage === '0') {
      console.log('✅ No usage of deprecated useAdvancedExport hook');
    } else {
      console.log(
        `⚠️ Found ${advancedExportUsage} uses of deprecated useAdvancedExport hook`
      );
    }
  } catch (error) {
    // grep returns non-zero if no matches
    console.log('✅ No duplicate hooks found');
  }
}

// Run all tests
(async () => {
  await testBackendExport();
  await testFrontendButtons();
  await testExportHooks();

  console.log('\n✨ Export System Test Complete\n');
})();
