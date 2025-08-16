# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**CRITICAL: This project runs entirely in Docker containers - DO NOT use npm commands directly!**

VERY IMPORTANT: Always read relevant docs and fetch relevant documentation using available MCP servers.

VERY IMPORTANT: Use subagents often to save context. They dont have shared context with main agent, so give them comprehensive and clear instructions, also recommend them to use available knowledge systems.

## Knowledge Management System

**Knowledge storage and retrieval** is available through the connected MCP servers for storing and retrieving application knowledge, best practices, and implementation details.

### Usage Guidelines

**ALWAYS use knowledge systems when:**
- **Planning tasks**: Retrieve relevant knowledge before starting implementation
- **Solving problems**: Check for existing solutions and patterns
- **After completing work**: Store insights, solutions, and best practices
- **Debugging issues**: Look for similar problems and their resolutions

### Knowledge Storage Strategy
Store these types of information in the knowledge system:
- **Code patterns**: Successful implementation approaches for common tasks
- **Bug fixes**: Solutions to specific errors and their root causes  
- **Architecture decisions**: Why certain technical choices were made
- **Configuration solutions**: Docker, database, and service setup fixes
- **Performance optimizations**: Techniques that improved application performance
- **API integrations**: Working examples of third-party service integrations
- **Testing approaches**: Effective testing strategies and test case patterns

### Retrieval Best Practices
Before starting work, query the knowledge system for:
- Similar features or components already implemented
- Known issues and their solutions related to your task
- Established patterns for the type of work you're doing
- Configuration requirements for related services

### Example Queries
- "React hook patterns for data fetching"
- "Docker container debugging techniques"
- "Prisma database migration best practices"
- "TypeScript error resolution strategies"
- "ML model integration patterns"

**Remember**: The knowledge system serves as the project's institutional memory - use it to avoid repeating work and to build upon proven solutions.

### Docker Environment (Required)
- **Start all services**: `make up` or `make dev-setup` 
- **View logs**: `make logs-f` (all services) or `make logs-fe`/`make logs-be`/`make logs-ml`
- **Stop services**: `make down`
- **Health check**: `make health` or `make test`
- **Reset environment**: `make reset` (clean + rebuild)
- **Shell access**: `make shell-fe`/`make shell-be`/`make shell-ml`

### Service URLs (Docker only)
- **Frontend**: http://localhost:3000 
- **Backend API**: http://localhost:3001
- **ML Service**: http://localhost:8000
- **API Documentation**: http://localhost:3001/api-docs
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3030

### Legacy Frontend Commands (Do NOT use in development)
These only work for building static assets, but the app must run in Docker:
- `npm run build` - Production build
- `npm run lint` - Code linting
- `npm run preview` - Preview build (but use Docker for development)

## Project Architecture

This is a React-based cell segmentation application with a full-stack microservices architecture. The system consists of three main services running in Docker containers:

### Core Technologies
- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend API**: Node.js + Express + TypeScript (port 3001)  
- **ML Service**: Python + FastAPI + PyTorch (port 8000)
- **Database**: SQLite (development) / PostgreSQL (CI/production) with Prisma ORM
- **Authentication**: JWT access/refresh tokens
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS
- **State Management**: React Query for server state, React Context for client state
- **Monitoring**: Prometheus + Grafana stack

### Key Directory Structure
**Frontend (React/TypeScript):**
- `/src/pages/` - Main application pages (Dashboard, ProjectDetail, SegmentationEditor)
- `/src/pages/segmentation/` - Complex segmentation editor with advanced polygon editing
- `/src/components/` - Reusable UI components organized by feature
- `/src/contexts/` - React contexts (Auth, Theme, Language, Model, WebSocket)
- `/src/hooks/` - Custom React hooks for data fetching and state management
- `/src/lib/` - Utility libraries (API client, image processing, segmentation algorithms)

**Backend (Node.js/Express):**
- `/backend/src/api/` - Controllers and routes for REST API
- `/backend/src/services/` - Business logic services
- `/backend/src/middleware/` - Authentication, validation, error handling, monitoring
- `/backend/src/storage/` - File storage abstraction layer
- `/backend/prisma/` - Database schema and migrations

**ML Service (Python/FastAPI):**
- `/backend/segmentation/api/` - FastAPI routes and models
- `/backend/segmentation/services/` - ML inference and postprocessing
- `/backend/segmentation/models/` - PyTorch model definitions (HRNet, ResUNet variants)
- `/backend/segmentation/weights/` - Pre-trained model weights

### Segmentation Editor Architecture
The segmentation editor (`/src/pages/segmentation/`) is the most complex part of the application:

