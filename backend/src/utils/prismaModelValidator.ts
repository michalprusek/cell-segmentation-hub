import { Prisma as _Prisma, PrismaClient } from '@prisma/client';

/**
 * Secure Prisma model validation utility
 * Prevents injection attacks when dynamically accessing Prisma models
 */

// Define allowed models that can be accessed dynamically
const ALLOWED_MODELS = [
  'user',
  'project',
  'projectImage',
  'segmentationResult',
  'queueItem',
  'refreshToken',
  'emailVerificationToken',
  'passwordResetToken',
  'segmentationHistory',
  'polygon',
  'exportTask'
] as const;

type AllowedModel = typeof ALLOWED_MODELS[number];

/**
 * Validates and sanitizes a model name for safe Prisma access
 * @param modelName - The model name to validate
 * @returns The validated model name or null if invalid
 */
export function validatePrismaModel(modelName: string): AllowedModel | null {
  // Convert to lowercase for case-insensitive comparison
  const normalized = modelName.toLowerCase().trim();
  
  // Check if the model is in the allowed list
  if (ALLOWED_MODELS.includes(normalized as AllowedModel)) {
    return normalized as AllowedModel;
  }
  
  return null;
}

/**
 * Type guard to check if a string is a valid Prisma model name
 * @param modelName - The model name to check
 * @returns True if the model name is valid
 */
export function isValidPrismaModel(modelName: string): modelName is AllowedModel {
  return validatePrismaModel(modelName) !== null;
}

/**
 * Validates field names to prevent injection when building dynamic queries
 * @param fieldName - The field name to validate
 * @returns The sanitized field name or null if invalid
 */
export function validateFieldName(fieldName: string): string | null {
  // Allow only alphanumeric characters and underscores
  const sanitized = fieldName.trim();
  
  // Check for valid field name pattern
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sanitized)) {
    return null;
  }
  
  // Limit field name length to prevent abuse
  if (sanitized.length > 64) {
    return null;
  }
  
  return sanitized;
}

/**
 * Validates and sanitizes where clause conditions
 * @param where - The where clause object
 * @returns Sanitized where clause or empty object if invalid
 */
export function sanitizeWhereClause(where: Record<string, unknown>): Record<string, unknown> {
  if (!where || typeof where !== 'object') {
    return {};
  }
  
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(where)) {
    const validKey = validateFieldName(key);
    if (!validKey) {
      continue; // Skip invalid field names
    }
    
    // Handle nested conditions
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Check for Prisma operators
      const operators = ['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith'];
      const hasOperator = Object.keys(value).some(k => operators.includes(k));
      
      if (hasOperator) {
        sanitized[validKey] = value; // Trust Prisma's built-in validation for operators
      } else {
        // Recursively sanitize nested objects
        sanitized[validKey] = sanitizeWhereClause(value);
      }
    } else {
      // Direct value assignment
      sanitized[validKey] = value;
    }
  }
  
  return sanitized;
}

/**
 * Creates a safe model accessor that validates model names
 * @param prisma - The Prisma client instance
 * @returns A function to safely access Prisma models
 */
export function createSafeModelAccessor(prisma: PrismaClient): (modelName: string) => unknown {
  return function getModel(modelName: string): unknown {
    const validModel = validatePrismaModel(modelName);
    if (!validModel) {
      throw new Error(`Invalid or unauthorized model name: ${modelName}`);
    }
    
    return prisma[validModel];
  };
}

export { AllowedModel };