# TypeScript Types Documentation

This directory contains comprehensive TypeScript type definitions for the backend API, ensuring type safety across controllers, services, and data validation.

## Type Organization

### `/validation.ts`

Contains **Zod schemas** and their corresponding TypeScript types for request validation:

- **Project types**: `CreateProjectData`, `UpdateProjectData`, `ProjectQueryParams`
- **Image types**: `ImageUploadData`, `ImageQueryParams`, `ImageBatchDeleteData`
- **Sharing types**: `ShareByEmailData`, `ShareByLinkData`
- **Queue types**: `AddImageToQueueData`, `AddBatchToQueueData`, `QueueCleanupData`

### `/queue.ts`

Contains **queue-specific interfaces** for controllers and WebSocket communication:

- **Response types**: `QueueEntryResponse`, `BatchQueueResponse`, `QueueStatsResponse`
- **WebSocket types**: `SegmentationUpdateData`, `QueueStatsUpdateData`
- **Request extensions**: `QueueControllerRequest`
- **Error classes**: `QueueValidationError`, `QueueAccessError`

### `/auth.ts`

Contains **authentication-related types**:

- **User profiles**: `UserProfile` with complete user data
- **Request extensions**: `AuthRequest` extending Express Request with user context

### `/index.ts`

Contains **common API response types**:

- **Generic responses**: `ApiResponse<T>`, `PaginatedResponse<T>`
- **Error handling**: `ApiError` interface

## Usage Patterns

### 1. Controller Method Typing

**Before (untyped):**

```typescript
addToQueue = async (req: Request, res: Response): Promise<void> => {
  const { model = 'hrnet', threshold = 0.5 } = req.body; // No validation
};
```

**After (typed):**

```typescript
interface AddImageToQueueRequest
  extends Request<ImageIdParams, unknown, AddImageToQueueData> {
  user: QueueControllerRequest['user'];
}

addToQueue = async (
  req: AddImageToQueueRequest,
  res: Response
): Promise<void> => {
  const { model, threshold } = req.body; // Fully typed and validated
};
```

### 2. WebSocket Event Typing

**Before (untyped):**

```typescript
websocketService.emitSegmentationUpdate(userId, {
  imageId: imageId as string, // Type assertion needed
  status: 'queued', // No validation
});
```

**After (typed):**

```typescript
const segmentationUpdate: SegmentationUpdateData = {
  imageId: imageId, // No casting needed
  projectId: image.projectId,
  status: 'queued', // Type-checked
  queueId: queueEntry.id,
};
websocketService.emitSegmentationUpdate(userId, segmentationUpdate);
```

### 3. Response Data Typing

**Before (untyped):**

```typescript
ResponseHelper.success(
  res,
  {
    queuedCount: queueEntries.length,
    // Missing type safety
  },
  'Success message'
);
```

**After (typed):**

```typescript
const batchResponse: BatchQueueResponse = {
  queuedCount: queueEntries.length,
  totalRequested: imageIds.length,
  queueEntries: queueEntries.map(entry => ({
    // Fully typed transformation
    id: entry.id,
    imageId: entry.imageId,
    // ... complete type safety
  })),
};
ResponseHelper.success(res, batchResponse, 'Success message');
```

## Validation Integration

### Zod Schema Usage

All request body data uses **Zod schemas** for runtime validation:

```typescript
// Schema definition
export const addImageToQueueSchema = z.object({
  model: z
    .enum(['hrnet', 'resunet_advanced', 'resunet_small'])
    .optional()
    .default('hrnet'),
  threshold: z.number().min(0.1).max(1.0).optional().default(0.5),
  priority: z.number().int().min(0).max(10).optional().default(0),
  detectHoles: z.boolean().optional().default(true),
});

// Type inference
export type AddImageToQueueData = z.infer<typeof addImageToQueueSchema>;
```

### Middleware Integration

**Recommended middleware pattern:**

```typescript
import { addImageToQueueSchema } from '../../types/validation';
import { validateBody } from '../../middleware/validation';

// Route with validation
router.post(
  '/images/:imageId',
  validateBody(addImageToQueueSchema),
  queueController.addImageToQueue
);
```

## Type Safety Benefits

### 1. **Compile-time Validation**

- TypeScript catches type mismatches during development
- No more `req.body` property access errors
- IntelliSense provides autocomplete for all properties

### 2. **Runtime Validation**

- Zod schemas validate incoming request data
- Automatic error messages in Czech language
- Prevents invalid data from reaching controllers

### 3. **Consistent API Contracts**

- All endpoints follow same typing patterns
- WebSocket events have guaranteed structure
- Response data is predictably shaped

### 4. **Developer Experience**

- Clear interfaces make API behavior obvious
- Easy refactoring with TypeScript's rename capabilities
- Reduced debugging time for type-related issues

## Model Type Aliases

For consistency across the application, use these predefined type aliases:

```typescript
// Segmentation models
export type SegmentationModel = 'hrnet' | 'resunet_advanced' | 'resunet_small';

// Queue status values
export type QueueStatus = 'queued' | 'processing' | 'completed' | 'failed';

// Priority levels (0-10)
export type QueuePriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
```

## Error Handling

Specialized error classes for different failure scenarios:

```typescript
// Validation errors (400 Bad Request)
throw new QueueValidationError('Invalid threshold value', 'threshold');

// Access control errors (403 Forbidden)
throw new QueueAccessError('Project access denied', projectId);

// Capacity errors (429 Too Many Requests)
throw new QueueCapacityError('Queue at capacity', currentSize, maxSize);
```

## Best Practices

### ✅ **DO**

- Always use typed request interfaces for controllers
- Validate all input data with Zod schemas
- Use specific error classes for different failure types
- Type WebSocket event data explicitly
- Include comprehensive JSDoc comments

### ❌ **DON'T**

- Use `any` or `unknown` for request bodies
- Skip validation for "internal" endpoints
- Use type assertions (`as string`) unless absolutely necessary
- Mix validation logic with business logic
- Leave response data untyped

## Integration Example

Complete example showing proper usage:

```typescript
// types/validation.ts
export const addImageToQueueSchema = z.object({
  model: z
    .enum(['hrnet', 'resunet_advanced', 'resunet_small'])
    .default('hrnet'),
  threshold: z.number().min(0.1).max(1.0).default(0.5),
  detectHoles: z.boolean().default(true),
});
export type AddImageToQueueData = z.infer<typeof addImageToQueueSchema>;

// controllers/queueController.ts
interface AddImageToQueueRequest
  extends Request<ImageIdParams, unknown, AddImageToQueueData> {
  user: QueueControllerRequest['user'];
}

addImageToQueue = async (
  req: AddImageToQueueRequest,
  res: Response
): Promise<void> => {
  const { model, threshold, detectHoles } = req.body; // Fully typed!

  // ... business logic

  const segmentationUpdate: SegmentationUpdateData = {
    imageId: req.params.imageId,
    status: 'queued',
    queueId: queueEntry.id,
  };
  websocketService.emitSegmentationUpdate(userId, segmentationUpdate);
};
```

This typing system ensures **complete type safety** from HTTP request to database operations to WebSocket events, making the API more reliable and easier to maintain.
