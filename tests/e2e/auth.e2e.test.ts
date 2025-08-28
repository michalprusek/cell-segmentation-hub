import { test, expect, Page } from '@playwright/test';
import { randomBytes } from 'crypto';

// Test user credentials
const TEST_USER = {
  email: `test-${randomBytes(4).toString('hex')}@example.com`,
  password: 'TestPassword123!',
  username: `testuser_${randomBytes(4).toString('hex')}`,
};

// Helper functions
async function fillLoginForm(page: Page, email: string, password: string) {
  await page.fill('[data-testid="email-input"]', email);
  await page.fill('[data-testid="password-input"]', password);
}

async function checkAuthState(
  page: Page,
  expectedState: 'authenticated' | 'unauthenticated'
) {
  if (expectedState === 'authenticated') {
    // Check for authenticated UI elements
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();

    // Check localStorage for auth tokens
    const tokens = await page.evaluate(() => {
      return {
        accessToken: localStorage.getItem('access_token'),
        refreshToken: localStorage.getItem('refresh_token'),
      };
    });
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  } else {
    // Check for unauthenticated UI elements
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Check localStorage is clear
    const tokens = await page.evaluate(() => {
      return {
        accessToken: localStorage.getItem('access_token'),
        refreshToken: localStorage.getItem('refresh_token'),
      };
    });
    expect(tokens.accessToken).toBeFalsy();
    expect(tokens.refreshToken).toBeFalsy();
  }
}

