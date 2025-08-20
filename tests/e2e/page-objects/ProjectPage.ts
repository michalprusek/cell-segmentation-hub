import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProjectPage extends BasePage {
  readonly projectTitle: Locator;
  readonly projectDescription: Locator;
  readonly uploadButton: Locator;
  readonly fileInput: Locator;
  readonly imageList: Locator;
  readonly segmentButton: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly exportButton: Locator;
  readonly moreOptionsButton: Locator;
  readonly processingStatus: Locator;
  readonly loadingSpinner: Locator;
  readonly backToDashboard: Locator;
  readonly modelSelector: Locator;
  readonly thresholdSlider: Locator;
  readonly processButton: Locator;

  constructor(page: Page) {
    super(page);

    // Project info elements
    this.projectTitle = page.locator(
      'h1, .project-title, [data-testid="project-title"]'
    );
    this.projectDescription = page.locator(
      '.project-description, [data-testid="project-description"]'
    );

    // Upload elements
    this.uploadButton = page.locator(
      'button:has-text("Upload"), button:has-text("Browse"), [data-testid="upload-button"]'
    );
    this.fileInput = page.locator('input[type="file"]');
    this.imageList = page.locator('.image-list, [data-testid="image-list"]');

    // Action buttons
    this.segmentButton = page
      .locator(
        'button:has-text("Segment"):visible, button:has-text("Analyze"):visible, button:has-text("Process"):visible'
      )
      .first();
    this.editButton = page
      .locator(
        'button:has-text("Edit"), a:has-text("Open Editor"), a:has-text("View Results")'
      )
      .first();
    this.deleteButton = page.locator('button:has-text("Delete")');
    this.exportButton = page.locator('button:has-text("Export")').first();
    this.moreOptionsButton = page.locator(
      'button:has-text("More"), [data-testid="more-options"]'
    );

    // Status elements
    this.processingStatus = page.locator(
      '.status, [data-testid="status"], text="Processing", text="Complete", text="Queued"'
    );
    this.loadingSpinner = page.locator(
      '.animate-spin, [data-testid="loading"]'
    );

    // Navigation
    this.backToDashboard = page.locator(
      'a[href="/dashboard"], button:has-text("Back to Dashboard")'
    );

    // ML Configuration
    this.modelSelector = page
      .locator(
        '[data-testid="model-selector"], select[name*="model"], [role="combobox"][aria-label*="model"]'
      )
      .first();
    this.thresholdSlider = page
      .locator(
        '[data-testid="threshold-slider"], input[type="range"][name*="threshold"], input[type="number"][name*="threshold"]'
      )
      .first();
    this.processButton = page
      .locator(
        '[data-testid="process-button"], button:has-text("Start"):visible, button:has-text("Process"):visible, button:has-text("Segment"):visible'
      )
      .first();
  }

  /**
   * Navigate to specific project
   */
  async navigate(projectId: string) {
    await this.goto(`/projects/${projectId}`);
    await this.waitForLoadState();
  }

  /**
   * Upload images to project
   */
  async uploadImages(imagePaths: string[]) {
    // Try multiple approaches for file upload
    const fileInput = this.fileInput.first();

    if (await fileInput.isVisible({ timeout: 2000 })) {
      await fileInput.setInputFiles(imagePaths);
    } else {
      // Try clicking upload button first
      if (await this.uploadButton.isVisible({ timeout: 2000 })) {
        await this.clickWithWait(this.uploadButton);
        await fileInput.setInputFiles(imagePaths);
      }
    }

    // Wait for upload to complete
    await this.waitForUploadComplete();
  }

  /**
   * Wait for upload to complete
   */
  async waitForUploadComplete() {
    // Wait for success message or uploaded image to appear
    const successIndicators = [
      this.page.locator('text="uploaded", text="success", text="complete"'),
      this.imageList,
    ];

    for (const indicator of successIndicators) {
      if (await indicator.isVisible({ timeout: 15000 }).catch(() => false)) {
        return;
      }
    }
  }

  /**
   * Start segmentation process
   */
  async startSegmentation(modelName?: string, threshold?: number) {
    // Click segment button to open configuration
    await this.clickWithWait(this.segmentButton);

    // Configure model if specified
    if (modelName && (await this.modelSelector.isVisible({ timeout: 2000 }))) {
      await this.modelSelector.selectOption({
        label: new RegExp(modelName, 'i'),
      });
    }

    // Configure threshold if specified
    if (
      threshold !== undefined &&
      (await this.thresholdSlider.isVisible({ timeout: 2000 }))
    ) {
      await this.thresholdSlider.fill(threshold.toString());
    }

    // Start processing
    await this.clickWithWait(this.processButton);
  }

  /**
   * Wait for processing to complete
   */
  async waitForProcessingComplete(timeout = 120000) {
    // Wait for processing status to change
    const completionIndicators = [
      this.page.locator(
        'text="Complete", text="Finished", text="Done", text="Success"'
      ),
      this.editButton, // Edit button appears when processing is complete
    ];

    for (const indicator of completionIndicators) {
      if (await indicator.isVisible({ timeout }).catch(() => false)) {
        return;
      }
    }
  }

  /**
   * Open segmentation editor
   */
  async openEditor() {
    await this.clickWithWait(this.editButton);
  }

  /**
   * Delete the project
   */
  async deleteProject() {
    // Try direct delete button or more options menu
    if (await this.deleteButton.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(this.deleteButton);
    } else if (await this.moreOptionsButton.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(this.moreOptionsButton);
      await this.clickWithWait(this.deleteButton);
    }

    // Confirm deletion
    const confirmButton = this.page
      .locator(
        'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")'
      )
      .last();
    if (await confirmButton.isVisible({ timeout: 5000 })) {
      await this.clickWithWait(confirmButton);
    }
  }

  /**
   * Export project results
   */
  async exportProject(format = 'coco') {
    await this.clickWithWait(this.exportButton);

    // Select export format if options are available
    const formatButton = this.page
      .locator(`text="${format}", button:has-text("${format}")`)
      .first();
    if (await formatButton.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(formatButton);
    }

    // Start download
    const downloadPromise = this.page.waitForDownload({ timeout: 30000 });
    const downloadButton = this.page
      .locator(
        '[data-testid="download-button"], button:has-text("Download"):visible, button:has-text("Export"):visible'
      )
      .first();

    try {
      await this.clickWithWait(downloadButton);
      return await downloadPromise;
    } catch (error) {
      console.warn('Download failed:', error);
      throw new Error(`Export download failed: ${error.message}`);
    }
  }

  /**
   * Go back to dashboard
   */
  async navigateBackToDashboard() {
    if (await this.backToDashboard.isVisible({ timeout: 2000 })) {
      await this.clickWithWait(this.backToDashboard);
    } else {
      await this.goto('/dashboard');
    }
  }

  /**
   * Get project title
   */
  async getProjectTitle(): Promise<string> {
    return (await this.projectTitle.textContent()) || '';
  }

  /**
   * Check if project has images
   */
  async hasImages(): Promise<boolean> {
    return await this.imageList.isVisible({ timeout: 5000 });
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(): Promise<string> {
    if (await this.processingStatus.isVisible({ timeout: 2000 })) {
      return (await this.processingStatus.textContent()) || '';
    }
    return '';
  }
}
