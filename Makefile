.PHONY: help build up down restart logs logs-f logs-fe logs-be logs-ml clean status health shell-fe shell-be shell-ml dev-setup reset start rebuild test

# Detect Docker Compose version
DOCKER_COMPOSE := $(shell command -v docker compose 2> /dev/null && echo "docker compose" || echo "docker-compose")

# Default target
help:
	@echo "SphereSeg Docker Development Environment"
	@echo ""
	@echo "Available commands:"
	@echo "  build       Build all Docker images"
	@echo "  up          Start all services"
	@echo "  down        Stop all services"
	@echo "  restart     Restart all services"
	@echo "  logs        View logs from all services"
	@echo "  logs-f      Follow logs from all services"
	@echo "  logs-fe     View frontend logs"
	@echo "  logs-be     View backend logs"
	@echo "  logs-ml     View ML service logs"
	@echo "  clean       Clean up Docker resources"
	@echo "  status      Show container status"
	@echo "  health      Check health of all services"
	@echo "  shell-fe    Open shell in frontend container"
	@echo "  shell-be    Open shell in backend container"
	@echo "  shell-ml    Open shell in ML container"
	@echo "  test        Run tests in containers"
	@echo ""

# Build all services
build:
	@echo "🔨 Building Docker images..."
	$(DOCKER_COMPOSE) build --parallel

# Start all services
up:
	@echo "🚀 Starting services..."
	$(DOCKER_COMPOSE) up -d
	@echo "✅ Services started!"
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:3001"
	@echo "ML Service: http://localhost:8000"

# Stop all services
down:
	@echo "🛑 Stopping services..."
	$(DOCKER_COMPOSE) down

# Restart all services
restart:
	@echo "🔄 Restarting services..."
	$(DOCKER_COMPOSE) restart

# View logs
logs:
	$(DOCKER_COMPOSE) logs

# Follow logs
logs-f:
	$(DOCKER_COMPOSE) logs -f

# Frontend logs
logs-fe:
	$(DOCKER_COMPOSE) logs -f frontend

# Backend logs
logs-be:
	$(DOCKER_COMPOSE) logs -f backend

# ML service logs
logs-ml:
	$(DOCKER_COMPOSE) logs -f ml-service

# Clean up Docker resources
clean:
	@echo "🧹 Cleaning Docker resources..."
	$(DOCKER_COMPOSE) down --volumes --remove-orphans
	docker system prune -f
	docker volume prune -f

# Show container status
status:
	@echo "📊 Container Status:"
	$(DOCKER_COMPOSE) ps

# Health check
health:
	@echo "🏥 Health Status:"
	@$(DOCKER_COMPOSE) ps --format "table {{.Name}}\t{{.Status}}"
	@echo ""
	@echo "Service URLs:"
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:3001/health"
	@echo "ML Service: http://localhost:8000/health"

# Shell access
shell-fe:
	$(DOCKER_COMPOSE) exec frontend sh

shell-be:
	$(DOCKER_COMPOSE) exec backend sh

shell-ml:
	$(DOCKER_COMPOSE) exec ml-service bash

# Development commands
dev-setup: build up
	@echo "🔧 Development environment ready!"
	@make health

# Reset everything
reset: clean build up
	@echo "🔄 Environment reset complete!"

# Quick start
start: up
	@make health

# Full rebuild
rebuild: down build up
	@echo "♻️  Full rebuild complete!"

# Test services
test:
	@echo "🧪 Testing services..."
	@status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3001/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ Backend healthy"; else echo "❌ Backend unhealthy (HTTP $$status)"; exit 1; fi
	@status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8000/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ ML Service healthy"; else echo "❌ ML Service unhealthy (HTTP $$status)"; exit 1; fi
	@status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ Frontend healthy"; else echo "❌ Frontend unhealthy (HTTP $$status)"; exit 1; fi