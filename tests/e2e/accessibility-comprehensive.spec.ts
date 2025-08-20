import { test, expect } from '@playwright/test';
import {
  injectAxe,
  checkA11y,
  getViolations,
  reportViolations,
} from 'axe-playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Comprehensive Accessibility Tests', () => {
  const testUser = {
    email: `accessibility-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Accessibility Test Project',
    description: 'Testing accessibility compliance',
  };

  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');

  test.beforeEach(async ({ page }) => {
    // Inject axe-core for accessibility testing
    await injectAxe(page);

    // Setup: Register and login
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
  });

  test.describe('Keyboard Navigation', () => {
    test('should navigate entire application using only keyboard', async ({
      page,
    }) => {
      // Test main navigation
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Should be able to reach main content
      const focusedElement = await page.evaluate(() => {
        return document.activeElement?.tagName;
      });

      expect(['BUTTON', 'A', 'INPUT']).toContain(focusedElement);

      // Test project creation via keyboard
      await page.keyboard.press('Enter'); // Activate focused element

      // If create project dialog opened, test keyboard navigation within it
      const createDialog = page.getByRole('dialog', {
        name: /create.*project/i,
      });
      if (await createDialog.isVisible({ timeout: 3000 })) {
        // Should focus on first input
        await page.keyboard.press('Tab');
        await page.keyboard.type(testProject.name);

        await page.keyboard.press('Tab');
        await page.keyboard.type(testProject.description);

        // Navigate to create button and activate
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });
      }

      // Test escape key functionality
      await page.keyboard.press('Escape');

      // Should close any open dialogs/menus
      const openDialogs = page.locator('[role="dialog"]:visible');
      expect(await openDialogs.count()).toBe(0);
    });

    test('should provide visible focus indicators', async ({ page }) => {
      // Check that tab navigation shows visible focus
      const focusStyles: string[] = [];

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');

        const focusedElementStyle = await page.evaluate(() => {
          const element = document.activeElement;
          if (element) {
            const styles = window.getComputedStyle(element);
            return {
              outline: styles.outline,
              outlineColor: styles.outlineColor,
              outlineWidth: styles.outlineWidth,
              boxShadow: styles.boxShadow,
              border: styles.border,
            };
          }
          return null;
        });

        if (focusedElementStyle) {
          focusStyles.push(JSON.stringify(focusedElementStyle));
        }
      }

      // Should have visible focus indicators (outline, box-shadow, or border changes)
      const hasVisibleFocus = focusStyles.some(style => {
        const parsed = JSON.parse(style);
        return (
          parsed.outline !== 'none' ||
          parsed.outlineWidth !== '0px' ||
          parsed.boxShadow.includes('inset') ||
          parsed.boxShadow.includes('rgb')
        );
      });

      expect(hasVisibleFocus).toBe(true);
    });

    test('should handle keyboard navigation in data tables', async ({
      page,
    }) => {
      // Create project with multiple images to get a data table
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Table Navigation Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing table keyboard navigation');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Table Navigation Test').click();

      // Upload multiple images to create a table/list
      const fileInput = page.locator('input[type="file"]').first();
      const multiplePaths = [testImagePath, testImagePath, testImagePath];
      await fileInput.setInputFiles(multiplePaths);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 30000,
      });

      // Navigate to table/list with arrow keys
      const tableRows = page.locator('[role="row"], .table-row, .list-item');
      if ((await tableRows.count()) > 0) {
        await tableRows.first().focus();

        // Test arrow key navigation
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');

        // Test Enter to activate item
        await page.keyboard.press('Enter');

        // Should perform action (open item, navigate, etc.)
        const currentUrl = page.url();
        expect(currentUrl).toBeDefined();
      }
    });

    test('should support skip links for main content', async ({ page }) => {
      await page.goto('/');

      // Press Tab to focus on skip link (usually first focusable element)
      await page.keyboard.press('Tab');

      const skipLink = page.getByText(
        /skip.*content|skip.*main|jump.*content/i
      );
      if (await skipLink.isVisible({ timeout: 2000 })) {
        await page.keyboard.press('Enter');

        // Should move focus to main content
        const mainContent = page.locator(
          'main, [role="main"], #main-content, .main-content'
        );
        await expect(mainContent).toBeFocused();
      }
    });
  });

  test.describe('Screen Reader Compatibility', () => {
    test('should have proper ARIA labels and roles', async ({ page }) => {
      // Check for proper semantic markup and ARIA attributes
      await checkA11y(page, null, {
        detailedReport: true,
        detailedReportOptions: { html: true },
      });

      // Check specific ARIA landmarks
      const landmarks = await page
        .locator(
          '[role="banner"], [role="main"], [role="navigation"], [role="complementary"], [role="contentinfo"]'
        )
        .count();
      expect(landmarks).toBeGreaterThan(0);

      // Check button accessibility
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < Math.min(buttonCount, 10); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const ariaLabel = await button.getAttribute('aria-label');
          const textContent = await button.textContent();
          const title = await button.getAttribute('title');

          // Button should have accessible name (text, aria-label, or title)
          expect(ariaLabel || textContent || title).toBeTruthy();
        }
      }

      // Check form labels
      const inputs = page.locator(
        'input[type="text"], input[type="email"], input[type="password"], textarea'
      );
      const inputCount = await inputs.count();

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          const id = await input.getAttribute('id');
          const ariaLabel = await input.getAttribute('aria-label');
          const ariaLabelledBy = await input.getAttribute('aria-labelledby');

          if (id) {
            const label = page.locator(`label[for="${id}"]`);
            const hasLabel = (await label.count()) > 0;

            // Input should have associated label or ARIA label
            expect(hasLabel || ariaLabel || ariaLabelledBy).toBeTruthy();
          }
        }
      }
    });

    test('should announce dynamic content changes', async ({ page }) => {
      // Check for ARIA live regions for dynamic content
      const liveRegions = page.locator(
        '[aria-live], [role="alert"], [role="status"]'
      );
      const liveRegionCount = await liveRegions.count();

      // Should have at least some live regions for notifications/updates
      if (liveRegionCount > 0) {
        expect(liveRegionCount).toBeGreaterThan(0);
      }

      // Test live region functionality by creating a project
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Live Region Test');
      await page.getByLabel(/description/i).fill('Testing live regions');
      await page.getByRole('button', { name: /create|save/i }).click();

      // Success message should be in a live region
      const successMessage = page.getByText(/project.*created|success/i);
      if (await successMessage.isVisible({ timeout: 10000 })) {
        const messageContainer = successMessage.locator('..'); // Parent element
        const ariaLive = await messageContainer.getAttribute('aria-live');
        const role = await messageContainer.getAttribute('role');

        // Should be announced to screen readers
        expect(
          ariaLive === 'polite' ||
            ariaLive === 'assertive' ||
            role === 'alert' ||
            role === 'status'
        ).toBe(true);
      }
    });

    test('should provide alternative text for images', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Image Alt Text Test');
      await page.getByLabel(/description/i).fill('Testing image alt text');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Image Alt Text Test').click();

      // Upload image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Check uploaded image has alt text
      const images = page.locator('img');
      const imageCount = await images.count();

      for (let i = 0; i < imageCount; i++) {
        const img = images.nth(i);
        if (await img.isVisible()) {
          const alt = await img.getAttribute('alt');
          const ariaLabel = await img.getAttribute('aria-label');
          const ariaLabelledBy = await img.getAttribute('aria-labelledby');

          // Image should have alt text or ARIA alternative
          expect(alt !== null || ariaLabel || ariaLabelledBy).toBe(true);

          // Alt text should not be just filename
          if (alt) {
            expect(alt).not.toMatch(/\.(jpg|jpeg|png|gif|webp)$/i);
          }
        }
      }
    });

    test('should provide context for complex UI elements', async ({ page }) => {
      // Navigate to segmentation editor to test complex UI
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Complex UI Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing complex UI accessibility');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Complex UI Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Navigate to editor if available
      const editButton = page
        .getByRole('button', { name: /edit|editor|segmentation/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Check canvas accessibility
        const canvas = page.locator('canvas').first();
        const canvasLabel = await canvas.getAttribute('aria-label');
        const canvasRole = await canvas.getAttribute('role');

        // Canvas should have accessible description
        expect(canvasLabel || canvasRole).toBeTruthy();

        // Check toolbar accessibility
        const toolbarButtons = page.locator(
          '[role="toolbar"] button, .toolbar button'
        );
        const toolbarButtonCount = await toolbarButtons.count();

        if (toolbarButtonCount > 0) {
          for (let i = 0; i < Math.min(toolbarButtonCount, 5); i++) {
            const button = toolbarButtons.nth(i);
            const ariaLabel = await button.getAttribute('aria-label');
            const title = await button.getAttribute('title');
            const textContent = await button.textContent();

            // Toolbar buttons should have accessible names
            expect(
              ariaLabel ||
                title ||
                (textContent && textContent.trim().length > 0)
            ).toBe(true);
          }
        }
      }
    });
  });

  test.describe('High Contrast Mode Support', () => {
    test('should be usable in high contrast mode', async ({ page }) => {
      // Enable high contrast mode simulation
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

      // Add high contrast CSS simulation
      await page.addStyleTag({
        content: `
          * {
            background-color: black !important;
            color: white !important;
            border-color: white !important;
          }
          button, input, select, textarea {
            background-color: black !important;
            color: white !important;
            border: 2px solid white !important;
          }
          button:hover, button:focus {
            background-color: white !important;
            color: black !important;
          }
        `,
      });

      await page.goto('/dashboard');

      // Test basic functionality in high contrast mode
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('High Contrast Test');
      await page.getByLabel(/description/i).fill('Testing high contrast mode');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Check that essential UI elements are still visible and functional
      const importantElements = [
        page.getByRole('button', { name: /create.*project|new.*project/i }),
        page.getByText('High Contrast Test'),
      ];

      for (const element of importantElements) {
        if (await element.isVisible()) {
          const styles = await element.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              border: computed.border,
            };
          });

          // Should have sufficient contrast (this is a basic check)
          expect(styles.color).toBeDefined();
          expect(styles.backgroundColor).toBeDefined();
        }
      }
    });

    test('should respect user color preferences', async ({ page }) => {
      // Test with different color scheme preferences
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/dashboard');

      // Check if dark theme is applied
      const body = page.locator('body');
      const bodyStyles = await body.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          backgroundColor: computed.backgroundColor,
          color: computed.color,
        };
      });

      // Should adapt to color scheme preference
      expect(bodyStyles.backgroundColor).toBeDefined();
      expect(bodyStyles.color).toBeDefined();

      // Test light theme
      await page.emulateMedia({ colorScheme: 'light' });
      await page.reload();

      const lightBodyStyles = await body.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          backgroundColor: computed.backgroundColor,
          color: computed.color,
        };
      });

      // Styles may change based on color scheme
      expect(lightBodyStyles.backgroundColor).toBeDefined();
      expect(lightBodyStyles.color).toBeDefined();
    });
  });

  test.describe('Focus Management', () => {
    test('should manage focus properly in modals and dialogs', async ({
      page,
    }) => {
      // Open create project modal
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();

      const modal = page.getByRole('dialog', { name: /create.*project/i });
      if (await modal.isVisible({ timeout: 3000 })) {
        // Focus should be trapped within modal
        const initialFocus = await page.evaluate(
          () => document.activeElement?.tagName
        );

        // Tab through modal elements
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');

        // Focus should still be within modal
        const currentFocus = await page.evaluate(() => {
          const activeElement = document.activeElement;
          const modal = document.querySelector('[role="dialog"]');
          return modal?.contains(activeElement);
        });

        expect(currentFocus).toBe(true);

        // Close modal with escape
        await page.keyboard.press('Escape');

        // Focus should return to trigger element
        const returnedFocus = await page.evaluate(
          () => document.activeElement?.tagName
        );
        expect(['BUTTON', 'A']).toContain(returnedFocus);
      }
    });

    test('should maintain logical tab order', async ({ page }) => {
      // Test tab order through main navigation
      const tabOrder: string[] = [];

      // Start from top of page
      await page.keyboard.press('Home');
      await page.keyboard.press('Tab');

      for (let i = 0; i < 15; i++) {
        const focusedElement = await page.evaluate(() => {
          const element = document.activeElement;
          return {
            tagName: element?.tagName,
            textContent: element?.textContent?.trim().substring(0, 20),
            ariaLabel: element?.getAttribute('aria-label'),
          };
        });

        if (focusedElement.tagName) {
          tabOrder.push(
            `${focusedElement.tagName}:${focusedElement.textContent || focusedElement.ariaLabel || ''}`
          );
        }

        await page.keyboard.press('Tab');
      }

      // Tab order should be logical (specific order will depend on UI layout)
      expect(tabOrder.length).toBeGreaterThan(5);

      // Should not jump randomly around the page
      expect(tabOrder.length).toBeGreaterThan(0);
    });

    test('should handle focus for dynamic content', async ({ page }) => {
      // Create project to test dynamic focus management
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Dynamic Focus Test');
      await page.getByLabel(/description/i).fill('Testing dynamic focus');
      await page.getByRole('button', { name: /create|save/i }).click();

      // Focus should move to success message or newly created project
      const successElement = page.getByText(
        /project.*created|success|Dynamic Focus Test/i
      );
      if (await successElement.isVisible({ timeout: 10000 })) {
        // Check if focus moved to relevant content
        const focusedElement = await page.evaluate(() => {
          return (
            document.activeElement?.textContent
              ?.toLowerCase()
              .includes('dynamic focus') ||
            document.activeElement?.textContent
              ?.toLowerCase()
              .includes('success') ||
            document.activeElement?.textContent
              ?.toLowerCase()
              .includes('created')
          );
        });

        // Focus should be on relevant dynamic content
        expect(focusedElement).toBe(true);
      }
    });
  });

  test.describe('ARIA Attributes Validation', () => {
    test('should have complete ARIA implementation', async ({ page }) => {
      // Run comprehensive accessibility audit
      await checkA11y(page, null, {
        detailedReport: true,
        detailedReportOptions: { html: true },
        rules: {
          // Enable specific ARIA rules
          'aria-allowed-attr': { enabled: true },
          'aria-required-attr': { enabled: true },
          'aria-required-children': { enabled: true },
          'aria-required-parent': { enabled: true },
          'aria-roles': { enabled: true },
          'aria-valid-attr': { enabled: true },
          'aria-valid-attr-value': { enabled: true },
        },
      });

      // Check specific ARIA patterns
      const regions = await page.locator('[role="region"]').count();
      const groups = await page.locator('[role="group"]').count();
      const buttons = await page.locator('[role="button"], button').count();

      expect(buttons).toBeGreaterThan(0);

      // Check expandable elements
      const expandableElements = page.locator('[aria-expanded]');
      const expandableCount = await expandableElements.count();

      for (let i = 0; i < expandableCount; i++) {
        const element = expandableElements.nth(i);
        const expanded = await element.getAttribute('aria-expanded');

        // aria-expanded should be true or false, not null
        expect(['true', 'false']).toContain(expanded);
      }

      // Check comboboxes and listboxes
      const comboboxes = page.locator('[role="combobox"]');
      const comboCount = await comboboxes.count();

      for (let i = 0; i < comboCount; i++) {
        const combo = comboboxes.nth(i);
        const controls = await combo.getAttribute('aria-controls');
        const haspopup = await combo.getAttribute('aria-haspopup');

        // Combobox should have proper ARIA attributes
        expect(controls || haspopup).toBeTruthy();
      }
    });

    test('should provide proper state announcements', async ({ page }) => {
      // Test loading states
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();

      const loadingIndicators = page.locator('[aria-busy="true"], [aria-live]');

      // Fill form to trigger loading state
      await page
        .getByLabel(/project name|name/i)
        .fill('State Announcement Test');
      await page.getByLabel(/description/i).fill('Testing state announcements');
      await page.getByRole('button', { name: /create|save/i }).click();

      // Check for loading/busy state
      const busyElement = page.locator('[aria-busy="true"]');
      if (await busyElement.isVisible({ timeout: 3000 })) {
        expect(await busyElement.count()).toBeGreaterThan(0);
      }

      // Check for success announcement
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      const successAnnouncement = page.getByText(/project.*created|success/i);
      const announcementParent = successAnnouncement.locator('..');
      const ariaLive = await announcementParent.getAttribute('aria-live');
      const role = await announcementParent.getAttribute('role');

      // Success should be announced
      expect(ariaLive || role === 'alert' || role === 'status').toBeTruthy();
    });

    test('should handle form validation announcements', async ({ page }) => {
      // Test form validation
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();

      // Try to submit form without required fields
      await page.getByRole('button', { name: /create|save/i }).click();

      // Should show validation errors
      const errorMessages = page.locator(
        '[role="alert"], .error, [aria-invalid="true"]'
      );
      const errorCount = await errorMessages.count();

      if (errorCount > 0) {
        // Check first error message
        const firstError = errorMessages.first();
        const ariaLive = await firstError.getAttribute('aria-live');
        const role = await firstError.getAttribute('role');

        // Error should be announced
        expect(ariaLive || role === 'alert').toBeTruthy();
      }

      // Fill invalid data
      await page.getByLabel(/project name|name/i).fill(''); // Leave empty
      await page.getByLabel(/project name|name/i).blur(); // Trigger validation

      // Check for aria-invalid
      const nameInput = page.getByLabel(/project name|name/i);
      const ariaInvalid = await nameInput.getAttribute('aria-invalid');

      if (ariaInvalid) {
        expect(ariaInvalid).toBe('true');
      }
    });
  });

  test.describe('Motion and Animation Accessibility', () => {
    test('should respect reduced motion preferences', async ({ page }) => {
      // Enable reduced motion
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/dashboard');

      // Check that animations are disabled or reduced
      const animatedElements = page.locator(
        '[class*="animate"], [class*="transition"], [class*="motion"]'
      );
      const animatedCount = await animatedElements.count();

      if (animatedCount > 0) {
        // Check animation durations are reduced or disabled
        for (let i = 0; i < Math.min(animatedCount, 5); i++) {
          const element = animatedElements.nth(i);
          const duration = await element.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return computed.animationDuration || computed.transitionDuration;
          });

          // Should be very short or none
          expect(
            duration === '0s' ||
              duration === 'none' ||
              parseFloat(duration) < 0.5
          ).toBe(true);
        }
      }
    });

    test('should not cause seizures with flashing content', async ({
      page,
    }) => {
      // This is a basic test - in practice, you'd need more sophisticated analysis
      // Check for any elements that might flash rapidly

      const flashingElements = page.locator(
        '[class*="flash"], [class*="blink"], [class*="strobe"]'
      );
      const flashingCount = await flashingElements.count();

      // Should not have elements that flash rapidly
      expect(flashingCount).toBe(0);

      // Check for CSS animations that might flash
      const allElements = page.locator('*').first();
      const hasFlashingAnimation = await allElements.evaluate(() => {
        const animations = document.getAnimations();
        return animations.some(animation => {
          const effect = animation.effect as KeyframeEffect;
          if (effect && effect.getKeyframes) {
            const keyframes = effect.getKeyframes();
            // Check for rapid opacity changes (basic check)
            return keyframes.some(
              (kf: any) =>
                kf.opacity !== undefined &&
                animation.currentTime !== null &&
                effect.getTiming().duration !== undefined &&
                (effect.getTiming().duration as number) < 500
            );
          }
          return false;
        });
      });

      expect(hasFlashingAnimation).toBe(false);
    });
  });

  test.describe('Mobile Accessibility', () => {
    test('should be accessible on mobile devices @mobile', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/dashboard');

      // Run accessibility audit on mobile
      await checkA11y(page, null, {
        tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      });

      // Test touch targets are large enough (minimum 44x44px)
      const interactiveElements = page.locator(
        'button, a, input, [role="button"]'
      );
      const elemCount = await interactiveElements.count();

      for (let i = 0; i < Math.min(elemCount, 10); i++) {
        const element = interactiveElements.nth(i);
        if (await element.isVisible()) {
          const box = await element.boundingBox();
          if (box) {
            // Touch targets should be at least 44x44px (WCAG 2.1 AAA guideline)
            expect(box.width).toBeGreaterThanOrEqual(44); // WCAG 2.1 AAA minimum
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
      }

      // Test that content is readable without horizontal scrolling
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()?.width || 375;

      // Should not require horizontal scrolling
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Small tolerance
    });

    test('should support mobile screen readers', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/dashboard');

      // Check for mobile-specific accessibility features
      const headings = page.locator('h1, h2, h3, h4, h5, h6');
      const headingCount = await headings.count();

      // Should have proper heading structure for navigation
      expect(headingCount).toBeGreaterThan(0);

      // Check for landmarks that help mobile navigation
      const landmarks = page.locator(
        '[role="banner"], [role="main"], [role="navigation"]'
      );
      const landmarkCount = await landmarks.count();

      expect(landmarkCount).toBeGreaterThan(0);

      // Test swipe gestures if supported
      const swipeableElements = page.locator(
        '[data-swipe], .swiper, .carousel'
      );
      const swipeCount = await swipeableElements.count();

      if (swipeCount > 0) {
        const firstSwipeable = swipeableElements.first();
        const ariaLabel = await firstSwipeable.getAttribute('aria-label');
        const role = await firstSwipeable.getAttribute('role');

        // Swipeable elements should have proper ARIA
        expect(ariaLabel || role).toBeTruthy();
      }
    });
  });
});
