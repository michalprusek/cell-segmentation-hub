// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-testing-only-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only-32-characters-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.DATABASE_URL = 'file:./test.db';
process.env.UPLOAD_DIR = './test-uploads';
process.env.MAX_FILE_SIZE = '10485760';
process.env.STORAGE_TYPE = 'local';

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};