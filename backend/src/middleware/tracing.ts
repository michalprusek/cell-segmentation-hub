// Placeholder tracing middleware for development setup
// This provides minimal implementations to prevent import errors

export function addSpanAttributes(attributes: Record<string, any>): void {
  // Placeholder implementation - just log the attributes in development
  console.log('Span attributes (dev mode):', attributes);
}

export function addSpanEvent(name: string, attributes?: Record<string, any>): void {
  // Placeholder implementation - just log the event in development
  console.log('Span event (dev mode):', name, attributes);
}

export function markSpanError(error: Error | string): void {
  // Placeholder implementation - just log the error in development
  console.log('Span error (dev mode):', error);
}

export function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  // Placeholder implementation - return headers as-is
  return {
    ...headers,
    'x-trace-id': `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
}

// Middleware functions expected by server.ts
export function createContextPropagationMiddleware() {
  return (req: any, res: any, next: any) => {
    // Placeholder - just add trace ID to request
    req.traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    next();
  };
}

export function createTracingMiddleware() {
  return (req: any, res: any, next: any) => {
    // Placeholder - no-op middleware
    next();
  };
}

export function createPerformanceTracingMiddleware() {
  return (req: any, res: any, next: any) => {
    // Placeholder - no-op middleware
    next();
  };
}

export function createErrorTracingMiddleware() {
  return (err: any, req: any, res: any, next: any) => {
    // Placeholder - just pass error through
    next(err);
  };
}