import { Page, Locator, Download } from '@playwright/test';
import { BasePage } from './BasePage';

export class ExportDialogPage extends BasePage {
  readonly dialog: Locator;
  readonly dialogTitle: Locator;
  readonly closeButton: Locator;

  // Format selection
  readonly formatTabs: Locator;
  readonly cocoTab: Locator;
  readonly excelTab: Locator;
  readonly csvTab: Locator;
  readonly jsonTab: Locator;
  readonly pngTab: Locator;

  // COCO export options
  readonly cocoOptions: Locator;
  readonly includeImagesCheckbox: Locator;
  readonly includeAnnotationsCheckbox: Locator;
  readonly cocoCategoriesInput: Locator;
  readonly cocoInfoInput: Locator;

  // Excel export options
  readonly excelOptions: Locator;
  readonly includeMetricsCheckbox: Locator;
  readonly includeStatisticsCheckbox: Locator;
  readonly includeSummaryCheckbox: Locator;
  readonly excelTemplateSelect: Locator;

  // CSV export options
  readonly csvOptions: Locator;
  readonly csvDelimiterSelect: Locator;
  readonly csvHeadersCheckbox: Locator;
  readonly csvFieldsSelect: Locator;

  // Image selection
  readonly imageSelection: Locator;
  readonly selectAllImagesCheckbox: Locator;
  readonly selectNoneButton: Locator;
  readonly selectedImagesCount: Locator;
  readonly imageList: Locator;
  readonly imageCheckboxes: Locator;

  // Quality and compression
  readonly qualitySettings: Locator;
  readonly qualitySlider: Locator;
  readonly compressionSelect: Locator;
  readonly resolutionSelect: Locator;

  // Export actions
  readonly exportButton: Locator;
  readonly previewButton: Locator;
  readonly cancelButton: Locator;
  readonly downloadButton: Locator;

  // Progress and status
  readonly progressBar: Locator;
  readonly progressText: Locator;
  readonly statusMessage: Locator;
  readonly exportLog: Locator;

  // Advanced options
  readonly advancedOptionsToggle: Locator;
  readonly advancedOptionsPanel: Locator;
  readonly customFieldsInput: Locator;
  readonly exportMetadataCheckbox: Locator;
  readonly timestampFormatSelect: Locator;

  constructor(page: Page) {
    super(page);

    // Main dialog elements
    this.dialog = page.getByRole('dialog', { name: /export/i });
    this.dialogTitle = this.dialog.locator(
      'h1, h2, .dialog-title, [data-testid="dialog-title"]'
    );
    this.closeButton = this.dialog.getByRole('button', { name: /close|×/i });

    // Format tabs
    this.formatTabs = this.dialog.locator('[role="tablist"], .format-tabs');
    this.cocoTab = this.formatTabs.getByRole('tab', { name: /coco/i });
    this.excelTab = this.formatTabs.getByRole('tab', { name: /excel|xlsx/i });
    this.csvTab = this.formatTabs.getByRole('tab', { name: /csv/i });
    this.jsonTab = this.formatTabs.getByRole('tab', { name: /json/i });
    this.pngTab = this.formatTabs.getByRole('tab', { name: /png|image/i });

    // COCO options
    this.cocoOptions = this.dialog.locator(
      '[data-format="coco"], .coco-options'
    );
    this.includeImagesCheckbox = this.cocoOptions.getByRole('checkbox', {
      name: /include.*images/i,
    });
    this.includeAnnotationsCheckbox = this.cocoOptions.getByRole('checkbox', {
      name: /include.*annotations/i,
    });
    this.cocoCategoriesInput = this.cocoOptions.getByLabel(/categories/i);
    this.cocoInfoInput = this.cocoOptions.getByLabel(/info|description/i);

    // Excel options
    this.excelOptions = this.dialog.locator(
      '[data-format="excel"], .excel-options'
    );
    this.includeMetricsCheckbox = this.excelOptions.getByRole('checkbox', {
      name: /include.*metrics/i,
    });
    this.includeStatisticsCheckbox = this.excelOptions.getByRole('checkbox', {
      name: /include.*statistics/i,
    });
    this.includeSummaryCheckbox = this.excelOptions.getByRole('checkbox', {
      name: /include.*summary/i,
    });
    this.excelTemplateSelect = this.excelOptions.getByRole('combobox', {
      name: /template/i,
    });

    // CSV options
    this.csvOptions = this.dialog.locator('[data-format="csv"], .csv-options');
    this.csvDelimiterSelect = this.csvOptions.getByRole('combobox', {
      name: /delimiter/i,
    });
    this.csvHeadersCheckbox = this.csvOptions.getByRole('checkbox', {
      name: /include.*headers/i,
    });
    this.csvFieldsSelect = this.csvOptions.getByRole('listbox', {
      name: /fields/i,
    });

    // Image selection
    this.imageSelection = this.dialog.locator(
      '.image-selection, [data-section="images"]'
    );
    this.selectAllImagesCheckbox = this.imageSelection.getByRole('checkbox', {
      name: /select.*all/i,
    });
    this.selectNoneButton = this.imageSelection.getByRole('button', {
      name: /select.*none|clear/i,
    });
    this.selectedImagesCount = this.imageSelection.locator(
      '.selected-count, [data-count]'
    );
    this.imageList = this.imageSelection.locator('.image-list, .images');
    this.imageCheckboxes = this.imageList.locator('input[type="checkbox"]');

    // Quality settings
    this.qualitySettings = this.dialog.locator(
      '.quality-settings, [data-section="quality"]'
    );
    this.qualitySlider = this.qualitySettings.locator(
      'input[type="range"], .quality-slider'
    );
    this.compressionSelect = this.qualitySettings.getByRole('combobox', {
      name: /compression/i,
    });
    this.resolutionSelect = this.qualitySettings.getByRole('combobox', {
      name: /resolution/i,
    });

    // Actions
    this.exportButton = this.dialog.getByRole('button', {
      name: /export|download|start/i,
    });
    this.previewButton = this.dialog.getByRole('button', { name: /preview/i });
    this.cancelButton = this.dialog.getByRole('button', { name: /cancel/i });
    this.downloadButton = this.dialog.getByRole('button', {
      name: /download/i,
    });

    // Progress
    this.progressBar = this.dialog.locator(
      '[role="progressbar"], .progress-bar'
    );
    this.progressText = this.dialog.locator(
      '.progress-text, [data-progress-text]'
    );
    this.statusMessage = this.dialog.locator('.status-message, [data-status]');
    this.exportLog = this.dialog.locator('.export-log, .log');

    // Advanced options
    this.advancedOptionsToggle = this.dialog.getByRole('button', {
      name: /advanced.*options|more.*options/i,
    });
    this.advancedOptionsPanel = this.dialog.locator(
      '.advanced-options, [data-advanced]'
    );
    this.customFieldsInput =
      this.advancedOptionsPanel.getByLabel(/custom.*fields/i);
    this.exportMetadataCheckbox = this.advancedOptionsPanel.getByRole(
      'checkbox',
      { name: /metadata/i }
    );
    this.timestampFormatSelect = this.advancedOptionsPanel.getByRole(
      'combobox',
      { name: /timestamp/i }
    );
  }

