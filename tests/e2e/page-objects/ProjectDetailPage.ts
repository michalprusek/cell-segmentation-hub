import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProjectDetailPage extends BasePage {
  readonly projectTitle: Locator;
  readonly projectDescription: Locator;
  readonly imageList: Locator;
  readonly uploadArea: Locator;
  readonly fileInput: Locator;

  // Project actions
  readonly editProjectButton: Locator;
  readonly deleteProjectButton: Locator;
  readonly archiveProjectButton: Locator;
  readonly shareProjectButton: Locator;
  readonly exportProjectButton: Locator;
  readonly duplicateProjectButton: Locator;

  // Image management
  readonly uploadImageButton: Locator;
  readonly bulkUploadButton: Locator;
  readonly selectAllImagesButton: Locator;
  readonly deleteSelectedImagesButton: Locator;
  readonly downloadImagesButton: Locator;

  // Segmentation controls
  readonly segmentAllButton: Locator;
  readonly segmentSelectedButton: Locator;
  readonly batchProcessButton: Locator;
  readonly modelSelector: Locator;
  readonly thresholdSlider: Locator;
  readonly advancedSettingsButton: Locator;

  // View options
  readonly viewModeButtons: Locator;
  readonly gridView: Locator;
  readonly listView: Locator;
  readonly thumbnailSize: Locator;
  readonly sortOptions: Locator;
  readonly filterOptions: Locator;

  // Statistics and info
  readonly projectStats: Locator;
  readonly imageCount: Locator;
  readonly processedCount: Locator;
  readonly storageUsed: Locator;
  readonly lastModified: Locator;

  // Queue and processing
  readonly processingQueue: Locator;
  readonly queueStatus: Locator;
  readonly progressBar: Locator;
  readonly cancelProcessingButton: Locator;

  // Image items
  readonly imageItems: Locator;
  readonly imageCheckboxes: Locator;
  readonly imageThumbnails: Locator;
  readonly imageNames: Locator;

  constructor(page: Page) {
    super(page);

    // Project info
    this.projectTitle = page.locator(
      'h1, .project-title, [data-testid="project-title"]'
    );
    this.projectDescription = page.locator(
      '.project-description, [data-testid="project-description"]'
    );
    this.imageList = page.locator(
      '.image-list, .images-container, [data-testid="image-list"]'
    );
    this.uploadArea = page.locator(
      '.upload-area, .dropzone, [data-testid="upload-area"]'
    );
    this.fileInput = page.locator('input[type="file"]');

    // Project actions
    this.editProjectButton = page.getByRole('button', {
      name: /edit.*project|project.*settings/i,
    });
    this.deleteProjectButton = page.getByRole('button', {
      name: /delete.*project/i,
    });
    this.archiveProjectButton = page.getByRole('button', { name: /archive/i });
    this.shareProjectButton = page.getByRole('button', { name: /share/i });
    this.exportProjectButton = page.getByRole('button', {
      name: /export.*project/i,
    });
    this.duplicateProjectButton = page.getByRole('button', {
      name: /duplicate|copy.*project/i,
    });

    // Image management
    this.uploadImageButton = page.getByRole('button', {
      name: /upload.*image|add.*image/i,
    });
    this.bulkUploadButton = page.getByRole('button', {
      name: /bulk.*upload|upload.*multiple/i,
    });
    this.selectAllImagesButton = page.getByRole('button', {
      name: /select.*all/i,
    });
    this.deleteSelectedImagesButton = page.getByRole('button', {
      name: /delete.*selected/i,
    });
    this.downloadImagesButton = page.getByRole('button', {
      name: /download.*images/i,
    });

    // Segmentation
    this.segmentAllButton = page.getByRole('button', {
      name: /segment.*all|process.*all|batch.*segment/i,
    });
    this.segmentSelectedButton = page.getByRole('button', {
      name: /segment.*selected|process.*selected/i,
    });
    this.batchProcessButton = page.getByRole('button', {
      name: /batch.*process|start.*batch/i,
    });
    this.modelSelector = page.getByRole('combobox', {
      name: /model|algorithm/i,
    });
    this.thresholdSlider = page.locator(
      'input[type="range"], .threshold-slider'
    );
    this.advancedSettingsButton = page.getByRole('button', {
      name: /advanced.*settings|more.*options/i,
    });

    // View options
    this.viewModeButtons = page.locator('.view-mode, [data-view-mode]');
    this.gridView = page.getByRole('button', { name: /grid.*view|grid/i });
    this.listView = page.getByRole('button', { name: /list.*view|list/i });
    this.thumbnailSize = page.locator(
      '.thumbnail-size, input[name="thumbnail-size"]'
    );
    this.sortOptions = page.getByRole('combobox', { name: /sort/i });
    this.filterOptions = page.locator('.filters, [data-testid="filters"]');

    // Statistics
    this.projectStats = page.locator(
      '.project-stats, .statistics, [data-testid="project-stats"]'
    );
    this.imageCount = page.locator('.image-count, [data-count="images"]');
    this.processedCount = page.locator(
      '.processed-count, [data-count="processed"]'
    );
    this.storageUsed = page.locator('.storage-used, [data-testid="storage"]');
    this.lastModified = page.locator(
      '.last-modified, [data-testid="last-modified"]'
    );

    // Processing
    this.processingQueue = page.locator(
      '.processing-queue, .queue, [data-testid="queue"]'
    );
    this.queueStatus = page.locator(
      '.queue-status, [data-testid="queue-status"]'
    );
    this.progressBar = page.locator('.progress-bar, [role="progressbar"]');
    this.cancelProcessingButton = page.getByRole('button', {
      name: /cancel.*processing|stop.*processing/i,
    });

    // Image items
    this.imageItems = page.locator(
      '.image-item, .image-card, [data-testid*="image"]'
    );
    this.imageCheckboxes = page.locator(
      '.image-checkbox, input[type="checkbox"][data-image]'
    );
    this.imageThumbnails = page.locator('.image-thumbnail, .thumbnail img');
    this.imageNames = page.locator('.image-name, .filename');
  }

  /**
   * Navigate to project detail page
   */
  async navigate(projectId: string) {
    await this.goto(`/projects/${projectId}`);
    await this.waitForLoadState();
  }

  /**
   * Wait for project to fully load
   */
  async waitForProjectLoad(timeout = 10000) {
    await this.projectTitle.waitFor({ state: 'visible', timeout });
    await this.imageList.waitFor({ state: 'visible', timeout });
  }

  /**
   * Upload single image
   */
  async uploadImage(imagePath: string) {
    await this.fileInput.setInputFiles(imagePath);
  }

  /**
   * Upload multiple images
   */
  async uploadImages(imagePaths: string[]) {
    await this.fileInput.setInputFiles(imagePaths);
  }

  /**
   * Upload images via drag and drop
   */
  async uploadImagesByDrag(imagePaths: string[]) {
    // This is a simplified implementation - actual drag/drop would require more complex setup
    await this.uploadImages(imagePaths);
  }

  /**
   * Select image by index
   */
  async selectImage(index: number) {
    const imageCheckbox = this.imageCheckboxes.nth(index);
    await this.clickWithWait(imageCheckbox);
  }

  /**
   * Select multiple images
   */
  async selectImages(indices: number[]) {
    for (const index of indices) {
      await this.selectImage(index);
    }
  }

  /**
   * Select all images
   */
  async selectAllImages() {
    await this.clickWithWait(this.selectAllImagesButton);
  }

  /**
   * Get selected image count
   */
  async getSelectedImageCount(): Promise<number> {
    const checkedBoxes = this.page.locator(
      'input[type="checkbox"][data-image]:checked'
    );
    return await checkedBoxes.count();
  }

  /**
   * Delete selected images
   */
  async deleteSelectedImages() {
    await this.clickWithWait(this.deleteSelectedImagesButton);

    // Handle confirmation dialog
    const confirmButton = this.page.getByRole('button', {
      name: /confirm|delete|yes/i,
    });
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }
  }

  /**
   * Start segmentation for all images
   */
  async segmentAllImages(modelName?: string, threshold?: number) {
    if (modelName) {
      await this.selectModel(modelName);
    }

    if (threshold !== undefined) {
      await this.setThreshold(threshold);
    }

    await this.clickWithWait(this.segmentAllButton);
  }

  /**
   * Start segmentation for selected images
   */
  async segmentSelectedImages(modelName?: string, threshold?: number) {
    if (modelName) {
      await this.selectModel(modelName);
    }

    if (threshold !== undefined) {
      await this.setThreshold(threshold);
    }

    await this.clickWithWait(this.segmentSelectedButton);
  }

  /**
   * Select ML model
   */
  async selectModel(modelName: string) {
    await this.clickWithWait(this.modelSelector);
    const modelOption = this.page.getByText(new RegExp(modelName, 'i'));
    await modelOption.click();
  }

  /**
   * Set segmentation threshold
   */
  async setThreshold(threshold: number) {
    // Use evaluate to properly set range input value and trigger events
    await this.thresholdSlider.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = value.toString();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, threshold);
  }

  /**
   * Open advanced settings
   */
  async openAdvancedSettings() {
    await this.clickWithWait(this.advancedSettingsButton);
  }

  /**
   * Change view mode
   */
  async changeViewMode(mode: 'grid' | 'list') {
    const viewButton = mode === 'grid' ? this.gridView : this.listView;
    await this.clickWithWait(viewButton);
  }

  /**
   * Sort images
   */
  async sortImages(criteria: string) {
    await this.clickWithWait(this.sortOptions);
    const sortOption = this.page.getByText(new RegExp(criteria, 'i'));
    await sortOption.click();
  }

  /**
   * Apply filters
   */
  async applyFilter(filterType: string, value: string) {
    const filterButton = this.filterOptions.getByText(
      new RegExp(filterType, 'i')
    );
    await filterButton.click();

    const filterValue = this.page.getByText(new RegExp(value, 'i'));
    await filterValue.click();
  }

  /**
   * Get project statistics
   */
  async getProjectStats(): Promise<{
    imageCount: number;
    processedCount: number;
    storageUsed: string;
    lastModified: string;
  }> {
    const imageCountText = await this.imageCount.textContent();
    const processedCountText = await this.processedCount.textContent();
    const storageUsedText = await this.storageUsed.textContent();
    const lastModifiedText = await this.lastModified.textContent();

    try {
      return {
        imageCount: parseInt(imageCountText?.match(/\d+/)?.[0] || '0', 10),
        processedCount: parseInt(
          processedCountText?.match(/\d+/)?.[0] || '0',
          10
        ),
        storageUsed: storageUsedText || '',
        lastModified: lastModifiedText || '',
      };
    } catch (_error) {
      // console.warn('Error parsing project statistics:', _error);
      return {
        imageCount: 0,
        processedCount: 0,
        storageUsed: storageUsedText || '',
        lastModified: lastModifiedText || '',
      };
    }
  }

  /**
   * Wait for processing to complete
   */
  async waitForProcessingComplete(timeout = 120000) {
    // Wait for processing to start
    await this.queueStatus.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for completion
    const completionIndicator = this.page.getByText(/complete|finished|done/i);
    await completionIndicator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Cancel ongoing processing
   */
  async cancelProcessing() {
    await this.clickWithWait(this.cancelProcessingButton);

    const confirmButton = this.page.getByRole('button', {
      name: /confirm|cancel|yes/i,
    });
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }
  }

  /**
   * Get processing queue status
   */
  async getQueueStatus(): Promise<{
    total: number;
    processed: number;
    remaining: number;
    status: string;
  }> {
    const statusText = await this.queueStatus.textContent();
    const progressValue = await this.progressBar.getAttribute('value');
    const progressMax = await this.progressBar.getAttribute('max');

    return {
      total: parseInt(progressMax || '0', 10),
      processed: parseInt(progressValue || '0', 10),
      remaining:
        parseInt(progressMax || '0', 10) - parseInt(progressValue || '0', 10),
      status: statusText || '',
    };
  }

  /**
   * Edit project details
   */
  async editProject(name?: string, description?: string) {
    await this.clickWithWait(this.editProjectButton);

    if (name) {
      const nameInput = this.page.getByLabel(/project.*name|name/i);
      await nameInput.clear();
      await nameInput.fill(name);
    }

    if (description) {
      const descInput = this.page.getByLabel(/description/i);
      await descInput.clear();
      await descInput.fill(description);
    }

    const saveButton = this.page.getByRole('button', { name: /save|update/i });
    await saveButton.click();
  }

  /**
   * Share project
   */
  async shareProject(email: string, permission: 'read' | 'write' = 'read') {
    await this.clickWithWait(this.shareProjectButton);

    const emailInput = this.page.getByLabel(/email/i);
    await emailInput.fill(email);

    const permissionSelect = this.page.getByRole('combobox', {
      name: /permission|role/i,
    });
    if (await permissionSelect.isVisible()) {
      await permissionSelect.click();
      const permissionOption = this.page.getByText(new RegExp(permission, 'i'));
      await permissionOption.click();
    }

    const shareButton = this.page.getByRole('button', {
      name: /share|invite|send/i,
    });
    await shareButton.click();
  }

  /**
   * Export project
   */
  async exportProject(
    format: 'coco' | 'excel' | 'csv',
    options?: {
      includeImages?: boolean;
      selectedOnly?: boolean;
    }
  ) {
    await this.clickWithWait(this.exportProjectButton);

    // Select format
    const formatOption = this.page.getByText(new RegExp(format, 'i'));
    await formatOption.click();

    // Configure options
    if (options?.includeImages) {
      const includeImagesCheckbox = this.page.getByRole('checkbox', {
        name: /include.*images/i,
      });
      if (await includeImagesCheckbox.isVisible()) {
        await includeImagesCheckbox.check();
      }
    }

    if (options?.selectedOnly) {
      const selectedOnlyCheckbox = this.page.getByRole('checkbox', {
        name: /selected.*only/i,
      });
      if (await selectedOnlyCheckbox.isVisible()) {
        await selectedOnlyCheckbox.check();
      }
    }

    // Start export
    const exportButton = this.page.getByRole('button', {
      name: /download|export|start/i,
    });
    await exportButton.click();
  }

  /**
   * Duplicate project
   */
  async duplicateProject(newName?: string, newDescription?: string) {
    await this.clickWithWait(this.duplicateProjectButton);

    if (newName) {
      const nameInput = this.page.getByLabel(/project.*name|name/i);
      await nameInput.clear();
      await nameInput.fill(newName);
    }

    if (newDescription) {
      const descInput = this.page.getByLabel(/description/i);
      await descInput.clear();
      await descInput.fill(newDescription);
    }

    const duplicateButton = this.page.getByRole('button', {
      name: /create|duplicate|copy/i,
    });
    await duplicateButton.click();
  }

  /**
   * Archive project
   */
  async archiveProject() {
    await this.clickWithWait(this.archiveProjectButton);

    const confirmButton = this.page.getByRole('button', {
      name: /confirm|archive|yes/i,
    });
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }
  }

  /**
   * Delete project
   */
  async deleteProject() {
    await this.clickWithWait(this.deleteProjectButton);

    const confirmButton = this.page.getByRole('button', {
      name: /confirm|delete|yes/i,
    });
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }
  }

  /**
   * Navigate to image segmentation editor
   */
  async openImageEditor(imageIndex: number) {
    const imageItem = this.imageItems.nth(imageIndex);
    const editButton = imageItem.getByRole('button', {
      name: /edit|open.*editor|segment/i,
    });

    if (await editButton.isVisible()) {
      await editButton.click();
    } else {
      // Try double-click on image
      await imageItem.dblclick();
    }
  }

  /**
   * Get image processing status
   */
  async getImageStatus(
    imageIndex: number
  ): Promise<'pending' | 'processing' | 'completed' | 'error'> {
    const imageItem = this.imageItems.nth(imageIndex);
    const statusIndicator = imageItem.locator('.status, [data-status]');

    if (await statusIndicator.isVisible()) {
      const statusText = await statusIndicator.textContent();
      const status = statusText?.toLowerCase();

      if (status?.includes('complete') || status?.includes('done'))
        return 'completed';
      if (status?.includes('processing') || status?.includes('analyzing'))
        return 'processing';
      if (status?.includes('error') || status?.includes('failed'))
        return 'error';
    }

    return 'pending';
  }

  /**
   * Get total image count
   */
  async getTotalImageCount(): Promise<number> {
    return await this.imageItems.count();
  }

  /**
   * Check if project is empty
   */
  async isProjectEmpty(): Promise<boolean> {
    const emptyState = this.page.getByText(
      /no.*images|empty.*project|get.*started/i
    );
    return await emptyState.isVisible({ timeout: 2000 });
  }

  /**
   * Search images
   */
  async searchImages(query: string) {
    const searchInput = this.page.getByPlaceholder(/search.*images|search/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(query);
      await this.page.keyboard.press('Enter');
    }
  }

  /**
   * Clear image selection
   */
  async clearSelection() {
    const clearButton = this.page.getByRole('button', {
      name: /clear.*selection|deselect.*all/i,
    });
    if (await clearButton.isVisible()) {
      await clearButton.click();
    }
  }

  /**
   * Get project breadcrumb path
   */
  async getBreadcrumbPath(): Promise<string[]> {
    const breadcrumb = this.page.locator('[role="navigation"] ol, .breadcrumb');
    const breadcrumbItems = breadcrumb.locator('li, .breadcrumb-item');
    const count = await breadcrumbItems.count();
    const path: string[] = [];

    for (let i = 0; i < count; i++) {
      const text = await breadcrumbItems.nth(i).textContent();
      if (text) {
        path.push(text.trim());
      }
    }

    return path;
  }
}
