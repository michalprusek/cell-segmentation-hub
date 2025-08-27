# TypeScript Patterns & Common Fixes - Cell Segmentation Hub

**Transferred from ByteRover memories - TypeScript error resolution and patterns**

## Common TypeScript Issues & Solutions

### Prisma Client Type Safety

```typescript
// ❌ Common error - Missing Prisma relations
const user = await prisma.user.findUnique({
  where: { id: userId },
  // Missing include/select causes type errors
});

// ✅ Correct - Explicit relations
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    profile: true,
    projects: {
      include: {
        images: true,
      },
    },
  },
});
```

### Interface Compatibility Fixes

```typescript
// Backend interface alignment
interface ApiProject extends Project {
  image_count?: number;
  created_at: string;
  updated_at: string;
}

// Frontend mapping for consistency
const formatProject = (apiProject: ApiProject): Project => ({
  ...apiProject,
  title: apiProject.name,
  imageCount: apiProject.image_count || 0,
  createdAt: new Date(apiProject.created_at),
  updatedAt: new Date(apiProject.updated_at),
});
```

### WebSocket Type Safety

```typescript
// Typed WebSocket events
interface WebSocketEvents {
  segmentationStatus: (data: {
    imageId: string;
    status: SegmentationStatus;
    projectId: string;
  }) => void;

  queueStats: (stats: {
    processing: number;
    queued: number;
    total: number;
  }) => void;
}

// Usage with proper typing
const socket: Socket<WebSocketEvents> = io(wsUrl);
```

### Auth Middleware Type Safety

```typescript
// Extended Request interface
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

// Middleware with proper types
const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  // ... validation logic
};
```

## React Hook Patterns & Dependencies

### Proper Dependency Arrays

```typescript
// ❌ Missing dependencies cause stale closures
const fetchData = useCallback(() => {
  apiClient.getData(userId); // userId not in deps
}, []); // ESLint exhaustive-deps warning

// ✅ Complete dependencies
const fetchData = useCallback(() => {
  if (!userId) return;
  apiClient.getData(userId);
}, [userId]);

// ✅ Using refs to avoid dependencies
const userIdRef = useRef(userId);
userIdRef.current = userId;

const fetchData = useCallback(() => {
  apiClient.getData(userIdRef.current);
}, []); // No deps needed with ref
```

### Fast Refresh Compatibility

```typescript
// ❌ Anonymous functions break Fast Refresh
export default () => {
  return <div>Component</div>;
};

// ✅ Named components for Fast Refresh
const MyComponent: React.FC = () => {
  return <div>Component</div>;
};

export default MyComponent;
```

### Proper useEffect Cleanup

```typescript
const useWebSocketConnection = (url: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(url);
    setSocket(newSocket);

    // ✅ Proper cleanup prevents memory leaks
    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [url]);

  return socket;
};
```

## Pagination & Validation Patterns

### Type-safe Pagination

```typescript
interface PaginationParams {
  page: number;
  limit: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    totalPages: number;
    totalItems: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

// Usage with generics
const useProjectsPagination = (): PaginatedResponse<Project> => {
  // Implementation with proper typing
};
```

### Zod Validation Schemas

```typescript
import { z } from 'zod';

// Project validation schema
export const createProjectSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  description: z.string().max(500).optional(),
});

export const imageUploadSchema = z.object({
  file: z.instanceof(File),
  projectId: z.string().uuid(),
});

// Type inference from schemas
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ImageUploadInput = z.infer<typeof imageUploadSchema>;
```

## Service Layer Type Safety

### Segmentation Service Types

```typescript
interface SegmentationRequest {
  imageId: string;
  projectId: string;
  model: 'hrnet' | 'resunet_small' | 'resunet_advanced';
  confidenceThreshold: number;
  detectHoles: boolean;
}

interface SegmentationResult {
  polygons: Polygon[];
  imageWidth: number;
  imageHeight: number;
  modelUsed: string;
  confidence: number;
  processingTime: number;
}

class SegmentationService {
  async processImage(
    request: SegmentationRequest
  ): Promise<SegmentationResult> {
    // Type-safe implementation
  }
}
```

### Queue Service Type Safety

```typescript
enum QueueStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

interface QueueItem {
  id: string;
  imageId: string;
  projectId: string;
  status: QueueStatus;
  priority: number;
  createdAt: Date;
  processedAt?: Date;
  error?: string;
}
```

## Error Handling Patterns

### Type-safe Error Responses

```typescript
// Standardized API error response
interface ApiError {
  message: string;
  code: string;
  field?: string;
  details?: Record<string, unknown>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

// Usage in API client
class ApiClient {
  async request<T>(url: string): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            message: data.message,
            code: data.code,
          },
        };
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: 'Network error',
          code: 'NETWORK_ERROR',
        },
      };
    }
  }
}
```

### Thumbnail Service Type Safety

```typescript
interface ThumbnailOptions {
  width: number;
  height: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

class ThumbnailService {
  async generateThumbnail(
    imagePath: string,
    options: ThumbnailOptions
  ): Promise<string> {
    // Type-safe thumbnail generation
    const { width, height, quality = 80, format = 'jpeg' } = options;
    // Implementation...
  }
}
```

## Common TypeScript Configuration Issues

### tsconfig.json Optimizations

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": false,
    "strictNullChecks": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "paths": {
      "@/*": ["./src/*"],
      "@db/*": ["./src/db/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Import Path Resolution

```typescript
// ✅ Use path aliases consistently
import { prisma } from '@db/prisma';
import { logger } from '@/utils/logger';
import { AuthContext } from '@/contexts/AuthContext';

// ❌ Avoid fragile relative paths
import { prisma } from '../../db/prisma';
import { logger } from '../../../utils/logger';
```

## Performance Type Patterns

### Memoization with Types

```typescript
const MemoizedComponent = React.memo<{
  data: ComplexDataType;
  onUpdate: (id: string) => void;
}>(({ data, onUpdate }) => {
  return <div>{/* Component logic */}</div>;
});

// Custom comparison for complex props
const arePropsEqual = (
  prevProps: ComponentProps,
  nextProps: ComponentProps
): boolean => {
  return (
    prevProps.data.id === nextProps.data.id &&
    prevProps.data.updatedAt === nextProps.data.updatedAt
  );
};

const OptimizedComponent = React.memo(MyComponent, arePropsEqual);
```
