import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const authTrend = new Trend('auth_duration', true);
const apiTrend = new Trend('api_duration', true);

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up to 10 users
    { duration: '5m', target: 10 }, // Stay at 10 users
    { duration: '2m', target: 20 }, // Ramp up to 20 users
    { duration: '5m', target: 20 }, // Stay at 20 users
    { duration: '2m', target: 0 }, // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should be below 2s
    http_req_failed: ['rate<0.1'], // Error rate should be below 10%
    errors: ['rate<0.1'], // Custom error rate should be below 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// Test data
const TEST_USER = {
  email: `load-test-${Math.random().toString(36).substring(7)}@example.com`,
  password: 'loadtest123',
  firstName: 'Load',
  lastName: 'Test',
};

// Note: Global variables removed - data now passed from setup() function to ensure
// proper Virtual User isolation in K6

export function setup() {
  // Register test user for load testing
  const registerPayload = JSON.stringify(TEST_USER);

  const registerResponse = http.post(
    `${BASE_URL}/api/auth/register`,
    registerPayload,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (registerResponse.status === 201 || registerResponse.status === 409) {
    // Login to get tokens
    const loginPayload = JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    const loginResponse = http.post(
      `${BASE_URL}/api/auth/login`,
      loginPayload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (loginResponse.status === 200) {
      const loginData = JSON.parse(loginResponse.body);

      // Create a test project for shared use across VUs
      const projectPayload = JSON.stringify({
        name: `Shared Load Test Project ${Math.random().toString(36).substring(7)}`,
        description: 'Shared project for load testing',
      });

      const projectResponse = http.post(
        `${BASE_URL}/api/projects`,
        projectPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${loginData.data.accessToken}`,
          },
        }
      );

      let testProjectId = null;
      if (projectResponse.status === 201) {
        const projectData = JSON.parse(projectResponse.body);
        testProjectId = projectData.data.id;
      }

      return {
        authToken: loginData.data.accessToken,
        refreshToken: loginData.data.refreshToken,
        testProjectId: testProjectId,
      };
    }
  }

  throw new Error('Failed to setup test user');
}

export default function (data) {
  const { authToken: token, refreshToken: refresh, testProjectId } = data;

  // Test 1: Health check
  const healthResponse = http.get(`${BASE_URL}/health`);
  check(healthResponse, {
    'health check status is 200': r => r.status === 200,
    'health check response time < 500ms': r => r.timings.duration < 500,
  });

  // Test 2: Authentication endpoints
  testAuthentication();

  // Test 3: Projects API
  testProjectsAPI(token);

  // Test 4: File upload simulation
  testFileUpload(token);

  // Test 5: Concurrent requests
  testConcurrentRequests(token);

  sleep(1); // Wait 1 second between iterations
}

function testAuthentication() {
  const loginStart = new Date();

  const loginPayload = JSON.stringify({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  const loginResponse = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const loginDuration = new Date() - loginStart;
  authTrend.add(loginDuration);

  const loginSuccess = check(loginResponse, {
    'login status is 200': r => r.status === 200,
    'login has access token': r => {
      if (r.status === 200) {
        const body = JSON.parse(r.body);
        return body.data && body.data.accessToken;
      }
      return false;
    },
    'login response time < 1000ms': r => r.timings.duration < 1000,
  });

  errorRate.add(!loginSuccess);
}

function testProjectsAPI(token) {
  if (!token) return;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Get projects list
  const projectsStart = new Date();
  const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });
  const projectsDuration = new Date() - projectsStart;
  apiTrend.add(projectsDuration);

  const projectsSuccess = check(projectsResponse, {
    'get projects status is 200': r => r.status === 200,
    'get projects response time < 1000ms': r => r.timings.duration < 1000,
    'get projects returns array': r => {
      if (r.status === 200) {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data);
      }
      return false;
    },
  });

  errorRate.add(!projectsSuccess);

  // Create a project
  const projectPayload = JSON.stringify({
    name: `Load Test Project ${Math.random().toString(36).substring(7)}`,
    description: 'Project created during load testing',
  });

  const createResponse = http.post(`${BASE_URL}/api/projects`, projectPayload, {
    headers,
  });

  const createSuccess = check(createResponse, {
    'create project status is 201': r => r.status === 201,
    'create project response time < 2000ms': r => r.timings.duration < 2000,
    'create project returns project data': r => {
      if (r.status === 201) {
        const body = JSON.parse(r.body);
        return body.data && body.data.id;
      }
      return false;
    },
  });

  errorRate.add(!createSuccess);

  // Get specific project if creation succeeded
  if (createResponse.status === 201) {
    const projectData = JSON.parse(createResponse.body);
    const projectId = projectData.data.id;

    const getProjectResponse = http.get(
      `${BASE_URL}/api/projects/${projectId}`,
      { headers }
    );

    const getProjectSuccess = check(getProjectResponse, {
      'get project status is 200': r => r.status === 200,
      'get project response time < 1000ms': r => r.timings.duration < 1000,
    });

    errorRate.add(!getProjectSuccess);

    // Update project
    const updatePayload = JSON.stringify({
      name: `Updated Load Test Project ${Math.random().toString(36).substring(7)}`,
      description: 'Updated during load testing',
    });

    const updateResponse = http.put(
      `${BASE_URL}/api/projects/${projectId}`,
      updatePayload,
      { headers }
    );

    const updateSuccess = check(updateResponse, {
      'update project status is 200': r => r.status === 200,
      'update project response time < 2000ms': r => r.timings.duration < 2000,
    });

    errorRate.add(!updateSuccess);

    // Delete project (cleanup)
    const deleteResponse = http.del(
      `${BASE_URL}/api/projects/${projectId}`,
      null,
      { headers }
    );

    const deleteSuccess = check(deleteResponse, {
      'delete project status is 200': r => r.status === 200,
      'delete project response time < 1000ms': r => r.timings.duration < 1000,
    });

    errorRate.add(!deleteSuccess);
  }
}

function testFileUpload(token) {
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  // First create a project for file upload
  const projectPayload = JSON.stringify({
    name: `Upload Test Project ${Math.random().toString(36).substring(7)}`,
    description: 'Project for upload testing',
  });

  const createResponse = http.post(`${BASE_URL}/api/projects`, projectPayload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (createResponse.status === 201) {
    const projectData = JSON.parse(createResponse.body);
    const projectId = projectData.data.id;

    // Simulate file upload with dummy data
    // Note: This will likely fail with 400 since we're using dummy data,
    // but we now only accept 201 status to ensure proper validation
    const fileData = 'dummy-image-data-for-load-testing';
    const formData = {
      image: http.file(fileData, 'test-image.jpg', 'image/jpeg'),
    };

    const uploadResponse = http.post(
      `${BASE_URL}/api/projects/${projectId}/images`,
      formData,
      { headers }
    );

    const uploadSuccess = check(uploadResponse, {
      'file upload status is 201': r => r.status === 201, // Only accept successful uploads
      'file upload response time < 5000ms': r => r.timings.duration < 5000,
    });

    errorRate.add(!uploadSuccess);

    // Cleanup: delete the project
    http.del(`${BASE_URL}/api/projects/${projectId}`, null, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }
}

function testConcurrentRequests(token) {
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  // Make multiple concurrent requests to test server capacity
  const requests = [
    {
      method: 'GET',
      url: `${BASE_URL}/api/projects`,
      params: { headers: headers },
    },
    {
      method: 'GET',
      url: `${BASE_URL}/health`,
      params: { headers: {} },
    },
    {
      method: 'GET',
      url: `${BASE_URL}/api/endpoints`,
      params: { headers: {} },
    },
    {
      method: 'GET',
      url: `${BASE_URL}/api/health/endpoints`,
      params: { headers: {} },
    },
  ];

  const responses = http.batch(requests);

  responses.forEach((response, index) => {
    const success = check(response, {
      [`concurrent request ${index} status < 400`]: r => r.status < 400,
      [`concurrent request ${index} response time < 2000ms`]: r =>
        r.timings.duration < 2000,
    });

    errorRate.add(!success);
  });
}

export function teardown(data) {
  // Cleanup: delete shared test project and logout
  if (data.authToken && data.testProjectId) {
    http.del(`${BASE_URL}/api/projects/${data.testProjectId}`, null, {
      headers: {
        Authorization: `Bearer ${data.authToken}`,
      },
    });
  }

  if (data.refreshToken) {
    const logoutPayload = JSON.stringify({
      refreshToken: data.refreshToken,
    });

    http.post(`${BASE_URL}/api/auth/logout`, logoutPayload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

// Additional test scenarios

export function apiStressTest() {
  return {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 50 }, // Ramp up to 50 users
      { duration: '3m', target: 50 }, // Stay at 50 users
      { duration: '1m', target: 100 }, // Ramp up to 100 users
      { duration: '3m', target: 100 }, // Stay at 100 users
      { duration: '2m', target: 0 }, // Ramp down
    ],
    env: { SCENARIO: 'stress' },
  };
}

export function apiSpikeTest() {
  return {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 10 }, // Normal load
      { duration: '30s', target: 200 }, // Spike to 200 users
      { duration: '1m', target: 200 }, // Stay at spike
      { duration: '30s', target: 10 }, // Return to normal
      { duration: '2m', target: 10 }, // Stay at normal
    ],
    env: { SCENARIO: 'spike' },
  };
}

export function apiSoakTest() {
  return {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5m', target: 20 }, // Ramp up
      { duration: '30m', target: 20 }, // Stay for extended period
      { duration: '5m', target: 0 }, // Ramp down
    ],
    env: { SCENARIO: 'soak' },
  };
}
