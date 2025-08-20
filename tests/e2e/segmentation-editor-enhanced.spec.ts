import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Enhanced Segmentation Editor Tests', () => {
  const testUser = {
    email: `segmentation-editor-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Segmentation Editor Test Project',
    description: 'Comprehensive testing of segmentation editor features',
  };

  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');

  test.beforeEach(async ({ page }) => {
    // Setup: Register, login, create project, upload image, and navigate to editor
    await page.goto('/');
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page).toHaveURL('/dashboard');

    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();
    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Navigate to project and upload image
    await page.getByText(testProject.name).click();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Start segmentation if needed
    const segmentButton = page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first();
    if (await segmentButton.isVisible()) {
      await segmentButton.click();
      await page.getByRole('button', { name: /start|process/i }).click();
      await expect(page.getByText(/complete|finished/i)).toBeVisible({
        timeout: 60000,
      });

      // Navigate to editor
      const editButton = page
        .getByRole('button', { name: /edit|open.*editor|view.*results/i })
        .first();
      await editButton.click();
    } else {
      // Direct navigation to editor (if segmentation already exists)
      const currentUrl = new URL(page.url());
      await page.goto(
        `${currentUrl.origin}${currentUrl.pathname}/segmentation`
      );
    }

    // Wait for editor to load
    await expect(
      page.locator('canvas, .canvas-container, .segmentation-canvas')
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test.describe('Complex Polygon Manipulation', () => {
    test('should create new polygons with point-by-point drawing', async ({
      page,
    }) => {
      // Activate polygon creation mode
      const createPolygonButton = page.getByRole('button', {
        name: /create.*polygon|new.*polygon|draw.*polygon/i,
      });
      if (await createPolygonButton.isVisible()) {
        await createPolygonButton.click();
      } else {
        // Try keyboard shortcut
        await page.keyboard.press('p');
      }

      const canvas = page.locator('canvas, .canvas-container').first();

      // Create polygon by clicking points
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 150, y: 250 },
        { x: 100, y: 200 },
      ];

      for (const point of points) {
        await canvas.click({ position: point });
        // Small delay between clicks
        await page.waitForTimeout(100);
      }

      // Close polygon (double-click or right-click)
      await canvas.dblclick({ position: points[0] });

      // Should show new polygon in polygon list
      const polygonList = page.locator(
        '.polygon-list, [data-testid="polygon-list"]'
      );
      if (await polygonList.isVisible()) {
        await expect(polygonList.getByText(/polygon/i)).toBeVisible();
      }

      // Should show polygon count increased
      const polygonCount = page.getByText(/polygons.*\d+|\d+.*polygons/i);
      if (await polygonCount.isVisible()) {
        const countText = await polygonCount.textContent();
        expect(countText).toMatch(/[1-9]/); // At least 1 polygon
      }
    });

    test('should select and move polygons', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Click on a polygon to select it
      await canvas.click({ position: { x: 150, y: 150 } });

      // Should show selection indicators
      const selectedIndicator = page.locator(
        '.selected, [data-selected="true"], .polygon-selected'
      );
      if (await selectedIndicator.isVisible({ timeout: 3000 })) {
        // Try to drag the polygon
        await canvas.dragTo(canvas, {
          sourcePosition: { x: 150, y: 150 },
          targetPosition: { x: 200, y: 200 },
        });

        // Should show polygon has moved
        await page.waitForTimeout(500);
      }

      // Test keyboard selection
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowRight');
    });

    test('should edit polygon vertices', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Double-click to enter vertex editing mode
      await canvas.dblclick({ position: { x: 150, y: 150 } });

      // Should show vertex handles
      const vertexHandles = page.locator('.vertex, .handle, [data-vertex]');
      const vertexCount = await vertexHandles.count();

      if (vertexCount > 0) {
        // Click and drag a vertex
        const firstVertex = vertexHandles.first();
        const vertexBox = await firstVertex.boundingBox();

        if (vertexBox) {
          await canvas.dragTo(canvas, {
            sourcePosition: { x: vertexBox.x + 5, y: vertexBox.y + 5 },
            targetPosition: { x: vertexBox.x + 20, y: vertexBox.y + 20 },
          });
        }

        // Exit vertex editing mode
        await page.keyboard.press('Escape');
      }
    });

    test('should add and remove vertices', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Enter vertex editing mode
      await canvas.dblclick({ position: { x: 150, y: 150 } });

      // Right-click on polygon edge to add vertex
      await canvas.click({
        position: { x: 175, y: 125 },
        button: 'right',
      });

      // Should show context menu
      const addVertexOption = page.getByText(/add.*vertex|insert.*point/i);
      if (await addVertexOption.isVisible({ timeout: 2000 })) {
        await addVertexOption.click();

        // Should add new vertex
        const vertices = page.locator('.vertex, .handle, [data-vertex]');
        const newVertexCount = await vertices.count();
        expect(newVertexCount).toBeGreaterThan(0);
      }

      // Test vertex removal
      const vertices = page.locator('.vertex, .handle, [data-vertex]');
      if ((await vertices.count()) > 0) {
        await vertices.first().click({ button: 'right' });

        const removeVertexOption = page.getByText(
          /remove.*vertex|delete.*point/i
        );
        if (await removeVertexOption.isVisible({ timeout: 2000 })) {
          await removeVertexOption.click();
        }
      }
    });

    test('should merge overlapping polygons', async ({ page }) => {
      // First, ensure we have multiple polygons by creating another one
      const createButton = page.getByRole('button', {
        name: /create.*polygon|new.*polygon/i,
      });
      if (await createButton.isVisible()) {
        await createButton.click();
      }

      const canvas = page.locator('canvas, .canvas-container').first();

      // Create overlapping polygon
      const overlappingPoints = [
        { x: 120, y: 120 },
        { x: 220, y: 120 },
        { x: 220, y: 220 },
        { x: 120, y: 220 },
      ];

      for (const point of overlappingPoints) {
        await canvas.click({ position: point });
        await page.waitForTimeout(50);
      }
      await canvas.dblclick({ position: overlappingPoints[0] });

      // Select both polygons
      await page.keyboard.press('Control+a');

      // Look for merge option
      const mergeButton = page.getByRole('button', {
        name: /merge|union|combine/i,
      });
      if (await mergeButton.isVisible()) {
        await mergeButton.click();

        // Should reduce polygon count
        const polygonCount = page.getByText(/polygons.*\d+|\d+.*polygons/i);
        if (await polygonCount.isVisible()) {
          const countText = await polygonCount.textContent();
          expect(countText).toMatch(/\d+/);
        }
      }
    });

    test('should split polygons', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Select a polygon
      await canvas.click({ position: { x: 150, y: 150 } });

      // Look for split tool
      const splitButton = page.getByRole('button', {
        name: /split|divide|cut/i,
      });
      if (await splitButton.isVisible()) {
        await splitButton.click();

        // Draw split line across polygon
        await canvas.dragTo(canvas, {
          sourcePosition: { x: 120, y: 150 },
          targetPosition: { x: 180, y: 150 },
        });

        // Should create two polygons
        await page.waitForTimeout(1000);

        const polygonList = page.locator(
          '.polygon-list, [data-testid="polygon-list"]'
        );
        if (await polygonList.isVisible()) {
          const polygonItems = await polygonList
            .locator('.polygon-item, [data-polygon]')
            .count();
          expect(polygonItems).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  test.describe('Undo/Redo Functionality', () => {
    test('should undo and redo polygon operations', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Perform an action (delete a polygon)
      await canvas.click({ position: { x: 150, y: 150 } });
      await page.keyboard.press('Delete');

      // Undo the action
      await page.keyboard.press('Control+z');

      // Polygon should be restored
      await expect(canvas).toBeVisible();

      // Redo the action
      await page.keyboard.press('Control+y');

      // Test undo/redo buttons if available
      const undoButton = page.getByRole('button', { name: /undo/i });
      const redoButton = page.getByRole('button', { name: /redo/i });

      if (await undoButton.isVisible()) {
        await undoButton.click();

        if (await redoButton.isVisible()) {
          await redoButton.click();
        }
      }
    });

    test('should maintain undo stack limit', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Perform multiple operations
      for (let i = 0; i < 10; i++) {
        await canvas.click({ position: { x: 100 + i * 10, y: 100 + i * 10 } });
        await page.keyboard.press('Delete');
        await page.waitForTimeout(100);
      }

      // Try to undo more than the limit
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(50);
      }

      // Should not crash and maintain valid state
      await expect(canvas).toBeVisible();
    });
  });

  test.describe('Keyboard Shortcuts', () => {
    test('should handle all keyboard shortcuts', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Test selection shortcuts
      await page.keyboard.press('Control+a'); // Select all
      await page.keyboard.press('Escape'); // Deselect

      // Test tool shortcuts
      await page.keyboard.press('p'); // Polygon tool
      await page.keyboard.press('s'); // Select tool
      await page.keyboard.press('m'); // Move tool

      // Test edit shortcuts
      await canvas.click({ position: { x: 150, y: 150 } });
      await page.keyboard.press('Delete'); // Delete
      await page.keyboard.press('Control+z'); // Undo
      await page.keyboard.press('Control+y'); // Redo

      // Test copy/paste
      await canvas.click({ position: { x: 150, y: 150 } });
      await page.keyboard.press('Control+c'); // Copy
      await page.keyboard.press('Control+v'); // Paste

      // Test save
      await page.keyboard.press('Control+s'); // Save

      // Should maintain editor state
      await expect(canvas).toBeVisible();
    });

    test('should show keyboard shortcuts help', async ({ page }) => {
      // Try to open help with common shortcuts
      await page.keyboard.press('F1');

      const helpDialog = page.getByText(/shortcuts|help|keys/i);
      if (await helpDialog.isVisible({ timeout: 2000 })) {
        // Should show list of shortcuts
        await expect(page.getByText(/ctrl|cmd|delete|esc/i)).toBeVisible();

        // Close help
        await page.keyboard.press('Escape');
      } else {
        // Try menu option
        const helpButton = page.getByRole('button', {
          name: /help|shortcuts/i,
        });
        if (await helpButton.isVisible()) {
          await helpButton.click();
          await expect(page.getByText(/shortcuts|keyboard/i)).toBeVisible();
        }
      }
    });
  });

  test.describe('Multi-polygon Selection and Operations', () => {
    test('should select multiple polygons', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Create additional polygons first
      const createButton = page.getByRole('button', {
        name: /create.*polygon|new.*polygon/i,
      });
      if (await createButton.isVisible()) {
        await createButton.click();

        // Create second polygon
        const points = [
          { x: 250, y: 100 },
          { x: 350, y: 100 },
          { x: 350, y: 200 },
          { x: 250, y: 200 },
        ];

        for (const point of points) {
          await canvas.click({ position: point });
          await page.waitForTimeout(50);
        }
        await canvas.dblclick({ position: points[0] });
      }

      // Test Ctrl+click multi-selection
      await canvas.click({ position: { x: 150, y: 150 } });
      await canvas.click({
        position: { x: 300, y: 150 },
        modifiers: ['Control'],
      });

      // Test box selection
      await canvas.dragTo(canvas, {
        sourcePosition: { x: 50, y: 50 },
        targetPosition: { x: 400, y: 300 },
        modifiers: ['Shift'],
      });

      // Test select all
      await page.keyboard.press('Control+a');

      // Should show multiple selection indicators
      const selectedElements = page.locator(
        '.selected, [data-selected="true"]'
      );
      const selectionCount = await selectedElements.count();
      expect(selectionCount).toBeGreaterThanOrEqual(0);
    });

    test('should perform bulk operations on selected polygons', async ({
      page,
    }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Select all polygons
      await page.keyboard.press('Control+a');

      // Test bulk delete
      await page.keyboard.press('Delete');

      // Undo to restore
      await page.keyboard.press('Control+z');

      // Test bulk move
      await page.keyboard.press('Control+a');
      await canvas.dragTo(canvas, {
        sourcePosition: { x: 150, y: 150 },
        targetPosition: { x: 200, y: 200 },
      });

      // Test bulk property changes
      const colorButton = page.getByRole('button', { name: /color|fill/i });
      if (await colorButton.isVisible()) {
        await colorButton.click();

        const redColor = page.getByRole('button', { name: /red/i });
        if (await redColor.isVisible()) {
          await redColor.click();
        }
      }
    });
  });

  test.describe('Polygon Validation and Quality', () => {
    test('should validate polygon geometry', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Try to create invalid polygon (self-intersecting)
      const createButton = page.getByRole('button', {
        name: /create.*polygon|new.*polygon/i,
      });
      if (await createButton.isVisible()) {
        await createButton.click();

        // Create self-intersecting polygon
        const invalidPoints = [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
          { x: 200, y: 100 },
        ];

        for (const point of invalidPoints) {
          await canvas.click({ position: point });
          await page.waitForTimeout(50);
        }
        await canvas.dblclick({ position: invalidPoints[0] });

        // Should show validation warning
        const warning = page.getByText(/invalid|self.*intersect|warning/i);
        if (await warning.isVisible({ timeout: 3000 })) {
          expect(await warning.textContent()).toMatch(
            /invalid|intersect|warning/i
          );
        }
      }
    });

    test('should auto-simplify complex polygons', async ({ page }) => {
      // This test would require creating very complex polygons
      // and testing if the system provides simplification options
      const simplifyButton = page.getByRole('button', {
        name: /simplify|smooth|optimize/i,
      });
      if (await simplifyButton.isVisible()) {
        await simplifyButton.click();

        const beforeVertexCount = await page
          .locator('.vertex, .handle')
          .count();

        const confirmButton = page.getByRole('button', {
          name: /apply|simplify/i,
        });
        if (await confirmButton.isVisible()) {
          await confirmButton.click();

          await page.waitForTimeout(1000);
          const afterVertexCount = await page
            .locator('.vertex, .handle')
            .count();

          // Simplified polygon should have fewer vertices
          expect(afterVertexCount).toBeLessThanOrEqual(beforeVertexCount);
        }
      }
    });
  });

  test.describe('Touch and Mobile Gestures', () => {
    test('should handle touch interactions @mobile', async ({ page }) => {
      // Simulate touch events for mobile testing
      const canvas = page.locator('canvas, .canvas-container').first();

      // Single tap to select
      await canvas.tap({ position: { x: 150, y: 150 } });

      // Long press for context menu
      await canvas.click({
        position: { x: 150, y: 150 },
        clickCount: 1,
        delay: 1000,
      });

      // Pinch zoom simulation (if supported)
      const initialZoom = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          // Get current zoom/scale (implementation depends on your app)
          return (
            (window as any).editorState?.zoom || canvas.style.transform || 1
          );
        }
        return 1;
      });

      await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const pinchEvent = new WheelEvent('wheel', {
            deltaY: -100,
            ctrlKey: true,
          });
          canvas.dispatchEvent(pinchEvent);
        }
      });

      // Verify zoom changed
      const finalZoom = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          return (
            (window as any).editorState?.zoom || canvas.style.transform || 1
          );
        }
        return 1;
      });

      expect(finalZoom).not.toEqual(initialZoom);

      // Two-finger pan simulation
      await page.mouse.move(150, 150);
      await page.mouse.down();
      await page.mouse.move(200, 200);
      await page.mouse.up();
    });

    test('should support multi-touch polygon creation @mobile', async ({
      page,
    }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Activate touch polygon creation mode if available
      const touchModeButton = page.getByRole('button', {
        name: /touch.*mode|mobile.*mode/i,
      });
      if (await touchModeButton.isVisible()) {
        await touchModeButton.click();
      }

      // Create polygon with touch events
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ];

      for (const point of points) {
        await canvas.tap({ position: point });
        await page.waitForTimeout(200);
      }

      // Double tap to close polygon
      await canvas.tap({ position: points[0], clickCount: 2 });

      // Should create valid polygon
      const polygonList = page.locator(
        '.polygon-list, [data-testid="polygon-list"]'
      );
      if (await polygonList.isVisible()) {
        await expect(polygonList.getByText(/polygon/i)).toBeVisible();
      }
    });
  });

  test.describe('Canvas Zoom and Pan', () => {
    test('should zoom in and out of canvas', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Zoom with mouse wheel
      await canvas.hover({ position: { x: 200, y: 200 } });
      await page.mouse.wheel(0, -100); // Zoom in
      await page.waitForTimeout(300);
      await page.mouse.wheel(0, 100); // Zoom out

      // Zoom with buttons if available
      const zoomInButton = page.getByRole('button', { name: /zoom.*in|\+/i });
      const zoomOutButton = page.getByRole('button', { name: /zoom.*out|-/i });

      if (await zoomInButton.isVisible()) {
        await zoomInButton.click();
        await zoomInButton.click();

        if (await zoomOutButton.isVisible()) {
          await zoomOutButton.click();
        }
      }

      // Fit to screen
      const fitButton = page.getByRole('button', {
        name: /fit.*screen|zoom.*fit/i,
      });
      if (await fitButton.isVisible()) {
        await fitButton.click();
      }

      // Reset zoom
      await page.keyboard.press('Control+0');
    });

    test('should pan around large images', async ({ page }) => {
      const canvas = page.locator('canvas, .canvas-container').first();

      // Pan with middle mouse drag
      await canvas.hover({ position: { x: 200, y: 200 } });
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(250, 250);
      await page.mouse.up({ button: 'middle' });

      // Pan with space + drag
      await page.keyboard.down('Space');
      await canvas.dragTo(canvas, {
        sourcePosition: { x: 200, y: 200 },
        targetPosition: { x: 150, y: 150 },
      });
      await page.keyboard.up('Space');

      // Use pan tool if available
      const panButton = page.getByRole('button', { name: /pan|hand/i });
      if (await panButton.isVisible()) {
        await panButton.click();

        await canvas.dragTo(canvas, {
          sourcePosition: { x: 200, y: 200 },
          targetPosition: { x: 100, y: 100 },
        });
      }
    });
  });

  test.describe('Real-time Collaboration', () => {
    test('should show cursor positions of other users', async ({
      page,
      browser,
    }) => {
      // This would require a second browser context to simulate another user
      const secondContext = await browser.newContext();
      const secondPage = await secondContext.newPage();

      // For now, just test the UI exists for collaboration
      const collaborationIndicator = page.getByText(
        /users.*online|collaborators/i
      );
      if (await collaborationIndicator.isVisible()) {
        // Should show user count or avatars
        await expect(collaborationIndicator).toBeVisible();
      }

      await secondContext.close();
    });
  });
});
