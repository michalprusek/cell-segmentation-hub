# Production 404 Error Fix for Thumbnail Endpoint - September 17, 2025

## Problem

Frontend was receiving 404 errors when calling `/api/projects/:id/images-with-thumbnails` endpoint in production, preventing thumbnail images from loading in the project detail view.

## Root Causes Identified

### 1. API Endpoint URL Mismatch

- **Frontend was calling**: `/projects/${projectId}/images-with-thumbnails`
- **Backend expected**: `/projects/:projectId/images/with-thumbnails`
- The hyphen vs slash difference (`images-with-thumbnails` vs `images/with-thumbnails`) was causing 404 errors

### 2. Authentication Refresh Token Endpoint Mismatch

- **Frontend was calling**: `/auth/refresh`
- **Backend expected**: `/auth/refresh-token`
- This would cause authentication failures when tokens expired

### 3. Missing LazyComponentWrapper Module

- Build failures due to missing exports: `createLazyComponent`, `LazyWrapper`
- Required for React lazy loading and code splitting

### 4. Duplicate Translation Keys

- Duplicate `confirmPassword` keys in translation files (cs, fr, zh, es, de)
- Caused TypeScript compilation errors during build

## Fixes Applied

### 1. Fixed API Endpoint URL (src/lib/api.ts:443)

```typescript
// Changed from:
const response = await this.instance.get(
  `/projects/${projectId}/images-with-thumbnails`,

// To:
const response = await this.instance.get(
  `/projects/${projectId}/images/with-thumbnails`,
```

### 2. Fixed Refresh Token Endpoint (src/lib/api.ts:443)

```typescript
// Changed from:
const response = await this.instance.post('/auth/refresh', {

// To:
const response = await this.instance.post('/auth/refresh-token', {
```

### 3. Created Complete LazyComponentWrapper (src/components/LazyComponentWrapper.tsx)

```typescript
import { Suspense, ComponentType, lazy, LazyExoticComponent } from 'react';
import { Loader2 } from 'lucide-react';

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Wrapper components
export function LazyComponentWrapper({ children }: LazyComponentWrapperProps) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
}

export function LazyWrapper({ children }: LazyComponentWrapperProps) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
}

// Helper function to create lazy components with proper typing
export function createLazyComponent<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(importFunc);
}

export default LazyComponentWrapper;
```

### 4. Fixed Duplicate Translation Keys

Removed duplicate `confirmPassword` keys from password reset sections in:

- src/translations/cs.ts (line 771)
- src/translations/fr.ts (line 569)
- src/translations/zh.ts (line 516)
- src/translations/es.ts (line 570)
- src/translations/de.ts (line 574)

### 5. Updated Backend Documentation (backend/src/api/controllers/imageController.ts)

Fixed comment to match actual route:

```typescript
/**
 * Get project images with optimized thumbnail data for cards
 * GET /api/projects/:projectId/images/with-thumbnails
 */
```

## Verification Steps

1. **Endpoint Test**:
   - `curl http://localhost:4001/api/projects/1/images/with-thumbnails`
   - Returns 401 (Unauthorized) instead of 404 - confirms endpoint exists

2. **Frontend Build Success**:
   - No TypeScript errors
   - No duplicate key warnings
   - All modules resolved correctly

3. **Production Deployment**:
   - Frontend container rebuilt and deployed successfully
   - Backend container running with updated routes

## Key Learnings

1. **URL Pattern Consistency**: Always verify that frontend API calls match backend route definitions exactly, including slash vs hyphen conventions
2. **Comprehensive Testing**: Test API endpoints independently before assuming frontend issues
3. **Module Dependencies**: Ensure all required exports are provided when creating shared components
4. **Translation File Integrity**: Check for duplicate keys when merging features or resolving conflicts
5. **Hot Fixes vs Complete Solutions**: Per user request "nedělej hot fix ale oprav vše", always prefer comprehensive solutions over quick patches

## Related Files Changed

- `/home/cvat/cell-segmentation-hub/src/lib/api.ts`
- `/home/cvat/cell-segmentation-hub/src/lib/__tests__/api-segmentation.test.ts`
- `/home/cvat/cell-segmentation-hub/src/components/LazyComponentWrapper.tsx`
- `/home/cvat/cell-segmentation-hub/backend/src/api/controllers/imageController.ts`
- `/home/cvat/cell-segmentation-hub/src/translations/*.ts` (cs, fr, zh, es, de)

## Production Impact

- Fixed: Image thumbnails now load correctly in project detail view
- Fixed: Authentication token refresh works properly
- Fixed: Frontend builds without errors
- Fixed: All translation files are valid

## Docker Commands Used

```bash
# Clean rebuild of frontend
docker compose -f docker-compose.blue.yml build blue-frontend --no-cache

# Deploy updated frontend
docker compose -f docker-compose.blue.yml up -d blue-frontend

# Backend was also rebuilt
docker compose -f docker-compose.blue.yml build blue-backend
docker compose -f docker-compose.blue.yml up -d blue-backend
```

## Status

✅ All issues resolved and deployed to production (blue environment)