test.describe('Authentication E2E Tests', () => {
  test.describe('User Registration Flow', () => {
    test('Should successfully register a new user', async ({ page }) => {
      await page.goto('http://localhost:3000/register');

      // Fill registration form
      await page.fill('[data-testid="email-input"]', TEST_USER.email);
      await page.fill('[data-testid="username-input"]', TEST_USER.username);
      await page.fill('[data-testid="password-input"]', TEST_USER.password);
      await page.fill(
        '[data-testid="confirm-password-input"]',
        TEST_USER.password
      );

      // Accept terms if required
      const termsCheckbox = page.locator('[data-testid="terms-checkbox"]');
      if (await termsCheckbox.isVisible()) {
        await termsCheckbox.check();
      }

      // Submit registration
      await page.click('[data-testid="register-button"]');

      // Wait for registration success
      await expect(
        page.locator('[data-testid="registration-success"]')
      ).toBeVisible({ timeout: 10000 });

      // Should redirect to email verification or dashboard
      await expect(page).toHaveURL(/\/(verify-email|dashboard)/);
    });

    test('Should validate registration form fields', async ({ page }) => {
      await page.goto('http://localhost:3000/register');

      // Test invalid email
      await page.fill('[data-testid="email-input"]', 'invalid-email');
      await page.click('[data-testid="register-button"]');
      await expect(page.locator('[data-testid="email-error"]')).toContainText(
        /valid email/i
      );

      // Test password mismatch
      await page.fill('[data-testid="email-input"]', 'valid@example.com');
      await page.fill('[data-testid="password-input"]', 'Password123!');
      await page.fill(
        '[data-testid="confirm-password-input"]',
        'DifferentPassword123!'
      );
      await page.click('[data-testid="register-button"]');
      await expect(
        page.locator('[data-testid="password-match-error"]')
      ).toContainText(/passwords.*match/i);

      // Test weak password
      await page.fill('[data-testid="password-input"]', 'weak');
      await page.fill('[data-testid="confirm-password-input"]', 'weak');
      await page.click('[data-testid="register-button"]');
      await expect(
        page.locator('[data-testid="password-strength-error"]')
      ).toBeVisible();
    });

    test('Should prevent duplicate email registration', async ({ page }) => {
      await page.goto('http://localhost:3000/register');

      // Use an existing email
      await page.fill('[data-testid="email-input"]', 'existing@example.com');
      await page.fill('[data-testid="username-input"]', 'newusername');
      await page.fill('[data-testid="password-input"]', TEST_USER.password);
      await page.fill(
        '[data-testid="confirm-password-input"]',
        TEST_USER.password
      );

      await page.click('[data-testid="register-button"]');

      // Should show error message
      await expect(
        page.locator('[data-testid="registration-error"]')
      ).toContainText(/already.*registered/i);
    });
  });

  test.describe('Login Flow', () => {
    test('Should successfully log in with valid credentials', async ({
      page,
    }) => {
      await page.goto('http://localhost:3000/login');

      // Fill login form
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');

      // Submit login
      await page.click('[data-testid="login-button"]');

      // Wait for successful login
      await page.waitForURL('**/dashboard', { timeout: 10000 });

      // Check authenticated state
      await checkAuthState(page, 'authenticated');

      // Verify user info is displayed
      await expect(page.locator('[data-testid="user-email"]')).toContainText(
        'test@example.com'
      );
    });

    test('Should show error for invalid credentials', async ({ page }) => {
      await page.goto('http://localhost:3000/login');

      // Try invalid credentials
      await fillLoginForm(page, 'wrong@example.com', 'WrongPassword');
      await page.click('[data-testid="login-button"]');

      // Should show error message
      await expect(page.locator('[data-testid="login-error"]')).toContainText(
        /invalid.*credentials/i
      );

      // Should remain on login page
      await expect(page).toHaveURL(/\/login/);

      // Should not be authenticated
      await checkAuthState(page, 'unauthenticated');
    });

    test('Should handle remember me functionality', async ({ page }) => {
      await page.goto('http://localhost:3000/login');

      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');

      // Check remember me
      await page.check('[data-testid="remember-me-checkbox"]');
      await page.click('[data-testid="login-button"]');

      await page.waitForURL('**/dashboard');

      // Check that refresh token has longer expiry
      const refreshToken = await page.evaluate(() => {
        const token = localStorage.getItem('refresh_token');
        if (!token) return null;

        // Decode JWT payload (simple base64 decode)
        const payload = JSON.parse(atob(token.split('.')[1]));
        return {
          exp: payload.exp,
          expiryDate: new Date(payload.exp * 1000),
        };
      });

      expect(refreshToken).toBeTruthy();
      // Should have extended expiry (e.g., 30 days)
      const daysDiff =
        (refreshToken!.exp * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(7); // At least 7 days
    });

    test('Should redirect to login when accessing protected routes', async ({
      page,
    }) => {
      // Clear any existing auth
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());

      // Try to access protected route
      await page.goto('http://localhost:3000/projects');

      // Should redirect to login
      await page.waitForURL('**/login');

      // Should show redirect message
      await expect(
        page.locator('[data-testid="auth-required-message"]')
      ).toBeVisible();

      // After login, should redirect back to original page
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');

      await page.waitForURL('**/projects');
    });
  });

  test.describe('Logout Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.goto('http://localhost:3000/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL('**/dashboard');
    });

    test('Should successfully log out user', async ({ page }) => {
      // Click user menu
      await page.click('[data-testid="user-menu"]');

      // Click logout
      await page.click('[data-testid="logout-button"]');

      // Should redirect to home or login
      await page.waitForURL(/\/(home|login)/);

      // Check unauthenticated state
      await checkAuthState(page, 'unauthenticated');

      // Try accessing protected route
      await page.goto('http://localhost:3000/dashboard');
      await page.waitForURL('**/login');
    });

    test('Should clear all auth data on logout', async ({ page }) => {
      // Store initial tokens
      const initialTokens = await page.evaluate(() => ({
        access: localStorage.getItem('access_token'),
        refresh: localStorage.getItem('refresh_token'),
      }));

      expect(initialTokens.access).toBeTruthy();
      expect(initialTokens.refresh).toBeTruthy();

      // Logout
      await page.click('[data-testid="user-menu"]');
      await page.click('[data-testid="logout-button"]');

      // Check all auth data is cleared
      const afterLogout = await page.evaluate(() => ({
        localStorage: {
          access: localStorage.getItem('access_token'),
          refresh: localStorage.getItem('refresh_token'),
          user: localStorage.getItem('user'),
        },
        sessionStorage: {
          auth: sessionStorage.getItem('auth_session'),
        },
        cookies: document.cookie,
      }));

      expect(afterLogout.localStorage.access).toBeFalsy();
      expect(afterLogout.localStorage.refresh).toBeFalsy();
      expect(afterLogout.localStorage.user).toBeFalsy();
      expect(afterLogout.sessionStorage.auth).toBeFalsy();
      expect(afterLogout.cookies).not.toContain('auth');
    });
  });

  test.describe('Password Reset Flow', () => {
    test('Should send password reset email', async ({ page }) => {
      await page.goto('http://localhost:3000/login');

      // Click forgot password
      await page.click('[data-testid="forgot-password-link"]');

      // Enter email
      await page.fill('[data-testid="reset-email-input"]', 'test@example.com');
      await page.click('[data-testid="send-reset-button"]');

      // Should show success message
      await expect(
        page.locator('[data-testid="reset-email-sent"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="reset-email-sent"]')
      ).toContainText(/email.*sent/i);
    });

    test('Should reset password with valid token', async ({ page }) => {
      // Simulate clicking reset link from email
      const resetToken = 'valid-reset-token-123';
      await page.goto(
        `http://localhost:3000/reset-password?token=${resetToken}`
      );

      // Enter new password
      const newPassword = 'NewPassword123!';
      await page.fill('[data-testid="new-password-input"]', newPassword);
      await page.fill(
        '[data-testid="confirm-new-password-input"]',
        newPassword
      );

      await page.click('[data-testid="reset-password-button"]');

      // Should show success and redirect to login
      await expect(
        page.locator('[data-testid="password-reset-success"]')
      ).toBeVisible();
      await page.waitForURL('**/login');

      // Should be able to login with new password
      await fillLoginForm(page, 'test@example.com', newPassword);
      await page.click('[data-testid="login-button"]');
      await page.waitForURL('**/dashboard');
    });

    test('Should handle expired reset token', async ({ page }) => {
      const expiredToken = 'expired-token-123';
      await page.goto(
        `http://localhost:3000/reset-password?token=${expiredToken}`
      );

      // Should show error
      await expect(
        page.locator('[data-testid="token-expired-error"]')
      ).toBeVisible();

      // Should provide option to request new token
      await expect(
        page.locator('[data-testid="request-new-token-link"]')
      ).toBeVisible();
    });
  });

  test.describe('Token Refresh Flow', () => {
    test('Should automatically refresh expired access token', async ({
      page,
    }) => {
      // Login
      await page.goto('http://localhost:3000/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL('**/dashboard');

      // Simulate expired access token
      await page.evaluate(() => {
        const expiredToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDAwMDAwMDB9.expired';
        localStorage.setItem('access_token', expiredToken);
      });

      // Make an API request
      await page.click('[data-testid="refresh-data-button"]');

      // Should automatically refresh token
      await page.waitForResponse(resp => resp.url().includes('/auth/refresh'));

      // Check new token is stored
      const newToken = await page.evaluate(() =>
        localStorage.getItem('access_token')
      );
      expect(newToken).not.toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDAwMDAwMDB9.expired'
      );

      // Request should succeed
      await expect(page.locator('[data-testid="data-loaded"]')).toBeVisible();
    });

    test('Should logout when refresh token is invalid', async ({ page }) => {
      // Login
      await page.goto('http://localhost:3000/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL('**/dashboard');

      // Simulate invalid tokens
      await page.evaluate(() => {
        localStorage.setItem('access_token', 'invalid-access');
        localStorage.setItem('refresh_token', 'invalid-refresh');
      });

      // Try to make authenticated request
      await page.click('[data-testid="fetch-projects-button"]');

      // Should redirect to login after failed refresh
      await page.waitForURL('**/login');

      // Should show session expired message
      await expect(
        page.locator('[data-testid="session-expired"]')
      ).toBeVisible();
    });
  });

  test.describe('Social Authentication', () => {
    test.skip('Should login with Google OAuth', async ({ page }) => {
      // Skip if social auth not configured
      await page.goto('http://localhost:3000/login');

      const googleButton = page.locator('[data-testid="google-login-button"]');
      if (!(await googleButton.isVisible())) {
        test.skip();
        return;
      }

      // Click Google login
      await googleButton.click();

      // Handle Google OAuth flow (mock in test environment)
      // This would redirect to Google in production
      await page.waitForURL('**/auth/google/callback');

      // Should be logged in after OAuth callback
      await page.waitForURL('**/dashboard');
      await checkAuthState(page, 'authenticated');
    });
  });

  test.describe('Session Management', () => {
    test('Should maintain session across page refreshes', async ({ page }) => {
      // Login
      await page.goto('http://localhost:3000/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL('**/dashboard');

      // Refresh page
      await page.reload();

      // Should still be authenticated
      await checkAuthState(page, 'authenticated');
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('Should handle concurrent sessions', async ({ browser }) => {
      // Create two browser contexts (simulate two devices)
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();

      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      try {
        // Login on first device
        await page1.goto('http://localhost:3000/login');
        await fillLoginForm(page1, 'test@example.com', 'TestPassword123!');
        await page1.click('[data-testid="login-button"]');
        await page1.waitForURL('**/dashboard');

        // Login on second device
        await page2.goto('http://localhost:3000/login');
        await fillLoginForm(page2, 'test@example.com', 'TestPassword123!');
        await page2.click('[data-testid="login-button"]');
        await page2.waitForURL('**/dashboard');

        // Both sessions should be active
        await checkAuthState(page1, 'authenticated');
        await checkAuthState(page2, 'authenticated');

        // Logout from one device
        await page1.click('[data-testid="user-menu"]');
        await page1.click('[data-testid="logout-button"]');

        // Other session should remain active (unless single-session enforced)
        await page2.reload();
        await checkAuthState(page2, 'authenticated');
      } finally {
        await context1.close();
        await context2.close();
      }
    });
  });

  test.describe('Security Features', () => {
    test('Should implement rate limiting on login attempts', async ({
      page,
    }) => {
      await page.goto('http://localhost:3000/login');

      // Make multiple failed login attempts
      for (let i = 0; i < 6; i++) {
        await fillLoginForm(page, 'test@example.com', 'WrongPassword');
        await page.click('[data-testid="login-button"]');
        await page.waitForTimeout(100);
      }

      // Should show rate limit error
      await expect(
        page.locator('[data-testid="rate-limit-error"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="rate-limit-error"]')
      ).toContainText(/too many attempts/i);

      // Login button should be disabled
      await expect(page.locator('[data-testid="login-button"]')).toBeDisabled();
    });

    test('Should enforce secure password requirements', async ({ page }) => {
      await page.goto('http://localhost:3000/register');

      const weakPasswords = [
        'short', // Too short
        'nouppercase123!', // No uppercase
        'NOLOWERCASE123!', // No lowercase
        'NoNumbers!', // No numbers
        'NoSpecialChar1', // No special characters
        'password123!', // Common password
      ];

      for (const password of weakPasswords) {
        await page.fill('[data-testid="password-input"]', password);
        await page.click('[data-testid="register-button"]');

        // Should show password requirement error
        await expect(
          page.locator('[data-testid="password-requirements"]')
        ).toBeVisible();
      }
    });

    test('Should protect against XSS in login form', async ({ page }) => {
      await page.goto('http://localhost:3000/login');

      // Try XSS payload
      const xssPayload = '<script>alert("XSS")</script>';
      await page.fill('[data-testid="email-input"]', xssPayload);
      await page.fill('[data-testid="password-input"]', xssPayload);
      await page.click('[data-testid="login-button"]');

      // Should not execute script (check no alert dialog)
      const alertDialog = page.locator('dialog');
      await expect(alertDialog).not.toBeVisible();

      // Should sanitize and show error
      await expect(page.locator('[data-testid="login-error"]')).toBeVisible();
    });
  });
});

// Cleanup after tests
test.afterAll(async () => {
  // Clean up test users if needed
  console.log('Auth E2E tests completed');
});
