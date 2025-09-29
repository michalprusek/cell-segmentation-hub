# Cell Segmentation Hub

Advanced cell segmentation platform powered by deep learning models. Complete system with React frontend, Node.js backend, and Python ML microservice.

## 🚀 Quick Start

### Prerequisites

- **Docker** (version 20.10+) and **Docker Compose** v2
- **Git**
- **8GB+ RAM** recommended
- **(Optional) NVIDIA GPU** for ML service acceleration

### Start Development Environment

```bash
# Clone the repository
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub

# Start all services with Docker
make dev
```

**That's it!** 🎉 All services will start automatically.

Access the application:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **ML Service**: http://localhost:8000
- **Grafana Dashboard**: http://localhost:3030
- **Prometheus**: http://localhost:9090
- **MailHog (Email Testing)**: http://localhost:8025

### Development Commands

This project uses **Makefile** for all common tasks:

```bash
# Starting & Stopping
make dev              # Start development environment
make up               # Start all services
make down             # Stop all services
make restart          # Restart all services

# Monitoring
make logs-f           # Follow logs from all services
make logs-fe          # View frontend logs
make logs-be          # View backend logs
make logs-ml          # View ML service logs
make health           # Check health of all services
make status           # Show container status

# Development
make shell-fe         # Open shell in frontend container
make shell-be         # Open shell in backend container
make shell-ml         # Open shell in ML service container

# Testing & Quality
make test             # Run all tests in Docker
make test-e2e         # Run end-to-end tests
make lint             # Run linting
make type-check       # TypeScript type checking

# Building
make build-optimized  # Build with optimization (auto cleanup)
make build-clean      # Clean rebuild without cache

# Monitoring & Metrics
make prometheus       # Open Prometheus dashboard
make grafana          # Open Grafana dashboard
make metrics          # View metrics endpoint

# Cleanup
make clean            # Clean Docker resources
make deep-clean       # Aggressive cleanup
make docker-usage     # Show Docker disk usage
```

See all available commands: `make help`

---

## 🚀 Production Deployment

For production deployment instructions, see:
- **[Deployment Guide](./docs/deployment/README.md)** - Complete production setup
- **[Blue-Green Deployment](./docs/deployment/blue-green.md)** - Zero-downtime deployments
- **[STAGING.md](./STAGING.md)** - Staging environment setup

Production URL: https://spherosegapp.utia.cas.cz

---

## 🛠️ Manual Setup (Alternative)

**⚠️ Note:** Docker is the recommended approach. Use manual setup only for specific debugging needs.

```bash
# 1. Backend API
cd backend
npm install
npm run dev          # http://localhost:3001

# 2. Python ML Service
cd backend/segmentation
pip install -r requirements.txt
python main.py       # http://localhost:8000

# 3. Frontend
npm install
npm run dev          # http://localhost:5173
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

**Interactive API Documentation**: http://localhost:3001/api-docs (when running locally)

### 💻 [Development](./docs/development/)

Developer setup and contribution guide

- [Getting Started](./docs/development/getting-started.md) - Local development setup
- [Testing Guide](./docs/development/testing.md) - Testing procedures

### 🚀 [Deployment](./docs/deployment/)

Production deployment guides

- [Deployment Guide](./docs/deployment/README.md) - Production setup with Docker

### 📖 [User Guide](./docs/guides/)

End-user documentation

- [User Guide](./docs/guides/user-guide.md) - Complete application usage guide

### 📋 [Reference](./docs/reference/)

Technical reference materials

- [Database Schema](./docs/reference/database-schema.md) - Complete database structure
- [ML Models](./docs/reference/ml-models.md) - Available segmentation models

## 🏗️ System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │───▶│  Node.js API    │───▶│  Python ML      │
│   Port: 5173    │    │  Port: 3001     │    │  Port: 8000     │
│   (Vite + React)│    │  (Express)      │    │  (FastAPI)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
       │                        │                        │
       │                        ▼                        ▼
       │               ┌─────────────────┐    ┌─────────────────┐
       │               │  PostgreSQL DB  │    │  PyTorch Models │
       └──────────────▶│   Prisma ORM    │    │  HRNet, ResUNet │
                       │   + Redis       │    │  + GPU (CUDA)   │
                       └─────────────────┘    └─────────────────┘
```

**Architecture Highlights:**
- **Frontend**: React 18 + TypeScript + Vite (hot reload)
- **Backend**: Node.js + Express + Prisma ORM
- **Database**: PostgreSQL (production) / SQLite (development)
- **ML Service**: Python + FastAPI + PyTorch + CUDA
- **Caching**: Redis for session and queue management
- **Monitoring**: Prometheus + Grafana for metrics

