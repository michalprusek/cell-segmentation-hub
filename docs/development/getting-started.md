# Development Setup Guide

This guide will help you set up the Cell Segmentation Hub for local development.

## Prerequisites

### Required Software
- **Node.js**: Version 18.0 or higher
- **Python**: Version 3.9 or higher  
- **Docker**: Version 20.10 or higher (optional, for containerized development)
- **Git**: For version control

### Recommended Tools
- **VS Code**: With TypeScript, Python, and Docker extensions
- **Postman**: For API testing
- **Docker Desktop**: For container management

## Quick Start (Recommended)

The fastest way to get started is using Docker Compose:

```bash
# 1. Clone the repository
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub

# 2. Start all services with Docker
npm run docker:dev

# 3. Wait for services to start (may take a few minutes on first run)
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001  
# ML Service: http://localhost:8000
```

## Manual Setup

For development with hot reloading and debugging:

### 1. Clone and Setup Environment

```bash
# Clone repository
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub

# Copy environment files
cp .env.example .env
cp backend/.env.example backend/.env
```

### 2. Frontend Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Frontend will be available at http://localhost:3000
```

#### Frontend Environment Variables
```bash
# .env
VITE_API_BASE_URL=http://localhost:3001/api
VITE_ML_SERVICE_URL=http://localhost:8000
```

### 3. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Setup database
npm run db:push
npm run db:generate

# Seed database with test data (optional)
npm run db:seed

# Start development server
npm run dev

# Backend API will be available at http://localhost:3001
```

#### Backend Environment Variables
```bash
# backend/.env
NODE_ENV=development
PORT=3001
HOST=localhost

# Database
DATABASE_URL=file:./dev.db

# JWT Secrets (MUST be changed in production - these are example values only)
JWT_ACCESS_SECRET=CHANGE_THIS_IN_PRODUCTION_32_CHAR_MIN
JWT_REFRESH_SECRET=CHANGE_THIS_IN_PRODUCTION_32_CHAR_MIN

# CORS Origins
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# File Storage
UPLOAD_DIR=./uploads
STORAGE_TYPE=local

# ML Service
SEGMENTATION_SERVICE_URL=http://localhost:8000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=1000
```

### 4. ML Service Setup

```bash
# Navigate to ML service directory
cd backend/segmentation

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download model weights (see ML Models section below)
mkdir weights

# Start development server
python api/main.py

# ML service will be available at http://localhost:8000
```

#### ML Service Environment Variables
```bash
# backend/segmentation/.env
PYTHONUNBUFFERED=1
PYTHONDONTWRITEBYTECODE=1
PORT=8000
```

## Database Setup

### SQLite (Development)

The application uses SQLite for development with Prisma ORM:

```bash
# Navigate to backend
cd backend

# Generate Prisma client
npm run db:generate

# Apply schema to database
npm run db:push

# View database in Prisma Studio (optional)
npm run db:studio
```

### Database Migrations

```bash
# Create new migration
npm run db:migrate

# Reset database (destructive)
npm run db:reset

# Seed with test data
npm run db:seed
```

## ML Models Setup

### Download Model Weights

Model weights are not included in the repository due to size. Download them separately:

```bash
# Create weights directory
mkdir backend/segmentation/weights

# Download weights (replace with actual download URLs)
cd backend/segmentation/weights

# HRNet weights (example)
wget https://example.com/models/hrnet_w32_cell_segmentation.pth

# ResUNet Advanced weights
wget https://example.com/models/resunet_advanced_cell_segmentation.pth

# ResUNet Small weights  
wget https://example.com/models/resunet_small_cell_segmentation.pth
```

### Model Configuration

Models are configured in `backend/segmentation/ml/model_loader.py`:

```python
# Available models
AVAILABLE_MODELS = {
    "hrnet": {
        "class": HRNet,
        "weights": "weights/hrnet_w32_cell_segmentation.pth",
        "input_size": (1024, 1024)
    },
    "resunet_advanced": {
        "class": ResUNetAdvanced,
        "weights": "weights/resunet_advanced_cell_segmentation.pth", 
        "features": [64, 128, 256, 512]
    },
    "resunet_small": {
        "class": ResUNetSmall,
        "weights": "weights/resunet_small_cell_segmentation.pth",
        "features": [48, 96, 192, 384, 512]
    }
}
```

## Development Workflow