  /**
   * Wait for export dialog to open
   */
  async waitForDialog(timeout = 10000) {
    await this.dialog.waitFor({ state: 'visible', timeout });
  }

  /**
   * Select export format
   */
  async selectFormat(format: 'coco' | 'excel' | 'csv' | 'json' | 'png') {
    const tab = {
      coco: this.cocoTab,
      excel: this.excelTab,
      csv: this.csvTab,
      json: this.jsonTab,
      png: this.pngTab,
    }[format];

    await this.clickWithWait(tab);
  }

  /**
   * Configure COCO export options
   */
  async configureCocoExport(options: {
    includeImages?: boolean;
    includeAnnotations?: boolean;
    categories?: string;
    info?: string;
  }) {
    await this.selectFormat('coco');

    if (options.includeImages !== undefined) {
      if (options.includeImages) {
        await this.includeImagesCheckbox.check();
      } else {
        await this.includeImagesCheckbox.uncheck();
      }
    }

    if (options.includeAnnotations !== undefined) {
      if (options.includeAnnotations) {
        await this.includeAnnotationsCheckbox.check();
      } else {
        await this.includeAnnotationsCheckbox.uncheck();
      }
    }

    if (options.categories) {
      await this.fillWithWait(this.cocoCategoriesInput, options.categories);
    }

    if (options.info) {
      await this.fillWithWait(this.cocoInfoInput, options.info);
    }
  }

  /**
   * Configure Excel export options
   */
  async configureExcelExport(options: {
    includeMetrics?: boolean;
    includeStatistics?: boolean;
    includeSummary?: boolean;
    template?: string;
  }) {
    await this.selectFormat('excel');

    if (options.includeMetrics !== undefined) {
      if (options.includeMetrics) {
        await this.includeMetricsCheckbox.check();
      } else {
        await this.includeMetricsCheckbox.uncheck();
      }
    }

    if (options.includeStatistics !== undefined) {
      if (options.includeStatistics) {
        await this.includeStatisticsCheckbox.check();
      } else {
        await this.includeStatisticsCheckbox.uncheck();
      }
    }

    if (options.includeSummary !== undefined) {
      if (options.includeSummary) {
        await this.includeSummaryCheckbox.check();
      } else {
        await this.includeSummaryCheckbox.uncheck();
      }
    }

    if (options.template) {
      await this.clickWithWait(this.excelTemplateSelect);
      const templateOption = this.page.getByText(options.template);
      await templateOption.click();
    }
  }

