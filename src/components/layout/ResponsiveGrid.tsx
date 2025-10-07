import React from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveGridProps {
  children: React.ReactNode;
  /**
   * Column configuration for different breakpoints
   * @example
   * cols={{ default: 1, md: 2, lg: 3 }}
   */
  cols?: {
    default?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  /**
   * Gap between grid items
   */
  gap?: 2 | 3 | 4 | 6 | 8 | 12;
  /**
   * Custom className for additional styling
   */
  className?: string;
}

/**
 * ResponsiveGrid - Reusable responsive grid component
 *
 * Consolidates 23+ instances of grid patterns:
 * - grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 (projects)
 * - grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 (stats)
 * - grid grid-cols-1 md:grid-cols-2 gap-4 (two-column)
 *
 * @example
 * <ResponsiveGrid cols={{ default: 1, md: 2, lg: 3 }} gap={6}>
 *   <ProjectCard />
 *   <ProjectCard />
 * </ResponsiveGrid>
 */
export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  cols = { default: 1, md: 2, lg: 3 },
  gap = 6,
  className,
}) => {
  const getGridColsClass = () => {
    const classes: string[] = [];

    if (cols.default) classes.push(`grid-cols-${cols.default}`);
    if (cols.sm) classes.push(`sm:grid-cols-${cols.sm}`);
    if (cols.md) classes.push(`md:grid-cols-${cols.md}`);
    if (cols.lg) classes.push(`lg:grid-cols-${cols.lg}`);
    if (cols.xl) classes.push(`xl:grid-cols-${cols.xl}`);

    return classes.join(' ');
  };

  const gapClass = `gap-${gap}`;

  return (
    <div className={cn('grid', getGridColsClass(), gapClass, className)}>
      {children}
    </div>
  );
};

/**
 * Pre-configured grid variants for common use cases
 */
export const ProjectsGrid: React.FC<
  Omit<ResponsiveGridProps, 'cols' | 'gap'> & { gap?: number }
> = ({ children, gap = 6, className }) => (
  <ResponsiveGrid
    cols={{ default: 1, md: 2, lg: 3 }}
    gap={gap as any}
    className={className}
  >
    {children}
  </ResponsiveGrid>
);

export const StatsGrid: React.FC<
  Omit<ResponsiveGridProps, 'cols' | 'gap'> & { gap?: number }
> = ({ children, gap = 4, className }) => (
  <ResponsiveGrid
    cols={{ default: 1, md: 2, lg: 4 }}
    gap={gap as any}
    className={className}
  >
    {children}
  </ResponsiveGrid>
);

export const TwoColumnGrid: React.FC<
  Omit<ResponsiveGridProps, 'cols' | 'gap'> & { gap?: number }
> = ({ children, gap = 4, className }) => (
  <ResponsiveGrid
    cols={{ default: 1, md: 2 }}
    gap={gap as any}
    className={className}
  >
    {children}
  </ResponsiveGrid>
);
