import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  readonly createProjectButton: Locator;
  readonly searchInput: Locator;
  readonly projectCards: Locator;
  readonly userMenu: Locator;
  readonly logoutButton: Locator;
  readonly settingsButton: Locator;
  readonly emptyStateMessage: Locator;
  readonly loadingSpinner: Locator;
  readonly welcomeMessage: Locator;
  readonly statsOverview: Locator;

  constructor(page: Page) {
    super(page);

    // Main dashboard elements
    this.createProjectButton = page.locator(
      'button:has-text("Create"), button:has-text("New Project"), [data-testid="create-project"]'
    );
    this.searchInput = page.locator(
      'input[placeholder*="search"], input[type="search"], [data-testid="search"]'
    );
    this.projectCards = page.locator(
      '.project-card, [data-testid="project-card"]'
    );

    // User menu and navigation
    this.userMenu = page.locator(
      '[data-testid="user-menu"], .user-menu, button[aria-label*="user"]'
    );
    this.logoutButton = page.locator(
      'button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout")'
    );
    this.settingsButton = page.locator(
      'button:has-text("Settings"), a[href*="settings"]'
    );

    // State messages
    this.emptyStateMessage = page.locator(
      'text="No projects", text="Get started", text="Create your first", [data-testid="empty-state"]'
    );
    this.welcomeMessage = page.locator(
      'text="Welcome", text="Dashboard", [data-testid="welcome"]'
    );
    this.loadingSpinner = page.locator(
      '.animate-spin, [data-testid="loading"]'
    );
    this.statsOverview = page.locator('.stats, [data-testid="stats"]');
  }

  /**
   * Navigate to dashboard
   */
  async navigate() {
    await this.goto('/dashboard');
    await this.waitForLoadState();
  }

  /**
   * Click create project button
   */
  async clickCreateProject() {
    await this.clickWithWait(this.createProjectButton);
  }

  /**
   * Search for projects
   */
  async searchProjects(query: string) {
    if (await this.searchInput.isVisible({ timeout: 2000 })) {
      await this.fillWithWait(this.searchInput, query);
    }
  }

  /**
   * Clear search
   */
  async clearSearch() {
    if (await this.searchInput.isVisible({ timeout: 2000 })) {
      await this.searchInput.clear();
    }
  }

  /**
   * Get number of visible project cards
   */
  async getProjectCount(): Promise<number> {
    return await this.projectCards.count();
  }

  /**
   * Click on a project by name
   */
  async clickProject(projectName: string) {
    const projectCard = this.projectCards.filter({ hasText: projectName });
    await this.clickWithWait(projectCard.first());
  }

  /**
   * Open user menu
   */
  async openUserMenu() {
    if (await this.userMenu.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(this.userMenu);
    }
  }

  /**
   * Logout from the application
   */
  async logout() {
    await this.openUserMenu();
    await this.clickWithWait(this.logoutButton);
  }

  /**
   * Check if dashboard is loaded
   */
  async isDashboardLoaded(): Promise<boolean> {
    try {
      // Look for dashboard-specific elements
      const dashboardElements = [
        this.createProjectButton,
        this.welcomeMessage,
        this.emptyStateMessage,
        this.statsOverview,
      ];

      for (const element of dashboardElements) {
        try {
          await element.waitFor({ state: 'visible', timeout: 2000 });
          return true;
        } catch {
          // Continue to next element
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking if dashboard is loaded:', error);
      return false;
    }
  }

  /**
   * Wait for projects to load
   */
  async waitForProjectsToLoad() {
    // Wait for loading spinner to disappear if present
    if (await this.loadingSpinner.isVisible({ timeout: 2000 })) {
      await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 10000 });
    }

    // Wait for projects to be visible using locator-based waiting
    try {
      const projectContainer = this.page
        .locator(
          '[data-testid="projects-container"], .projects-grid, .project-list'
        )
        .first();
      await projectContainer.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      // Fallback if no projects container found - page might be empty
    }
  }

  /**
   * Check if there are any projects
   */
  async hasProjects(): Promise<boolean> {
    await this.waitForProjectsToLoad();
    return (await this.getProjectCount()) > 0;
  }

  /**
   * Check if empty state is shown
   */
  async isEmptyState(): Promise<boolean> {
    return await this.emptyStateMessage.isVisible({ timeout: 5000 });
  }
}
