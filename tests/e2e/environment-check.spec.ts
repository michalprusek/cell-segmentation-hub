/**
 * Environment verification test
 * This test verifies that the test environment is properly configured
 */
import { test, expect } from '@playwright/test';

test.describe('Environment Check', () => {
  test('should verify environment is properly configured', async ({ page }) => {
    // Log environment info for debugging
    //     console.log('Environment Variables:');
    //     console.log('NODE_ENV:', process.env.NODE_ENV);
    //     console.log('CI:', process.env.CI);
    //     console.log('PLAYWRIGHT_SERVICE_URL:', process.env.PLAYWRIGHT_SERVICE_URL);

    // Visit the application home page
    await page.goto('/');

    // Should load without errors
    await expect(page).toHaveTitle(/SpheroSeg/i);

    // Should show the main navigation or welcome content
    const hasNavigation = (await page.locator('nav').count()) > 0;
    const hasWelcome =
      (await page.getByText(/welcome|sign in|sign up/i).count()) > 0;

    expect(hasNavigation || hasWelcome).toBeTruthy();

    //     console.log('✓ Homepage loaded successfully');
  });

  test('should verify API connectivity', async ({ page }) => {
    // Test API endpoints are reachable
    const apiResponse = await page.request.get('/api/health');
    expect(apiResponse.ok()).toBeTruthy();

    const responseBody = await apiResponse.json();
    expect(responseBody).toHaveProperty('status', 'ok');

    //     console.log('✓ API connectivity verified');
  });

  test('should verify services are responding', async ({ page }) => {
    // Navigate to page and check for error states
    await page.goto('/');

    // Should not have any critical errors on the page
    const errorMessages = await page
      .locator('.error, [data-testid="error"], .alert-error')
      .count();
    expect(errorMessages).toBe(0);

    // Should be able to interact with basic UI elements
    const signInLink = page.getByRole('link', { name: /sign in/i }).first();
    if (await signInLink.isVisible()) {
      await expect(signInLink).toBeVisible();
    }

    //     console.log('✓ Services are responding correctly');
  });
});
