.PHONY: help build up down restart logs logs-f logs-fe logs-be logs-ml clean status health-status health-check shell-fe shell-be shell-ml dev-setup reset start rebuild test test-ui test-e2e test-e2e-ui test-coverage lint lint-fix type-check dev prod generate-ssl-cert metrics prometheus grafana alerts prometheus-config-check test-alerts monitor-health monitor-setup restart-grafana restart-prometheus monitor-errors export-metrics monitor-resources clean-monitoring download-weights check-weights weights-info

# Detect Docker Compose version  
DOCKER_COMPOSE := docker compose

# Environment file selection
ENV_FILE ?= .env.development

# Default target
help:
	@echo "SphereSeg Docker Environment"
	@echo ""
	@echo "📦 Environment Commands:"
	@echo "  dev         Start development environment (.env.development)"
	@echo "  prod        Start production environment (.env.production.template)"
	@echo ""
	@echo "🚀 Service Commands:"
	@echo "  build       Build all Docker images"
	@echo "  up          Start all services"
	@echo "  down        Stop all services"
	@echo "  restart     Restart all services"
	@echo ""
	@echo "📋 Monitoring Commands:"
	@echo "  logs        View logs from all services"
	@echo "  logs-f      Follow logs from all services"
	@echo "  logs-fe     View frontend logs"
	@echo "  logs-be     View backend logs"
	@echo "  logs-ml     View ML service logs"
	@echo "  status      Show container status"
	@echo "  health      Check health of all services"
	@echo ""
	@echo "📊 Advanced Monitoring:"
	@echo "  metrics     View raw metrics endpoint"
	@echo "  prometheus  Open Prometheus dashboard"
	@echo "  grafana     Open Grafana dashboard"
	@echo "  alerts      Check active alerts"
	@echo "  monitor-setup  Initialize monitoring dashboards"
	@echo ""
	@echo "🛠️  Development Commands:"
	@echo "  shell-fe    Open shell in frontend container"
	@echo "  shell-be    Open shell in backend container"
	@echo "  shell-ml    Open shell in ML container"
	@echo "  test        Run tests in containers"
	@echo "  clean       Clean up Docker resources"
	@echo "  reset       Reset everything (clean + rebuild)"
	@echo ""
	@echo "🤖 Model Weights Management:"
	@echo "  download-weights  Download ML model weights (~1.8 GB)"
	@echo "  check-weights     Verify model weights are present"
	@echo "  weights-info      Show detailed weights information"
	@echo ""

# Build all services
build:
	@echo "🔨 Building Docker images with $(ENV_FILE)..."
	ENV_FILE=$(ENV_FILE) $(DOCKER_COMPOSE) build --parallel

# Start all services
up:
	@echo "🚀 Starting services with $(ENV_FILE)..."
	ENV_FILE=$(ENV_FILE) $(DOCKER_COMPOSE) up -d
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

# Deep clean - aggressive Docker cleanup
deep-clean:
	@echo "🧹💪 Deep cleaning Docker resources..."
	@scripts/docker-build-optimizer.sh --aggressive

# Optimized build for production
build-optimized:
	@echo "🚀 Building production images..."
	$(DOCKER_COMPOSE) -f docker-compose.production.yml build --parallel

# Build without cache (clean build)
build-clean:
	@echo "🔨 Clean build (no cache)..."
	$(DOCKER_COMPOSE) -f docker-compose.production.yml build --no-cache --parallel

# Build specific service
build-service:
	@echo "🔨 Building service: $(SERVICE)..."
	$(DOCKER_COMPOSE) -f docker-compose.production.yml build $(SERVICE)

# Show Docker disk usage
docker-usage:
	@echo "📊 Docker Disk Usage:"
	@docker system df
	@echo ""
	@echo "📦 Image Sizes:"
	@docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | head -20

# Optimize Docker storage
optimize-storage:
	@echo "⚡ Optimizing Docker storage..."
	@scripts/docker-build-optimizer.sh --max-cache 5 --keep-images 2

# Show container status
status:
	@echo "📊 Container Status:"
	$(DOCKER_COMPOSE) ps

# Health check status
health-status:
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
	@make health-check

# Reset everything
reset: clean build up
	@echo "🔄 Environment reset complete!"

# Quick start
start: up
	@make health-check

# Full rebuild
rebuild: down build up
	@echo "♻️  Full rebuild complete!"

