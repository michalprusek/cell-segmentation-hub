# SphereSeg Testing Guide

Comprehensive testing strategy and implementation guide for the SphereSeg cell segmentation application.

## Overview

SphereSeg implements a complete testing pyramid with the following layers:

- **Unit Tests**: Individual component and function testing
- **Integration Tests**: API, database, and service interaction testing  
- **End-to-End Tests**: Complete user workflow testing
- **Performance Tests**: Load testing and performance benchmarking
- **Security Tests**: Vulnerability scanning and security auditing

## Quick Start

### Running All Tests

```bash
# Start services
make up

# Run complete test suite
npm run test              # Frontend unit tests
cd backend && npm run test # Backend unit tests
cd backend/segmentation && pytest # ML service tests
npm run test:e2e         # End-to-end tests
```

### Running Individual Test Suites

```bash
# Unit Tests
npm run test:coverage              # Frontend with coverage
cd backend && npm run test:coverage # Backend with coverage
cd backend/segmentation && pytest --cov # ML service with coverage

# Integration Tests
cd backend && npm run test:integration

# E2E Tests
npm run test:e2e
npm run test:e2e:ui  # With UI

# Performance Tests
k6 run tests/performance/api-load-test.js

# Security Tests
./tests/security/dependency-audit.sh
python tests/security/zap-baseline-scan.py
```

## Test Architecture

### Frontend Testing (React + TypeScript)

**Stack**: Vitest + React Testing Library + MSW

```typescript
// Component test example
import { render, screen, fireEvent } from '@/test/utils/test-utils'
import { ImageUploader } from '@/components/ImageUploader'

test('should upload file successfully', async () => {
  const onUpload = vi.fn()
  render(<ImageUploader onUpload={onUpload} />)
  
  const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
  const input = screen.getByLabelText(/upload/i)
  
  fireEvent.change(input, { target: { files: [file] } })
  
  await waitFor(() => {
    expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'test.jpg'
    }))
  })
})
```

**Coverage**: 80%+ target for components, hooks, and utilities

### Backend Testing (Node.js + Express)

**Stack**: Jest + Supertest + Prisma mocking

```typescript
// API integration test example
describe('POST /api/projects', () => {
  it('should create project successfully', async () => {
    const response = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Project',
        description: 'Test description'
      })
      .expect(201)
    
    expect(response.body.data.name).toBe('Test Project')
  })
})
```

**Coverage**: 75%+ target for controllers, services, and middleware

### ML Service Testing (Python + FastAPI)

**Stack**: pytest + httpx + pytest-asyncio

```python
# ML API test example
@pytest.mark.asyncio
async def test_segment_image(async_client, sample_image_bytes):
    files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
    data = {"model_name": "hrnet"}
    
    response = await async_client.post("/api/v1/segment", files=files, data=data)
    assert response.status_code == 200
    
    result = response.json()
    assert "polygons" in result
    assert len(result["polygons"]) > 0
```

**Coverage**: 80%+ target for API endpoints, services, and models

## Test Data and Fixtures

### Database Environment Configuration

The application uses different databases per environment for optimal development and testing:

| Environment | Database | Configuration |
|------------|----------|---------------|
| **Development** | SQLite | `file:./data/dev.db` - Fast local development |
| **Testing (Local)** | In-Memory SQLite | `file::memory:?cache=shared` - Isolated test runs |
| **CI/Integration** | PostgreSQL 15 | Service container - Production parity |
| **Production** | PostgreSQL | Managed service - Full features |

**Schema Consistency**: All environments use identical Prisma schema. Migrations ensure compatibility across SQLite and PostgreSQL.

### Database Fixtures

```typescript
// Using test fixtures
import { testHelpers } from '@/tests/fixtures/database-seed'

const user = await testHelpers.createAuthenticatedUser()
const project = await testHelpers.createTestProject(user.id)
const { image, segmentationResult } = await testHelpers.createTestImageWithSegmentation(project.id)
```

### Test Images

```bash
# Generate synthetic test images
python tests/fixtures/generate-test-images.py

# Creates various image types:
# - sparse_cells.jpg (few cells, easy case)
# - dense_cells.jpg (many overlapping cells)
# - elongated_cells.jpg (non-circular cells)
# - poor_quality.jpg (challenging case)
```

### Mock Data

```typescript
// Access predefined mock responses
import { testData } from '@/tests/fixtures/test-data.json'

const mockResponse = testData.mockResponses.authSuccess
const testPolygons = testData.samplePolygons.circular
const testScenario = testData.testScenarios.authentication.validUser
```

## Performance Testing

### K6 Load Testing

```javascript
// API load test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up
    { duration: '5m', target: 10 },  // Sustained load
    { duration: '2m', target: 20 },  // Peak load
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% under 2s
    http_req_failed: ['rate<0.1'],     // <10% errors
  },
}
```

### Performance Benchmarks

- **API Response Time**: p95 < 2000ms
- **ML Inference Time**: 
  - HRNet: ~3.1s
  - ResUNet Small: ~6.9s
  - ResUNet Advanced: ~18.1s
- **File Upload**: <30s for 10MB images
- **Database Queries**: <100ms for most operations

## Security Testing

### Dependency Auditing

```bash
# Automated dependency security check
./tests/security/dependency-audit.sh

# Checks:
# - npm audit (frontend & backend)
# - Python safety check (ML service)
# - Docker image vulnerabilities (trivy)
# - Hardcoded secrets scanning
```

### OWASP ZAP Integration

