import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Helper function to read secrets from Docker secret files
const readSecretFile = (secretPath: string): string | undefined => {
  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf8').trim();
    }
    return undefined;
  } catch (error) {
    console.warn(`Failed to read secret file ${secretPath}:`, error);
    return undefined;
  }
};

// Helper function to get value from environment or secret file
const getSecretValue = (envKey: string, secretFileKey?: string): string | undefined => {
  // First try environment variable
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  
  // Then try secret file if specified
  if (secretFileKey) {
    const secretFilePath = process.env[secretFileKey];
    if (secretFilePath) {
      return readSecretFile(secretFilePath);
    }
  }
  
  return undefined;
};

// Configuration schema for validation
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  HOST: z.string().default('localhost'),
  
  // Database
  DATABASE_URL: z.string().default('file:./dev.db').transform((url) => {
    // Support DATABASE_URL template with secret substitution for production
    const urlTemplate = process.env.DATABASE_URL_TEMPLATE;
    if (urlTemplate) {
      // Validate template contains required placeholder
      if (!urlTemplate.includes('{{DB_PASSWORD}}')) {
        throw new Error('DATABASE_URL_TEMPLATE must contain {{DB_PASSWORD}} placeholder');
      }
      
      // Check for multiple occurrences (should be exactly one)
      const occurrences = (urlTemplate.match(/\{\{DB_PASSWORD\}\}/g) || []).length;
      if (occurrences !== 1) {
        throw new Error('DATABASE_URL_TEMPLATE must contain exactly one {{DB_PASSWORD}} placeholder');
      }
      
      const dbPassword = getSecretValue('DB_PASSWORD', 'DB_PASSWORD_FILE');
      if (!dbPassword) {
        throw new Error('DB_PASSWORD or DB_PASSWORD_FILE must be provided when using DATABASE_URL_TEMPLATE');
      }
      
      const resultUrl = urlTemplate.replace('{{DB_PASSWORD}}', dbPassword);
      
      // Validate the resulting URL is well-formed
      try {
        new URL(resultUrl);
      } catch {
        // If URL constructor fails, try basic database URL pattern validation
        if (!/^(postgres|postgresql|mysql|sqlite):\/\/.+/.test(resultUrl)) {
          throw new Error('DATABASE_URL_TEMPLATE substitution resulted in invalid database URL format');
        }
      }
      
      return resultUrl;
    }
    return url;
  }),
  
  // JWT
  JWT_ACCESS_SECRET: z.string().transform(() => {
    const secret = getSecretValue('JWT_ACCESS_SECRET', 'JWT_ACCESS_SECRET_FILE');
    if (!secret || secret.length < 32) {
      throw new Error('JWT Access Secret must be at least 32 characters');
    }
    return secret;
  }),
  JWT_REFRESH_SECRET: z.string().transform(() => {
    const secret = getSecretValue('JWT_REFRESH_SECRET', 'JWT_REFRESH_SECRET_FILE');
    if (!secret || secret.length < 32) {
      throw new Error('JWT Refresh Secret must be at least 32 characters');
    }
    return secret;
  }),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  
  // Email
  EMAIL_SERVICE: z.enum(['sendgrid', 'smtp']).default('sendgrid'),
  SENDGRID_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email(),
  FROM_NAME: z.string().default('Cell Segmentation Platform'),
  
  // File Storage
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().min(1, 'Upload directory cannot be empty').default('./uploads'),
  MAX_FILE_SIZE: z.string().transform((val) => {
    const num = Number(val);
    if (isNaN(num) || num <= 0) {
      throw new Error('MAX_FILE_SIZE must be a positive number');
    }
    return num;
  }).default('10485760'), // 10MB
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  
  // Redis (optional)
  REDIS_URL: z.string().optional(),
  
  // Segmentation Service
  SEGMENTATION_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  
  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000,http://localhost:8082'),
  
  // Rate Limiting
  RATE_LIMIT_ENABLED: z.coerce.boolean().default(true),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1).default(60000), // 1 minute
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10000) // 10000 requests per minute for production (increased from 5000)
}).refine((data) => {
  // S3 storage validation
  if (data.STORAGE_TYPE === 's3') {
    if (!data.S3_ACCESS_KEY || data.S3_ACCESS_KEY.trim() === '') {
      throw new Error('S3_ACCESS_KEY is required when STORAGE_TYPE is s3');
    }
    if (!data.S3_SECRET_KEY || data.S3_SECRET_KEY.trim() === '') {
      throw new Error('S3_SECRET_KEY is required when STORAGE_TYPE is s3');
    }
    if (!data.S3_BUCKET || data.S3_BUCKET.trim() === '') {
      throw new Error('S3_BUCKET is required when STORAGE_TYPE is s3');
    }
  }
  
  // Email service validation
  if (data.EMAIL_SERVICE === 'sendgrid') {
    if (!data.SENDGRID_API_KEY || data.SENDGRID_API_KEY.trim() === '') {
      throw new Error('SENDGRID_API_KEY is required when EMAIL_SERVICE is sendgrid');
    }
  } else if (data.EMAIL_SERVICE === 'smtp') {
    if (!data.SMTP_HOST || data.SMTP_HOST.trim() === '') {
      throw new Error('SMTP_HOST is required when EMAIL_SERVICE is smtp');
    }
    if (!data.SMTP_PORT) {
      throw new Error('SMTP_PORT is required when EMAIL_SERVICE is smtp');
    }
    if (!data.SMTP_USER || data.SMTP_USER.trim() === '') {
      throw new Error('SMTP_USER is required when EMAIL_SERVICE is smtp');
    }
    if (!data.SMTP_PASS || data.SMTP_PASS.trim() === '') {
      throw new Error('SMTP_PASS is required when EMAIL_SERVICE is smtp');
    }
  }
  
  return true;
});

