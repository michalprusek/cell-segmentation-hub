# Cell Segmentation Hub

Advanced cell segmentation platform powered by deep learning models. Complete system with React frontend, Node.js backend, and Python ML microservice.

## 🚀 Quick Start

### Development Environment

```bash
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub

# Start development environment
docker compose up -d
```

Development services will be available at:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **ML Service**: http://localhost:8000
- **Grafana**: http://localhost:3030

### Production & Staging Deployment

This project supports parallel production and staging environments:

#### Staging Environment

```bash
# Deploy staging environment
./scripts/deploy-staging.sh

# Manage staging environment
./scripts/staging-manager.sh start
./scripts/staging-manager.sh status
./scripts/staging-manager.sh logs -f
```

Staging URL: https://staging.spherosegapp.utia.cas.cz

#### Production Environment

```bash
# Setup SSL certificates (run once)
./scripts/init-letsencrypt-staging.sh

# Deploy production environment
./scripts/deploy-production.sh
```

Production URL: https://spherosegapp.utia.cas.cz

📖 **Detailed staging setup**: See [STAGING.md](./STAGING.md)

### Manual Setup

```bash
# 1. Backend API
cd backend
npm install && npm run dev          # http://localhost:3001

# 2. Python ML Service
cd backend/segmentation
pip install -r requirements.txt
python api/main.py                  # http://localhost:8000

# 3. Frontend
npm install && npm run dev          # http://localhost:8082
```

## 📚 Documentation

### 🏗️ [System Architecture](./docs/architecture/)

Complete system design and component documentation

- [Architecture Overview](./docs/architecture/README.md) - High-level system design
- [Frontend Architecture](./docs/architecture/frontend.md) - React app structure
- [Backend Architecture](./docs/architecture/backend.md) - Node.js API design
- [ML Service Architecture](./docs/architecture/ml-service.md) - Python segmentation service

### 🔌 [API Documentation](./docs/api/)

Complete REST API reference

- [API Overview](./docs/api/README.md) - General API information
- [Authentication](./docs/api/authentication.md) - User auth and JWT tokens
- [Projects](./docs/api/projects.md) - Project management endpoints
- [Images](./docs/api/images.md) - Image upload and management
- [Segmentation](./docs/api/segmentation.md) - ML segmentation services

### 💻 [Development](./docs/development/)

Developer setup and contribution guide

- [Getting Started](./docs/development/getting-started.md) - Local development setup
- [Testing Guide](./docs/development/testing.md) - Testing procedures

### 🚀 [Deployment](./docs/deployment/)

Production deployment guides

- [Deployment Guide](./docs/deployment/README.md) - Production setup with Docker
- [Docker Configuration](./docs/deployment/docker.md) - Container deployment

### 📖 [User Guide](./docs/guides/)

End-user documentation

- [User Guide](./docs/guides/user-guide.md) - Complete application usage guide

### 📋 [Reference](./docs/reference/)

Technical reference materials

- [Database Schema](./docs/reference/database-schema.md) - Complete database structure
- [ML Models](./docs/reference/ml-models.md) - Available segmentation models
- [Claude Instructions](./docs/reference/claude-instructions.md) - AI assistant guidelines

## 🏗️ System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │───▶│  Node.js API    │───▶│  Python ML      │
│   Port: 8082    │    │  Port: 3001     │    │  Port: 8000     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
       │                        │                        │
       │                        ▼                        ▼
       │               ┌─────────────────┐    ┌─────────────────┐
       │               │   SQLite DB     │    │  PyTorch Models │
       └──────────────▶│   Prisma ORM    │    │  HRNet, ResUNet │
                       └─────────────────┘    └─────────────────┘
