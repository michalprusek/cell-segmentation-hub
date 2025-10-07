import React from 'react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: React.ReactNode;
  /**
   * Variant controls padding and max-width
   * - default: py-8 (standard pages)
   * - narrow: py-8 max-w-4xl (forms, focused content)
   * - wide: py-20 (hero sections, landing pages)
   * - legal: py-12 flex-1 mt-16 (terms, privacy)
   * - compact: py-4 (tight spacing)
   */
  variant?: 'default' | 'narrow' | 'wide' | 'legal' | 'compact';
  /**
   * Custom className for additional styling
   */
  className?: string;
}

/**
 * PageContainer - Reusable container component
 *
 * Consolidates 23+ instances of container patterns:
 * - container mx-auto px-4 py-8 (most common)
 * - container mx-auto px-4 py-12 (legal pages)
 * - container mx-auto px-4 py-20 (hero sections)
 *
 * @example
 * <PageContainer variant="default">
 *   <h1>Page content</h1>
 * </PageContainer>
 */
export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  variant = 'default',
  className,
}) => {
  const variantStyles = {
    default: 'py-8',
    narrow: 'py-8 max-w-4xl',
    wide: 'py-20',
    legal: 'py-12 flex-1 mt-16',
    compact: 'py-4',
  };

  return (
    <div
      className={cn(
        'container mx-auto px-4',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </div>
  );
};
