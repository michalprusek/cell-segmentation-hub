import React from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveStackProps {
  children: React.ReactNode;
  /**
   * Direction on mobile (default: vertical)
   */
  direction?: 'vertical' | 'horizontal';
  /**
   * Breakpoint where direction changes
   */
  breakpoint?: 'sm' | 'md' | 'lg';
  /**
   * Gap between items
   */
  gap?: 2 | 3 | 4 | 6 | 8;
  /**
   * Alignment of items
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /**
   * Justification of items
   */
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  /**
   * Custom className for additional styling
   */
  className?: string;
}

/**
 * ResponsiveStack - Flexible container that changes direction based on screen size
 *
 * Consolidates 16+ instances of:
 * - flex flex-col md:flex-row
 *
 * @example
 * // Vertical on mobile, horizontal on desktop
 * <ResponsiveStack direction="vertical" breakpoint="md" gap={4}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </ResponsiveStack>
 */
export const ResponsiveStack: React.FC<ResponsiveStackProps> = ({
  children,
  direction = 'vertical',
  breakpoint = 'md',
  gap = 4,
  align = 'stretch',
  justify = 'start',
  className,
}) => {
  const gapClass = `gap-${gap}`;

  const directionClass =
    direction === 'vertical'
      ? `flex-col ${breakpoint}:flex-row`
      : `flex-row ${breakpoint}:flex-col`;

  const alignClasses = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  };

  const justifyClasses = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
  };

  return (
    <div
      className={cn(
        'flex',
        directionClass,
        gapClass,
        alignClasses[align],
        justifyClasses[justify],
        className
      )}
    >
      {children}
    </div>
  );
};
