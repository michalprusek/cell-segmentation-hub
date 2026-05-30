import { z } from 'zod';
import { JOB_STATUSES } from './index';
import {
  SEGMENTATION_MODELS,
  SEGMENTATION_MODEL_ERROR_MESSAGE,
} from '../constants/segmentationModels';

// ============================================================================
// Common validation schemas
// ============================================================================

/**
 * UUID validation
 */
export const uuidSchema = z.string().uuid('Musí být platné UUID');

/**
 * Segmentation model validation. Mirror of the KnownModelId union further
 * down in this file — keep them in lock-step: every member of one must be
 * a member of the other. The Microtubules video project uses 'microtubule'
 * (added 2026-05-12 with PR #142) so frontend Segment-All requests against
 * a Microtubules project send model='microtubule' and need to validate.
 */
// Single source of truth is `constants/segmentationModels.ts`; the
// Zod schema is derived from the same const so the route validator,
// controller fallback, and any Zod-validated path stay in lock-step.
// Previously these drifted (Zod had 7 models, route+controller had 9),
// making a `resunet_advanced` request pass the route but fail Zod-aware
// internal callers — silent acceptance / rejection asymmetry.
const _SEG_MODELS_TUPLE = SEGMENTATION_MODELS as unknown as [
  SegmentationModelLiteral,
  ...SegmentationModelLiteral[],
];
type SegmentationModelLiteral = (typeof SEGMENTATION_MODELS)[number];
export const segmentationModelSchema = z.enum(_SEG_MODELS_TUPLE, {
  errorMap: () => ({ message: SEGMENTATION_MODEL_ERROR_MESSAGE }),
});

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
  // Per-batch channel override for multi-channel video frames.
  // Matches the channel labels in images.channels[].id (e.g. "488_nm",
  // "640_nm", "ch_0"). When set, the worker reads frames/NNNN/<channel>.png
  // for every video-frame image in the batch instead of each frame's default
  // originalPath. Limited to 64 chars to bound the path-rewrite below.
  channel: z
    .string()
    .min(1, 'Kanál nesmí být prázdný')
    .max(64, 'Kanál může mít maximálně 64 znaků')
    .regex(/^[A-Za-z0-9_-]+$/, 'Kanál může obsahovat jen alfanumerické znaky, _ a -')
    .optional(),
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
  'microtubules',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

const projectTypeSchema = z.enum(PROJECT_TYPES);

/**
 * Narrow an arbitrary string (e.g. `Project.type` from Prisma, where the
 * column is a plain `String` despite the comment locking it to the union)
 * to a known `ProjectType`. Falls back to `'spheroid'` for legacy rows or
 * unrecognised values — matches the frontend `coerceProjectType` helper
 * (`src/types/index.ts:343`).
 */
export const isProjectType = (v: unknown): v is ProjectType =>
  typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v);

export const coerceProjectType = (v: unknown): ProjectType =>
  isProjectType(v) ? v : 'spheroid';

/** Model identifiers and the model↔project-type compatibility map now derive
 *  from the single source of truth in `../constants/modelRegistry`. Adding or
 *  removing a model there updates this automatically — no more hand-synced
 *  copies (this file and the whitelist had already drifted to 9 vs 11).
 *
 *  Cross-tree (frontend) parity is guaranteed by two independent equality
 *  tests pinning each side to the canonical matrix, plus the source-level
 *  `scripts/check-model-parity.cjs` guard. Compatibility rationale:
 *  - `spheroid_invasive` is locked to `unet_attention_aspp` (core detection is
 *    tied to that model's postprocessing path).
 *  - `wound`, `sperm`, `microtubules` use their dedicated specialised models.
 *  - Standard `spheroid` projects use the general spheroid models;
 *    `unet_attention_aspp` is excluded there on purpose. */
import {
  MODEL_TYPE_COMPATIBILITY,
  type KnownModelId,
} from '../constants/modelRegistry';

export { MODEL_TYPE_COMPATIBILITY };
export type { KnownModelId };

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
 *
 * ``folderId`` filters by user-folder placement. Accepts:
 *   - undefined / omitted: unfiltered (default — returns all projects the user can see).
 *   - "root": projects that the user has NOT placed in any of their folders.
 *   - <uuid>: projects placed inside the given folder (must belong to the caller).
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
  folderId: z
    .union([z.literal('root'), z.string().uuid('Neplatné ID složky')])
    .optional(),
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
    .enum(JOB_STATUSES, {
      errorMap: () => ({
        message: `Neplatný status. Možné hodnoty: ${JOB_STATUSES.join(', ')}`,
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

// ============================================================================
// Project folder schemas (file-explorer style hierarchy)
// ============================================================================

// `.trim()` runs LAST in Zod's pipeline, AFTER `.min(1)` — meaning a
// whitespace-only input like " " would pass `.min(1)` validation and then
// be trimmed to "" before reaching the service layer. Reorder so trim
// happens first; the min(1) then catches the empty post-trim case.
// (This bug shipped briefly with PR #202 and updateFolder accepted " " →
// "" in the DB. createFolder had a defensive re-check; updateFolder did
// not. Fixing at the schema level eliminates the divergence.)
const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Název složky je povinný')
  .max(100, 'Název složky může mít maximálně 100 znaků');

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().uuid('Neplatné ID nadřazené složky').nullable().optional(),
});

// PATCH semantics: any subset of { name, parentId } may be supplied.
// parentId === null  → move to root.
// parentId === undefined → leave unchanged.
export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: z.string().uuid('Neplatné ID nadřazené složky').nullable().optional(),
  })
  .refine(v => v.name !== undefined || v.parentId !== undefined, {
    message: 'Aktualizace musí obsahovat alespoň jedno pole (name nebo parentId)',
  });

export const folderItemsSchema = z.object({
  projectIds: z
    .array(uuidSchema)
    .min(1, 'Je potřeba alespoň jedno UUID')
    .max(100, 'Maximum 100 projektů na jeden přesun')
    .refine(arr => new Set(arr).size === arr.length, {
      message: 'projectIds obsahují duplicity',
    }),
});

export const folderIdSchema = z.object({
  id: z.string().uuid('Neplatné ID složky'),
});

export type CreateFolderData = z.infer<typeof createFolderSchema>;
export type UpdateFolderData = z.infer<typeof updateFolderSchema>;
export type FolderItemsData = z.infer<typeof folderItemsSchema>;
export type FolderIdParams = z.infer<typeof folderIdSchema>;

// ============================================================================
// Feedback (bug reports + feature requests)
// ============================================================================

// Mirrored as a DB CHECK constraint in 20260513_add_feedback so an attacker
// who bypasses the API layer still can't insert an unknown type.
export const FEEDBACK_TYPES = ['bug', 'feature'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const createFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  // Length caps match the DB columns; the trim() prevents users from sending
  // whitespace-only content that the .min(1) check would otherwise accept.
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export type CreateFeedbackData = z.infer<typeof createFeedbackSchema>;
