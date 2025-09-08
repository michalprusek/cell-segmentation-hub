/**
 * Global setup for Playwright E2E tests
 * Ensures all services are healthy before running tests
 */

const SERVICES = [
  { name: 'Frontend', url: 'http://localhost:3000', expectedText: '' },
  {
    name: 'Backend API',
    url: 'http://localhost:3001/health',
    expectedText: '"status":"healthy"',
  },
  {
    name: 'ML Service',
    url: 'http://localhost:8000/health',
    expectedText: '"status":"healthy"',
  },
];

async function verifyServiceHealth(
  service: (typeof SERVICES)[0]
): Promise<void> {
  const maxRetries = 20; // Increased from 10
  const retryDelay = 3000; // Increased to 3 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${attempt}/${maxRetries}] Checking ${service.name}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(service.url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (service.expectedText) {
        const text = await response.text();
        if (!text.includes(service.expectedText)) {
          throw new Error(
            `Response doesn't contain expected text: ${service.expectedText}`
          );
        }
      }

      console.log(`✓ ${service.name} is healthy`);
      return; // Success!
    } catch (error) {
      console.log(`✗ ${service.name} check failed: ${error.message}`);

      if (attempt === maxRetries) {
        throw new Error(
          `${service.name} failed health check after ${maxRetries} attempts: ${error.message}`
        );
      }

      console.log(`Waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

async function globalSetup(): Promise<void> {
  console.log(
    '🔍 Verifying all services are healthy before running E2E tests...'
  );

  for (const service of SERVICES) {
    await verifyServiceHealth(service);
  }

  console.log('✅ All services are healthy! Starting E2E tests...');
}

export default globalSetup;
