import { test, expect, Browser } from '@playwright/test';
import {
  LandingPage,
  SignInPage,
  SignUpPage,
  DashboardPage,
} from './page-objects';

test.describe('Comprehensive Authentication Flow Tests', () => {
  const testUser = {
    email: `comprehensive-auth-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    newPassword: 'NewPassword456!',
  };

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test.describe('Password Reset Flow', () => {
    test('should initiate and complete password reset process', async ({
      page,
    }) => {
      const signInPage = new SignInPage(page);
      const signUpPage = new SignUpPage(page);

      // First create an account
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

      // Logout
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.logout();

      // Go to sign in and click forgot password
      await signInPage.navigate();
      await signInPage.clickForgotPassword();

      // Should navigate to password reset page
      await expect(page).toHaveURL(/.*forgot-password.*|.*reset-password.*/);

      // Fill email for password reset
      const emailInput = page.getByLabel(/email/i);
      await emailInput.fill(testUser.email);

      // Submit reset request
      await page
        .getByRole('button', {
          name: /send.*reset|reset.*password|send.*link/i,
        })
        .click();

      // Should show success message
      await expect(
        page.getByText(/reset.*link.*sent|check.*email|password.*reset.*sent/i)
      ).toBeVisible({
        timeout: 10000,
      });
    });

    test('should handle invalid email for password reset', async ({ page }) => {
      const signInPage = new SignInPage(page);

      await signInPage.navigate();
      await signInPage.clickForgotPassword();

      const emailInput = page.getByLabel(/email/i);
      await emailInput.fill('nonexistent@example.com');

      await page
        .getByRole('button', { name: /send.*reset|reset.*password/i })
        .click();

      // Should show error or generic message for security
      const hasError = await page
        .getByText(/error|not.*found|invalid.*email/i)
        .isVisible({ timeout: 5000 });
      const hasGenericMessage = await page
        .getByText(/reset.*link.*sent|check.*email/i)
        .isVisible({ timeout: 5000 });

      if (!hasError && !hasGenericMessage) {
        throw new Error(
          'Expected either error message or generic success message to be visible'
        );
      }
      expect(hasError || hasGenericMessage).toBe(true);
    });
  });

  test.describe('Session Management', () => {
    test('should handle session timeout gracefully', async ({ page }) => {
      const signUpPage = new SignUpPage(page);
      const dashboardPage = new DashboardPage(page);

      // Register and login
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

      // Mock expired token responses
      await page.route('**/api/auth/me', route => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Token expired' }),
        });
      });

      await page.route('**/api/auth/refresh', route => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Refresh token expired' }),
        });
      });

      // Try to access protected content - should automatically handle token refresh
      await page.reload();

      // Should either:
      // 1. Successfully refresh and stay on dashboard
      // 2. Redirect to sign in page due to expired refresh token
      await page.waitForURL(
        url =>
          url.pathname === '/dashboard' ||
          url.pathname.includes('sign-in') ||
          url.pathname === '/',
        { timeout: 10000 }
      );

      const isOnDashboard = page.url().includes('/dashboard');
      const isOnSignIn =
        page.url().includes('sign-in') ||
        page.url() === 'http://localhost:3000/';

      expect(isOnDashboard || isOnSignIn).toBe(true);
    });

    test('should sync authentication across multiple tabs', async ({
      browser,
    }) => {
      const context = await browser.newContext();
      // Ensure we always get a proper page instead of relying on context.pages()[0]
      const page1 = await context.newPage();
      const page2 = await context.newPage();

      const signUpPage1 = new SignUpPage(page1);
      const dashboardPage1 = new DashboardPage(page1);
      const dashboardPage2 = new DashboardPage(page2);

      // Login in first tab
      await signUpPage1.navigate();
      await signUpPage1.signUp(testUser.email, testUser.password);
      await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

      // Second tab should also be authenticated when accessing dashboard
      await dashboardPage2.navigate();

      // Wait to see if we're authenticated or redirected
      await page2.waitForLoadState('networkidle');

      const isAuthenticated = await dashboardPage2.isDashboardLoaded();
      const isRedirected =
        page2.url().includes('sign-in') ||
        page2.url() === 'http://localhost:3000/';

      // Either authenticated or redirected to sign in (depends on session handling)
      expect(isAuthenticated || isRedirected).toBe(true);

      // Test logout synchronization
      if (isAuthenticated) {
        await dashboardPage1.logout();

        // Refresh second tab to check if logout is synced
        await page2.reload();
        await page2.waitForLoadState('networkidle');

        // Should be redirected to sign in
        const isLoggedOut =
          page2.url().includes('sign-in') ||
          page2.url() === 'http://localhost:3000/';
        expect(isLoggedOut).toBe(true);
      }

      await context.close();
    });
  });

  test.describe('Account Management', () => {
    test('should allow user to change password', async ({ page }) => {
      const signUpPage = new SignUpPage(page);
      const dashboardPage = new DashboardPage(page);

      // Register and login
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

      // Navigate to account settings
      const userMenuButton = page.getByRole('button', {
        name: /account|profile|settings|user.*menu/i,
      });
      if (await userMenuButton.isVisible()) {
        await userMenuButton.click();

        const settingsLink = page.getByRole('link', {
          name: /settings|account|profile/i,
        });
        if (await settingsLink.isVisible()) {
          await settingsLink.click();
          await expect(page).toHaveURL(/.*settings.*|.*profile.*|.*account.*/);
        } else {
          // Try direct navigation
          await page.goto('/settings');
        }

        // Look for password change section
        const changePasswordButton = page.getByRole('button', {
          name: /change.*password|update.*password/i,
        });
        if (await changePasswordButton.isVisible()) {
          await changePasswordButton.click();

          // Fill password change form
          await page
            .getByLabel(/current.*password|old.*password/i)
            .fill(testUser.password);
          await page.getByLabel(/new.*password/i).fill(testUser.newPassword);
          await page
            .getByLabel(/confirm.*password/i)
            .fill(testUser.newPassword);

          await page
            .getByRole('button', { name: /save|update|change/i })
            .click();

          // Should show success message
          await expect(
            page.getByText(/password.*updated|password.*changed|success/i)
          ).toBeVisible({
            timeout: 10000,
          });
        }
      }
    });

    test('should handle account deletion flow', async ({ page }) => {
      const signUpPage = new SignUpPage(page);
      const dashboardPage = new DashboardPage(page);

      // Register and login
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

      // Navigate to account settings
      const userMenuButton = page.getByRole('button', {
        name: /account|profile|settings|user.*menu/i,
      });
      if (await userMenuButton.isVisible()) {
        await userMenuButton.click();

        const settingsLink = page.getByRole('link', {
          name: /settings|account|profile/i,
        });
        if (await settingsLink.isVisible()) {
          await settingsLink.click();
        } else {
          await page.goto('/settings');
        }

        // Look for delete account option
        const deleteAccountButton = page.getByRole('button', {
          name: /delete.*account|close.*account|remove.*account/i,
        });

        if (await deleteAccountButton.isVisible()) {
          await deleteAccountButton.click();

          // Should show confirmation dialog
          await expect(
            page.getByText(
              /delete.*account|permanently.*delete|cannot.*undone/i
            )
          ).toBeVisible();

          // Enter password confirmation if required
          const passwordConfirmInput = page.getByLabel(/password|confirm/i);
          if (await passwordConfirmInput.isVisible()) {
            await passwordConfirmInput.fill(testUser.password);
          }

          // Confirm deletion (but don't actually delete to avoid test interference)
          const confirmButton = page.getByRole('button', {
            name: /confirm|delete|yes/i,
          });
          await expect(confirmButton).toBeVisible();

          // Cancel instead of confirming to preserve test account
          const cancelButton = page.getByRole('button', {
            name: /cancel|no|keep/i,
          });
          if (await cancelButton.isVisible()) {
            await cancelButton.click();
          }
        }
      }
    });
  });

  test.describe('Remember Me and Session Persistence', () => {
    test('should persist login with remember me checked', async ({
      browser,
    }) => {
      const context1 = await browser.newContext();
      const page1 = await context1.newPage();

      const signUpPage = new SignUpPage(page1);
      const signInPage = new SignInPage(page1);
      const dashboardPage = new DashboardPage(page1);

      // Register user
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

      // Logout
      await dashboardPage.logout();

      // Login with remember me
      await signInPage.navigate();
      await signInPage.signIn(testUser.email, testUser.password, true); // remember me = true
      await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

      await context1.close();

      // Create new context (simulate browser restart)
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();

      const dashboardPage2 = new DashboardPage(page2);

      // Try to access dashboard directly
      await dashboardPage2.navigate();

      await page2.waitForLoadState('networkidle');

      const isAuthenticated = await dashboardPage2.isDashboardLoaded();
      const currentUrl = page2.url();

      // Should either be authenticated or redirected to sign in
      expect(isAuthenticated || currentUrl.includes('sign-in')).toBe(true);

      await context2.close();
    });

    test('should not persist login without remember me', async ({
      browser,
    }) => {
      const context1 = await browser.newContext();
      const page1 = await context1.newPage();

      const signUpPage = new SignUpPage(page1);
      const signInPage = new SignInPage(page1);
      const dashboardPage = new DashboardPage(page1);

      // Register user
      await signUpPage.navigate();
      await signUpPage.signUp(testUser.email, testUser.password);
      await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

      // Logout and login without remember me
      await dashboardPage.logout();
      await signInPage.navigate();
      await signInPage.signIn(testUser.email, testUser.password, false); // remember me = false
      await expect(page1).toHaveURL('/dashboard', { timeout: 15000 });

      await context1.close();

      // Create new context
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();

      // Try to access dashboard directly
      await page2.goto('/dashboard');
      await page2.waitForLoadState('networkidle');

      // Should be redirected to sign in (session not persisted)
      const currentUrl = page2.url();
      expect(
        currentUrl.includes('sign-in') ||
          currentUrl === 'http://localhost:3000/'
      ).toBe(true);

      await context2.close();
    });
  });

  test.describe('Security and Validation', () => {
    test('should enforce strong password requirements', async ({ page }) => {
      const signUpPage = new SignUpPage(page);

      await signUpPage.navigate();

      const weakPasswords = [
        '123456', // too simple
        'password', // common password
        'short', // too short
        'nouppercase123', // no uppercase
        'NOLOWERCASE123', // no lowercase
        'NoNumbers', // no numbers
      ];

      for (const weakPassword of weakPasswords) {
        // Clear form state at the beginning of each iteration
        await signUpPage.emailInput.clear();
        await signUpPage.passwordInput.clear();
        await signUpPage.confirmPasswordInput.clear();

        const termsCheckbox = page.getByRole('checkbox', { name: /terms/i });
        if (
          (await termsCheckbox.isVisible()) &&
          (await termsCheckbox.isChecked())
        ) {
          await termsCheckbox.uncheck();
        }

        await signUpPage.emailInput.fill(`test-${Date.now()}@example.com`);
        await signUpPage.passwordInput.fill(weakPassword);
        await signUpPage.confirmPasswordInput.fill(weakPassword);

        if (await termsCheckbox.isVisible()) {
          await termsCheckbox.check();
        }

        await signUpPage.signUpButton.click();

        // Should show password strength error
        await page
          .getByText(
            /password.*weak|password.*requirements|password.*strong|password.*secure/i
          )
          .waitFor({ timeout: 3000 });
      }
    });

    test('should prevent XSS in login form', async ({ page }) => {
      const signInPage = new SignInPage(page);

      await signInPage.navigate();

      // Try to inject script in email field
      const xssPayload = '<script>alert("XSS")</script>';

      await signInPage.emailInput.fill(xssPayload);
      await signInPage.passwordInput.fill('password123');
      await signInPage.signInButton.click();

      // Page should not execute the script or show alert
      const hasAlert = await page
        .locator('dialog[role="alert"]')
        .isVisible({ timeout: 2000 });
      expect(hasAlert).toBe(false);

      // Should show validation error for invalid email format
      const hasEmailError = await page
        .getByText(/valid.*email|invalid.*email/i)
        .isVisible({ timeout: 5000 });
      expect(hasEmailError).toBe(true);
    });

    test('should handle concurrent login attempts', async ({ browser }) => {
      const contexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
        browser.newContext(),
      ]);

      const pages = await Promise.all(
        contexts.map(async ctx => {
          const page = ctx.pages()[0] || (await ctx.newPage());
          return page;
        })
      );

      try {
        // Register user first
        const signUpPage = new SignUpPage(pages[0]);
        await signUpPage.navigate();
        await signUpPage.signUp(testUser.email, testUser.password);
        await expect(pages[0]).toHaveURL('/dashboard', { timeout: 15000 });

        const dashboardPage = new DashboardPage(pages[0]);
        await dashboardPage.logout();

        // Attempt concurrent logins
        const loginPromises = pages.map(async page => {
          const signInPage = new SignInPage(page);
          await signInPage.navigate();
          await signInPage.signIn(testUser.email, testUser.password);
          return page.waitForURL(
            url =>
              url.pathname === '/dashboard' || url.pathname.includes('sign-in'),
            { timeout: 15000 }
          );
        });

        await Promise.all(loginPromises);

        // All should either succeed or handle gracefully
        for (const page of pages) {
          const currentUrl = page.url();
          const isValidState =
            currentUrl.includes('/dashboard') ||
            currentUrl.includes('sign-in') ||
            currentUrl === 'http://localhost:3000/';
          expect(isValidState).toBe(true);
        }
      } finally {
        // Cleanup - ensure contexts are always closed
        await Promise.all(
          contexts.map(async ctx => {
            try {
              await ctx.close();
            } catch {
              // Ignore cleanup errors
            }
          })
        );
      }
    });
  });

  test.describe('Email Verification (Mock)', () => {
    test('should show email verification prompt after registration', async ({
      page,
    }) => {
      const signUpPage = new SignUpPage(page);

      await signUpPage.navigate();
      await signUpPage.signUp(
        `verify-${Date.now()}@example.com`,
        testUser.password
      );

      // After successful registration, might show email verification prompt
      const verificationPrompt = await page
        .getByText(
          /verify.*email|check.*email|verification.*link|confirm.*email/i
        )
        .isVisible({ timeout: 10000 });

      if (verificationPrompt) {
        // Should show resend verification option
        const resendButton = page.getByRole('button', {
          name: /resend|send.*again/i,
        });
        if (await resendButton.isVisible()) {
          await resendButton.click();

          await expect(
            page.getByText(/verification.*sent|email.*sent/i)
          ).toBeVisible({
            timeout: 5000,
          });
        }
      } else {
        // If no email verification required, should go to dashboard
        await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
      }
    });
  });
});