# Test services health
health-check:
	@echo "🧪 Testing services..."
	@command -v curl >/dev/null 2>&1 || { echo "❌ Error: curl is not installed. Please install curl to run health checks."; exit 1; }
	@set -e; \
	status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3001/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ Backend healthy"; else echo "❌ Backend unhealthy (HTTP $$status)"; exit 1; fi
	@set -e; \
	status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8000/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ ML Service healthy"; else echo "❌ ML Service unhealthy (HTTP $$status)"; exit 1; fi
	@set -e; \
	status=$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/health) && \
	 if [ "$$status" = "200" ]; then echo "✅ Frontend healthy"; else echo "❌ Frontend unhealthy (HTTP $$status)"; exit 1; fi

# Run unit tests in Docker
test:
	@echo "🧪 Running unit tests in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run test

# Test email configuration with MailHog
test-email-mailhog:
	@echo "📧 Testing email with MailHog..."
	@echo "1. MailHog SMTP: localhost:1025 (SMTP)"
	@echo "2. MailHog Web UI: http://localhost:8025"
	@echo "3. Configuration uses MailHog by default"
	@echo "✅ Open http://localhost:8025 to see sent emails"

# Test email configuration with UTIA SMTP
test-email-utia:
	@echo "📧 Testing email with UTIA SMTP..."
	@echo "⚠️  First, update password in .env.utia file"
	@echo "Then restart backend with: make restart-backend-utia"
	@echo "API endpoint: http://localhost:3001/api/test-email/test-connection"

# Restart backend with UTIA email config
restart-backend-utia:
	@echo "🔄 Restarting backend with UTIA email configuration..."
	$(DOCKER_COMPOSE) stop backend
	ENV_FILE=.env.utia $(DOCKER_COMPOSE) up -d backend
	@echo "✅ Backend restarted with UTIA config"
	@echo "Test connection: curl http://localhost:3001/api/test-email/test-connection"

# Run unit tests with UI in Docker
test-ui:
	@echo "🧪 Running unit tests with UI in Docker..."
	@$(DOCKER_COMPOSE) exec frontend npm run test:ui

# Run E2E tests in Docker
test-e2e:
	@echo "🧪 Running E2E tests in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run test:e2e

# Run E2E tests with UI in Docker
test-e2e-ui:
	@echo "🧪 Running E2E tests with UI in Docker..."
	@$(DOCKER_COMPOSE) exec frontend npm run test:e2e:ui

# Run test coverage in Docker
test-coverage:
	@echo "🧪 Running test coverage in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run test:coverage

# Run linting in Docker
lint:
	@echo "🔍 Running linting in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run lint

# Run lint fix in Docker
lint-fix:
	@echo "🔧 Running lint fix in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run lint:fix

# Run type checking in Docker
type-check:
	@echo "🔍 Running type checking in Docker..."
	@$(DOCKER_COMPOSE) exec -T frontend npm run type-check

# Development environment
dev:
	@echo "🚀 Starting development environment..."
	@if [ ! -f .env.development ]; then \
		echo "❌ .env.development not found! Creating from template..."; \
		cp .env.example .env.development; \
		echo "📝 Please edit .env.development with your settings (especially JWT secrets)"; \
		echo "💡 Generate JWT secrets with: openssl rand -hex 32"; \
		exit 1; \
	fi
	@$(MAKE) ENV_FILE=.env.development up
	@echo "🎉 Development environment ready!"
	@echo "📝 Edit files locally - changes sync automatically"

# Production environment
prod:
	@echo "🚀 Starting production environment..."
	@if [ ! -f .env.production ]; then \
		echo "❌ .env.production not found!"; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) -f docker-compose.production.yml build --parallel
	$(DOCKER_COMPOSE) -f docker-compose.production.yml up -d
	@echo "🎉 Production environment started!"

# Generate SSL certificates for testing
generate-ssl-cert:
	@echo "🔐 Generating self-signed SSL certificates for testing..."
	@mkdir -p docker/nginx/ssl
	@openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
		-keyout docker/nginx/ssl/server.key \
		-out docker/nginx/ssl/server.crt \
		-subj "/C=US/ST=State/L=City/O=Cell Segmentation Hub/CN=localhost" \
		-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
	@chmod 600 docker/nginx/ssl/server.key
	@chmod 644 docker/nginx/ssl/server.crt
	@echo "✅ Self-signed certificates generated in docker/nginx/ssl/"
	@echo "⚠️  These are for testing only - use proper certificates in production"

# ===== MONITORING COMMANDS =====

# View raw metrics endpoint
metrics:
	@echo "📊 Fetching metrics from backend service..."
	@curl -s http://localhost:3001/metrics | head -20
	@echo ""
	@echo "Full metrics available at: http://localhost:3001/metrics"

