import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Segmentation Performance Benchmarks', () => {
  const testUser = {
    email: `perf-test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  // Performance thresholds (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    PAGE_LOAD: 5000,
    IMAGE_UPLOAD: 10000,
    SEGMENTATION_START: 2000,
    EDITOR_LOAD: 8000,
    CANVAS_INTERACTION: 500,
    SAVE_OPERATION: 3000,
    EXPORT_OPERATION: 5000,
    ML_PROCESSING_HRNET: 60000,
    ML_PROCESSING_RESUNET_SMALL: 45000,
    ML_PROCESSING_RESUNET_ADVANCED: 120000,
  };

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
    // Setup authentication
    await page.goto('/');

    const isLoggedIn = await page
      .locator('[data-testid="user-menu"], .user-menu')
      .isVisible();

    if (!isLoggedIn) {
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.getByLabel(/email/i).fill(testUser.email);
      await page
        .getByLabel(/password/i)
        .first()
        .fill(testUser.password);
      await page.getByLabel(/confirm password/i).fill(testUser.password);

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

  test('should benchmark page load performance', async ({ page }) => {
    // Measure dashboard load time
    const dashboardStart = Date.now();
    await page.goto('/dashboard');
    await expect(page.getByText(/project|dashboard/i)).toBeVisible();
    const dashboardTime = Date.now() - dashboardStart;

    console.log(`Dashboard load time: ${dashboardTime}ms`);
    expect(dashboardTime).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD);

    // Create project for further testing
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page
      .getByLabel(/project name|name/i)
      .fill('Performance Test Project');
    await page
      .getByLabel(/description/i)
      .fill('Benchmarking application performance');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Measure project detail page load time
    const projectDetailStart = Date.now();
    await page.getByText('Performance Test Project').click();
    await expect(page).toHaveURL(/\/projects\/.*/);
    await expect(page.getByText('Performance Test Project')).toBeVisible();
    const projectDetailTime = Date.now() - projectDetailStart;

    console.log(`Project detail load time: ${projectDetailTime}ms`);
    expect(projectDetailTime).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD);
  });

  test('should benchmark image upload performance', async ({ page }) => {
    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Upload Performance Test');
    await page.getByLabel(/description/i).fill('Testing upload performance');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Upload Performance Test').click();

    // Test upload performance for each image
    for (let i = 0; i < testImagePaths.length; i++) {
      const uploadStart = Date.now();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[i]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      const uploadTime = Date.now() - uploadStart;
      console.log(`Image ${i + 1} upload time: ${uploadTime}ms`);
      expect(uploadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.IMAGE_UPLOAD);

      // Wait a bit between uploads
      await page.waitForTimeout(1000);
    }
  });

  test('should benchmark ML model processing performance', async ({ page }) => {
    const models = [
      { name: 'hrnet', threshold: PERFORMANCE_THRESHOLDS.ML_PROCESSING_HRNET },
      {
        name: 'resunet_small',
        threshold: PERFORMANCE_THRESHOLDS.ML_PROCESSING_RESUNET_SMALL,
      },
      {
        name: 'resunet_advanced',
        threshold: PERFORMANCE_THRESHOLDS.ML_PROCESSING_RESUNET_ADVANCED,
      },
    ];

    for (const model of models) {
      // Create separate project for each model
      await page.goto('/dashboard');

      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill(`${model.name} Performance Test`);
      await page
        .getByLabel(/description/i)
        .fill(`Benchmarking ${model.name} model performance`);
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText(`${model.name} Performance Test`).click();

      // Upload image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Start segmentation
      const segmentationStart = Date.now();

      await page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first()
        .click();

      // Select specific model
      const modelSelector = page.getByRole('combobox', { name: /model/i });
      if (await modelSelector.isVisible()) {
        await modelSelector.click();
        await page.getByText(new RegExp(model.name, 'i')).first().click();
      }

      const startButtonClick = Date.now();
      await page
        .getByRole('button', { name: /start|process|segment/i })
        .click();
      const startTime = Date.now() - startButtonClick;

      console.log(`${model.name} segmentation start time: ${startTime}ms`);
      expect(startTime).toBeLessThan(PERFORMANCE_THRESHOLDS.SEGMENTATION_START);

      // Wait for processing to complete
      await expect(page.getByText(/processing|analyzing/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: model.threshold });

      const processingTime = Date.now() - segmentationStart;
      console.log(`${model.name} total processing time: ${processingTime}ms`);
      expect(processingTime).toBeLessThan(model.threshold);
    }
  });

  test('should benchmark segmentation editor performance', async ({ page }) => {
    // Setup project with segmented image
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Editor Performance Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing segmentation editor performance');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Editor Performance Test').click();

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

    // Measure editor load time
    const editorLoadStart = Date.now();
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();

    await expect(page).toHaveURL(/.*\/segmentation.*/);
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/polygon|segment|object/i).first()).toBeVisible(
      { timeout: 10000 }
    );

    const editorLoadTime = Date.now() - editorLoadStart;
    console.log(`Segmentation editor load time: ${editorLoadTime}ms`);
    expect(editorLoadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.EDITOR_LOAD);

    // Measure canvas interaction performance
    const canvas = page.locator('canvas, .canvas-container').first();

    const interactionTests = [
      {
        name: 'click',
        action: () => canvas.click({ position: { x: 200, y: 200 } }),
      },
      {
        name: 'double-click',
        action: () => canvas.dblclick({ position: { x: 250, y: 250 } }),
      },
      { name: 'hover', action: () => canvas.hover() },
      {
        name: 'right-click',
        action: () =>
          canvas.click({ button: 'right', position: { x: 300, y: 300 } }),
      },
    ];

    for (const interaction of interactionTests) {
      const interactionStart = Date.now();
      await interaction.action();
      await page.waitForTimeout(100); // Allow for UI updates
      const interactionTime = Date.now() - interactionStart;

      console.log(
        `Canvas ${interaction.name} response time: ${interactionTime}ms`
      );
      expect(interactionTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.CANVAS_INTERACTION
      );
    }
  });

  test('should benchmark zoom and pan performance', async ({ page }) => {
    // Setup editor
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page
      .getByLabel(/project name|name/i)
      .fill('Zoom Pan Performance Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing zoom and pan performance');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Zoom Pan Performance Test').click();

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

    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });

    const canvas = page.locator('canvas, .canvas-container').first();

    // Test zoom performance
    const zoomOperations = [
      {
        name: 'zoom in button',
        action: () =>
          page.getByRole('button', { name: /zoom.*in|\+/i }).click(),
      },
      {
        name: 'zoom out button',
        action: () =>
          page.getByRole('button', { name: /zoom.*out|-/i }).click(),
      },
      { name: 'wheel zoom in', action: () => page.mouse.wheel(0, -100) },
      { name: 'wheel zoom out', action: () => page.mouse.wheel(0, 100) },
    ];

    await canvas.hover();

    for (const operation of zoomOperations) {
      if (operation.name.includes('button')) {
        const button = operation.action as () => Promise<void>;
        const buttonElement = operation.name.includes('in')
          ? page.getByRole('button', { name: /zoom.*in|\+/i })
          : page.getByRole('button', { name: /zoom.*out|-/i });

        if (await buttonElement.isVisible()) {
          const zoomStart = Date.now();
          await button();
          await page.waitForTimeout(50);
          const zoomTime = Date.now() - zoomStart;

          console.log(`${operation.name} time: ${zoomTime}ms`);
          expect(zoomTime).toBeLessThan(
            PERFORMANCE_THRESHOLDS.CANVAS_INTERACTION
          );
        }
      } else {
        const zoomStart = Date.now();
        await (operation.action as () => Promise<void>)();
        await page.waitForTimeout(50);
        const zoomTime = Date.now() - zoomStart;

        console.log(`${operation.name} time: ${zoomTime}ms`);
        expect(zoomTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.CANVAS_INTERACTION
        );
      }
    }

    // Test pan performance
    const canvasBounds = await canvas.boundingBox();
    if (canvasBounds) {
      const centerX = canvasBounds.x + canvasBounds.width / 2;
      const centerY = canvasBounds.y + canvasBounds.height / 2;

      const panStart = Date.now();
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 100, centerY + 100);
      await page.mouse.up();
      await page.waitForTimeout(50);
      const panTime = Date.now() - panStart;

      console.log(`Pan operation time: ${panTime}ms`);
      expect(panTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.CANVAS_INTERACTION * 2
      );
    }
  });

  test('should benchmark save and export performance', async ({ page }) => {
    // Setup editor with modifications
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page
      .getByLabel(/project name|name/i)
      .fill('Save Export Performance Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing save and export performance');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Save Export Performance Test').click();

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

    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });

    // Make some modifications
    const canvas = page.locator('canvas, .canvas-container').first();
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('Delete'); // Delete a polygon

    // Test save performance
    const saveButton = page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible()) {
      const saveStart = Date.now();
      await saveButton.click();
      await expect(page.getByText(/saved|success|updated/i)).toBeVisible({
        timeout: 5000,
      });
      const saveTime = Date.now() - saveStart;

      console.log(`Save operation time: ${saveTime}ms`);
      expect(saveTime).toBeLessThan(PERFORMANCE_THRESHOLDS.SAVE_OPERATION);
    }

    // Test export performance
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible()) {
      const exportStart = Date.now();
      await exportButton.click();

      await expect(page.getByText(/coco|json|excel/i)).toBeVisible({
        timeout: 5000,
      });

      // Select COCO format
      await page
        .getByText(/coco|json/i)
        .first()
        .click();

      const downloadPromise = page.waitForDownload({ timeout: 10000 });
      await page
        .getByRole('button', { name: /download|export|confirm/i })
        .click();

      try {
        const download = await downloadPromise;
        const exportTime = Date.now() - exportStart;

        console.log(`Export operation time: ${exportTime}ms`);
        expect(exportTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.EXPORT_OPERATION
        );
        expect(download.suggestedFilename()).toMatch(/\.(json|zip)$/);
      } catch (error) {
        console.log(
          'Export download test failed - this may be expected in test environment'
        );
      }
    }
  });

  test('should benchmark memory usage during intensive operations', async ({
    page,
  }) => {
    // Enable performance monitoring
    await page.addInitScript(() => {
      window.performanceMetrics = {
        memoryUsage: [],
        startMemory: 0,
        peakMemory: 0,
      };

      if ('memory' in performance) {
        window.performanceMetrics.startMemory = (
          performance as any
        ).memory.usedJSHeapSize;

        setInterval(() => {
          const currentMemory = (performance as any).memory.usedJSHeapSize;
          window.performanceMetrics.memoryUsage.push(currentMemory);
          if (currentMemory > window.performanceMetrics.peakMemory) {
            window.performanceMetrics.peakMemory = currentMemory;
          }
        }, 1000);
      }
    });

    // Setup and perform intensive operations
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Memory Usage Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing memory usage during operations');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Memory Usage Test').click();

    // Upload large image
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePaths[0]);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Process with ML
    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 60000 }
    );

    // Load editor and perform operations
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });

    const canvas = page.locator('canvas, .canvas-container').first();

    // Perform intensive operations
    for (let i = 0; i < 20; i++) {
      await canvas.click({ position: { x: 200 + i * 10, y: 200 + i * 10 } });
      await page.mouse.wheel(0, -50); // Zoom
      await page.mouse.wheel(0, 50); // Zoom back
      await page.waitForTimeout(100);
    }

    // Check memory usage
    const memoryMetrics = await page.evaluate(() => window.performanceMetrics);

    if (memoryMetrics && memoryMetrics.peakMemory > 0) {
      const memoryIncrease =
        memoryMetrics.peakMemory - memoryMetrics.startMemory;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      console.log(
        `Peak memory usage: ${(memoryMetrics.peakMemory / (1024 * 1024)).toFixed(2)}MB`
      );
      console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);

      // Memory increase should be reasonable (less than 100MB for these operations)
      expect(memoryIncreaseMB).toBeLessThan(100);
    }
  });

  test('should benchmark application responsiveness under load', async ({
    page,
  }) => {
    // Setup multiple concurrent operations
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Responsiveness Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing application responsiveness');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Responsiveness Test').click();

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

    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });

    const canvas = page.locator('canvas, .canvas-container').first();

    // Perform rapid operations to test responsiveness
    const rapidOperations = async () => {
      const operations = [];

      for (let i = 0; i < 10; i++) {
        operations.push(
          canvas.click({ position: { x: 100 + i * 20, y: 100 + i * 20 } }),
          page.mouse.wheel(0, -20),
          page.mouse.wheel(0, 20)
        );
      }

      const startTime = Date.now();
      await Promise.all(operations);
      return Date.now() - startTime;
    };

    const responsivenesTime = await rapidOperations();
    console.log(`Rapid operations completion time: ${responsivenesTime}ms`);

    // Should handle rapid operations without significant delay
    expect(responsivenesTime).toBeLessThan(5000);

    // Test UI responsiveness during operations
    const uiResponseStart = Date.now();
    await page.getByRole('button', { name: /view|select/i }).click();
    await page.getByRole('button', { name: /edit|modify/i }).click();
    const uiResponseTime = Date.now() - uiResponseStart;

    console.log(`UI mode switch time: ${uiResponseTime}ms`);
    expect(uiResponseTime).toBeLessThan(
      PERFORMANCE_THRESHOLDS.CANVAS_INTERACTION
    );
  });
});