```bash
# Comprehensive security scan
python tests/security/zap-baseline-scan.py \
  --target http://localhost:3000 \
  --api http://localhost:3001

# Features:
# - Spider scan for URL discovery
# - Active security testing
# - Authenticated scanning
# - Automated reporting
```

### Security Test Coverage

- **Authentication**: JWT validation, session management
- **Authorization**: Role-based access control
- **Input Validation**: SQL injection, XSS prevention
- **File Upload**: Type validation, size limits
- **API Security**: Rate limiting, CORS, security headers

## End-to-End Testing

### Playwright Configuration

```typescript
// playwright.config.ts highlights
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
```

### E2E Test Scenarios

1. **Authentication Flow**
   - User registration
   - Login/logout
   - Session persistence
   - Password validation

2. **Project Management**
   - Project creation/editing/deletion
   - Project listing and filtering
   - Access control

3. **Image Processing Workflow**
   - Image upload
   - Segmentation processing
   - Results visualization
   - Export functionality

4. **Error Handling**
   - Network errors
   - Invalid file types
   - Processing failures

## CI/CD Integration

### GitHub Actions Pipeline

```yaml
# .github/workflows/ci.yml structure
jobs:
  lint:         # Code quality checks
  test-frontend: # Frontend unit tests  
  test-backend:  # Backend unit tests
  test-ml:      # ML service tests
  test-integration: # API integration tests
  test-e2e:     # End-to-end tests
  security-scan: # Security testing
  build:        # Docker builds
  performance:  # Performance testing
  deploy:       # Staging/production deployment
```

### Quality Gates

- **All unit tests pass** (required)
- **Integration tests pass** (required)  
- **E2E tests pass** (required)
- **Security scan passes** (no high-risk findings)
- **Performance benchmarks met** (staging only)
- **Code coverage >80%** (recommended)

## Test Environment Setup

### Local Development

```bash
# Setup test environment
make dev-setup

# Run with test data
tsx tests/fixtures/database-seed.ts seed
python tests/fixtures/generate-test-images.py
```

### Docker Testing

```bash
# Test with Docker Compose
docker-compose -f docker-compose.test.yml up -d

# Health checks
curl http://localhost:3001/health
curl http://localhost:8000/health
```

### CI Environment

The CI environment uses production-like infrastructure to catch environment-specific issues:

- **Database**: PostgreSQL 15 (service container) - mirrors production database engine
- **Cache**: Redis (service container)
- **Node**: 18.x LTS
- **Python**: 3.11
- **Browser**: Playwright browsers (Chromium, Firefox, WebKit)

**Note**: This differs from local development which uses SQLite for simplicity. The schema is identical across environments via Prisma migrations.

## Test Reporting

### Coverage Reports

- **Frontend**: Vitest coverage → Codecov
- **Backend**: Jest coverage → Codecov  
- **ML Service**: pytest-cov → Codecov
- **Overall**: Combined coverage dashboard

### Test Results

- **Unit Tests**: JUnit XML format
- **E2E Tests**: HTML reports with screenshots/videos
- **Performance**: K6 HTML reports
- **Security**: JSON reports + HTML dashboards

### Monitoring

- **Test Execution Time**: Track test suite performance
- **Flaky Test Detection**: Identify unstable tests
- **Coverage Trends**: Monitor coverage changes over time
- **Security Findings**: Track vulnerability remediation

## Best Practices

### Writing Tests

1. **Follow AAA Pattern**: Arrange, Act, Assert
2. **Use Descriptive Names**: Test behavior, not implementation
3. **Keep Tests Independent**: No shared state between tests
4. **Mock External Dependencies**: Focus on unit under test
5. **Test Edge Cases**: Happy path + error conditions

### Test Maintenance

1. **Regular Updates**: Keep test data and fixtures current
2. **Remove Obsolete Tests**: Clean up unused test code
3. **Monitor Coverage**: Maintain target coverage levels
4. **Review Test Failures**: Address flaky or failing tests promptly

### Performance Guidelines

1. **Parallel Execution**: Run tests concurrently when possible
2. **Selective Testing**: Use test tags for focused runs
3. **Resource Management**: Clean up test data and connections
4. **Fast Feedback**: Prioritize unit tests in CI pipeline

## Troubleshooting

### Common Issues

**Tests fail in CI but pass locally**
- Check environment variables and dependencies
- Verify database setup and migrations
- Review timing issues (add appropriate waits)

**Flaky E2E tests**  
- Add explicit waits for async operations
- Use data-testid attributes for reliable selectors
- Mock external services when possible

**High test execution time**
- Profile slow tests and optimize
- Increase parallelization
- Use test filtering for faster feedback

**Coverage gaps**
- Identify untested code paths
- Add tests for critical business logic
- Remove dead code

### Getting Help

- **Test Framework Docs**: Vitest, Jest, Playwright, pytest
- **CI/CD Issues**: Check GitHub Actions logs
- **Performance Problems**: Review K6 documentation
- **Security Questions**: OWASP ZAP guides

## Metrics and KPIs

### Test Metrics

- **Test Coverage**: >80% target
- **Test Execution Time**: <10 minutes full suite
- **Test Reliability**: <1% flaky test rate
- **Bug Detection Rate**: Tests catch 90%+ of regressions

### Quality Metrics

- **Security Issues**: Zero high-risk findings
- **Performance Regression**: <10% degradation threshold  
- **API Reliability**: 99.9% uptime in tests
- **User Experience**: All critical paths tested