  /**
   * Configure CSV export options
   */
  async configureCsvExport(options: {
    delimiter?: ',' | ';' | '\t' | '|';
    includeHeaders?: boolean;
    fields?: string[];
  }) {
    await this.selectFormat('csv');

    if (options.delimiter) {
      await this.clickWithWait(this.csvDelimiterSelect);
      const delimiterText = {
        ',': 'Comma',
        ';': 'Semicolon',
        '\t': 'Tab',
        '|': 'Pipe',
      }[options.delimiter];
      const delimiterOption = this.page.getByText(delimiterText);
      await delimiterOption.click();
    }

    if (options.includeHeaders !== undefined) {
      if (options.includeHeaders) {
        await this.csvHeadersCheckbox.check();
      } else {
        await this.csvHeadersCheckbox.uncheck();
      }
    }

    if (options.fields) {
      for (const field of options.fields) {
        const fieldOption = this.csvFieldsSelect.getByText(field);
        await fieldOption.click();
      }
    }
  }

  /**
   * Select specific images for export
   */
  async selectImages(indices: number[]) {
    for (const index of indices) {
      const checkbox = this.imageCheckboxes.nth(index);
      await checkbox.check();
    }
  }

  /**
   * Select all images
   */
  async selectAllImages() {
    await this.clickWithWait(this.selectAllImagesCheckbox);
  }

  /**
   * Clear image selection
   */
  async selectNoImages() {
    await this.clickWithWait(this.selectNoneButton);
  }

  /**
   * Get selected image count
   */
  async getSelectedImageCount(): Promise<number> {
    try {
      const countText = await this.selectedImagesCount.textContent();
      if (!countText) return 0;

      const match = countText.match(/(\d+)/);
      const count = match ? parseInt(match[1], 10) : 0;

      // Validate the parsed count
      return isNaN(count) ? 0 : count;
    } catch (_error) {
      // console.warn('Failed to extract selected image count:', _error);
      return 0;
    }
  }

  /**
   * Set image quality
   */
  async setImageQuality(quality: number) {
    await this.qualitySlider.fill(quality.toString());
  }

  /**
   * Set compression level
   */
  async setCompression(level: 'none' | 'low' | 'medium' | 'high') {
    await this.clickWithWait(this.compressionSelect);
    const compressionOption = this.page.getByText(new RegExp(level, 'i'));
    await compressionOption.click();
  }

  /**
   * Set output resolution
   */
  async setResolution(resolution: 'original' | '1080p' | '720p' | '480p') {
    await this.clickWithWait(this.resolutionSelect);
    const resolutionOption = this.page.getByText(resolution);
    await resolutionOption.click();
  }

  /**
   * Open advanced options
   */
  async openAdvancedOptions() {
    if (await this.advancedOptionsToggle.isVisible()) {
      await this.clickWithWait(this.advancedOptionsToggle);
      await this.advancedOptionsPanel.waitFor({ state: 'visible' });
    }
  }

  /**
   * Configure advanced options
   */
  async configureAdvancedOptions(options: {
    customFields?: string;
    includeMetadata?: boolean;
    timestampFormat?: string;
  }) {
    await this.openAdvancedOptions();

    if (options.customFields) {
      await this.fillWithWait(this.customFieldsInput, options.customFields);
    }

    if (options.includeMetadata !== undefined) {
      if (options.includeMetadata) {
        await this.exportMetadataCheckbox.check();
      } else {
        await this.exportMetadataCheckbox.uncheck();
      }
    }

    if (options.timestampFormat) {
      await this.clickWithWait(this.timestampFormatSelect);
      const formatOption = this.page.getByText(options.timestampFormat);
      await formatOption.click();
    }
  }

  /**
   * Preview export
   */
  async previewExport() {
    await this.clickWithWait(this.previewButton);
  }

  /**
   * Start export and wait for completion
   */
  async startExport(): Promise<Download> {
    const downloadPromise = this.page.waitForDownload({ timeout: 60000 });
    await this.clickWithWait(this.exportButton);
    return await downloadPromise;
  }

  /**
   * Start export without waiting for download
   */
  async startExportAsync() {
    await this.clickWithWait(this.exportButton);
  }

  /**
   * Wait for export to complete
   */
  async waitForExportComplete(timeout = 60000) {
    // Wait for progress bar to appear
    await this.progressBar.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for completion message or download button
    const completionIndicators = [
      this.page.getByText(/export.*complete|download.*ready/i),
      this.downloadButton,
    ];

    await Promise.race([
      ...completionIndicators.map(indicator =>
        indicator.waitFor({ state: 'visible', timeout })
      ),
    ]);
  }

