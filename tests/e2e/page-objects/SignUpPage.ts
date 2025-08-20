import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class SignUpPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly termsCheckbox: Locator;
  readonly signUpButton: Locator;
  readonly signInLink: Locator;
  readonly backButton: Locator;
  readonly loadingSpinner: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    super(page);

    // Form elements
    this.emailInput = page.locator(
      'input[type="email"], input#email, [data-testid="email"]'
    );
    this.passwordInput = page
      .locator(
        '[data-testid="password"], input[type="password"][id*="password"], input[type="password"][name*="password"]'
      )
      .first();
    this.confirmPasswordInput = page.locator(
      '[data-testid="confirm-password"], input[id*="confirm"], input[name*="confirm"]'
    );
    this.termsCheckbox = page
      .locator(
        '[data-testid="terms-checkbox"], input[type="checkbox"][id*="terms"], input[type="checkbox"][name*="terms"]'
      )
      .first();

    // Buttons and links
    this.signUpButton = page.locator(
      'button[type="submit"], button:has-text("Sign Up"), [data-testid="sign-up-button"]'
    );
    this.signInLink = page.locator(
      'a[href="/sign-in"], a:has-text("Sign In"), [data-testid="sign-in-link"]'
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
    this.successMessage = page.locator('.success, [data-testid="success"]');
  }

  /**
   * Navigate to sign up page
   */
  async navigate() {
    await this.goto('/sign-up');
    await this.waitForLoadState();
  }

  /**
   * Sign up with email and password
   */
  async signUp(email: string, password: string, confirmPassword?: string) {
    await this.fillWithWait(this.emailInput, email);
    await this.fillWithWait(this.passwordInput, password);

    if (confirmPassword !== undefined) {
      await this.fillWithWait(this.confirmPasswordInput, confirmPassword);
    } else {
      await this.fillWithWait(this.confirmPasswordInput, password);
    }

    // Accept terms if checkbox is present
    if (await this.termsCheckbox.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(this.termsCheckbox);
    }

    await this.clickWithWait(this.signUpButton);
  }

  /**
   * Click sign in link to navigate to sign in page
   */
  async clickSignIn() {
    await this.clickWithWait(this.signInLink);
  }

  /**
   * Click back button to return to landing page
   */
  async clickBack() {
    await this.clickWithWait(this.backButton);
  }

  /**
   * Wait for registration to complete
   */
  async waitForSignUpToComplete() {
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

  /**
   * Check if there's a success message
   */
  async hasSuccessMessage(): Promise<boolean> {
    return await this.successMessage.isVisible({ timeout: 5000 });
  }
}
