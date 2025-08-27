# Testing Strategy - Cell Segmentation Hub

**Transferred from ByteRover memories - Testing coverage and strategies**

## Testing Framework Stack

- **Frontend**: Vitest + Testing Library React + JSDOM
- **Backend**: Jest + Supertest for API testing
- **ML Service**: Pytest for Python testing
- **E2E Testing**: Playwright with Chromium
- **Integration**: Docker Compose test environment

## Test Coverage Areas

### Frontend Testing

- **Component Tests**: React components with Testing Library
- **Hook Tests**: Custom hooks with proper mocking
- **Context Tests**: Auth, Theme, Language, Model contexts
- **WebSocket Tests**: Real-time updates with fake timers
- **API Integration**: Axios client with mock responses

### Backend Testing

- **API Endpoints**: RESTful API testing with Supertest
- **Authentication**: JWT token validation and refresh
- **Database**: Prisma ORM with test database
- **WebSocket**: Socket.io event handling
- **File Upload**: Image processing and storage

### ML Service Testing

- **Inference Tests**: Model prediction accuracy
- **Image Processing**: Segmentation algorithms
- **Queue Processing**: Batch job handling
- **Performance**: Processing time and memory usage

### End-to-End Testing

- **User Workflows**: Complete user journeys
- **File Upload**: Image upload and processing
- **Segmentation**: ML inference pipeline
- **Export Functions**: COCO format and Excel exports
- **Real-time Updates**: WebSocket queue notifications

## Testing Environment Configuration

### Docker Test Environment

```yaml
# Ephemeral PostgreSQL for CI
test-db:
  image: postgres:15
  environment:
    POSTGRES_DB: test_spheroseg
    POSTGRES_USER: test
    POSTGRES_PASSWORD: test
  tmpfs:
    - /var/lib/postgresql/data
```

### Playwright Configuration

- **Browser**: Chromium for consistent results
- **Base URL**: Configurable for different environments
- **Timeouts**: Extended timeouts for ML processing
- **Retry Logic**: Automatic retry on transient failures
- **Global Setup**: Service health verification

## Testing Best Practices

### Unit Testing Patterns

```typescript
// Mock API client properly
vi.mock('@/lib/api', () => ({
  default: {
    getProjects: vi.fn(),
    uploadImage: vi.fn(),
  },
}));

// Test hooks with proper cleanup
afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});
```

### Integration Testing

- **Database Setup**: Clean database state per test
- **Service Dependencies**: Wait for all services to be healthy
- **Authentication**: Test with real JWT tokens
- **File Handling**: Use temporary test files

### E2E Testing Strategies

- **Page Object Model**: Reusable page interactions
- **Test Data Management**: Clean test data between runs
- **Visual Testing**: Screenshot comparisons for UI
- **Performance Testing**: Measure loading times
- **Accessibility Testing**: WCAG compliance checks

## Current Testing Gaps (From ByteRover Analysis)

1. **WebSocket Integration**: Need more real-time update tests
2. **ML Model Accuracy**: Systematic model validation tests
3. **File Processing**: Edge cases in image processing
4. **Performance Tests**: Load testing for concurrent users
5. **Security Tests**: Penetration testing of APIs

## CI/CD Integration

- **GitHub Actions**: Automated test execution
- **Docker Compose**: Isolated test environments
- **Test Reports**: Coverage reports and test results
- **Health Checks**: Service readiness verification
- **Parallel Execution**: Tests run in parallel for speed

## Test Commands (Use Desktop Commander for long operations)

```bash
# Unit tests
make test                    # All unit tests
make test-coverage          # With coverage report

# E2E tests
make test-e2e               # Full E2E suite
make test-e2e-ui            # Interactive mode

# Specific test suites
npm run test:frontend       # Frontend only
npm run test:backend        # Backend only
npm run test:ml             # ML service only
```
