// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-for-testing-only-32-characters-long';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-for-testing-only-32-characters-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.JWT_REFRESH_EXPIRY_REMEMBER = '30d';
process.env.DATABASE_URL = 'file:./test.db';
process.env.UPLOAD_DIR = './test-uploads';
process.env.MAX_FILE_SIZE = '10485760';
process.env.STORAGE_TYPE = 'local';
process.env.SESSION_SECRET = 'test-session-secret-for-testing-only';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.SEGMENTATION_SERVICE_URL = 'http://localhost:8000';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.WS_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.FROM_EMAIL = 'test@example.com';
process.env.FROM_NAME = 'Test Platform';
process.env.EMAIL_SERVICE = 'none';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
process.env.PORT = '3001';
process.env.HOST = 'localhost';

// Mock console methods to reduce test output noise
// Only mock if we're in test environment
if (process.env.NODE_ENV === 'test') {
  global.console = {
    ...console,
    error: () => {},
    warn: () => {},
    log: () => {},
  };
}
