/**
 * Environment Variable Validator
 * Ensures all required environment variables are set at startup
 */

import { logger } from '../utils/logger';

interface EnvVariable {
  name: string;
  required: boolean;
  defaultValue?: string;
  validator?: (value: string) => boolean;
  description?: string;
}

const ENV_VARIABLES: EnvVariable[] = [
  // Database
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection string',
    validator: (value) => value.includes('postgresql://') || value.includes('sqlite:'),
  },
  
  // JWT Secrets
  {
    name: 'JWT_ACCESS_SECRET',
    required: true,
    description: 'Secret for JWT access tokens',
    validator: (value) => value.length >= 32,
  },
  {
    name: 'JWT_REFRESH_SECRET',
    required: true,
    description: 'Secret for JWT refresh tokens',
    validator: (value) => value.length >= 32,
  },
  
  // Service URLs
  {
    name: 'SEGMENTATION_SERVICE_URL',
    required: true,
    description: 'ML service endpoint',
    validator: (value) => value.startsWith('http'),
  },
  {
    name: 'REDIS_URL',
    required: true,
    description: 'Redis connection URL',
    validator: (value) => value.includes('redis://'),
  },
  
  // Upload Configuration
  {
    name: 'UPLOAD_DIR',
    required: true,
    defaultValue: '/app/uploads',
    description: 'Directory for file uploads',
  },
  
  // Email Configuration (optional but validated if present)
  {
    name: 'SMTP_HOST',
    required: false,
    description: 'SMTP server hostname',
  },
  {
    name: 'SMTP_PORT',
    required: false,
    defaultValue: '587',
    validator: (value) => !isNaN(parseInt(value, 10)),
    description: 'SMTP server port',
  },
  {
    name: 'SMTP_USER',
    required: false,
    description: 'SMTP username for authentication',
  },
  {
    name: 'SMTP_PASS',
    required: false,
    description: 'SMTP password for authentication',
  },
  {
    name: 'FROM_EMAIL',
    required: false,
    defaultValue: 'noreply@example.com',
    description: 'Email sender address',
    validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  },
  {
    name: 'EMAIL_TIMEOUT',
    required: false,
    defaultValue: '60000',
    validator: (value) => !isNaN(parseInt(value, 10)) && parseInt(value, 10) > 0,
    description: 'Email timeout in milliseconds',
  },
  
  // CORS Configuration
  {
    name: 'CORS_ORIGIN',
    required: true,
    description: 'Allowed CORS origins',
  },
  {
    name: 'WS_ALLOWED_ORIGINS',
    required: true,
    description: 'Allowed WebSocket origins',
  },
  
  // Frontend URL
  {
    name: 'FRONTEND_URL',
    required: true,
    description: 'Frontend application URL',
    validator: (value) => value.startsWith('http'),
  },
  
  // Node Environment
  {
    name: 'NODE_ENV',
    required: false,
    defaultValue: 'development',
    validator: (value) => ['development', 'production', 'test'].includes(value),
    description: 'Node.js environment',
  },
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    total: number;
    configured: number;
    missing: number;
    invalid: number;
  };
}

/**
 * Validates all environment variables at startup
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let configured = 0;
  let missing = 0;
  let invalid = 0;

  logger.info('Starting environment validation...', 'EnvValidator');

  for (const envVar of ENV_VARIABLES) {
    const value = process.env[envVar.name];
    
    // Check if variable exists
    if (!value && !envVar.defaultValue) {
      if (envVar.required) {
        errors.push(`Missing required environment variable: ${envVar.name} - ${envVar.description || 'No description'}`);
        missing++;
      } else {
        warnings.push(`Optional environment variable not set: ${envVar.name} - ${envVar.description || 'No description'}`);
      }
      continue;
    }
    
    // Use default value if not set
    const actualValue = value || envVar.defaultValue!;
    
    // Validate the value if validator is provided
    if (envVar.validator && actualValue) {
      if (!envVar.validator(actualValue)) {
        const message = `Invalid value for ${envVar.name}: "${actualValue.substring(0, 20)}${actualValue.length > 20 ? '...' : ''}" - ${envVar.description || 'No description'}`;
        if (envVar.required) {
          errors.push(message);
          invalid++;
        } else {
          warnings.push(message);
        }
      } else {
        configured++;
      }
    } else {
      configured++;
    }
    
    // Set default value if not present
    if (!value && envVar.defaultValue) {
      process.env[envVar.name] = envVar.defaultValue;
      logger.debug(`Using default value for ${envVar.name}: ${envVar.defaultValue}`, 'EnvValidator');
    }
  }
  
  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total: ENV_VARIABLES.length,
      configured,
      missing,
      invalid,
    },
  };
  
  // Log summary
  if (result.valid) {
    logger.info('✅ Environment validation passed', 'EnvValidator', result.summary);
  } else {
    logger.error('❌ Environment validation failed', undefined, 'EnvValidator', {
      ...result.summary,
      errors: result.errors.slice(0, 5), // Log first 5 errors
    });
  }
  
  if (warnings.length > 0) {
    logger.warn('⚠️ Environment validation warnings', 'EnvValidator', {
      count: warnings.length,
      warnings: warnings.slice(0, 3), // Log first 3 warnings
    });
  }
  
  return result;
}

/**
 * Fail fast if environment is invalid
 */
export function requireValidEnvironment(): void {
  const result = validateEnvironment();
  
  if (!result.valid) {
    console.error('\n🚨 ENVIRONMENT VALIDATION FAILED 🚨\n');
    console.error('The following errors must be resolved:\n');
    result.errors.forEach((error, index) => {
      console.error(`  ${index + 1}. ${error}`);
    });
    console.error('\nPlease check your .env file or Docker environment configuration.');
    console.error('Refer to .env.example for required variables.\n');
    
    // Exit with error code
    process.exit(1);
  }
  
  if (result.warnings.length > 0) {
    console.warn('\n⚠️ Environment Warnings:\n');
    result.warnings.forEach((warning, index) => {
      console.warn(`  ${index + 1}. ${warning}`);
    });
    console.warn('');
  }
}

/**
 * Get environment variable with type safety
 */
export function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${name} is not defined`);
  }
  return value;
}

/**
 * Get numeric environment variable
 */
export function getNumericEnvVar(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {return defaultValue;}
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    logger.warn(`Invalid numeric value for ${name}: ${value}, using default: ${defaultValue}`, 'EnvValidator');
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Get boolean environment variable
 */
export function getBooleanEnvVar(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) {return defaultValue;}
  
  return value.toLowerCase() === 'true' || value === '1';
}