  /**
   * Get export progress
   */
  async getExportProgress(): Promise<{
    percentage: number;
    status: string;
  }> {
    const progressValue = await this.progressBar.getAttribute('value');
    const progressMax = await this.progressBar.getAttribute('max');
    const statusText = await this.statusMessage.textContent();

    const percentage =
      progressValue && progressMax && parseInt(progressMax) > 0
        ? (parseInt(progressValue) / parseInt(progressMax)) * 100
        : 0;

    return {
      percentage: Math.round(percentage),
      status: statusText || '',
    };
  }

  /**
   * Cancel export
   */
  async cancelExport() {
    await this.clickWithWait(this.cancelButton);
  }

  /**
   * Close dialog
   */
  async closeDialog() {
    await this.clickWithWait(this.closeButton);
    await this.dialog.waitFor({ state: 'hidden' });
  }

  /**
   * Get export log messages
   */
  async getExportLog(): Promise<string[]> {
    const logItems = this.exportLog.locator('.log-item, .log-message');
    const count = await logItems.count();
    const messages: string[] = [];

    for (let i = 0; i < count; i++) {
      const message = await logItems.nth(i).textContent();
      if (message) {
        messages.push(message.trim());
      }
    }

    return messages;
  }

  /**
   * Check if format is available
   */
  async isFormatAvailable(
    format: 'coco' | 'excel' | 'csv' | 'json' | 'png'
  ): Promise<boolean> {
    const tab = {
      coco: this.cocoTab,
      excel: this.excelTab,
      csv: this.csvTab,
      json: this.jsonTab,
      png: this.pngTab,
    }[format];

    return await tab.isVisible({ timeout: 2000 });
  }

  /**
   * Get estimated file size
   */
  async getEstimatedFileSize(): Promise<string> {
    const sizeEstimate = this.dialog.locator(
      '.file-size-estimate, [data-size]'
    );
    if (await sizeEstimate.isVisible({ timeout: 2000 })) {
      return (await sizeEstimate.textContent()) || '';
    }
    return '';
  }

  /**
   * Validate export settings
   */
  async validateSettings(): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    const errorMessages = this.dialog.locator(
      '.error, .validation-error, [role="alert"]'
    );
    const errorCount = await errorMessages.count();
    const errors: string[] = [];

    for (let i = 0; i < errorCount; i++) {
      const error = await errorMessages.nth(i).textContent();
      if (error) {
        errors.push(error.trim());
      }
    }

    return {
      isValid: errorCount === 0,
      errors,
    };
  }

  /**
   * Get available export formats
   */
  async getAvailableFormats(): Promise<string[]> {
    const tabs = this.formatTabs.locator('[role="tab"]');
    const count = await tabs.count();
    const formats: string[] = [];

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      if (await tab.isVisible()) {
        const text = await tab.textContent();
        if (text) {
          formats.push(text.trim().toLowerCase());
        }
      }
    }

    return formats;
  }

  /**
   * Configure complete export with all options
   */
  async configureCompleteExport(config: {
    format: 'coco' | 'excel' | 'csv' | 'json' | 'png';
    images?: 'all' | 'selected' | number[];
    quality?: {
      level?: number;
      compression?: 'none' | 'low' | 'medium' | 'high';
      resolution?: 'original' | '1080p' | '720p' | '480p';
    };
    formatOptions?: any;
    advanced?: {
      customFields?: string;
      includeMetadata?: boolean;
      timestampFormat?: string;
    };
  }) {
    // Select format and configure format-specific options
    await this.selectFormat(config.format);

    if (config.formatOptions) {
      switch (config.format) {
        case 'coco':
          await this.configureCocoExport(config.formatOptions);
          break;
        case 'excel':
          await this.configureExcelExport(config.formatOptions);
          break;
        case 'csv':
          await this.configureCsvExport(config.formatOptions);
          break;
        case 'json':
          // JSON export configuration would go here
          break;
        case 'png':
          // PNG export configuration would go here
          break;
        default:
          // console.warn(`Unknown export format: ${config.format}`);
          break;
      }
    }

    // Configure image selection
    if (config.images === 'all') {
      await this.selectAllImages();
    } else if (config.images === 'selected') {
      // Assume images are already selected
    } else if (Array.isArray(config.images)) {
      await this.selectImages(config.images);
    }

    // Configure quality settings
    if (config.quality) {
      if (config.quality.level !== undefined) {
        await this.setImageQuality(config.quality.level);
      }
      if (config.quality.compression) {
        await this.setCompression(config.quality.compression);
      }
      if (config.quality.resolution) {
        await this.setResolution(config.quality.resolution);
      }
    }

    // Configure advanced options
    if (config.advanced) {
      await this.configureAdvancedOptions(config.advanced);
    }
  }
}
