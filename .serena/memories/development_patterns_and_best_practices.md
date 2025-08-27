# Development Patterns & Best Practices - Cell Segmentation Hub

## Critical Development Rules

1. **Docker-First Development**: NEVER use npm commands directly - always use `make` targets
2. **File Reading Requirement**: MUST read files before editing with MultiEdit tool
3. **Production Safety**: Never modify blue-green deployment directories or volumes
4. **Logging Standards**: Use structured logger with context, avoid console.log in application code

## Architecture Understanding

### Service Architecture

- **Frontend**: React 18 + TypeScript + Vite (port 3000 in Docker, 5173 for Vite dev)
- **Backend**: Node.js + Express + TypeScript (port 3001)
- **ML Service**: Python + FastAPI + PyTorch (port 8000)
- **Database**: SQLite (dev) / PostgreSQL (CI/prod) with Prisma ORM

### Deployment Strategy

- **Blue-Green Deployment**: Zero-downtime releases with nginx routing
- **Environment Separation**: Blue (staging), Green (production) with separate databases
- **Container Health**: Comprehensive health checks and monitoring

### Real-time Systems

- **WebSocket**: Socket.io for segmentation queue updates
- **Queue Management**: Real-time status updates with deduplication
- **Status Reconciliation**: Automatic sync between backend and frontend states

## Code Quality Patterns

### Logging Best Practices

```typescript
// ✅ Correct - Structured logging with context
logger.debug('Real-time WebSocket update received', 'ProjectDetail', {
  imageId: lastUpdate.imageId,
  status: lastUpdate.status,
  projectId: lastUpdate.projectId,
});

// ❌ Avoid - Console.log without context
console.log('Update received:', lastUpdate);
```

### Test Organization

- **Integration Tests**: Environment-specific with proper setup/teardown
- **Database Tests**: Use TEST_DATABASE_URL for CI compatibility
- **Schema Compatibility**: Handle User/Profile model separation

### Configuration Management

- **Environment Variables**: Proper .env file management for each environment
- **Port Configuration**: Align Vite config with Docker container ports
- **CORS Settings**: WebSocket origins must match production domains

## Development Workflow

### Essential Commands

```bash
# Start all services
make up

# View logs
make logs-f

# Run tests (use Desktop Commander for long operations)
make test

# Health check
make health

# Shell access
make shell-fe / make shell-be / make shell-ml
```

### File Organization

- **Debug Scripts**: `/scripts/debug/` for development utilities
- **Tests**: Proper test directory structure with integration/unit separation
- **Documentation**: Project-specific docs in root, avoid scattered README files

## Critical System Components

### Database Schema Evolution

- **User Model**: Basic authentication fields
- **Profile Model**: Extended user information (firstName, lastName moved here)
- **Project/Image Relationship**: Complex segmentation status tracking

### ML Pipeline

- **Models**: HRNet (accuracy), CBAM-ResUNet (speed), MA-ResUNet (precision)
- **Queue System**: Batch processing with priority and force re-segmentation
- **Status Tracking**: Complex state machine (pending → queued → processing → completed/failed)

### Frontend State Management

- **React Query**: Server state management
- **Context**: Auth, Theme, Language, Model, WebSocket
- **Real-time Updates**: WebSocket integration with optimistic updates

## Common Pitfalls to Avoid

1. **Port Mismatches**: Always verify Vite config matches Docker setup
2. **Test Disabling**: Never disable tests - fix them instead
3. **Console Logging**: Replace with structured logging for production code
4. **Direct npm Commands**: Use Docker environment through make targets
5. **Volume Modification**: Never change docker-compose volume configurations

## Performance Considerations

- **WebSocket Deduplication**: Prevent unnecessary segmentation refreshes
- **Pagination**: Handle large image sets efficiently
- **Image Processing**: Thumbnail generation and caching strategies
- **Queue Optimization**: Batch operations and priority handling

This knowledge base ensures consistent development practices and prevents regression of the cleanup improvements.