- **Main Editor**: `SegmentationEditor.tsx` orchestrates the entire editing experience
- **Canvas System**: Located in `components/canvas/` - handles image display, polygon rendering, and interactive editing
- **Edit Modes**: Supports multiple editing modes including point addition, polygon modification, and slicing
- **Polygon Interaction**: Complex hooks in `hooks/polygonInteraction/` manage geometry operations, vertex manipulation, and spatial calculations
- **Context System**: Uses React Context to share segmentation state across components
- **Export System**: Supports COCO format export and Excel-based metrics

### Database Schema
The application uses Prisma ORM with different databases per environment:
- **Development**: SQLite (`file:./data/dev.db`)
- **CI/Testing**: PostgreSQL 15 (service container)
- **Production**: PostgreSQL (managed service)

Key tables include:
- `User` - User accounts and authentication
- `Project` - Project metadata and settings  
- `ProjectImage` - Image files and processing status
- `SegmentationResult` - ML model results and polygon annotations
- `QueueItem` - Processing queue for ML operations

### Path Aliases
- `@/` maps to `./src/` for clean import paths

### TypeScript Configuration
- Relaxed TypeScript settings (`noImplicitAny: false`, `strictNullChecks: false`)
- Path mapping configured for `@/*` imports
- Separate configs for app and Node.js code

### Authentication Flow
Uses JWT-based authentication with access/refresh tokens. The `AuthContext` manages user state and the `ProtectedRoute` component guards authenticated pages.

### ML Models in Production
- **HRNetV2** - Best accuracy, ~3.1s inference time
- **ResUNet Small** - Fastest inference, ~6.9s inference time  
- **ResUNet Advanced** - Most precise, ~18.1s inference time with attention mechanisms

### API Documentation
- **Swagger UI**: http://localhost:3001/api-docs (interactive documentation)
- **OpenAPI spec**: http://localhost:3001/api-docs/openapi.json
- **Endpoint registry**: http://localhost:3001/api/endpoints

### Internationalization
Multi-language support via `LanguageContext` with translations in `/src/translations/`.

## Development Best Practices

### Important Reminders
- **Docker-first development**: Always use `make` commands, never direct npm/node commands
- **File editing**: Always prefer editing existing files over creating new ones
- **Documentation**: Only create docs when explicitly requested by the user
- **Terminal safety**: Never use KillBash tool as it terminates the user's session
- **VERY IMPORTANT - MacOS Terminal Issue**: When running long commands (>30s), ALWAYS use the appropriate MCP tools for process management instead of Bash tool, as long-running Bash commands cause Claude Code terminal crashes on macOS

### Testing and Quality
- **Linting**: Run `npm run lint` for code quality checks
- **API testing**: Use Swagger UI at http://localhost:3001/api-docs
- **Health checks**: Use `make health` to verify all services are running
- **Service logs**: Use `make logs-f` to monitor all services in real-time

### Common Development Tasks
- **Adding new API endpoints**: Add routes in `/backend/src/api/routes/`, controllers in `/backend/src/api/controllers/`, and update OpenAPI spec
- **Frontend components**: Create in `/src/components/` following existing patterns, use shadcn/ui primitives
- **ML model changes**: Modify `/backend/segmentation/models/` and update model loading in `/backend/segmentation/services/`
- **Database changes**: Update `/backend/prisma/schema.prisma` and run `npx prisma migrate dev` in backend container

## Current System Status

**Production-Ready Components:**
- ✅ **Full-stack architecture**: React frontend + Node.js API + Python ML service
- ✅ **Authentication system**: JWT-based with access/refresh tokens
- ✅ **Database layer**: Prisma ORM (SQLite dev, PostgreSQL CI/prod), full CRUD operations
- ✅ **ML pipeline**: 3 production models (HRNet, ResUNet Small, ResUNet Advanced)
- ✅ **File storage**: Local storage with automatic thumbnail generation
- ✅ **API documentation**: Swagger UI with OpenAPI 3.0 specification
- ✅ **Monitoring stack**: Prometheus metrics + Grafana dashboards
- ✅ **Docker environment**: Full containerization with health checks

**Key Features Working:**
- User registration, authentication, and profile management
- Project creation and management with image uploads
- Real-time ML segmentation with polygon extraction
- Advanced polygon editing with multiple interaction modes
- Export functionality (COCO format, Excel metrics)
- Multi-language support (EN, CS, ES)
- Real-time WebSocket notifications for queue processing

**Architecture Highlights:**
- **Security**: JWT tokens stored securely, CORS configured, rate limiting
- **Performance**: Optimized Docker containers, efficient image processing
- **Scalability**: Microservices architecture, queue-based ML processing
- **Developer Experience**: Hot reload in development, comprehensive API docs