```

## 🤖 AI Models

### Available Models

- **HRNetV2**: High-Resolution Network (~3.1s, highest accuracy)
- **ResUNet Advanced**: Advanced with attention mechanisms (~18.1s, balanced)
- **ResUNet Small**: Lightweight version (~6.9s, fastest)

### Performance Benchmarks

| Model            | Parameters | Inference Time | Best Use Case             |
| ---------------- | ---------- | -------------- | ------------------------- |
| HRNet            | 66M        | ~3.1s          | Research-quality analysis |
| ResUNet Advanced | 45M        | ~18.1s         | Balanced accuracy/speed   |
| ResUNet Small    | 15M        | ~6.9s          | Fast batch processing     |

## 🏢 About

Developed at **ÚTIA AV ČR** (Institute of Information Theory and Automation, Czech Academy of Sciences)

- **Address**: Pod Vodárenskou věží 4, 182 08 Prague 8, Czech Republic
- **Contact**: spheroseg@utia.cas.cz
- **Website**: [www.utia.cas.cz](http://www.utia.cas.cz)

## 🔑 Key Features

### For Researchers

- **Multiple AI Models**: Choose the best model for your needs
- **Advanced Editor**: Precise polygon editing tools with undo/redo
- **Batch Processing**: Upload and process multiple images at once
- **Export Options**: COCO format, Excel, CSV exports
- **Project Organization**: Organize work into logical projects

### For Developers

- **REST API**: Complete programmatic access
- **Microservices**: Scalable architecture with independent services
- **Docker Support**: Easy deployment and development
- **TypeScript**: Full type safety across frontend and backend
- **Modern Stack**: React 18, Node.js, FastAPI, PyTorch

## 📊 Technical Stack

| Component          | Technology                       | Purpose          |
| ------------------ | -------------------------------- | ---------------- |
| **Frontend**       | React + TypeScript + Vite        | User interface   |
| **Backend**        | Node.js + Express + Prisma       | REST API server  |
| **Database**       | SQLite (dev) / PostgreSQL (prod) | Data persistence |
| **ML Service**     | Python + FastAPI + PyTorch       | AI inference     |
| **Authentication** | JWT tokens                       | Secure user auth |
| **Deployment**     | Docker + Docker Compose          | Containerization |

## 🚀 Getting Started

1. **📖 Read the [Getting Started Guide](./docs/development/getting-started.md)** - Complete setup instructions
2. **🏗️ Understand the [Architecture](./docs/architecture/README.md)** - System design overview
3. **🔌 Explore the [API](./docs/api/README.md)** - REST endpoints reference
4. **👨‍💻 Start Developing** - Follow the development workflow
5. **🚀 Deploy** - Use the [deployment guide](./docs/deployment/README.md) for production

## ⚡ Quick Commands

```bash
# Development
npm run dev                 # Start frontend
npm run docker:dev         # Start all services with Docker

# Build
npm run build              # Build frontend
npm run docker:build      # Build all Docker images

# Database
cd backend
npm run db:migrate         # Run database migrations
npm run db:studio         # Open database browser

# Health checks
curl http://localhost:3001/health  # Backend
curl http://localhost:8000/health  # ML Service
```

## 🔧 Configuration

### Environment Variables

Create `.env` files based on `.env.example`:

```bash
# Copy and customize environment files
cp .env.example .env
```

#### Frontend

```bash
# Frontend environment variables
VITE_API_BASE_URL=http://localhost:3001/api
VITE_ML_SERVICE_URL=http://localhost:8000
```

#### Backend API

```bash
# Backend API environment variables
JWT_ACCESS_SECRET=your-super-secret-jwt-access-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secret-jwt-refresh-key-change-this-in-production
DATABASE_URL=file:./dev.db
PORT=3001
```

#### ML Service

```bash
# ML Service environment variables
ML_SERVICE_PORT=8000
MODEL_WEIGHTS_DIR=/app/weights
DEFAULT_MODEL=resunet_small
```

> ⚠️ **Security Notice**: Never commit `.env` files with real secrets to version control. Always use secure, randomly generated keys in production.

## 🛠️ Development Workflow

1. **Setup Environment**: Follow [Getting Started Guide](./docs/development/getting-started.md)
2. **Make Changes**: Edit code with hot reload enabled
3. **Test Changes**: Use provided testing procedures
4. **Review Code**: Follow coding standards and best practices
5. **Deploy**: Use Docker for consistent deployments

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](./docs/development/contributing.md) for details on:

- Code style and standards
- Testing requirements
- Pull request process
- Issue reporting

## 📝 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🆘 Support

- **📚 Documentation**: Check the [docs](./docs/) directory
- **🐛 Issues**: Report bugs via GitHub Issues
- **💬 Discussions**: Join community discussions
- **📧 Contact**: Reach out for enterprise support

---

Built with ❤️ using modern web technologies | Last updated: 2025-08-14
