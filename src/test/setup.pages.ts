/**
 * Minimal test setup for page-level tests.
 * Uses only @testing-library/jest-dom — skips the vi.clearAllTimers() afterEach
 * from src/test/setup.ts which clears vitest's internal timeout tracking and
 * causes the runner to crash between tests in memory-heavy environments.
 */
import '@testing-library/jest-dom';
