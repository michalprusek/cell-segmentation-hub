/**
 * Shared configuration constants for export functionality
 * These defaults align with documentation and are used across components
 */

export const EXPORT_DEFAULTS = {
  COLORS: {
    EXTERNAL_POLYGON: '#FF0000', // Red
    INTERNAL_POLYGON: '#0000FF', // Blue
  },
  VISUALIZATION: {
    STROKE_WIDTH: 2,
    FONT_SIZE: 32,
    TRANSPARENCY: 0.3,
    SHOW_NUMBERS: true,
  },
  FORMATS: {
    ANNOTATION: ['coco', 'json'] as const,
    METRICS: ['excel'] as const,
  },
  OPTIONS: {
    INCLUDE_ORIGINAL_IMAGES: true,
    INCLUDE_VISUALIZATIONS: true,
    INCLUDE_DOCUMENTATION: true,
  },
} as const;

export type ExportFormat = 'coco' | 'yolo' | 'json';
export type MetricsFormat = 'excel' | 'csv' | 'json';