// TypeScript type for configuration
type ConfigType = z.infer<typeof configSchema>;

// Parse and validate configuration
const parseConfig = (): ConfigType => {
  try {
    return configSchema.parse(process.env);
  } catch (error) {
     
    console.error('❌ Invalid environment configuration:');
    if (error instanceof z.ZodError) {
       
      console.error('Zod validation errors:');
      error.errors.forEach((err) => {
         
        console.error(`  ${err.path.join('.')}: ${err.message}`);
         
        console.error(`    Code: ${err.code}`);
      });
    } else {
       
      console.error('Non-Zod error:', error);
    }
     
    console.error('Environment variables:');
     
    console.error('NODE_ENV:', process.env.NODE_ENV);
     
    console.error('FROM_EMAIL:', process.env.FROM_EMAIL);
     
    console.error('JWT_ACCESS_SECRET length:', process.env.JWT_ACCESS_SECRET?.length);
     
    console.error('JWT_REFRESH_SECRET length:', process.env.JWT_REFRESH_SECRET?.length);
    process.exit(1);
  }
};

export const config = parseConfig();

// Derived configuration
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// Helper functions
export const getOrigins = (): string[] => {
  return config.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
};

export const getEmailConfig = (): { service: 'sendgrid' | 'smtp'; apiKey?: string; host?: string; port?: number; user?: string; pass?: string } => {
  if (config.EMAIL_SERVICE === 'sendgrid') {
    return {
      service: 'sendgrid' as const,
      apiKey: config.SENDGRID_API_KEY || ''
    };
  } else {
    return {
      service: 'smtp' as const,
      host: config.SMTP_HOST || '',
      port: config.SMTP_PORT || 587,
      user: config.SMTP_USER || '',
      pass: config.SMTP_PASS || ''
    };
  }
};

export const getStorageConfig = (): { type: 's3' | 'local'; endpoint?: string; accessKey?: string; secretKey?: string; bucket?: string; uploadDir?: string; region?: string; maxFileSize?: number } => {
  if (config.STORAGE_TYPE === 's3') {
    return {
      type: 's3' as const,
      endpoint: config.S3_ENDPOINT,
      accessKey: config.S3_ACCESS_KEY || '',
      secretKey: config.S3_SECRET_KEY || '',
      bucket: config.S3_BUCKET || '',
      region: config.S3_REGION
    };
  } else {
    return {
      type: 'local' as const,
      uploadDir: config.UPLOAD_DIR,
      maxFileSize: config.MAX_FILE_SIZE
    };
  }
};