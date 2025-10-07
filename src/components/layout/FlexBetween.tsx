import React from 'react';
import { cn } from '@/lib/utils';

interface FlexBetweenProps {
  children: React.ReactNode;
  /**
   * Vertical alignment of flex items
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /**
   * Direction of flex container (default: row)
   */
  direction?: 'row' | 'col';
  /**
   * Custom className for additional styling
   */
  className?: string;
}

/**
 * FlexBetween - Reusable flex container with justify-between
 *
 * Consolidates 33+ instances of:
 * - flex items-center justify-between
 *
 * Common use cases:
 * - Card headers with actions
 * - Toolbar layouts
 * - Navigation bars
 * - Status displays
 *
 * @example
 * <FlexBetween align="center">
 *   <h3>Title</h3>
 *   <Button>Action</Button>
 * </FlexBetween>
 */
export const FlexBetween: React.FC<FlexBetweenProps> = ({
  children,
  align = 'center',
  direction = 'row',
  className,
}) => {
  const alignClasses = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  };

  const directionClass = direction === 'col' ? 'flex-col' : 'flex-row';

  return (
    <div
      className={cn(
        'flex justify-between',
        directionClass,
        alignClasses[align],
        className
      )}
    >
      {children}
    </div>
  );
};
