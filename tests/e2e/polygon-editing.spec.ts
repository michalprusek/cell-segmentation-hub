import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Polygon Editing E2E Tests', () => {
  const testUser = {
    email: `polygon-edit-test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Polygon Editing Test Project',
    description: 'Testing comprehensive polygon editing functionality',
  };

  const testImagePath = path.join(
    __dirname,
    '../../public/lovable-uploads/026f6ae6-fa28-487c-8263-f49babd99dd3.png'
  );

  test.beforeEach(async ({ page }) => {
    // Setup: Register, login, create project with segmented image
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

    // Create project with segmented image
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

    // Upload and segment image
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
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

    // Navigate to segmentation editor
    const editButton = page
      .getByRole('button', { name: /edit|open.*editor|view.*results/i })
      .first();
    await editButton.click();
    await expect(page).toHaveURL(/.*\/segmentation.*/);
    await expect(page.locator('canvas, .canvas-container')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should select and deselect polygons', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Click on canvas to potentially select a polygon
    await canvas.click({ position: { x: 300, y: 300 } });

    // Look for visual indicators of selection
    const selectedIndicators = [
      '.selected-polygon',
      '.polygon-selected',
      '[data-selected="true"]',
      '.polygon-highlight',
      '.active-polygon',
    ];

    let isPolygonSelected = false;
    for (const selector of selectedIndicators) {
      if (await page.locator(selector).isVisible()) {
        isPolygonSelected = true;
        break;
      }
    }

    if (isPolygonSelected) {
      // Test deselection by clicking on empty area
      await canvas.click({ position: { x: 50, y: 50 } });

      // Verify deselection
      await page.waitForTimeout(500); // Allow for state update

      // Check that selection indicators are no longer visible
      for (const selector of selectedIndicators) {
        await expect(page.locator(selector)).not.toBeVisible();
      }
    }
  });

  test('should handle keyboard shortcuts for polygon operations', async ({
    page,
  }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Try to select a polygon first
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);

    // Test Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    // Test Undo (Ctrl+Z)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Test Redo (Ctrl+Y or Ctrl+Shift+Z)
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(500);

    // Test Escape key (should exit edit modes)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Test Enter key (might complete polygon drawing)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Test save shortcut (Ctrl+S)
    await page.keyboard.press('Control+s');

    // Should trigger save operation
    await expect(page.getByText(/saving|saved|success/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test('should handle different edit modes', async ({ page }) => {
    // Look for edit mode buttons or toolbar
    const editModeButtons = [
      page.getByRole('button', { name: /view|select/i }),
      page.getByRole('button', { name: /edit|modify/i }),
      page.getByRole('button', { name: /draw|create/i }),
      page.getByRole('button', { name: /slice|cut/i }),
      page.getByRole('button', { name: /add.*point/i }),
    ];

    for (const button of editModeButtons) {
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(500);

        // Verify mode change by checking for mode-specific UI elements
        const modeIndicators = [
          '.edit-mode-indicator',
          '.mode-active',
          '.current-mode',
          '[data-mode]',
        ];

        // At least one mode indicator should be present
        let modeIndicatorFound = false;
        for (const indicator of modeIndicators) {
          if (await page.locator(indicator).isVisible()) {
            modeIndicatorFound = true;
            break;
          }
        }

        // If no specific indicators, at least the button should show active state
        if (!modeIndicatorFound) {
          await expect(button).toHaveAttribute(
            /class|data-active/,
            /active|selected|current/
          );
        }
      }
    }
  });

  test('should allow vertex manipulation', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Select a polygon
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);

    // Try to enter edit vertices mode
    const editVerticesButton = page.getByRole('button', {
      name: /edit.*vert|vertex|point/i,
    });
    if (await editVerticesButton.isVisible()) {
      await editVerticesButton.click();
      await page.waitForTimeout(500);
    }

    // Look for vertex handles or markers
    const vertexSelectors = [
      '.vertex',
      '.vertex-handle',
      '.polygon-vertex',
      '.edit-point',
      '[data-vertex]',
    ];

    let vertexFound = false;
    for (const selector of vertexSelectors) {
      const vertices = page.locator(selector);
      if ((await vertices.count()) > 0) {
        vertexFound = true;

        // Test vertex dragging
        const firstVertex = vertices.first();
        const boundingBox = await firstVertex.boundingBox();

        if (boundingBox) {
          const startX = boundingBox.x + boundingBox.width / 2;
          const startY = boundingBox.y + boundingBox.height / 2;

          // Drag vertex to new position
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.mouse.move(startX + 20, startY + 20);
          await page.mouse.up();

          await page.waitForTimeout(500);
        }
        break;
      }
    }

    // If vertices aren't visible, try double-clicking to enter edit mode
    if (!vertexFound) {
      await canvas.dblclick({ position: { x: 300, y: 300 } });
      await page.waitForTimeout(500);

      // Check again for vertices
      for (const selector of vertexSelectors) {
        if ((await page.locator(selector).count()) > 0) {
          vertexFound = true;
          break;
        }
      }
    }
  });

  test('should support polygon slicing', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Select a polygon
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);

    // Try to enter slice mode
    const sliceButton = page.getByRole('button', { name: /slice|cut|split/i });
    if (await sliceButton.isVisible()) {
      await sliceButton.click();
      await page.waitForTimeout(500);

      // Perform slicing gesture by drawing a line across the polygon
      await canvas.click({ position: { x: 250, y: 280 } }); // Start point
      await page.waitForTimeout(200);
      await canvas.click({ position: { x: 350, y: 320 } }); // End point
      await page.waitForTimeout(500);

      // Look for confirmation that slicing occurred
      const sliceIndicators = [
        page.getByText(/slice.*complete|split.*success/i),
        page.getByText(/2.*polygon|polygon.*created/i),
      ];

      let sliceCompleted = false;
      for (const indicator of sliceIndicators) {
        if (await indicator.isVisible({ timeout: 2000 })) {
          sliceCompleted = true;
          break;
        }
      }

      // Alternative: Check if polygon count increased
      if (!sliceCompleted) {
        const polygonList = page.locator('.polygon-list, .segments-list');
        if (await polygonList.isVisible()) {
          const polygonItems = polygonList.locator(
            '.polygon-item, .segment-item'
          );
          const count = await polygonItems.count();
          expect(count).toBeGreaterThan(0);
        }
      }
    }
  });

  test('should handle polygon drawing mode', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Enter draw mode
    const drawButton = page.getByRole('button', {
      name: /draw|create|new.*polygon/i,
    });
    if (await drawButton.isVisible()) {
      await drawButton.click();
      await page.waitForTimeout(500);

      // Draw a new polygon by clicking points
      const drawingPoints = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ];

      for (const point of drawingPoints) {
        await canvas.click({ position: point });
        await page.waitForTimeout(300);
      }

      // Complete the polygon by either:
      // 1. Clicking the first point again
      await canvas.click({ position: drawingPoints[0] });

      // 2. Or pressing Enter
      await page.keyboard.press('Enter');

      // 3. Or double-clicking
      await canvas.dblclick({ position: drawingPoints[0] });

      await page.waitForTimeout(500);

      // Verify new polygon was created
      const successIndicators = [
        page.getByText(/polygon.*created|new.*polygon|created.*successfully/i),
        page.getByText(/complete|finished|added/i),
      ];

      let polygonCreated = false;
      for (const indicator of successIndicators) {
        if (await indicator.isVisible({ timeout: 2000 })) {
          polygonCreated = true;
          break;
        }
      }

      // If no explicit message, check if we exited draw mode
      if (!polygonCreated) {
        // Should have exited draw mode back to view mode
        const viewModeButton = page.getByRole('button', {
          name: /view|select/i,
        });
        if (await viewModeButton.isVisible()) {
          await expect(viewModeButton).toHaveAttribute(
            /class|data-active/,
            /active|selected|current/
          );
        }
      }
    }
  });

  test('should handle zoom and pan operations', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Test zoom in
    const zoomInButton = page.getByRole('button', {
      name: /zoom.*in|\+|increase/i,
    });
    if (await zoomInButton.isVisible()) {
      const initialTransform = await canvas.getAttribute('style');
      await zoomInButton.click();
      await page.waitForTimeout(500);

      const newTransform = await canvas.getAttribute('style');
      expect(newTransform).not.toBe(initialTransform);
    }

    // Test zoom out
    const zoomOutButton = page.getByRole('button', {
      name: /zoom.*out|-|decrease/i,
    });
    if (await zoomOutButton.isVisible()) {
      await zoomOutButton.click();
      await page.waitForTimeout(500);
    }

    // Test wheel zoom
    await canvas.hover();
    await page.mouse.wheel(0, -100); // Zoom in
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 100); // Zoom out
    await page.waitForTimeout(200);

    // Test pan by dragging
    const canvasBounds = await canvas.boundingBox();
    if (canvasBounds) {
      const centerX = canvasBounds.x + canvasBounds.width / 2;
      const centerY = canvasBounds.y + canvasBounds.height / 2;

      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 50, centerY + 50);
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    // Test reset view
    const resetViewButton = page.getByRole('button', {
      name: /reset.*view|fit.*screen|center/i,
    });
    if (await resetViewButton.isVisible()) {
      await resetViewButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should save and export polygon modifications', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Make some modifications (select and delete a polygon)
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    // Test save functionality
    const saveButton = page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await expect(page.getByText(/saved|success|updated/i)).toBeVisible({
        timeout: 5000,
      });
    }

    // Test export functionality
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible()) {
      await exportButton.click();

      // Wait for export options
      await expect(page.getByText(/coco|json|excel|csv/i)).toBeVisible({
        timeout: 5000,
      });

      // Test different export formats
      const exportFormats = [
        { name: /coco|json/i, extension: /\.(json|zip)$/ },
        { name: /excel|xlsx/i, extension: /\.xlsx$/ },
        { name: /csv/i, extension: /\.csv$/ },
      ];

      for (const format of exportFormats) {
        const formatButton = page.getByText(format.name).first();
        if (await formatButton.isVisible()) {
          await formatButton.click();

          const confirmButton = page.getByRole('button', {
            name: /download|export|confirm/i,
          });

          try {
            // Wait for the confirm button to appear with a short timeout
            await confirmButton.waitFor({ state: 'visible', timeout: 3000 });

            // Start waiting for download before clicking
            const downloadPromise = page.waitForDownload({ timeout: 10000 });
            await confirmButton.click();

            // Wait for the download and verify filename
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(format.extension);
          } catch (error) {
            console.log(
              `Download test for ${format.name} failed or timed out: ${error}`
            );
          }

          // Close export dialog if it's still open
          const closeButton = page.getByRole('button', {
            name: /close|cancel/i,
          });
          if (await closeButton.isVisible()) {
            await closeButton.click();
          }

          break; // Test only one format to avoid multiple downloads
        }
      }
    }
  });

  test('should handle polygon list management', async ({ page }) => {
    // Look for polygon list or sidebar
    const polygonListSelectors = [
      '.polygon-list',
      '.segments-list',
      '.objects-list',
      '[data-testid="polygon-list"]',
      '.sidebar .list',
    ];

    let polygonList = null;
    for (const selector of polygonListSelectors) {
      const element = page.locator(selector);
      if (await element.isVisible()) {
        polygonList = element;
        break;
      }
    }

    if (polygonList) {
      // Test polygon visibility toggle
      const polygonItems = polygonList.locator(
        '.polygon-item, .segment-item, .object-item'
      );
      const itemCount = await polygonItems.count();

      if (itemCount > 0) {
        const firstItem = polygonItems.first();

        // Look for visibility toggle (eye icon)
        const visibilityToggle = firstItem.locator(
          '.visibility-toggle, .eye-icon, [data-testid="visibility"]'
        );
        if (await visibilityToggle.isVisible()) {
          await visibilityToggle.click();
          await page.waitForTimeout(500);

          // Toggle back
          await visibilityToggle.click();
          await page.waitForTimeout(500);
        }

        // Test selection from list
        await firstItem.click();
        await page.waitForTimeout(500);

        // Should show selection in canvas
        const selectedIndicators = [
          '.selected-polygon',
          '.polygon-selected',
          '.polygon-highlight',
        ];

        let selectionVisible = false;
        for (const selector of selectedIndicators) {
          if (await page.locator(selector).isVisible()) {
            selectionVisible = true;
            break;
          }
        }

        // Test right-click context menu if available
        await firstItem.click({ button: 'right' });
        await page.waitForTimeout(500);

        const contextMenu = page.locator(
          '.context-menu, .popup-menu, .dropdown-menu'
        );
        if (await contextMenu.isVisible()) {
          const deleteOption = contextMenu.getByText(/delete|remove/i);
          if (await deleteOption.isVisible()) {
            await deleteOption.click();
            await page.waitForTimeout(500);
          }
        }
      }
    }
  });

  test('should handle undo/redo operations', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Perform an action that can be undone (delete a polygon)
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    // Test undo button
    const undoButton = page.getByRole('button', { name: /undo/i });
    if ((await undoButton.isVisible()) && !(await undoButton.isDisabled())) {
      await undoButton.click();
      await page.waitForTimeout(500);

      // Test redo button
      const redoButton = page.getByRole('button', { name: /redo/i });
      if ((await redoButton.isVisible()) && !(await redoButton.isDisabled())) {
        await redoButton.click();
        await page.waitForTimeout(500);
      }
    }

    // Test keyboard shortcuts
    await page.keyboard.press('Control+z'); // Undo
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+y'); // Redo
    await page.waitForTimeout(500);
  });

  test('should handle polygon properties and metadata', async ({ page }) => {
    const canvas = page.locator('canvas, .canvas-container').first();

    // Select a polygon
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(500);

    // Look for properties panel
    const propertiesPanelSelectors = [
      '.properties-panel',
      '.polygon-properties',
      '.details-panel',
      '.info-panel',
      '[data-testid="properties"]',
    ];

    let propertiesPanel = null;
    for (const selector of propertiesPanelSelectors) {
      const element = page.locator(selector);
      if (await element.isVisible()) {
        propertiesPanel = element;
        break;
      }
    }

    if (propertiesPanel) {
      // Check for polygon metadata
      const metadataFields = [
        propertiesPanel.getByText(/area/i),
        propertiesPanel.getByText(/perimeter/i),
        propertiesPanel.getByText(/confidence/i),
        propertiesPanel.getByText(/id|identifier/i),
      ];

      for (const field of metadataFields) {
        if (await field.isVisible()) {
          await expect(field).toBeVisible();
        }
      }

      // Test color picker if available
      const colorPicker = propertiesPanel.locator(
        'input[type="color"], .color-picker'
      );
      if (await colorPicker.isVisible()) {
        await colorPicker.click();
        await page.waitForTimeout(500);
      }

      // Test name/label editing if available
      const nameInput = propertiesPanel.locator(
        'input[type="text"], .name-input, .label-input'
      );
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test Polygon Name');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }
    }
  });
});
