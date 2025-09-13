import { Page, Locator, expect as _expect } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific URL
   */
  async goto(url: string) {
    await this.page.goto(url);
  }

  /**
   * Wait for page to load completely
   */
  async waitForLoadState() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Take a screenshot for debugging
   */
  async screenshot(name: string) {
    return await this.page.screenshot({ path: `test-results/${name}.png` });
  }

  /**
   * Wait for an element to be visible with retries
   */
  async waitForElement(locator: Locator, timeout = 10000) {
    return await locator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Click with wait for element
   */
  async clickWithWait(locator: Locator, timeout = 10000) {
    await this.waitForElement(locator, timeout);
    await locator.click();
  }

  /**
   * Fill input with wait for element
   */
  async fillWithWait(locator: Locator, text: string, timeout = 10000) {
    await this.waitForElement(locator, timeout);
    await locator.fill(text);
  }

  /**
   * Check if user is logged in by looking for user-specific elements
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      // Look for dashboard elements or user menu
      const userElements = [
        this.page.locator('[data-testid="user-menu"]'),
        this.page.locator('[data-testid="dashboard"]'),
        this.page.locator('[aria-label*="user"]'),
        this.page.locator('[aria-label*="profile"]'),
        this.page.locator('text="dashboard"').first(),
        this.page.locator('text="logout"').first(),
        this.page.locator('text="sign out"').first(),
      ];

      for (const element of userElements) {
        try {
          await element.waitFor({ state: 'visible', timeout: 2000 });
          return true;
        } catch {
          // Continue checking next element
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(urlPattern?: string | RegExp) {
    if (urlPattern) {
      await this.page.waitForURL(urlPattern);
    } else {
      await this.page.waitForLoadState('networkidle');
    }
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Reload the page
   */
  async reload() {
    await this.page.reload();
    await this.waitForLoadState();
  }
}
