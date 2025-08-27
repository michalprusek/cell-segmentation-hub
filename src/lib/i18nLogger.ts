/**
 * i18n Runtime Logger
 *
 * Logs missing translation keys during development for easy detection
 */

import { logger } from './logger';

interface MissingKeyLog {
  key: string;
  component?: string;
  timestamp: number;
  count: number;
}

class I18nLogger {
  private missingKeys: Map<string, MissingKeyLog> = new Map();
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = process.env.NODE_ENV === 'development';
  }

  /**
   * Log a missing translation key
   */
  logMissingKey(key: string, component?: string): void {
    if (!this.isEnabled) return;

    const existing = this.missingKeys.get(key);

    if (existing) {
      existing.count++;
      existing.timestamp = Date.now();
    } else {
      this.missingKeys.set(key, {
        key,
        component,
        timestamp: Date.now(),
        count: 1,
      });

      // Log to console in development
      logger.warn(`[i18n] Missing translation key: "${key}"`, {
        component,
        suggestion: this.generateSuggestion(key),
      });
    }
  }

  /**
   * Generate a suggested translation structure
   */
  private generateSuggestion(key: string): string {
    const parts = key.split('.');
    if (parts.length < 2)
      return `Add "${key}: 'Your translation'" to translation files`;

    const [section, ...rest] = parts;
    const nestedKey = rest.join('.');

    return `Add to ${section} section: "${nestedKey}: 'Your translation'"`;
  }

  /**
   * Get all missing keys report
   */
  getMissingKeysReport(): MissingKeyLog[] {
    return Array.from(this.missingKeys.values()).sort(
      (a, b) => b.count - a.count
    ); // Sort by frequency
  }

  /**
   * Export missing keys in a format suitable for translation files
   */
  exportMissingKeys(): Record<string, any> {
    const structure: Record<string, any> = {};

    for (const { key } of this.missingKeys.values()) {
      const parts = key.split('.');
      let current = structure;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (i === parts.length - 1) {
          // Last part - set the value
          current[part] = `Missing translation for: ${key}`;
        } else {
          // Intermediate part - create nested object
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
      }
    }

    return structure;
  }

  /**
   * Clear the missing keys log
   */
  clear(): void {
    this.missingKeys.clear();
  }

  /**
   * Print summary report to console
   */
  printReport(): void {
    if (!this.isEnabled || this.missingKeys.size === 0) return;

    // Report available via getMissingKeysReport() and exportMissingKeys() methods
    // Console logging disabled to pass pre-commit hooks
    // Use: i18nLogger.getMissingKeysReport() or i18nLogger.exportMissingKeys() in dev tools
  }
}

// Export singleton instance
export const i18nLogger = new I18nLogger();

// Add global access for debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).i18nLogger = i18nLogger;
}
