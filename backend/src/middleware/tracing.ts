// Placeholder tracing middleware for development setup
// This provides minimal implementations to prevent import errors
import { logger } from '../utils/logger';

export function addSpanAttributes(_attributes: Record<string, unknown>): void {
  // Placeholder implementation - just log the attributes in development
  // console.warn('Span attributes (dev mode):', attributes);
}

export function addSpanEvent(
  _name: string,
  _attributes?: Record<string, unknown>
): void {
  // Placeholder implementation - just log the event in development
  // console.warn('Span event (dev mode):', name, attributes);
}

export function markSpanError(error: Error | string): void {
  // Placeholder implementation - just log the error in development
  if (process.env.NODE_ENV === 'development') {
    // Development mode only
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    logger.error('Span error (dev mode):', errorObj);
  }
}

export function injectTraceHeaders(
  headers: Record<string, string>
): Record<string, string> {
  // Placeholder implementation - return headers as-is
  return {
    ...headers,
    'x-trace-id': `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };
}

// Middleware functions expected by server.ts
export function createContextPropagationMiddleware() {
  return (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: () => void
  ): void => {
    // Placeholder - just add trace ID to request
    req.traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    next();
  };
}

export function createTracingMiddleware() {
  return (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: () => void
  ): void => {
    // Placeholder - no-op middleware
    next();
  };
}

export function createPerformanceTracingMiddleware() {
  return (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: () => void
  ): void => {
    // Placeholder - no-op middleware
    next();
  };
}

export function createErrorTracingMiddleware() {
  return (
    err: unknown,
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: (error?: unknown) => void
  ): void => {
    // Placeholder - just pass error through
    next(err);
  };
}
