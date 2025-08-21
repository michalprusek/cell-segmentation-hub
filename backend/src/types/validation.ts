import { z } from 'zod';

// Project validation schemas

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  title: z.string()
    .min(1, 'Název projektu je povinný')
    .max(255, 'Název projektu může mít maximálně 255 znaků')
    .trim(),
  description: z.string()
    .max(1000, 'Popis může mít maximálně 1000 znaků')
    .trim()
    .optional()
    .nullable()
});

/**
 * Schema for updating a project
 */
export const updateProjectSchema = z.object({
  title: z.string()
    .min(1, 'Název projektu je povinný')
    .max(255, 'Název projektu může mít maximálně 255 znaků')
    .trim()
    .optional(),
  description: z.string()
    .max(1000, 'Popis může mít maximálně 1000 znaků')
    .trim()
    .optional()
    .nullable()
});

/**
 * Schema for project query parameters (pagination, search, sort)
 */
export const projectQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  search: z.string()
    .max(255, 'Vyhledávací dotaz může mít maximálně 255 znaků')
    .trim()
    .optional(),
  sortBy: z.enum(['title', 'createdAt', 'updatedAt'], {
    errorMap: () => ({ message: 'Řazení lze provést podle: title, createdAt, updatedAt' })
  })
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc'], {
    errorMap: () => ({ message: 'Pořadí řazení: asc nebo desc' })
  })
    .optional()
    .default('desc')
});

/**
 * Schema for project ID parameter
 */
export const projectIdSchema = z.object({
  id: z.string()
    .uuid('Neplatné ID projektu')
});

// Image validation schemas

/**
 * Schema for image upload validation
 */
export const imageUploadSchema = z.object({
  files: z.array(z.object({
    originalname: z.string(),
    mimetype: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/tiff', 'image/tif'], {
      errorMap: () => ({ message: 'Nepodporovaný formát souboru. Podporované: JPG, PNG, BMP, TIFF' })
    }),
    size: z.number().max(10485760, { // 10MB
      message: 'Soubor je příliš velký. Maximální velikost: 10MB'
    }),
    buffer: z.instanceof(Buffer)
  })).min(1, 'Je nutné vybrat alespoň jeden soubor')
    .max(20, 'Lze nahrát maximálně 20 souborů najednou')
});

/**
 * Schema for image query parameters
 */
export const imageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  status: z.enum(['pending', 'processing', 'completed', 'failed'], {
    errorMap: () => ({ message: 'Neplatný status. Možné hodnoty: pending, processing, completed, failed' })
  }).optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'fileSize'], {
    errorMap: () => ({ message: 'Řazení lze provést podle: name, createdAt, updatedAt, fileSize' })
  })
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc'], {
    errorMap: () => ({ message: 'Pořadí řazení: asc nebo desc' })
  })
    .optional()
    .default('desc')
});

/**
 * Schema for image ID parameter
 */
export const imageIdSchema = z.object({
  imageId: z.string()
    .uuid('Neplatné ID obrázku')
});

/**
 * Schema for project and image ID parameters
 */
export const projectImageParamsSchema = z.object({
  projectId: z.string()
    .uuid('Neplatné ID projektu'),
  imageId: z.string()
    .uuid('Neplatné ID obrázku')
});

/**
 * Schema for batch deleting images
 */
export const imageBatchDeleteSchema = z.object({
  imageIds: z.array(z.string().uuid('Neplatné ID obrázku'))
    .min(1, 'Musí být vybrán alespoň jeden obrázek')
    .max(100, 'Maximálně 100 obrázků může být smazáno najednou'),
  projectId: z.string()
    .uuid('Neplatné ID projektu')
    .optional()
});

// Sharing validation schemas

/**
 * Schema for sharing project by email
 */
export const shareByEmailSchema = z.object({
  email: z.string()
    .email('Neplatná emailová adresa')
    .max(255, 'Email může mít maximálně 255 znaků')
    .trim(),
  message: z.string()
    .max(500, 'Zpráva může mít maximálně 500 znaků')
    .trim()
    .optional()
});

/**
 * Schema for sharing project by link
 */
export const shareByLinkSchema = z.object({
  expiryHours: z.number()
    .int('Doba vypršení musí být celé číslo')
    .min(1, 'Minimální doba vypršení je 1 hodina')
    .max(8760, 'Maximální doba vypršení je 1 rok') // 365 * 24
    .optional()
});

/**
 * Schema for share ID parameter
 */
export const shareIdSchema = z.object({
  shareId: z.string()
    .uuid('Neplatné ID sdílení')
});

/**
 * Schema for share token parameter
 */
export const shareTokenSchema = z.object({
  token: z.string()
    .uuid('Neplatný token sdílení')
});

// Export types
export type CreateProjectData = z.infer<typeof createProjectSchema>;
export type UpdateProjectData = z.infer<typeof updateProjectSchema>;
export type ProjectQueryParams = z.infer<typeof projectQuerySchema>;
export type ProjectIdParams = z.infer<typeof projectIdSchema>;
export type ImageUploadData = z.infer<typeof imageUploadSchema>;
export type ImageQueryParams = z.infer<typeof imageQuerySchema>;
export type ImageIdParams = z.infer<typeof imageIdSchema>;
export type ProjectImageParams = z.infer<typeof projectImageParamsSchema>;
export type ImageBatchDeleteData = z.infer<typeof imageBatchDeleteSchema>;
export type ShareByEmailData = z.infer<typeof shareByEmailSchema>;
export type ShareByLinkData = z.infer<typeof shareByLinkSchema>;
export type ShareIdParams = z.infer<typeof shareIdSchema>;
export type ShareTokenParams = z.infer<typeof shareTokenSchema>;