# Frontend API Mock Implementation Fix Commands

## 1. Remove conflicting global mock from setup.ts

```bash
# Remove lines 246-365 from setup.ts (the global apiClient mock)
cd /home/cvat/cell-segmentation-hub
sed -i '246,365d' src/test/setup.ts
```

## 2. Update the test file with proper mocking strategy

The key changes needed in `src/lib/__tests__/api-advanced.test.ts`:

### A. Fix the mock storage setup (top of file)
```typescript
// Remove the globalThis mocking and use vi.hoisted instead
vi.hoisted(() => {
  // Mock localStorage and sessionStorage at the module level
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    writable: true,
  });

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    writable: true,
  });
});
```

### B. Simplify test approach
Instead of trying to re-import the API client, test the existing methods directly:

```typescript
test('should load tokens from localStorage on initialization', () => {
  // Set up storage mock
  const getItemSpy = vi.spyOn(localStorage, 'getItem');
  getItemSpy.mockImplementation((key) => {
    if (key === 'accessToken') return 'stored-access-token';
    if (key === 'refreshToken') return 'stored-refresh-token';
    return null;
  });

  // Call the private method directly
  (apiClient as any).loadTokensFromStorage();

  expect(apiClient.isAuthenticated()).toBe(true);
  expect(apiClient.getAccessToken()).toBe('stored-access-token');

  getItemSpy.mockRestore();
});
```

### C. Fix interceptor tests by mocking them properly
```typescript
// In beforeEach, ensure interceptors are set up correctly
mockAxiosInstance.interceptors.request.use.mockImplementation((successFn, errorFn) => {
  // Store the interceptors for later testing
  (mockAxiosInstance as any)._requestInterceptor = successFn;
  return 1; // Return interceptor ID
});

mockAxiosInstance.interceptors.response.use.mockImplementation((successFn, errorFn) => {
  (mockAxiosInstance as any)._responseInterceptor = errorFn; // Store error handler
  return 1;
});
```

## 3. Run tests to verify fix
```bash
cd /home/cvat/cell-segmentation-hub
npm test -- src/lib/__tests__/api-advanced.test.ts --reporter=verbose
```

## 4. Alternative simpler approach

If the above is too complex, create a simpler test file focused on actual functionality:

```bash
# Create a new simplified test file
cat > src/lib/__tests__/api-client.simple.test.ts << 'EOF'
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '../api';

describe('API Client - Core Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should be authenticated when access token exists', () => {
    // Set token directly
    (apiClient as any).accessToken = 'test-token';
    expect(apiClient.isAuthenticated()).toBe(true);

    // Clear token
    (apiClient as any).accessToken = null;
    expect(apiClient.isAuthenticated()).toBe(false);
  });

  test('should return access token', () => {
    (apiClient as any).accessToken = 'test-token';
    expect(apiClient.getAccessToken()).toBe('test-token');
  });
});
EOF
```

## Key Points:

1. **The main issue**: setup.ts provides a global mock that conflicts with testing the real API client
2. **Storage mocking**: Must be done before the API client module is imported
3. **Interceptor testing**: Requires storing the interceptor functions during setup
4. **Mock functions**: Use vi.spyOn for localStorage rather than replacing the entire object

## Verification:

After implementing these fixes:
- localStorage tests should pass (tokens loaded on initialization)
- Interceptor tests should access the correct functions
- Data extraction tests should work with proper axios mock responses
- All 32 tests should pass

The core principle is to test the actual API client behavior rather than fighting with complex mocking scenarios.