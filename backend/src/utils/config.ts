import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Configuration schema for validation
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  HOST: z.string().default('localhost'),
  
  // Database
  DATABASE_URL: z.string().default('file:./dev.db'),
  
  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT Access Secret must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT Refresh Secret must be at least 32 characters'),
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
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 minute
  RATE_LIMIT_MAX: z.coerce.number().default(5000) // 5000 requests per minute for development
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
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment configuration:');
    if (error instanceof z.ZodError) {
      // eslint-disable-next-line no-console
      console.error('Zod validation errors:');
      error.errors.forEach((err) => {
        // eslint-disable-next-line no-console
        console.error(`  ${err.path.join('.')}: ${err.message}`);
        // eslint-disable-next-line no-console
        console.error(`    Code: ${err.code}`);
      });
    } else {
      // eslint-disable-next-line no-console
      console.error('Non-Zod error:', error);
    }
    // eslint-disable-next-line no-console
    console.error('Environment variables:');
    // eslint-disable-next-line no-console
    console.error('NODE_ENV:', process.env.NODE_ENV);
    // eslint-disable-next-line no-console
    console.error('FROM_EMAIL:', process.env.FROM_EMAIL);
    // eslint-disable-next-line no-console
    console.error('JWT_ACCESS_SECRET length:', process.env.JWT_ACCESS_SECRET?.length);
    // eslint-disable-next-line no-console
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