# Open Prometheus dashboard
prometheus:
	@echo "🔍 Opening Prometheus dashboard..."
	@echo "Dashboard URL: http://localhost:9090"
	@if command -v open >/dev/null 2>&1; then \
		open http://localhost:9090; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		xdg-open http://localhost:9090; \
	else \
		echo "Please manually open http://localhost:9090 in your browser"; \
	fi

# Open Grafana dashboard
grafana:
	@echo "📈 Opening Grafana dashboard..."
	@echo "Dashboard URL: http://localhost:3030"
	@echo "Default credentials: admin / admin123"
	@if command -v open >/dev/null 2>&1; then \
		open http://localhost:3030; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		xdg-open http://localhost:3030; \
	else \
		echo "Please manually open http://localhost:3030 in your browser"; \
	fi

# Check active alerts
alerts:
	@echo "🚨 Checking active alerts..."
	@curl -s http://localhost:9090/api/v1/alerts | jq '.data[] | select(.state=="firing") | {alertname: .labels.alertname, severity: .labels.severity, summary: .annotations.summary}' 2>/dev/null || \
	curl -s http://localhost:9090/api/v1/alerts
	@echo ""
	@echo "Full alerts API: http://localhost:9090/api/v1/alerts"

# Validate Prometheus configuration
prometheus-config-check:
	@echo "🔧 Validating Prometheus configuration..."
	@if $(DOCKER_COMPOSE) exec prometheus promtool check config /etc/prometheus/prometheus.yml; then \
		echo "✅ Prometheus configuration is valid"; \
	else \
		echo "❌ Prometheus configuration has errors"; \
		exit 1; \
	fi
	@if $(DOCKER_COMPOSE) exec prometheus promtool check rules /etc/prometheus/alerts.yml; then \
		echo "✅ Alert rules are valid"; \
	else \
		echo "❌ Alert rules have errors"; \
		exit 1; \
	fi

# Test alert rules
test-alerts:
	@echo "🧪 Testing alert rule syntax..."
	@$(DOCKER_COMPOSE) exec prometheus promtool check rules /etc/prometheus/alerts.yml

# Monitor system health
monitor-health:
	@echo "🏥 System Health Check"
	@echo "======================="
	@echo ""
	@echo "📊 Service Status:"
	@curl -s http://localhost:3001/health | jq '.' 2>/dev/null || curl -s http://localhost:3001/health
	@echo ""
	@echo "📈 Prometheus Targets:"
	@curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health, lastScrape: .lastScrape}' 2>/dev/null || echo "Prometheus not accessible"
	@echo ""
	@echo "🚨 Active Alerts:"
	@curl -s http://localhost:9090/api/v1/alerts | jq '.data[] | select(.state=="firing") | .labels.alertname' 2>/dev/null || echo "No alerts or Prometheus not accessible"

