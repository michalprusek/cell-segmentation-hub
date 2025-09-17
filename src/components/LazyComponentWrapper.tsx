import { Suspense, ComponentType, lazy, LazyExoticComponent } from 'react';
import { Loader2 } from 'lucide-react';

interface LazyComponentWrapperProps {
  children: React.ReactNode;
}

/**
 * Loading fallback component
 */
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

/**
 * Wrapper component for lazy-loaded components
 */
export function LazyComponentWrapper({ children }: LazyComponentWrapperProps) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}

/**
 * Wrapper component for lazy-loaded routes
 */
export function LazyWrapper({ children }: LazyComponentWrapperProps) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}

/**
 * Helper function to create lazy components with proper typing
 */
export function createLazyComponent<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(importFunc);
}

export default LazyComponentWrapper;
