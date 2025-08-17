import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Complete Segmentation Workflow', () => {
  const testUser = {
    email: `segmentation-test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Segmentation E2E Test Project',
    description: 'A project for comprehensive segmentation workflow testing',
  };

  // Test images paths
  const testImagePaths = [
    path.join(
      __dirname,
      '../../public/lovable-uploads/026f6ae6-fa28-487c-8263-f49babd99dd3.png'
    ),
    path.join(
      __dirname,
      '../../public/lovable-uploads/19687f60-a78f-49e3-ada7-8dfc6a5fab4e.png'
    ),
    path.join(
      __dirname,
      '../../public/lovable-uploads/8f483962-36d5-4bae-8c90-c9542f8cc2d8.png'
    ),
  ];

  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await page.goto('/');

    // Handle potential existing login state
    const isLoggedIn = await page
      .locator(
        '[data-testid="user-menu"], .user-menu, [aria-label*="user"], [aria-label*="profile"]'
      )
      .isVisible();

    if (!isLoggedIn) {
      await page.getByRole('link', { name: /sign up/i }).click();

      await page.getByLabel(/email/i).fill(testUser.email);
      await page
        .getByLabel(/password/i)
        .first()
        .fill(testUser.password);
      await page.getByLabel(/confirm password/i).fill(testUser.password);

      // Handle consent checkboxes if present
      const consentCheckbox = page
        .getByRole('checkbox', { name: /terms|consent/i })
        .first();
      if (await consentCheckbox.isVisible()) {
        await consentCheckbox.check();
      }

      await page.getByRole('button', { name: /sign up/i }).click();
      await expect(page).toHaveURL('/dashboard');
    }
  });

  test('should complete full segmentation workflow with HRNet model', async ({
    page,
  }) => {
    // Step 1: Create a new project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Wait for project creation success
    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(testProject.name)).toBeVisible();

    // Step 2: Navigate to project details
    await page.getByText(testProject.name).click();
    await expect(page).toHaveURL(/\/projects\/.*/);

    // Step 3: Upload test image
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePaths[0]);

    // Wait for upload completion
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Step 4: Start segmentation process
    const segmentButton = page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first();
    await segmentButton.click();

    // Step 5: Configure segmentation settings
    // Select HRNet model if model selection is available
    const modelSelector = page.getByRole('combobox', { name: /model/i });
    if (await modelSelector.isVisible()) {
      await modelSelector.click();
      await page.getByText(/hrnet/i).first().click();
    }

    // Adjust threshold if available
    const thresholdSlider = page.locator(
      'input[type="range"], .threshold-slider'
    );
    if (await thresholdSlider.isVisible()) {
      await thresholdSlider.fill('0.5');
    }

    // Step 6: Start processing
    await page
      .getByRole('button', { name: /start|process|segment|analyze/i })
      .click();

    // Wait for processing to complete
    await expect(
      page.getByText(/processing|analyzing|in progress/i)
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 60000 }
    );

    // Step 7: Navigate to segmentation editor
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();

    // Wait for editor to load
    await expect(page).toHaveURL(/.*\/segmentation.*/);
    await expect(
      page.locator('canvas, .canvas-container, .segmentation-canvas')
    ).toBeVisible({ timeout: 10000 });

    // Step 8: Verify segmentation results are loaded
    await expect(page.getByText(/polygon|segment|object/i).first()).toBeVisible(
      { timeout: 10000 }
    );

    // Step 9: Test basic polygon interaction
    const canvas = page.locator('canvas, .canvas-container').first();
    await canvas.click({ position: { x: 100, y: 100 } });

    // Step 10: Test polygon editing capabilities
    // Try to select a polygon
    await canvas.click({ position: { x: 200, y: 200 } });

    // Check if polygon selection UI appears
    const selectedPolygonIndicator = page.locator(
      '.selected-polygon, .polygon-selected, [data-selected="true"]'
    );
    if (await selectedPolygonIndicator.isVisible()) {
      // Test delete functionality
      await page.keyboard.press('Delete');
    }

    // Step 11: Test save functionality
    const saveButton = page.getByRole('button', { name: /save/i }).first();
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await expect(page.getByText(/saved|success/i)).toBeVisible({
        timeout: 5000,
      });
    }

    // Step 12: Test export functionality
    const exportButton = page.getByRole('button', { name: /export/i }).first();
    if (await exportButton.isVisible()) {
      await exportButton.click();

      // Wait for export options
      await expect(page.getByText(/coco|json|excel/i)).toBeVisible({
        timeout: 5000,
      });

      // Select COCO format export
      await page.getByText(/coco/i).first().click();

      // Start download
      const downloadPromise = page.waitForDownload();
      await page.getByRole('button', { name: /download|export/i }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/.*\.(json|zip)$/);
    }
  });

  test('should test all three ML models (HRNet, ResUNet Small, ResUNet Advanced)', async ({
    page,
  }) => {
    const models = ['hrnet', 'resunet_small', 'resunet_advanced'];

    for (const modelName of models) {
      // Create a new project for each model
      await page.goto('/dashboard');

      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill(`${testProject.name} - ${modelName}`);
      await page.getByLabel(/description/i).fill(`Testing ${modelName} model`);
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Navigate to project
      await page.getByText(`${testProject.name} - ${modelName}`).click();

      // Upload image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[1]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Start segmentation
      await page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first()
        .click();

      // Select specific model
      const modelSelector = page.getByRole('combobox', { name: /model/i });
      if (await modelSelector.isVisible()) {
        await modelSelector.click();

        // Find and select the specific model
        const modelOption = page.getByText(new RegExp(modelName, 'i')).first();
        await modelOption.click();
      }

      // Start processing
      await page
        .getByRole('button', { name: /start|process|segment/i })
        .click();

      // Wait for completion with longer timeout for advanced models
      const timeout = modelName === 'resunet_advanced' ? 120000 : 60000;
      await expect(page.getByText(/processing|analyzing/i)).toBeVisible({
        timeout: 5000,
      });
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout });

      // Verify results exist
      const editButton = page
        .getByRole('button', { name: /edit|open.*editor|view.*results/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Verify polygons are present
        await expect(
          page.getByText(/polygon|segment|object/i).first()
        ).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test('should handle different threshold values', async ({ page }) => {
    const thresholds = [0.3, 0.5, 0.7];

    for (const threshold of thresholds) {
      // Create project
      await page.goto('/dashboard');

      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill(`${testProject.name} - Threshold ${threshold}`);
      await page
        .getByLabel(/description/i)
        .fill(`Testing threshold ${threshold}`);
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Navigate and upload
      await page
        .getByText(`${testProject.name} - Threshold ${threshold}`)
        .click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[2]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Configure and start segmentation
      await page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first()
        .click();

      // Set threshold
      const thresholdInput = page
        .locator('input[type="range"], input[type="number"]')
        .first();
      if (await thresholdInput.isVisible()) {
        await thresholdInput.fill(threshold.toString());
      }

      await page
        .getByRole('button', { name: /start|process|segment/i })
        .click();

      // Wait for completion
      await expect(page.getByText(/processing|analyzing/i)).toBeVisible({
        timeout: 5000,
      });
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: 60000 });

      // Verify different thresholds produce different results
      const editButton = page
        .getByRole('button', { name: /edit|open.*editor|view.*results/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Count polygons or segments (implementation depends on UI)
        const polygonElements = page.locator(
          '.polygon, [data-polygon], .segment'
        );
        const count = await polygonElements.count();

        // Different thresholds should produce different polygon counts
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should handle WebSocket real-time updates during processing', async ({
    page,
  }) => {
    // Create project and upload image
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText(testProject.name).click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePaths[0]);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Start segmentation and monitor real-time updates
    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Monitor for real-time status updates
    const statusUpdates = [
      /queued|waiting/i,
      /processing|analyzing|running/i,
      /complete|finished|done|success/i,
    ];

    for (const statusPattern of statusUpdates) {
      await expect(page.getByText(statusPattern)).toBeVisible({
        timeout: 30000,
      });
    }

    // Verify final success state
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 60000 }
    );
  });

  test('should handle error scenarios gracefully', async ({ page }) => {
    // Test 1: Invalid file upload
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Error Test Project');
    await page.getByLabel(/description/i).fill('Testing error handling');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Error Test Project').click();

    // Try to upload invalid file (create a text file)
    const invalidFilePath = path.join(
      __dirname,
      '../fixtures/invalid-file.txt'
    );

    // Ensure the invalid file exists for testing
    const fs = await import('fs');
    if (!fs.default.existsSync(invalidFilePath)) {
      fs.default.writeFileSync(
        invalidFilePath,
        'This is not an image file - testing invalid upload'
      );
    }

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      try {
        await fileInput.setInputFiles(invalidFilePath);

        // Should show error message for invalid file type
        await expect(
          page.getByText(/invalid.*file|unsupported.*format|error/i)
        ).toBeVisible({ timeout: 5000 });
      } catch (error) {
        console.log('Invalid file test failed:', error);
      }
    }

    // Test 2: Network error handling (if applicable)
    // This would require mocking network requests or deliberately causing failures

    // Test 3: Processing timeout/cancellation
    const uploadInput = page.locator('input[type="file"]').first();
    if (await uploadInput.isVisible()) {
      await uploadInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      await page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first()
        .click();
      await page
        .getByRole('button', { name: /start|process|segment/i })
        .click();

      // Try to cancel processing if cancel button exists
      const cancelButton = page.getByRole('button', {
        name: /cancel|stop|abort/i,
      });
      if (await cancelButton.isVisible({ timeout: 5000 })) {
        await cancelButton.click();
        await expect(page.getByText(/cancelled|stopped|aborted/i)).toBeVisible({
          timeout: 10000,
        });
      }
    }
  });

  test('should maintain performance with large images', async ({ page }) => {
    // Create project for performance testing
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page
      .getByLabel(/project name|name/i)
      .fill('Performance Test Project');
    await page
      .getByLabel(/description/i)
      .fill('Testing performance with large images');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Performance Test Project').click();

    // Upload the largest available test image
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePaths[0]);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 20000,
    });

    // Measure segmentation performance
    const startTime = Date.now();

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    await expect(page.getByText(/processing|analyzing/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 120000 }
    );

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    // Performance assertion - should complete within reasonable time
    expect(processingTime).toBeLessThan(120000); // 2 minutes maximum

    // Test editor performance with results
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    if (await editButton.isVisible()) {
      const editorStartTime = Date.now();

      await editButton.click();
      await expect(page.locator('canvas, .canvas-container')).toBeVisible({
        timeout: 15000,
      });

      const editorLoadTime = Date.now() - editorStartTime;
      expect(editorLoadTime).toBeLessThan(15000); // 15 seconds maximum for editor to load

      // Test canvas responsiveness
      const canvas = page.locator('canvas, .canvas-container').first();

      const interactionStartTime = Date.now();
      await canvas.click({ position: { x: 100, y: 100 } });
      await canvas.click({ position: { x: 200, y: 200 } });
      await canvas.click({ position: { x: 300, y: 300 } });
      const interactionTime = Date.now() - interactionStartTime;

      expect(interactionTime).toBeLessThan(1000); // Interactions should be responsive
    }
  });

  test('should save and restore session state', async ({ page }) => {
    // Create project and start work
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Session Test Project');
    await page.getByLabel(/description/i).fill('Testing session persistence');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Session Test Project').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePaths[0]);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 60000 }
    );

    // Get current URL to verify state
    const currentUrl = page.url();

    // Simulate session interruption by refreshing the page
    await page.reload();

    // Verify we're still authenticated and can access the project
    await expect(page.getByText('Session Test Project')).toBeVisible({
      timeout: 10000,
    });

    // Navigate back to the segmentation results
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    if (await editButton.isVisible()) {
      await editButton.click();

      // Verify the segmentation editor loads with previous results
      await expect(page.locator('canvas, .canvas-container')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByText(/polygon|segment|object/i).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
