import { z } from 'zod';

// ============================================================================
// Common validation schemas
// ============================================================================

/**
 * UUID validation
 */
export const uuidSchema = z.string().uuid('Musí být platné UUID');

/**
 * Segmentation model validation
 */
export const segmentationModelSchema = z.enum(
  ['hrnet', 'cbam_resunet', 'unet_spherohq', 'unet_attention_aspp', 'sperm', 'wound'],
  {
    errorMap: () => ({
      message:
        'Model musí být hrnet, cbam_resunet, unet_spherohq, unet_attention_aspp, sperm nebo wound',
    }),
  }
);

/**
 * Queue priority validation
 */
export const queuePrioritySchema = z
  .number()
  .int('Priorita musí být celé číslo')
  .min(0, 'Priorita musí být nejméně 0')
  .max(10, 'Priorita může být maximálně 10');

/**
 * Segmentation threshold validation
 */
export const thresholdSchema = z
  .number()
  .min(0.1, 'Threshold musí být nejméně 0.1')
  .max(0.9, 'Threshold může být maximálně 0.9');

// ============================================================================
// Queue validation schemas
// ============================================================================

/**
 * Schema for adding single image to queue
 */
export const addImageToQueueSchema = z.object({
  model: segmentationModelSchema.optional().default('hrnet'),
  threshold: thresholdSchema.optional().default(0.5),
  priority: queuePrioritySchema.optional().default(0),
  detectHoles: z.boolean().optional().default(true),
});

/**
 * Schema for batch queue operations
 */
export const batchQueueSchema = z.object({
  imageIds: z
    .array(uuidSchema)
    .min(1, 'Musíte zadat alespoň jeden obrázek')
    .max(10000, 'Můžete zpracovat maximálně 10000 obrázků najednou'),
  projectId: uuidSchema,
  model: segmentationModelSchema.optional().default('hrnet'),
  threshold: thresholdSchema.optional().default(0.5),
  priority: queuePrioritySchema.optional().default(0),
  forceResegment: z.boolean().optional().default(false),
  detectHoles: z.boolean().optional().default(true),
});

/**
 * Schema for resetting stuck items
 */
export const resetStuckItemsSchema = z.object({
  maxProcessingMinutes: z
    .number()
    .int('Čas musí být celé číslo')
    .min(1, 'Minimální čas je 1 minuta')
    .max(60, 'Maximální čas je 60 minut')
    .optional()
    .default(15),
});

/**
 * Schema for cleaning up old queue entries
 */
export const cleanupQueueSchema = z.object({
  daysOld: z
    .number()
    .int('Počet dní musí být celé číslo')
    .min(1, 'Minimální počet dní je 1')
    .max(30, 'Maximální počet dní je 30')
    .optional()
    .default(7),
});

// ============================================================================
// Project validation schemas
// ============================================================================

/**
 * Project workflow type — drives metric export format and editor behavior.
 * Mirrors the `type` column on the projects table.
 */
export const PROJECT_TYPES = [
  'spheroid',
  'spheroid_invasive',
  'wound',
  'sperm',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

const projectTypeSchema = z.enum(PROJECT_TYPES);

/**
 * Models compatible with each project type. Mirror of the same constant
 * in `src/types/index.ts` (frontend) — kept duplicated because frontend
 * and backend have separate build trees and no shared import path.
 *
 * Cross-type segmentation requests fail with 400.
 */
export const MODEL_TYPE_COMPATIBILITY: Record<ProjectType, readonly string[]> =
  {
    spheroid: ['hrnet', 'cbam_resunet', 'unet_spherohq'],
    spheroid_invasive: ['unet_attention_aspp'],
    wound: ['wound'],
    sperm: ['sperm'],
  } as const;

export const isModelCompatibleWithType = (
  model: string,
  projectType: ProjectType
): boolean =>
  (MODEL_TYPE_COMPATIBILITY[projectType] as readonly string[]).includes(model);

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  title: z
    .string()
    .min(1, 'Název projektu je povinný')
    .max(255, 'Název projektu může mít maximálně 255 znaků')
    .trim(),
  description: z
    .string()
    .max(1000, 'Popis může mít maximálně 1000 znaků')
    .trim()
    .optional()
    .nullable(),
  type: projectTypeSchema.optional(),
});

/**
 * Schema for updating a project
 */
export const updateProjectSchema = z.object({
  title: z
    .string()
    .min(1, 'Název projektu je povinný')
    .max(255, 'Název projektu může mít maximálně 255 znaků')
    .trim()
    .optional(),
  description: z
    .string()
    .max(1000, 'Popis může mít maximálně 1000 znaků')
    .trim()
    .optional()
    .nullable(),
  type: projectTypeSchema.optional(),
});

/**
 * Schema for project query parameters (pagination, search, sort)
 */
export const projectQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  search: z
    .string()
    .max(255, 'Vyhledávací dotaz může mít maximálně 255 znaků')
    .trim()
    .optional(),
  sortBy: z
    .enum(['title', 'createdAt', 'updatedAt'], {
      errorMap: () => ({
        message: 'Řazení lze provést podle: title, createdAt, updatedAt',
      }),
    })
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'], {
      errorMap: () => ({ message: 'Pořadí řazení: asc nebo desc' }),
    })
    .optional()
    .default('desc'),
});

/**
 * Schema for project ID parameter
 */
export const projectIdSchema = z.object({
  id: z.string().uuid('Neplatné ID projektu'),
});

// Image validation schemas

/**
 * Schema for image upload validation
 */
