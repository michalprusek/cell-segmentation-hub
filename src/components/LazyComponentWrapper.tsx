import React, { lazy, Suspense, ComponentType } from 'react';
import PageLoadingFallback from './PageLoadingFallback';

// Helper to create lazy components with proper display names
export function createLazyComponent<
  T extends ComponentType<Record<string, unknown>>,
>(
  importFunc: () => Promise<{ default: T }>,
  displayName: string
): React.LazyExoticComponent<T> {
  const LazyComponent = lazy(importFunc);
  LazyComponent.displayName = displayName;
  return LazyComponent;
}

// Wrapper component for lazy loaded components
export const LazyWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <Suspense fallback={<PageLoadingFallback />}>{children}</Suspense>;
};
