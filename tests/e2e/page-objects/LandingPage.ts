import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class LandingPage extends BasePage {
  readonly getStartedButton: Locator;
  readonly learnMoreButton: Locator;
  readonly signInLink: Locator;
  readonly documentationLink: Locator;
  readonly termsOfServiceLink: Locator;
  readonly privacyPolicyLink: Locator;
  readonly logo: Locator;
  readonly headerTitle: Locator;
  readonly description: Locator;

  constructor(page: Page) {
    super(page);

    // Header elements
    this.signInLink = page.locator('a[href="/sign-in"], a:has-text("Sign In")');
    this.documentationLink = page.locator('a[href="/documentation"]');
    this.termsOfServiceLink = page.locator('a[href="/terms-of-service"]');
    this.privacyPolicyLink = page.locator('a[href="/privacy-policy"]');
    this.logo = page.locator('img[alt*="Logo"], .logo, [data-testid="logo"]');

    // Main content elements
    this.headerTitle = page.locator(
      'h1, .main-title, [data-testid="main-title"]'
    );
    this.description = page.locator(
      '.description, [data-testid="description"]'
    );
    this.getStartedButton = page.locator(
      'button:has-text("Get Started"), a:has-text("Get Started")'
    );
    this.learnMoreButton = page.locator(
      'button:has-text("Learn More"), a:has-text("Learn More")'
    );
  }

  /**
   * Navigate to landing page
   */
  async navigate() {
    await this.goto('/');
    await this.waitForLoadState();
  }

  /**
   * Click on Sign In link
   */
  async clickSignIn() {
    await this.clickWithWait(this.signInLink);
  }

  /**
   * Click on Get Started button
   */
  async clickGetStarted() {
    await this.clickWithWait(this.getStartedButton);
  }

  /**
   * Click on Learn More button
   */
  async clickLearnMore() {
    await this.clickWithWait(this.learnMoreButton);
  }

  /**
   * Navigate to documentation
   */
  async clickDocumentation() {
    await this.clickWithWait(this.documentationLink);
  }

  /**
   * Verify page elements are visible
   */
  async verifyPageElements() {
    await this.waitForElement(this.logo);
    // Don't require all elements as some may be conditional
  }
}
