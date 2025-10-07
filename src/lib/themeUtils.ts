/**
 * Theme Utility Functions
 *
 * Consolidates repeated class combinations into reusable constants and functions.
 * Part of SSOT refactoring to eliminate 100+ duplicate patterns.
 */

/**
 * Container variants (consolidates 23 instances)
 */
export const containerVariants = {
  default: 'container mx-auto px-4 py-8',
  narrow: 'container mx-auto px-4 py-8 max-w-4xl',
  wide: 'container mx-auto px-4 py-20',
  legal: 'container mx-auto px-4 py-12 flex-1 mt-16',
  compact: 'container mx-auto px-4 py-4',
  header: 'container mx-auto px-4 md:px-6 flex items-center justify-between',
} as const;

/**
 * Grid variants (consolidates 23+ instances)
 */
export const gridVariants = {
  projects: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6',
  stats: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4',
  twoCol: 'grid grid-cols-1 md:grid-cols-2 gap-4',
  threeCol: 'grid grid-cols-1 md:grid-cols-3 gap-6',
  fourCol: 'grid grid-cols-1 lg:grid-cols-4 gap-8',
  features: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8',
} as const;

/**
 * Card variants (consolidates 40+ instances)
 */
export const cardVariants = {
  base: 'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm',
  interactive:
    'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer',
  elevated:
    'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-md',
} as const;

/**
 * Text variants (consolidates 40+ instances)
 */
export const textVariants = {
  secondary: 'text-sm text-gray-500 dark:text-gray-400',
  tertiary: 'text-sm text-gray-600 dark:text-gray-400',
  muted: 'text-sm text-gray-400 dark:text-gray-500',
  label: 'text-sm text-gray-700 dark:text-gray-300',
} as const;

/**
 * Border variants (consolidates 40+ instances)
 */
export const borderVariants = {
  default: 'border border-gray-200 dark:border-gray-700',
  strong: 'border border-gray-300 dark:border-gray-600',
  subtle: 'border border-gray-100 dark:border-gray-700',
} as const;

/**
 * Transition variants (consolidates 35+ instances)
 */
export const transitionVariants = {
  fast: 'transition-all duration-200',
  default: 'transition-all duration-300',
  slow: 'transition-all duration-500',
} as const;

/**
 * Flex layout variants (consolidates 33+ instances)
 */
export const flexVariants = {
  between: 'flex items-center justify-between',
  center: 'flex items-center justify-center',
  start: 'flex items-center justify-start',
  end: 'flex items-center justify-end',
} as const;

/**
 * Spacing variants
 */
export const spacingVariants = {
  stackSm: 'space-y-2',
  stackMd: 'space-y-4',
  stackLg: 'space-y-6',
  inlineSm: 'space-x-2',
  inlineMd: 'space-x-4',
  inlineLg: 'space-x-6',
} as const;

/**
 * Responsive visibility helpers
 */
export const visibilityVariants = {
  hideOnMobile: 'hidden md:flex',
  showOnMobile: 'flex md:hidden',
  hideOnDesktop: 'flex md:hidden',
  showOnDesktop: 'hidden md:flex',
} as const;

/**
 * Helper function to combine variant classes
 */
export const combineVariants = (...variants: string[]) => {
  return variants.filter(Boolean).join(' ');
};

/**
 * Get card class based on interactivity
 */
export const getCardClass = (
  interactive: boolean = false,
  elevated: boolean = false
) => {
  if (elevated) return cardVariants.elevated;
  if (interactive) return cardVariants.interactive;
  return cardVariants.base;
};

/**
 * Get text class based on hierarchy
 */
export const getTextClass = (
  variant: keyof typeof textVariants = 'secondary'
) => {
  return textVariants[variant];
};

/**
 * Get flex class based on layout
 */
export const getFlexClass = (
  variant: keyof typeof flexVariants = 'between'
) => {
  return flexVariants[variant];
};
