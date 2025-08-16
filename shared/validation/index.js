"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listImagesSchema = exports.listProjectsSchema = exports.searchSchema = exports.sortSchema = exports.uuidSchema = exports.segmentationDataSchema = exports.polygonDataSchema = exports.pointSchema = exports.fileUploadSchema = exports.paginationSchema = exports.exportRequestSchema = exports.segmentationRequestSchema = exports.uploadImageSchema = exports.updateProfileSchema = exports.updateProjectSchema = exports.createProjectSchema = exports.confirmResetPasswordSchema = exports.resetPasswordSchema = exports.registerSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const types_1 = require("../types");
// Auth validation schemas
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Neplatná emailová adresa'),
    password: zod_1.z.string().min(6, 'Heslo musí mít minimálně 6 znaků')
});
exports.registerSchema = zod_1.z.object({
    email: zod_1.z.string().email('Neplatná emailová adresa'),
    password: zod_1.z.string().min(6, 'Heslo musí mít minimálně 6 znaků'),
    username: zod_1.z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').optional()
});
exports.resetPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email('Neplatná emailová adresa')
});
exports.confirmResetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().min(1, 'Token je vyžadován'),
    password: zod_1.z.string().min(6, 'Heslo musí mít minimálně 6 znaků')
});
// Project validation schemas
exports.createProjectSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'Název projektu je vyžadován').max(100, 'Název projektu může mít maximálně 100 znaků'),
    description: zod_1.z.string().max(500, 'Popis může mít maximálně 500 znaků').optional()
});
exports.updateProjectSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'Název projektu je vyžadován').max(100, 'Název projektu může mít maximálně 100 znaků').optional(),
    description: zod_1.z.string().max(500, 'Popis může mít maximálně 500 znaků').optional()
});
// User profile validation schemas
exports.updateProfileSchema = zod_1.z.object({
    username: zod_1.z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').max(50, 'Uživatelské jméno může mít maximálně 50 znaků').optional(),
    bio: zod_1.z.string().max(500, 'Bio může mít maximálně 500 znaků').optional(),
    preferredModel: zod_1.z.enum(Object.keys(types_1.SEGMENTATION_MODELS).length > 0 ? Object.keys(types_1.SEGMENTATION_MODELS) : ['default']).optional(),
    modelThreshold: zod_1.z.number().min(0.0, 'Threshold musí být minimálně 0.0').max(1.0, 'Threshold může být maximálně 1.0').optional(),
    preferredLang: zod_1.z.enum(['cs', 'en', 'de', 'fr', 'es', 'zh']).optional(),
    preferredTheme: zod_1.z.enum(['light', 'dark', 'system']).optional()
});
// Image validation schemas
exports.uploadImageSchema = zod_1.z.object({
    projectId: zod_1.z.string().uuid('Neplatné ID projektu'),
    autoSegment: zod_1.z.boolean().optional().default(true)
});
exports.segmentationRequestSchema = zod_1.z.object({
    imageId: zod_1.z.string().uuid('Neplatné ID obrázku'),
    model: zod_1.z.enum(Object.keys(types_1.SEGMENTATION_MODELS).length > 0 ? Object.keys(types_1.SEGMENTATION_MODELS) : ['default']).optional(),
    threshold: zod_1.z.number().min(0.0).max(1.0).optional()
});
// Export validation schemas
exports.exportRequestSchema = zod_1.z.object({
    projectId: zod_1.z.string().uuid('Neplatné ID projektu'),
    imageIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    format: zod_1.z.enum(['coco', 'excel']),
    includeMetrics: zod_1.z.boolean().optional().default(true)
});
// Pagination schemas
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.number().int().min(1).optional().default(1),
    limit: zod_1.z.number().int().min(1).max(100).optional().default(10)
});
// File validation
exports.fileUploadSchema = zod_1.z.object({
    mimetype: zod_1.z.string().refine((mimetype) => mimetype.startsWith('image/'), 'Pouze obrázky jsou povolené'),
    size: zod_1.z.number().max(10 * 1024 * 1024, 'Soubor může mít maximálně 10MB')
});
// Polygon validation
exports.pointSchema = zod_1.z.object({
    x: zod_1.z.number(),
    y: zod_1.z.number()
});
exports.polygonDataSchema = zod_1.z.object({
    id: zod_1.z.string(),
    points: zod_1.z.array(exports.pointSchema).min(3, 'Polygon musí mít minimálně 3 body'),
    type: zod_1.z.enum(['external', 'internal']),
    class: zod_1.z.string()
});
exports.segmentationDataSchema = zod_1.z.object({
    polygons: zod_1.z.array(exports.polygonDataSchema),
    model: zod_1.z.string(),
    threshold: zod_1.z.number().min(0.0).max(1.0)
});
// ID validation helpers
exports.uuidSchema = zod_1.z.string().uuid();
// Common query parameters
exports.sortSchema = zod_1.z.object({
    sortBy: zod_1.z.string().optional(),
    sortOrder: zod_1.z.enum(['asc', 'desc']).optional().default('desc')
});
exports.searchSchema = zod_1.z.object({
    q: zod_1.z.string().optional()
});
// Combined schemas for common use cases
exports.listProjectsSchema = exports.paginationSchema.merge(exports.sortSchema).merge(exports.searchSchema);
exports.listImagesSchema = exports.paginationSchema.merge(exports.sortSchema);
//# sourceMappingURL=index.js.map