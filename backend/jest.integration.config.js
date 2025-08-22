export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/integration/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/db/seed.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/test/**/*'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/src/test/setup.integration.ts'
  ],
  testTimeout: 60000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};