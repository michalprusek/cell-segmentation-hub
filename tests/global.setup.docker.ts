import { chromium } from '@playwright/test';

async function globalSetup() {
  console.log(
    '🚀 Starting global setup for E2E tests in Docker environment...'
  );

  // Services to check - using Docker container ports
  const services = [
    {
      name: 'Frontend (Blue)',
      url: 'http://localhost:4000',
      healthCheck: async (page: any) => {
        const response = await page.goto('http://localhost:4000');
        return response?.status() === 200;
      },
    },
    {
      name: 'Backend API (Blue)',
      url: 'http://localhost:4001/health',
      healthCheck: async (page: any) => {
        const response = await page.goto('http://localhost:4001/health');
        return response?.status() === 200;
      },
    },
    {
      name: 'ML Service (Blue)',
      url: 'http://localhost:4008/health',
      healthCheck: async (page: any) => {
        const response = await page.goto('http://localhost:4008/health');
        return response?.status() === 200;
      },
    },
  ];

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Increase timeouts for Docker environment
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);

  for (const service of services) {
    console.log(`Checking ${service.name}...`);

    let isHealthy = false;
    let attempts = 0;
    const maxAttempts = 30; // More attempts for Docker startup
    const retryDelay = 2000; // 2 seconds between retries

    while (!isHealthy && attempts < maxAttempts) {
      attempts++;
      try {
        isHealthy = await service.healthCheck(page);

        if (isHealthy) {
          console.log(
            `✅ ${service.name} is healthy (attempt ${attempts}/${maxAttempts})`
          );
        } else {
          console.log(
            `⚠️ ${service.name} returned non-200 status (attempt ${attempts}/${maxAttempts})`
          );
        }
      } catch (error: any) {
        console.log(
          `⚠️ ${service.name} is not ready (attempt ${attempts}/${maxAttempts}): ${error.message}`
        );
      }

      if (!isHealthy && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!isHealthy) {
      await browser.close();
      throw new Error(
        `${service.name} failed health check after ${maxAttempts} attempts`
      );
    }
  }

  await browser.close();

  console.log('✅ All services are healthy and ready for E2E tests!');
  console.log('📍 Using Blue environment on ports 4000-4008');

  return async () => {
    console.log('🧹 Global teardown completed');
  };
}

export default globalSetup;
