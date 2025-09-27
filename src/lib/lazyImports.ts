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

/**
 * Lazy load TIFF converter utility
 * Saves ~30KB from initial bundle (includes UTIF library)
 */
export const lazyLoadTiffConverter = async () => {
  try {
    const module = await import('./tiffConverter');
    return module;
  } catch (error) {
    logger.error('Failed to load TIFF converter:', error);
    throw error;
  }
};

/**
 * Lazy load polygon ID utilities
 * Used only when working with polygons
 */
export const lazyLoadPolygonIdUtils = async () => {
  try {
    const module = await import('./polygonIdUtils');
    return module;
  } catch (error) {
    logger.error('Failed to load polygon ID utils:', error);
    throw error;
  }
};

/**
 * Preload a module without waiting for it
 * Useful for preloading on hover/focus
 */
export const preloadModule = (
  loader: () => Promise<any>,
  moduleName: string
): void => {
  loader().catch(error => {
    logger.warn(`Failed to preload module ${moduleName}:`, error);
  });
};

/**
 * Cache for loaded modules to avoid re-importing
 */
const moduleCache = new Map<string, any>();

/**
 * Cached lazy loader - loads module once and caches it
 */
export const cachedLazyLoad = async <T>(
  key: string,
  loader: () => Promise<T>
): Promise<T> => {
  if (moduleCache.has(key)) {
    return moduleCache.get(key);
  }

  try {
    const module = await loader();
    moduleCache.set(key, module);
    return module;
  } catch (error) {
    logger.error(`Failed to load module ${key}:`, error);
    throw error;
  }
};
