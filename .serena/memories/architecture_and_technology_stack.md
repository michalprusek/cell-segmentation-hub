# Architecture & Technology Stack - Cell Segmentation Hub

**Transferred from ByteRover memories - System architecture and tech stack**

## System Architecture Overview

### Microservices Design

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   ML Service    │
│   React + TS    │◄──►│   Node.js + TS  │◄──►│   Python + AI   │
│   Port: 3000    │    │   Port: 3001    │    │   Port: 8000    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────────┐
                    │   Database      │
                    │   SQLite/Postgres│
                    │   + Prisma ORM  │
                    └─────────────────┘
```

## Frontend Architecture

### Core Technologies

- **React 18**: Component-based UI with modern hooks
- **TypeScript**: Type-safe development
- **Vite**: Fast build system and dev server
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui + Radix UI**: Component library with primitives

### State Management

- **React Query (TanStack)**: Server state management
- **Context API**: Client state (Auth, Theme, Language, Model)
- **Local State**: useState, useReducer for component state
- **WebSocket State**: Real-time updates with Socket.io

### Key Frontend Features

- **Segmentation Editor**: Complex canvas-based polygon editing
- **Real-time Updates**: WebSocket integration for queue status
- **Internationalization**: Multi-language support (EN, CS, ES, DE, FR, ZH)
- **Authentication**: JWT-based with refresh tokens
- **File Management**: Drag-drop upload with progress tracking
- **Export Systems**: COCO format and Excel exports

### Frontend Structure

```
src/
├── pages/           # Main application pages
│   └── segmentation/ # Complex segmentation editor
├── components/      # Reusable UI components
├── contexts/        # React contexts (Auth, Theme, etc.)
├── hooks/          # Custom React hooks
├── lib/            # Utilities (API client, algorithms)
└── translations/   # i18n language files
```

## Backend Architecture

### Core Technologies

- **Node.js + Express**: RESTful API server
- **TypeScript**: Type-safe backend development
- **Prisma ORM**: Database abstraction with migrations
- **JWT Authentication**: Access + refresh token pattern
- **Socket.io**: WebSocket real-time communication

### Database Design

- **Development**: SQLite for local development
- **CI/Production**: PostgreSQL for scalability
- **Schema**: User, Profile, Project, ProjectImage, SegmentationResult
- **Migrations**: Prisma-managed database evolution

### API Features

- **REST Endpoints**: Full CRUD operations
- **OpenAPI/Swagger**: Comprehensive API documentation
- **Rate Limiting**: Protection against abuse
- **CORS**: Secure cross-origin requests
- **File Storage**: Local filesystem with thumbnails
- **Queue Management**: ML processing queue with priorities

### Backend Structure

```
backend/
├── src/
│   ├── api/        # Controllers and routes
│   ├── services/   # Business logic
│   ├── middleware/ # Auth, validation, monitoring
│   └── storage/    # File storage abstraction
└── prisma/         # Database schema and migrations
```

## ML Service Architecture

### Core Technologies

- **Python + FastAPI**: High-performance async API
- **PyTorch**: Deep learning framework
- **PIL/Pillow**: Image processing
- **NumPy**: Numerical computations
- **OpenCV**: Computer vision utilities

### ML Models in Production

1. **HRNetV2**: Best accuracy (~3.1s inference)
2. **CBAM-ResUNet**: Fastest inference (~6.9s)
3. **MA-ResUNet**: Most precise (~18.1s with attention)

### ML Pipeline Features

- **Batch Processing**: Queue-based inference
- **Model Selection**: Runtime model switching
- **Confidence Thresholding**: Adjustable detection sensitivity
- **Polygon Extraction**: Cell boundary detection
- **Post-processing**: Hole detection and polygon cleanup

### ML Service Structure

```
backend/segmentation/
├── api/            # FastAPI routes and models
├── services/       # ML inference and postprocessing
├── models/         # PyTorch model definitions
└── weights/        # Pre-trained model weights
```

## Database Schema

### Key Entities

- **User**: Authentication and basic profile
- **Profile**: Extended user information (firstName, lastName)
- **Project**: Container for related images
- **ProjectImage**: Image files with processing status
- **SegmentationResult**: ML results with polygon data
- **QueueItem**: Processing queue management

### Status Flow

```
Image Upload → pending → queued → processing → completed/failed/no_segmentation
```

## Monitoring & DevOps

### Monitoring Stack

- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboards
- **Health Checks**: Service readiness endpoints
- **Logging**: Structured logging with context

### Deployment Strategy

- **Blue-Green Deployment**: Zero-downtime releases
- **Docker Containers**: Full containerization
- **Environment Separation**: Dev/Staging/Production
- **nginx Proxy**: Load balancing and SSL termination

## Performance Characteristics

- **Frontend**: ~100ms page loads, real-time UI updates
- **API**: ~50ms average response time
- **ML Inference**: 3-18s depending on model choice
- **Database**: SQLite (dev) handles 1000+ images, PostgreSQL (prod) scales
- **WebSocket**: <100ms notification delivery

## Security Features

- **JWT Tokens**: Secure authentication with refresh
- **CORS Configuration**: Environment-specific origins
- **Rate Limiting**: API abuse protection
- **Input Validation**: Zod schemas for type safety
- **File Upload Security**: Type validation and size limits