### 1. Start Development Environment

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
cd backend && npm run dev

# Terminal 3: ML Service  
cd backend/segmentation && python api/main.py
```

### 2. Test the Setup

```bash
# Check service health
curl http://localhost:3001/health    # Backend
curl http://localhost:8000/health    # ML Service

# Test frontend
open http://localhost:3000
```

### 3. Create Test User

```bash
# Register via API
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPassword123!"}'

# Or use the frontend registration form
```

## IDE Configuration

### VS Code Settings

Create `.vscode/settings.json`:

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "python.defaultInterpreterPath": "./backend/segmentation/venv/bin/python",
  "python.linting.enabled": true,
  "python.linting.pylintEnabled": true
}
```

### VS Code Extensions

Recommended extensions:
- TypeScript and JavaScript Language Features
- Python
- Prisma
- Docker
- ESLint
- Prettier
- GitLens

## Common Development Tasks

### Database Operations

```bash
# Reset database and apply fresh schema
cd backend
npm run db:reset

# View database in browser
npm run db:studio

# Generate new migration
npm run db:migrate
```

### Code Quality

```bash
# Frontend linting
npm run lint

# Backend linting  
cd backend && npm run lint

# Type checking
npx tsc --noEmit
```

### Testing Services

```bash
# Test backend endpoints
curl -X GET http://localhost:3001/health

# Test ML service
curl -X GET http://localhost:8000/health

# Test image segmentation
curl -X POST http://localhost:8000/api/v1/segment \
  -F "file=@test-image.jpg" \
  -F "model=hrnet" \
  -F "threshold=0.5"
```

### File Uploads

Test file upload functionality:

```bash
# Create test project via API
PROJECT_ID=$(curl -X POST http://localhost:3001/api/projects \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Project","description":"Test"}' | jq -r '.data.id')

# Upload images
curl -X POST http://localhost:3001/api/projects/$PROJECT_ID/images \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@test-image1.jpg" \
  -F "images=@test-image2.jpg"
```

## Troubleshooting

### Common Issues

#### Frontend not connecting to backend
```bash
# Check if backend is running
curl http://localhost:3001/health

# Check CORS configuration in backend/.env
ALLOWED_ORIGINS=http://localhost:3000
```

#### ML Service connection issues
```bash
# Check Python dependencies
cd backend/segmentation
pip list | grep torch

# Check model weights
ls -la weights/
```

#### Database connection errors
```bash
# Regenerate Prisma client
cd backend
npm run db:generate

# Check database file permissions
ls -la dev.db
```

#### Port conflicts
```bash
# Check what's running on ports
lsof -i :3001  # Backend
lsof -i :3000  # Frontend  
lsof -i :8000  # ML Service

# Kill processes if needed
kill -9 PID
```

### Log Files

Development logs are available at:
- **Frontend**: Browser console
- **Backend**: Terminal output + `backend/logs/`
- **ML Service**: Terminal output

### Performance Issues

```bash
# Monitor memory usage
htop

# Check disk space
df -h

# Monitor Python processes
ps aux | grep python
```

## Hot Reloading

All services support hot reloading in development:

- **Frontend**: Vite HMR automatically reloads on file changes
- **Backend**: `tsx watch` restarts server on TypeScript changes
- **ML Service**: Manual restart required for model changes

## Environment-Specific Configuration

### Development
- SQLite database
- Local file storage
- Verbose logging
- Hot reloading enabled
- CORS allows localhost origins

### Testing
- In-memory database
- Mock file storage
- Minimal logging
- Fast test execution

### Production
- PostgreSQL database
- Cloud storage (S3/GCS)
- Structured logging
- Optimized builds
- Security headers

## Next Steps

Once your development environment is running:

1. **Explore the API**: Visit `http://localhost:3001/health`
2. **Test the Frontend**: Open `http://localhost:3000`
3. **Review the Code**: Start with `src/App.tsx` and `backend/src/server.ts`
4. **Read the Architecture**: See [Architecture Documentation](../architecture/)
5. **Make Changes**: The hot reload will update automatically

## Additional Resources

- [API Documentation](../api/) - Complete API reference
- [Architecture Guide](../architecture/) - System design details
- [Deployment Guide](../deployment/) - Production deployment
- [Testing Guide](./testing.md) - Testing procedures

For questions or issues, check the troubleshooting section or create an issue in the repository.