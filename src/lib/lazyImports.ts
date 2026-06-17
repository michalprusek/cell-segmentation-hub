/**
 * Lazy import utilities for heavy dependencies
 * These functions load heavy modules only when needed, reducing initial bundle size
 */

import { logger } from './logger';

/**
 * Lazy load metric calculations utility
 * Saves ~15KB from initial bundle
 */
export const lazyLoadMetricCalculations = async () => {
  try {
    const module = await import(
      '@/pages/segmentation/utils/metricCalculations'
    );
    return module;
  } catch (error) {
    logger.error('Failed to load metric calculations:', error);
    throw error;
  }
};
