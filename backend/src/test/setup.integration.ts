// Integration test setup - use real services, no mocks

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'
process.env.HOST = 'localhost'
// Generate proper 64-character hex strings for JWT secrets (32 bytes each)
process.env.JWT_ACCESS_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

// Use the CI/CD database URL if available, otherwise fallback to local test DB
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://postgres:testpass@localhost:5432/testdb'

process.env.REDIS_URL = 'redis://localhost:6379'
process.env.ML_SERVICE_URL = 'http://localhost:8000'
process.env.FROM_EMAIL = 'test@example.com'
process.env.UPLOAD_DIR = './uploads'
process.env.EMAIL_SERVICE = 'smtp'
process.env.SMTP_HOST = 'localhost'
process.env.SMTP_PORT = '587'
process.env.SMTP_USER = 'test'
process.env.SMTP_PASS = 'test'

// Suppress console logs during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: () => {},
    warn: () => {},
    error: () => {},
  }
}

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});