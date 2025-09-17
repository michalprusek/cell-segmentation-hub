# Batch API Validation Schema Fix - September 7, 2025

## Problem Summary

**Issue**: POST requests to `/api/queue/batch` were failing with 400 Bad Request due to validation errors.

**Root Cause**: Critical mismatch between validation schema and type definitions:

1. **Validation Schema** (`/backend/src/types/validation.ts` line 15):

   ```typescript
   z.enum(['hrnet', 'cbam_resunet', 'unet_spherohq']);
   ```

2. **Queue Type Definition** (`/backend/src/types/queue.ts` line 18):
   ```typescript
   'hrnet' |
     'cbam_resunet' |
     'unet_spherohq' |
     'resunet_advanced' |
     'resunet_small';
   ```

**Impact**: Frontend requests using `resunet_advanced` or `resunet_small` models were being rejected with validation errors, even though these models were defined in the TypeScript types.

## Solution Applied

### 1. Fixed Validation Schema Mismatch

**File**: `/home/cvat/spheroseg-app/backend/src/types/validation.ts`

**Changed**:

```typescript
// BEFORE (line 15-17):
export const segmentationModelSchema = z.enum(
  ['hrnet', 'cbam_resunet', 'unet_spherohq'],
  {
    errorMap: () => ({
      message: 'Model musí být hrnet, cbam_resunet nebo unet_spherohq',
    }),
  }
);

// AFTER:
export const segmentationModelSchema = z.enum(
  [
    'hrnet',
    'cbam_resunet',
    'unet_spherohq',
    'resunet_advanced',
    'resunet_small',
  ],
  {
    errorMap: () => ({
      message:
        'Model musí být hrnet, cbam_resunet, unet_spherohq, resunet_advanced nebo resunet_small',
    }),
  }
);
```

### 2. Enhanced Validation Error Logging

**File**: `/home/cvat/spheroseg-app/backend/src/middleware/validation.ts`

**Added comprehensive logging** to capture validation failures:

```typescript
// Enhanced logging for validation errors with request details
logger.warn('Validation failed', undefined, 'ValidationMiddleware', {
  target: target,
  url: req.url,
  method: req.method,
  userId: (req as any).user?.id,
  validationErrors: errors,
  receivedData: data,
  errorCount: error.errors.length,
});
```

This will help debug future validation issues by providing:

- Request URL and method
- User ID (if authenticated)
- Detailed validation errors
- Actual data received
- Error count

## Expected API Behavior

### Valid Requests

All these model values should now be accepted by validation:

- `hrnet`
- `cbam_resunet`
- `unet_spherohq`
- `resunet_advanced` (legacy)
- `resunet_small` (legacy)

### Required Request Format

```json
{
  "imageIds": ["uuid1", "uuid2"],  // Required: Array of 1-100 UUIDs
  "projectId": "uuid",             // Required: Valid UUID
  "model": "hrnet|cbam_resunet|unet_spherohq|resunet_advanced|resunet_small",  // Optional
  "threshold": 0.1-0.9,            // Optional: Float
  "priority": 0-10,                // Optional: Integer
  "forceResegment": true|false,    // Optional: Boolean
  "detectHoles": true|false        // Optional: Boolean
}
```

## Testing Results

✅ **All 5 model types** now pass validation
✅ **Enhanced error logging** provides detailed debugging information
✅ **Authentication still works** (requests without valid JWT get 401)
✅ **Validation order preserved** (auth → validation → controller)

## Key Lessons Learned

1. **Schema Synchronization**: Validation schemas must be kept in sync with TypeScript type definitions
2. **Model Evolution**: When adding new models (like `unet_spherohq`), both types AND validation schemas need updates
3. **Middleware Order**: Authentication runs before validation, so invalid requests from unauthenticated users get 401, not 400
4. **Legacy Support**: Old model names (`resunet_advanced`, `resunet_small`) must be maintained for backward compatibility
5. **Error Logging**: Detailed validation logging is crucial for debugging client integration issues

## Prevention Strategy

1. **Code Reviews**: Always check both types and validation schemas when adding new models
2. **Tests**: Add validation tests for new model types
3. **Documentation**: Update API documentation when model options change
4. **Monitoring**: Use the enhanced logging to detect validation patterns

## Related Files Modified

- `/backend/src/types/validation.ts` - Fixed model enum to include all 5 models
- `/backend/src/middleware/validation.ts` - Added comprehensive error logging

## Verification

The fix can be verified by:

1. Checking backend logs for validation errors (should disappear for valid model names)
2. Testing API with all 5 model types
3. Confirming enhanced logging captures request details on validation failures

## Future Considerations

1. **Model Deprecation**: Consider removing legacy models (`resunet_advanced`, `resunet_small`) if they're no longer used
2. **Schema Generation**: Consider generating validation schemas from TypeScript types to prevent mismatches
3. **API Versioning**: Consider API versioning when making model changes
