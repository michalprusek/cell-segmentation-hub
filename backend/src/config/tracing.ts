/**
 * Placeholder OpenTelemetry tracing configuration
 * This file provides minimal implementations to prevent import errors
 * when OpenTelemetry dependencies are not available
 */

import { logger } from '../utils/logger';

/**
 * Initialize OpenTelemetry tracing
 * Placeholder implementation for development
 */
export function initializeTracing(): void {
  logger.info('OpenTelemetry tracing disabled (placeholder implementation)');
}

/**
 * Shutdown OpenTelemetry tracing
 * Placeholder implementation for development
 */
export async function shutdownTracing(): Promise<void> {
  logger.info('OpenTelemetry tracing shutdown (placeholder)');
  return Promise.resolve();
}

/**
 * Get active span
 * Placeholder implementation
 */
export function getActiveSpan(): unknown {
  return null;
}

/**
 * Create a new span
 * Placeholder implementation
 */
export function createSpan(
  _name: string,
  _options?: Record<string, unknown>
): Record<string, () => void> {
  return {
    setAttribute: (): void => {},
    setStatus: (): void => {},
    addEvent: (): void => {},
    end: (): void => {},
  };
}

/**
 * Set span attributes
 * Placeholder implementation
 */
export function setSpanAttributes(_attributes: Record<string, unknown>): void {
  // No-op in placeholder
}

/**
 * Record an exception in the current span
 * Placeholder implementation
 */
export function recordException(error: Error): void {
  logger.error('Exception recorded (tracing disabled):', error);
}
