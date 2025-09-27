# Cell Segmentation Hub - Architecture Documentation

## Overview

The Cell Segmentation Hub is a modern web application for biomedical image segmentation, built with a microservices architecture and real-time processing capabilities.

## Technology Stack

### Frontend
- **React 18** - UI framework with concurrent features
- **TypeScript 5** - Type-safe JavaScript
- **Vite** - Fast build tool and dev server
- **shadcn/ui** - Tailwind-based component library
- **Socket.io Client** - Real-time WebSocket communication
- **Vitest** - Unit and integration testing

### Backend
- **Node.js + Express** - REST API server
- **TypeScript** - Type-safe backend code
- **Prisma ORM** - Database abstraction
- **Socket.io** - WebSocket server for real-time updates
- **Bull Queue** - Redis-based job queue
- **JWT** - Authentication tokens

### ML Service
- **Python + FastAPI** - High-performance ML API
- **PyTorch** - Deep learning framework
- **HRNet/ResUNet** - Segmentation models
- **NumPy/SciPy** - Scientific computing
- **Uvicorn** - ASGI server

### Infrastructure
- **Docker** - Containerization
- **Nginx** - Reverse proxy and load balancer
- **PostgreSQL** - Primary database
- **Redis** - Caching and queue management
- **Blue-Green Deployment** - Zero-downtime deployments

## Architecture Patterns

### 1. Single Source of Truth (SSOT)
All configuration constants are centralized in `/src/lib/constants.ts`:
```typescript
export const TIMEOUTS = {
  RETRY_INITIAL: 1000,
  API_REQUEST: 5000,
  SEGMENTATION_PROCESS: 300000,
  // ...
} as const;
```

### 2. Retry Pattern with Exponential Backoff
Robust error handling with configurable retry logic:
```typescript
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<RetryResult<T>>
```

### 3. Circuit Breaker Pattern
Prevents cascading failures in distributed systems:
```typescript
export class CircuitBreaker {
  recordFailure(key: string): void
  recordSuccess(key: string): void
  isOpen(key: string): boolean
}
```

### 4. Repository Pattern
Database operations are abstracted through service layers:
```typescript
class ImageService {
  async uploadImagesWithProgress(
    projectId: string,
    userId: string,
    files: UploadFile[],
    batchId: string,
    onProgress?: ProgressCallback
  ): Promise<ImageWithUrls[]>
}
```

### 5. WebSocket Event-Driven Architecture
Real-time updates using Socket.io:
```typescript
export enum WebSocketEvent {
  SEGMENTATION_STATUS = 'segmentationStatus',
  EXPORT_PROGRESS = 'exportProgress',
  QUEUE_UPDATE = 'queueUpdate'
}
```

## Key Features

### 1. Batch Processing
- Supports up to **10,000 images** per batch
- Chunked uploads with progress tracking
- Parallel ML processing with 4-way concurrency

### 2. Real-time Updates
- WebSocket-based status updates
- Queue position tracking
- Export progress monitoring
- Cross-tab synchronization

### 3. Export System
- Multiple format support (COCO, YOLO, Excel, JSON)
- Streaming exports for large datasets
- Progress tracking with cancellation

### 4. Segmentation Pipeline
- Three ML models (HRNet, CBAM-ResUNet, U-Net)
- GPU acceleration with CUDA
- Automatic retry on failures
- Thumbnail generation for performance

### 5. Authentication & Security
- JWT with refresh tokens
- Email verification
- Rate limiting per endpoint
- CORS protection
- XSS/CSRF prevention

## Data Flow

### Image Upload Flow
1. Frontend validates file (type, size)
2. Chunked upload to backend
3. Backend stores in filesystem/S3
4. Thumbnail generation
5. Database record creation
6. WebSocket notification

### Segmentation Flow
1. Image added to queue
2. Queue worker picks up job
3. ML service processes image
4. Polygons extracted and validated
5. Results stored in database
6. Thumbnail generated
7. WebSocket notification

### Export Flow
1. User selects images and format
2. Export job created
3. Background processing
4. Files packaged into ZIP
5. Download link generated
6. Cleanup after expiration

## Performance Optimizations

### Frontend
- **Code splitting** - Lazy loading of routes
- **Virtual scrolling** - For large image galleries
- **Image lazy loading** - Load on demand
- **Memoization** - React.memo and useMemo
- **Debouncing** - Search and filter inputs

### Backend
- **Connection pooling** - Database connections
- **Redis caching** - Frequent queries
- **Batch operations** - Bulk inserts/updates
- **Stream processing** - Large file handling
- **Compression** - gzip for API responses

### ML Service
- **GPU batch processing** - Process multiple images
- **Model caching** - Keep models in memory
- **Parallel inference** - 4-way concurrency
- **Memory management** - Automatic cleanup

## Error Handling

### Retry Strategies
- **API calls**: 3 attempts, 2s backoff
- **Uploads**: 5 attempts, 2s backoff
- **WebSocket**: Infinite retries, 1.5x backoff
- **ML processing**: 3 attempts, 5s backoff

### Error Recovery
- Automatic reconnection for WebSockets
- Queue job retry with exponential backoff
- Transaction rollback on database errors
- Graceful degradation for non-critical features

## Monitoring & Logging

### Application Logs
- Structured JSON logging
- Log levels: ERROR, WARN, INFO, DEBUG
- Context injection (userId, requestId)
- Log rotation and archival

### Metrics
- Response time percentiles
- Error rates by endpoint
- Queue depth and processing time
- Memory and CPU usage
- Active WebSocket connections

## Security Measures

### Authentication
- Bcrypt password hashing
- JWT with short expiration
- Refresh token rotation
- Session invalidation on logout

### Data Protection
- Input validation with Zod
- SQL injection prevention (Prisma)
- XSS protection (React)
- CORS configuration
- Rate limiting

### File Security
- File type validation
- Size limits (20MB per file)
- Virus scanning (optional)
- Secure file paths
- Access control checks

## Deployment Architecture

### Blue-Green Deployment
- Zero-downtime deployments
- Instant rollback capability
- A/B testing support
- Gradual traffic shifting

### Container Architecture
```
nginx-router (80/443)
  ├── blue-environment (4000-4008)
  │   ├── frontend-blue
  │   ├── backend-blue
  │   ├── ml-service-blue
  │   ├── postgres-blue
  │   └── redis-blue
  └── green-environment (5000-5008)
      ├── frontend-green
      ├── backend-green
      ├── ml-service-green
      ├── postgres-green
      └── redis-green
```

## Scalability Considerations

### Horizontal Scaling
- Stateless backend services
- Redis for shared state
- Database read replicas
- CDN for static assets

### Vertical Scaling
- GPU instances for ML
- High-memory for image processing
- SSD storage for databases
- Network-optimized for uploads

## Future Enhancements

### Planned Features
- Multi-GPU support
- Kubernetes orchestration
- GraphQL API
- Mobile applications
- Advanced ML models

### Performance Targets
- <100ms API response time
- <5s segmentation per image
- 99.9% uptime SLA
- Support for 100+ concurrent users

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and best practices.

## License

MIT License - See [LICENSE](./LICENSE) for details.