import React from 'react';
import { cn } from '@/lib/utils';

interface ContentCardProps {
  children: React.ReactNode;
  /**
   * Visual variant of the card
   * - default: Standard card with border and shadow
   * - interactive: Adds hover effects and cursor pointer
   * - elevated: Stronger shadow for emphasis
   */
  variant?: 'default' | 'interactive' | 'elevated';
  /**
   * Enable hover shadow effect
   */
  hover?: boolean;
  /**
   * Custom className for additional styling
   */
  className?: string;
  /**
   * Optional click handler (automatically sets cursor-pointer)
   */
  onClick?: () => void;
}

/**
 * ContentCard - Reusable card component with consistent styling
 *
 * Consolidates 40+ instances of:
 * - bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700
 * - transition-all duration-300 hover:shadow-md (interactive variant)
 *
 * Base styles include:
 * - Consistent background colors (light/dark theme)
 * - Border styling
 * - Border radius
 * - Optional shadow effects
 *
 * @example
 * <ContentCard variant="interactive" hover>
 *   <h3>Card Title</h3>
 *   <p>Card content</p>
 * </ContentCard>
 */
export const ContentCard: React.FC<ContentCardProps> = ({
  children,
  variant = 'default',
  hover = false,
  className,
  onClick,
}) => {
  const baseStyles =
    'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700';

  const variantStyles = {
    default: 'shadow-sm',
    interactive:
      'shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer',
    elevated: 'shadow-md',
  };

  const hoverStyles =
    hover && variant === 'default'
      ? 'transition-all duration-300 hover:shadow-md'
      : '';

  const cursorStyle = onClick ? 'cursor-pointer' : '';

  return (
    <div
      className={cn(
        baseStyles,
        variantStyles[variant],
        hoverStyles,
        cursorStyle,
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
