import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class SignInPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly signInButton: Locator;
  readonly signUpButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly backButton: Locator;
  readonly loadingSpinner: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);

    // Form elements
    this.emailInput = page.locator(
      'input[type="email"], input#email, [data-testid="email"]'
    );
    this.passwordInput = page.locator(
      'input[type="password"], input#password, [data-testid="password"]'
    );
    this.rememberMeCheckbox = page.locator(
      'input[type="checkbox"]#remember, [data-testid="remember"]'
    );

    // Buttons and links
    this.signInButton = page.locator(
      'button[type="submit"], button:has-text("Sign In"), [data-testid="sign-in-button"]'
    );
    this.signUpButton = page.locator(
      'a[href="/sign-up"], button:has-text("Sign Up"), [data-testid="sign-up-button"]'
    );
    this.forgotPasswordLink = page.locator(
      'a[href="/forgot-password"], a:has-text("Forgot Password")'
    );
    this.backButton = page.locator(
      'a[href="/"], button:has-text("Back"), [data-testid="back-button"]'
    );

    // Status elements
    this.loadingSpinner = page.locator(
      '.animate-spin, [data-testid="loading"]'
    );
    this.errorMessage = page.locator(
      '.error, [data-testid="error"], [role="alert"]'
    );
  }

  /**
   * Navigate to sign in page
   */
  async navigate() {
    await this.goto('/sign-in');
    await this.waitForLoadState();
  }

  /**
   * Sign in with email and password
   */
  async signIn(email: string, password: string, rememberMe = false) {
    await this.fillWithWait(this.emailInput, email);
    await this.fillWithWait(this.passwordInput, password);

    if (rememberMe) {
      await this.clickWithWait(this.rememberMeCheckbox);
    }

    await this.clickWithWait(this.signInButton);

    // Wait for navigation to complete (either success or error state)
    // Race between navigation and error display
    await Promise.any([
      this.page.waitForURL(/\/dashboard/, { timeout: 10000 }),
      this.errorMessage.waitFor({ timeout: 5000 }),
    ]).catch(() => {
      // If both fail, continue - test will handle verification
    });
  }

  /**
   * Click sign up button to navigate to registration
   */
  async clickSignUp() {
    await this.clickWithWait(this.signUpButton);
  }

  /**
   * Click forgot password link
   */
  async clickForgotPassword() {
    await this.clickWithWait(this.forgotPasswordLink);
  }

  /**
   * Click back button to return to landing page
   */
  async clickBack() {
    await this.clickWithWait(this.backButton);
  }

  /**
   * Wait for loading to complete
   */
  async waitForSignInToComplete() {
    // Wait for loading spinner to disappear
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 15000 });
  }

  /**
   * Check if there's an error message
   */
  async hasErrorMessage(): Promise<boolean> {
    return await this.errorMessage.isVisible({ timeout: 5000 });
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string> {
    return (await this.errorMessage.textContent()) || '';
  }
}