export const imageUploadSchema = z.object({
  files: z
    .array(
      z.object({
        originalname: z.string(),
        mimetype: z.enum(
          [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/bmp',
            'image/tiff',
            'image/tif',
          ],
          {
            errorMap: () => ({
              message:
                'Nepodporovaný formát souboru. Podporované: JPG, PNG, BMP, TIFF',
            }),
          }
        ),
        size: z.number().max(10485760, {
          // 10MB
          message: 'Soubor je příliš velký. Maximální velikost: 10MB',
        }),
        buffer: z.instanceof(Buffer),
      })
    )
    .min(1, 'Je nutné vybrat alespoň jeden soubor')
    .max(20, 'Lze nahrát maximálně 20 souborů najednou'),
});

/**
 * Schema for image query parameters
 */
export const imageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed'], {
      errorMap: () => ({
        message:
          'Neplatný status. Možné hodnoty: pending, processing, completed, failed',
      }),
    })
    .optional(),
  sortBy: z
    .enum(['name', 'createdAt', 'updatedAt', 'fileSize', 'displayOrder'], {
      errorMap: () => ({
        message:
          'Řazení lze provést podle: name, createdAt, updatedAt, fileSize, displayOrder',
      }),
    })
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'], {
      errorMap: () => ({ message: 'Pořadí řazení: asc nebo desc' }),
    })
    .optional()
    .default('desc'),
});

/**
 * Schema for image ID parameter
 */
export const imageIdSchema = z.object({
  imageId: z.string().uuid('Neplatné ID obrázku'),
});

/**
 * Schema for project and image ID parameters
 */
export const projectImageParamsSchema = z.object({
  projectId: z.string().uuid('Neplatné ID projektu'),
  imageId: z.string().uuid('Neplatné ID obrázku'),
});

/**
 * Schema for batch deleting images
 */
export const imageBatchDeleteSchema = z.object({
  imageIds: z
    .array(z.string().uuid('Neplatné ID obrázku'))
    .min(1, 'Musí být vybrán alespoň jeden obrázek')
    .max(100, 'Maximálně 100 obrázků může být smazáno najednou'),
  projectId: z.string().uuid('Neplatné ID projektu').optional(),
});

// Sharing validation schemas

/**
 * Schema for sharing project by email
 */
export const shareByEmailSchema = z.object({
  email: z
    .string()
    .email('Neplatná emailová adresa')
    .max(255, 'Email může mít maximálně 255 znaků')
    .trim(),
});

/**
 * Schema for sharing project by link
 */
export const shareByLinkSchema = z.object({
  expiryHours: z
    .number()
    .int('Doba vypršení musí být celé číslo')
    .min(1, 'Minimální doba vypršení je 1 hodina')
    .max(8760, 'Maximální doba vypršení je 1 rok') // 365 * 24
    .optional(),
});

/**
 * Schema for share ID parameter
 */
export const shareIdSchema = z.object({
  shareId: z.string().uuid('Neplatné ID sdílení'),
});

/**
 * Schema for share token parameter
 */
export const shareTokenSchema = z.object({
  token: z.string().uuid('Neplatný token sdílení'),
});

// Export types
export type CreateProjectData = z.infer<typeof createProjectSchema>;
export type UpdateProjectData = z.infer<typeof updateProjectSchema>;
export type ProjectQueryParams = z.infer<typeof projectQuerySchema>;
export type ProjectIdParams = z.infer<typeof projectIdSchema>;
export type ImageUploadData = z.infer<typeof imageUploadSchema>;
export type ImageQueryParams = z.infer<typeof imageQuerySchema>;

/**
 * Schema for reordering images within a project (time-series / wound-healing UI).
 * Array order == desired displayOrder (index 0 → displayOrder 0, index 1 → 1, ...).
 *
 * ``mode`` controls what happens to images not in the payload:
 * - ``'all'`` (default): payload MUST contain every image in the project. The
 *   service rejects with 400 otherwise, preventing silent sort drift when the
 *   client forgets an image.
 * - ``'partial'``: only the listed images are repositioned at the front
 *   (indexes 0..N-1); omitted images keep their existing displayOrder but
 *   are shifted to start at N. Useful for "move these to front" UX.
 */
export const imageReorderSchema = z.object({
  imageIds: z
    .array(uuidSchema)
    .min(1, 'Je potřeba alespoň jedno UUID')
    .max(10000, 'Maximum 10000 obrázků na jeden reorder')
    .refine(arr => new Set(arr).size === arr.length, {
      message: 'imageIds obsahují duplicity',
    }),
  mode: z.enum(['all', 'partial']).optional().default('all'),
});

export type ImageReorderData = z.infer<typeof imageReorderSchema>;
export type ImageIdParams = z.infer<typeof imageIdSchema>;
export type ProjectImageParams = z.infer<typeof projectImageParamsSchema>;
export type ImageBatchDeleteData = z.infer<typeof imageBatchDeleteSchema>;
export type ShareByEmailData = z.infer<typeof shareByEmailSchema>;
export type ShareByLinkData = z.infer<typeof shareByLinkSchema>;
export type ShareIdParams = z.infer<typeof shareIdSchema>;
export type ShareTokenParams = z.infer<typeof shareTokenSchema>;

// ============================================================================
// Type exports for queue schemas
// ============================================================================

export type AddImageToQueueData = z.infer<typeof addImageToQueueSchema>;
export type BatchQueueData = z.infer<typeof batchQueueSchema>;
export type ResetStuckItemsData = z.infer<typeof resetStuckItemsSchema>;
export type CleanupQueueData = z.infer<typeof cleanupQueueSchema>;
