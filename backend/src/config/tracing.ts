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
export function getActiveSpan(): any {
  return null;
}

/**
 * Create a new span
 * Placeholder implementation
 */
export function createSpan(name: string, options?: any): any {
  return {
    setAttribute: () => {},
    setStatus: () => {},
    addEvent: () => {},
    end: () => {},
  };
}

/**
 * Set span attributes
 * Placeholder implementation
 */
export function setSpanAttributes(attributes: Record<string, any>): void {
  // No-op in placeholder
}

/**
 * Record an exception in the current span
 * Placeholder implementation
 */
export function recordException(error: Error): void {
  logger.error('Exception recorded (tracing disabled):', error);
}