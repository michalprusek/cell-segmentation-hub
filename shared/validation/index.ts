import { z } from 'zod';
import { SEGMENTATION_MODELS } from '../types';

// Auth validation schemas
export const loginSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(6, 'Heslo musí mít minimálně 6 znaků')
});

export const registerSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(6, 'Heslo musí mít minimálně 6 znaků'),
  username: z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').optional()
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Neplatná emailová adresa')
});

export const confirmResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token je vyžadován'),
  password: z.string().min(6, 'Heslo musí mít minimálně 6 znaků')
});

// Project validation schemas
export const createProjectSchema = z.object({
  title: z.string().min(1, 'Název projektu je vyžadován').max(100, 'Název projektu může mít maximálně 100 znaků'),
  description: z.string().max(500, 'Popis může mít maximálně 500 znaků').optional()
});

export const updateProjectSchema = z.object({
  title: z.string().min(1, 'Název projektu je vyžadován').max(100, 'Název projektu může mít maximálně 100 znaků').optional(),
  description: z.string().max(500, 'Popis může mít maximálně 500 znaků').optional()
});

// User profile validation schemas
export const updateProfileSchema = z.object({
  username: z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').max(50, 'Uživatelské jméno může mít maximálně 50 znaků').optional(),
  bio: z.string().max(500, 'Bio může mít maximálně 500 znaků').optional(),
  preferredModel: z.enum(Object.keys(SEGMENTATION_MODELS).length > 0 ? Object.keys(SEGMENTATION_MODELS) as [keyof typeof SEGMENTATION_MODELS, ...Array<keyof typeof SEGMENTATION_MODELS>] : ['default'] as const).optional(),
  modelThreshold: z.number().min(0.0, 'Threshold musí být minimálně 0.0').max(1.0, 'Threshold může být maximálně 1.0').optional(),
  preferredLang: z.enum(['cs', 'en', 'de', 'fr', 'es', 'zh']).optional(),
  preferredTheme: z.enum(['light', 'dark', 'system']).optional()
});

// Image validation schemas
export const uploadImageSchema = z.object({
  projectId: z.string().uuid('Neplatné ID projektu'),
  autoSegment: z.boolean().optional().default(true)
});

export const segmentationRequestSchema = z.object({
  imageId: z.string().uuid('Neplatné ID obrázku'),
  model: z.enum(Object.keys(SEGMENTATION_MODELS).length > 0 ? Object.keys(SEGMENTATION_MODELS) as [keyof typeof SEGMENTATION_MODELS, ...Array<keyof typeof SEGMENTATION_MODELS>] : ['default'] as const).optional(),
  threshold: z.number().min(0.0).max(1.0).optional()
});

// Export validation schemas
export const exportRequestSchema = z.object({
  projectId: z.string().uuid('Neplatné ID projektu'),
  imageIds: z.array(z.string().uuid()).optional(),
  format: z.enum(['coco', 'excel']),
  includeMetrics: z.boolean().optional().default(true)
});

// Pagination schemas
export const paginationSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10)
});

// File validation
export const fileUploadSchema = z.object({
  mimetype: z.string().refine(
    (mimetype: string) => mimetype.startsWith('image/'),
    'Pouze obrázky jsou povolené'
  ),
  size: z.number().max(10 * 1024 * 1024, 'Soubor může mít maximálně 10MB')
});

// Polygon validation
export const pointSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const polygonDataSchema = z.object({
  id: z.string(),
  points: z.array(pointSchema).min(3, 'Polygon musí mít minimálně 3 body'),
  type: z.enum(['external', 'internal']),
  class: z.string()
});

export const segmentationDataSchema = z.object({
  polygons: z.array(polygonDataSchema),
  model: z.string(),
  threshold: z.number().min(0).max(1)
});

// ID validation helpers
export const uuidSchema = z.string().uuid();

// Common query parameters
export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

export const searchSchema = z.object({
  q: z.string().optional()
});

// Combined schemas for common use cases
export const listProjectsSchema = paginationSchema.merge(sortSchema).merge(searchSchema);
export const listImagesSchema = paginationSchema.merge(sortSchema);

// Type exports for use in components
export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type CreateProjectFormData = z.infer<typeof createProjectSchema>;
export type UpdateProjectFormData = z.infer<typeof updateProjectSchema>;
export type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;
export type SegmentationRequestData = z.infer<typeof segmentationRequestSchema>;
export type ExportRequestData = z.infer<typeof exportRequestSchema>;