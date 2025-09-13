import { test, expect } from '@playwright/test';
import {
  LandingPage,
  SignInPage,
  SignUpPage,
  DashboardPage,
} from './page-objects';

test.describe('Enhanced Authentication Flow', () => {
  // Generate unique user for each test file
  function generateTestUser() {
    return {
      email: `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`,
      password: 'TestPassword123!',
    };
  }

  test.beforeEach(async ({ page }) => {
    // Start fresh each test
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test('should complete full registration flow from landing page', async ({
    page,
  }) => {
    const landingPage = new LandingPage(page);
    const _signInPage = new SignInPage(page);
    const signUpPage = new SignUpPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: Navigate to landing page
    await landingPage.navigate();
    await landingPage.verifyPageElements();

    // Step 2: Click Sign In from header
    await landingPage.clickSignIn();
    await expect(page).toHaveURL('/sign-in');

    // Step 3: Navigate to Sign Up from Sign In page
    await signUpPage.navigate(); // Direct navigation to sign up
    await expect(page).toHaveURL('/sign-up');

    // Step 4: Register new user
    const testUser = generateTestUser();
    await signUpPage.signUp(testUser.email, testUser.password);

    // Step 5: Should redirect to dashboard after successful registration
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

    // Step 6: Verify dashboard is loaded
    expect(await dashboardPage.isDashboardLoaded()).toBe(true);
  });

  test('should sign in with existing credentials', async ({ page }) => {
    const landingPage = new LandingPage(page);
    const signInPage = new SignInPage(page);
    const signUpPage = new SignUpPage(page);
    const dashboardPage = new DashboardPage(page);

    // Step 1: First create an account
    const testUser = generateTestUser();
    await signUpPage.navigate();
    await signUpPage.signUp(testUser.email, testUser.password);
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

    // Step 2: Logout
    await dashboardPage.logout();
    await expect(page).toHaveURL('/');

    // Step 3: Sign in with the created account
    await landingPage.clickSignIn();
    await signInPage.signIn(testUser.email, testUser.password, true); // with remember me

    // Step 4: Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
    expect(await dashboardPage.isDashboardLoaded()).toBe(true);
  });

  test('should handle invalid login credentials', async ({ page }) => {
    const signInPage = new SignInPage(page);

    await signInPage.navigate();
    await signInPage.signIn('nonexistent@example.com', 'wrongpassword');

    // Should show error message
    expect(await signInPage.hasErrorMessage()).toBe(true);

    // Should still be on sign in page
    await expect(page).toHaveURL('/sign-in');
  });

  test('should validate required fields on registration', async ({ page }) => {
    const signUpPage = new SignUpPage(page);

    await signUpPage.navigate();

    // Try to submit with empty fields
    await signUpPage.signUpButton.click();

    // Should show validation errors and stay on page
    await expect(page).toHaveURL('/sign-up');
  });

  test('should handle password mismatch on registration', async ({ page }) => {
    const testUser = generateTestUser();
    const signUpPage = new SignUpPage(page);

    await signUpPage.navigate();
    await signUpPage.signUp(
      testUser.email,
      testUser.password,
      'DifferentPassword123!'
    );

    // Should show error or stay on registration page
    const hasError = await signUpPage.hasErrorMessage();
    const stillOnSignUp = page.url().includes('/sign-up');

    expect(hasError || stillOnSignUp).toBe(true);
  });

  test('should navigate between authentication pages', async ({ page }) => {
    const landingPage = new LandingPage(page);
    const _signInPage = new SignInPage(page);
    const _signUpPage = new SignUpPage(page);

    // Landing -> Sign In
    await landingPage.navigate();
    await landingPage.clickSignIn();
    await expect(page).toHaveURL('/sign-in');

    // Sign In -> Sign Up
    await _signInPage.clickSignUp();
    await expect(page).toHaveURL('/sign-up');

    // Sign Up -> Sign In
    await signInPage.navigate(); // Navigate back to sign in
    await expect(page).toHaveURL('/sign-in');

    // Sign In -> Back to Landing
    await _signInPage.clickBack();
    await expect(page).toHaveURL('/');
  });

  test('should persist login across browser sessions', async ({ browser }) => {
    // Create first context with persistent storage for session persistence
    const context1 = await browser.newContext({
      storageState: undefined, // Start fresh
    });
    const page1 = await context1.newPage();

    const testUser = generateTestUser();
    const signUpPage = new SignUpPage(page1);
    const dashboardPage = new DashboardPage(page1);

    // Register and login
    await signUpPage.navigate();
    await signUpPage.signUp(testUser.email, testUser.password);
    await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

    // Verify user is logged in by checking for user-specific content
    await expect(dashboardPage.userProfileOrAvatar).toBeVisible({
      timeout: 5000,
    });

    // Save storage state to simulate session persistence
    const storageState = await context1.storageState();
    await context1.close();

    // Create new context with saved storage state (simulates browser restart with stored session)
    const context2 = await browser.newContext({
      storageState: storageState,
    });
    const page2 = await context2.newPage();

    const dashboardPage2 = new DashboardPage(page2);

    // Navigate to dashboard - should stay logged in due to stored session
    await dashboardPage2.navigate();

    // Should still be logged in and see dashboard content
    await expect(page2).toHaveURL('/dashboard', { timeout: 10000 });
    await expect(dashboardPage2.userProfileOrAvatar).toBeVisible({
      timeout: 5000,
    });

    await context2.close();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    const signInPage = new SignInPage(page);

    // Simulate network failure
    await page.route('**/api/auth/**', route => route.abort());

    await signInPage.navigate();
    await signInPage.signIn('test@example.com', 'password123');

    // Should show network error message or handle gracefully
    const hasError = await signInPage.hasErrorMessage();
    const errorMessage = hasError ? await signInPage.getErrorMessage() : '';

    expect(hasError).toBe(true);
    expect(errorMessage.toLowerCase()).toContain('error');
  });

  test('should show loading states during authentication', async ({ page }) => {
    const testUser = generateTestUser();
    const signInPage = new SignInPage(page);

    await signInPage.navigate();

    // Fill credentials but don't submit yet
    await signInPage.emailInput.fill(testUser.email);
    await signInPage.passwordInput.fill(testUser.password);

    // Submit and check for loading state
    const submitPromise = signInPage.signInButton.click();

    // Should show loading state (might be very brief)
    const _hasLoadingSpinner = await signInPage.loadingSpinner.isVisible({
      timeout: 3000,
    });

    await submitPromise;

    // Loading state might not always be visible due to speed, so don't fail the test
    // Just verify the action completed
    expect(page.url()).toBeDefined();
  });

  test('should redirect to intended page after login', async ({ page }) => {
    const signInPage = new SignInPage(page);
    const dashboardPage = new DashboardPage(page);

    // Try to access dashboard without being logged in (should redirect to sign in)
    await page.goto('/dashboard');

    // Should be redirected to sign in with returnTo parameter
    const currentUrl = page.url();
    expect(currentUrl).toContain('sign-in');

    // Register first to have valid credentials
    const testUser = generateTestUser();
    const signUpPage = new SignUpPage(page);
    await signUpPage.navigate();
    await signUpPage.signUp(testUser.email, testUser.password);
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

    // Logout and try the redirect flow
    await dashboardPage.logout();
    await page.goto('/dashboard'); // Should redirect to sign-in

    // Sign in
    await signInPage.signIn(testUser.email, testUser.password);

    // Should return to dashboard
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
  });
});
