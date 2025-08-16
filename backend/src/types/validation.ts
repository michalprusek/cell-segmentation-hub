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
  page: z.string()
    .optional()
    .refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0), {
      message: 'Stránka musí být kladné číslo'
    })
    .transform((val) => val ? Number(val) : 1),
  limit: z.string()
    .optional()
    .refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0 && Number(val) <= 100), {
      message: 'Limit musí být mezi 1 a 100'
    })
    .transform((val) => val ? Number(val) : 10),
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
  page: z.string()
    .optional()
    .refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0), {
      message: 'Stránka musí být kladné číslo'
    })
    .transform((val) => val ? Number(val) : 1),
  limit: z.string()
    .optional()
    .refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0 && Number(val) <= 50), {
      message: 'Limit musí být mezi 1 a 50'
    })
    .transform((val) => val ? Number(val) : 20),
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

// Export types
export type CreateProjectData = z.infer<typeof createProjectSchema>;
export type UpdateProjectData = z.infer<typeof updateProjectSchema>;
export type ProjectQueryParams = z.infer<typeof projectQuerySchema>;
export type ProjectIdParams = z.infer<typeof projectIdSchema>;
export type ImageUploadData = z.infer<typeof imageUploadSchema>;
export type ImageQueryParams = z.infer<typeof imageQuerySchema>;
export type ImageIdParams = z.infer<typeof imageIdSchema>;
export type ProjectImageParams = z.infer<typeof projectImageParamsSchema>;