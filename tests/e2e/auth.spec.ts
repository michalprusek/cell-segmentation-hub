import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should register new user successfully', async ({ page }) => {
    // Navigate to register page
    await page.getByRole('link', { name: /sign up/i }).click();

    // Fill registration form
    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);

    // Accept terms
    await page.getByRole('checkbox', { name: /terms/i }).check();

    // Submit form
    await page.getByRole('button', { name: /sign up/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');

    // Should show dashboard content
    await expect(page.getByText(/dashboard|welcome/i)).toBeVisible();
  });

  test('should not register with invalid email', async ({ page }) => {
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill('invalid-email');
    await page
      .getByLabel(/password/i)
      .first()
      .fill('password123');
    await page.getByLabel(/confirm password/i).fill('password123');
    await page.getByRole('checkbox', { name: /terms/i }).check();

    await page.getByRole('button', { name: /sign up/i }).click();

    // Should show validation error
    await expect(page.getByText(/valid email/i)).toBeVisible();
  });

  test('should not register with mismatched passwords', async ({ page }) => {
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill('test@example.com');
    await page
      .getByLabel(/password/i)
      .first()
      .fill('password123');
    await page.getByLabel(/confirm password/i).fill('different123');

    // Should show real-time password mismatch indicator
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();

    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();

    // Should show password mismatch error toast
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    // First register the user
    await page.getByRole('link', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();

    // Logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();

    // Now login
    await page.getByRole('link', { name: /sign in/i }).click();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(/dashboard|welcome/i)).toBeVisible();
  });

  test('should not login with invalid credentials', async ({ page }) => {
    await page.getByRole('link', { name: /sign in/i }).click();

    await page.getByLabel(/email/i).fill('nonexistent@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show error message
    await expect(page.getByText(/invalid.*credentials/i)).toBeVisible();
  });

  test('should logout successfully', async ({ page, context: _context }) => {
    // Register and login first
    await page.getByRole('link', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();

    // Verify logged in
    await expect(page).toHaveURL('/dashboard');

    // Logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();

    // Should redirect to login page
    await expect(page).toHaveURL('/');

    // Should not be able to access protected routes
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL('/dashboard');
  });

  test('should persist login across browser sessions', async ({
    page,
    context,
  }) => {
    // Register and login
    await page.getByRole('link', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();

    // Verify logged in
    await expect(page).toHaveURL('/dashboard');

    // Create new page (simulate new browser session)
    const newPage = await context.newPage();
    await newPage.goto('/dashboard');

    // Should still be logged in
    await expect(newPage).toHaveURL('/dashboard');
    await expect(newPage.getByText(/dashboard|welcome/i)).toBeVisible();
  });

  test('should handle session expiration', async ({ page }) => {
    // Register and login first
    await page.getByRole('link', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();

    // Verify logged in
    await expect(page).toHaveURL('/dashboard');

    // Mock API responses to simulate token expiration
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    await page.route('**/api/auth/refresh', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Refresh token expired' }),
      });
    });

    // Try to access a protected route - should redirect to login
    await page.goto('/dashboard');

    // Wait for authentication check and redirect
    await page.waitForURL(url => !url.pathname.includes('/dashboard'), {
      timeout: 10000,
    });

    // Should show sign in elements indicating user is not authenticated
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should show loading state during authentication', async ({ page }) => {
    await page.getByRole('link', { name: /sign in/i }).click();

    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);

    // Click login and immediately check for loading state
    const loginPromise = page.getByRole('button', { name: /sign in/i }).click();

    // Should show loading indicator
    await expect(
      page.getByRole('button', { name: /signing in|loading/i })
    ).toBeVisible();

    await loginPromise;
  });

  test('should validate required fields', async ({ page }) => {
    await page.getByRole('link', { name: /sign up/i }).click();

    // Try to submit without filling fields
    await page.getByRole('button', { name: /sign up/i }).click();

    // Should show validation errors for required fields (email, password, confirmPassword)
    await expect(
      page.getByText(/email.*required|password.*required|fill.*all.*fields/i)
    ).toBeVisible();

    // Try to submit without agreeing to terms
    await page.getByLabel(/email/i).fill('test@example.com');
    await page
      .getByLabel(/password/i)
      .first()
      .fill('password123');
    await page.getByLabel(/confirm password/i).fill('password123');
    await page.getByRole('button', { name: /sign up/i }).click();

    // Should show terms validation error
    await expect(page.getByText(/agree.*terms/i)).toBeVisible();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Simulate network failure
    await page.route('**/api/auth/**', route => route.abort());

    await page.getByRole('link', { name: /sign in/i }).click();

    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show network error message
    await expect(
      page.getByText(/network.*error|connection.*failed/i)
    ).toBeVisible();
  });
});