# Setup monitoring dashboards (provision dashboards to Grafana)
monitor-setup:
	@echo "🔧 Setting up monitoring dashboards..."
	@echo "Copying dashboard configurations to Grafana..."
	@mkdir -p docker/grafana/dashboards
	@cp monitoring/dashboards/*.json docker/grafana/dashboards/ || echo "Dashboard files copied"
	@echo "✅ Dashboard files copied to docker/grafana/dashboards/"
	@echo "📈 Restart Grafana to load new dashboards: make restart-grafana"
	@echo ""
	@echo "📋 Available Dashboards:"
	@echo "  • Business Overview: http://localhost:3030/d/business-overview"
	@echo "  • Performance: http://localhost:3030/d/performance"
	@echo "  • Alerts: http://localhost:3030/d/alerts"

# Restart specific services
restart-grafana:
	@echo "🔄 Restarting Grafana..."
	@$(DOCKER_COMPOSE) restart grafana

restart-prometheus:
	@echo "🔄 Restarting Prometheus..."
	@$(DOCKER_COMPOSE) restart prometheus

# Monitor logs for errors
monitor-errors:
	@echo "🔍 Monitoring logs for errors (press Ctrl+C to stop)..."
	@$(DOCKER_COMPOSE) logs -f | grep -i error --color=always

# Export monitoring data
export-metrics:
	@echo "💾 Exporting metrics data..."
	@mkdir -p monitoring/exports
		@curl -s "http://localhost:9090/api/v1/query_range?query=up&start=$$(shell if command -v gdate >/dev/null 2>&1 || date -d '1 hour ago' >/dev/null 2>&1; then date -d '1 hour ago' --iso-8601 2>/dev/null || gdate -d '1 hour ago' --iso-8601 2>/dev/null; else python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow()-timedelta(hours=1)).isoformat()+'Z')"; fi)&end=$$(shell if command -v gdate >/dev/null 2>&1 || date --iso-8601 >/dev/null 2>&1; then date --iso-8601 2>/dev/null || gdate --iso-8601 2>/dev/null; else python3 -c "from datetime import datetime; print(datetime.utcnow().isoformat()+'Z')"; fi)&step=60s" > monitoring/exports/uptime_last_hour.json
	@curl -s "http://localhost:9090/api/v1/query?query=spheroseg_dau" > monitoring/exports/current_dau.json
	@echo "✅ Metrics exported to monitoring/exports/"

# Monitor resource usage
monitor-resources:
	@echo "💻 Current Resource Usage"
	@echo "========================="
	@$(DOCKER_COMPOSE) exec prometheus sh -c 'wget -qO- http://localhost:9090/api/v1/query?query=process_resident_memory_bytes | head -1' || echo "Memory data not available"
	@$(DOCKER_COMPOSE) exec prometheus sh -c 'wget -qO- "http://localhost:9090/api/v1/query?query=rate(process_cpu_user_seconds_total[5m])*100" | head -1' || echo "CPU data not available"
	@echo ""
	@echo "📊 Live resource monitoring: http://localhost:3030/d/performance"

# Clean monitoring data
clean-monitoring:
	@echo "🧹 Cleaning monitoring data..."
	@$(DOCKER_COMPOSE) down prometheus grafana
	@docker volume rm cell-segmentation-hub_prometheus_data cell-segmentation-hub_grafana_data 2>/dev/null || true
	@echo "✅ Monitoring data cleaned. Run 'make up' to restart with fresh data."

# ============================================================================
# ML Model Optimization
# ============================================================================

# Optimize batch sizes for production inference
optimize-batch:
	@echo "🚀 Optimizing batch sizes for production inference..."
	@echo "⚠️  This will take several minutes and requires GPU access"
	@$(DOCKER_COMPOSE) exec -T ml-service python /app/scripts/optimize_production_batch.py
	@echo "✅ Batch optimization complete! Configuration saved to backend/segmentation/config/production_batch_config.json"

# Test production configuration
test-production:
	@echo "🧪 Testing production configuration..."
	@$(DOCKER_COMPOSE) exec -T ml-service python /app/scripts/test_production_config.py
	@echo "✅ Production testing complete! Results saved to backend/segmentation/results/"

# View current batch configuration
show-batch-config:
	@echo "📊 Current Production Batch Configuration:"
	@echo "=========================================="
	@cat backend/segmentation/config/production_batch_config.json 2>/dev/null || echo "No configuration found. Run 'make optimize-batch' first."

# Run batch optimization and testing
optimize-all: optimize-batch test-production
	@echo "✅ Full optimization and testing complete!"
# ============================================
# Model Weights Management
# ============================================

# Download ML model weights
download-weights:
	@echo "📥 Downloading ML model weights..."
	@echo "This will download ~1.8 GB of model weights"
	@if [ \! -d "backend/segmentation/weights" ]; then mkdir -p backend/segmentation/weights; fi
	@cd backend/segmentation && python scripts/download_weights.py
	@echo "✅ Weights download complete\!"

# Check if model weights exist
check-weights:
	@echo "🔍 Checking model weights..."
	@if [ -d "backend/segmentation/weights" ] && [ -n "$$(ls -A backend/segmentation/weights/*.pth 2>/dev/null)" ]; then \
		echo "✅ Model weights found"; \
		echo ""; \
		du -sh backend/segmentation/weights; \
	else \
		echo "❌ Model weights missing\!"; \
		echo ""; \
		echo "Run: make download-weights"; \
		echo "Or mount existing weights as volume"; \
		exit 1; \
	fi

# Show detailed weights information
weights-info:
	@echo "🤖 Model Weights Information"
	@echo "=============================="
	@echo ""
	@if [ -d "backend/segmentation/weights" ] && [ -n "$$(ls -A backend/segmentation/weights/*.pth 2>/dev/null)" ]; then \
		echo "Weights directory: backend/segmentation/weights"; \
		echo ""; \
		echo "Available models:"; \
		ls -lh backend/segmentation/weights/*.pth 2>/dev/null || true; \
		echo ""; \
		echo "Total size:"; \
		du -sh backend/segmentation/weights 2>/dev/null || echo "Unknown"; \
	else \
		echo "❌ No weights found in backend/segmentation/weights/"; \
		echo ""; \
		echo "To download: make download-weights"; \
	fi