## 🤖 AI Models

### Available Models

- **HRNetV2**: High-Resolution Network (0.2s per image, highest throughput)
- **CBAM-ResUNet**: Advanced with attention mechanisms (0.3s per image, best accuracy)

### Performance Benchmarks

| Model        | Inference Time | Throughput  | Batch Size  | P95 Latency | Best Use Case              |
| ------------ | -------------- | ----------- | ----------- | ----------- | -------------------------- |
| HRNet        | ~0.2s/image    | 5.5 img/sec | 8 (optimal) | <0.3s       | High-throughput processing |
| CBAM-ResUNet | ~0.3s/image    | 3.0 img/sec | 2 (optimal) | <0.7s       | Maximum accuracy analysis  |

### Production Configuration

- **Dynamic Batching**: Enabled with 5ms queue delay for optimal GPU utilization
- **GPU**: NVIDIA RTX A5000 (24GB VRAM)
- **Max Batch Sizes**: HRNet (12), CBAM-ResUNet (4) for offline processing
- **SLA Compliance**: All models maintain P95 latency under 1 second

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

1. **⚡ Quick Start** - Run `make dev` and you're ready!
2. **📖 Read the [Getting Started Guide](./docs/development/getting-started.md)** - Complete setup instructions
3. **🏗️ Understand the [Architecture](./docs/architecture/README.md)** - System design overview
4. **🔌 Explore the [API](http://localhost:3001/api-docs)** - Interactive API documentation
5. **👨‍💻 Start Developing** - Use `make help` to see all commands

## ⚡ Essential Commands

```bash
# Start & Stop
make dev                   # Start development environment
make down                  # Stop all services
make restart               # Restart services

# Monitoring
make logs-f                # Follow all logs
make health                # Check service health
make status                # Show container status

# Development
make shell-be              # Access backend shell
make test                  # Run tests
make lint                  # Run linting

# Database (from backend shell)
npx prisma migrate dev     # Run migrations
npx prisma studio          # Open database browser

# Health Checks
curl http://localhost:3001/health  # Backend
curl http://localhost:8000/health  # ML Service
curl http://localhost:5173         # Frontend
```

**See all commands**: `make help`

## 🔧 Configuration

### Environment Variables

The application uses `.env` files for configuration. Default development settings work out of the box!

**For production**, create a `.env` file:

```bash
# Copy example and customize
cp .env.example .env
```

**Key environment variables:**

```bash
# Backend API
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/spheroseg
JWT_ACCESS_SECRET=your-secret-key-here
JWT_REFRESH_SECRET=your-refresh-secret-here

# Frontend (Vite)
VITE_API_BASE_URL=http://localhost:3001/api
VITE_ML_SERVICE_URL=http://localhost:8000

# ML Service
ML_SERVICE_PORT=8000
MODEL_WEIGHTS_DIR=/app/weights
ENABLE_GPU=true
```

> ⚠️ **Security**: Never commit `.env` files with secrets! Use strong, random keys in production.

## 🛠️ Development Workflow

1. **Start Development**: `make dev` - All services start with hot reload
2. **Make Changes**: Edit code - changes apply automatically
3. **Test**: `make test` - Run tests in Docker
4. **Quality Check**: `make lint && make type-check`
5. **View Logs**: `make logs-f` - Monitor all services
6. **Database**: `make shell-be` then run Prisma commands

**Typical Development Session:**
```bash
make dev              # Start everything
make logs-f           # Watch logs in another terminal
# ... make your changes ...
make test             # Run tests
make lint             # Check code quality
make down             # Stop when done
```

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork and Clone**: Fork the repository and clone locally
2. **Create Branch**: `git checkout -b feature/your-feature`
3. **Make Changes**: Follow the development workflow above
4. **Test**: Ensure all tests pass (`make test`)
5. **Commit**: Use clear commit messages
6. **Push and PR**: Push to your fork and create a pull request

**Code Standards:**
- TypeScript for frontend and backend
- Python type hints for ML service
- Run `make lint` before committing
- Write tests for new features

## 📝 License

This project is developed at ÚTIA AV ČR. For licensing information, please contact spheroseg@utia.cas.cz.

## 🆘 Support

- **📚 Documentation**: Check the [docs](./docs/) directory
- **🐛 Issues**: Report bugs via GitHub Issues
- **💬 Discussions**: Join community discussions
- **📧 Contact**: Reach out for enterprise support

---

Built with ❤️ using modern web technologies | Last updated: 2025-08-14
