.PHONY: help build build-no-cache build-clean up down restart logs logs-f logs-fe logs-be logs-ml clean clean-moderate clean-aggressive clean-nuclear clean-buildkit docker-usage status health-status health-check shell-fe shell-be shell-ml dev-setup reset start rebuild test test-ui test-e2e test-e2e-ui test-coverage lint lint-fix type-check dev prod generate-ssl-cert metrics prometheus grafana alerts prometheus-config-check test-alerts monitor-health monitor-setup restart-grafana restart-prometheus monitor-errors export-metrics monitor-resources clean-monitoring

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
	@echo "  build-no-cache  Build without cache (fresh build)"
	@echo "  build-clean Build with automatic cache cleanup"
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
	@echo "  reset       Reset everything (clean + rebuild)"
	@echo ""
	@echo "🧹 Cleanup Commands:"
	@echo "  clean       Light cleanup (safe)"
	@echo "  clean-moderate  Moderate cleanup (recommended)"
	@echo "  clean-aggressive  Remove all unused resources"
	@echo "  clean-buildkit   Clean only BuildKit cache"
	@echo "  docker-usage     Show Docker disk usage"
	@echo ""

# Build all services
build:
	@echo "🔨 Building Docker images with $(ENV_FILE)..."
	ENV_FILE=$(ENV_FILE) $(DOCKER_COMPOSE) build --parallel

# Build without cache (forces fresh build)
build-no-cache:
	@echo "🔨 Building Docker images WITHOUT cache..."
	@echo "🧹 Cleaning old build cache first..."
	@bash scripts/docker-cleanup.sh light 2>/dev/null || docker builder prune -f
	ENV_FILE=$(ENV_FILE) $(DOCKER_COMPOSE) build --no-cache --parallel

# Build with automatic cache cleanup
build-clean:
	@echo "🧹 Pre-build cleanup..."
	@bash scripts/docker-cleanup.sh light 2>/dev/null || docker builder prune -f
	@echo "🔨 Building Docker images with cache cleanup..."
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

# Clean up Docker resources (light cleanup)
clean:
	@echo "🧹 Cleaning Docker resources..."
	$(DOCKER_COMPOSE) down --volumes --remove-orphans
	docker system prune -f
	docker volume prune -f

# Moderate Docker cleanup (recommended for regular use)
clean-moderate:
	@echo "🧹 Performing moderate Docker cleanup..."
	@bash scripts/docker-cleanup.sh moderate || (docker system prune -f && docker builder prune -f)

# Aggressive Docker cleanup (removes all unused resources)
clean-aggressive:
	@echo "⚠️  Performing aggressive Docker cleanup..."
	@bash scripts/docker-cleanup.sh aggressive || docker system prune -a --volumes -f

# Nuclear cleanup (removes EVERYTHING - use with extreme caution!)
clean-nuclear:
	@echo "☢️  WARNING: This will remove ALL Docker resources!"
	@bash scripts/docker-cleanup.sh nuclear

# Clean only BuildKit cache
clean-buildkit:
	@echo "🧹 Cleaning BuildKit cache..."
	docker builder prune -a -f

# Show Docker disk usage
docker-usage:
	@echo "📊 Docker Disk Usage:"
	@docker system df
	@echo ""
	@echo "💡 Tip: Use 'make clean-moderate' for safe cleanup"

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

# Reset everything (with moderate cleanup)
reset: clean-moderate build-clean up
	@echo "🔄 Environment reset complete with cache cleanup!"
	@make health-check

# Reset with fresh build (no cache)
reset-fresh: clean-aggressive build-no-cache up
	@echo "🔄 Environment reset with completely fresh build!"
	@make health-check

# Quick start
start: up
	@make health-check

# Full rebuild (forces fresh build)
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
		echo "❌ .env.production not found! Creating from template..."; \
		cp .env.production.template .env.production; \
		echo "⚠️  CRITICAL: Edit .env.production with real production values!"; \
		echo "🔐 Replace ALL placeholder secrets and URLs before continuing"; \
		exit 1; \
	fi
	@if [ ! -f docker/nginx/ssl/server.crt ] || [ ! -f docker/nginx/ssl/server.key ]; then \
		echo "❌ SSL certificates not found!"; \
		echo "📜 Please place SSL certificates in docker/nginx/ssl/"; \
		echo "   Required files: server.crt and server.key"; \
		echo "   For testing, run: make generate-ssl-cert"; \
		exit 1; \
	fi
	@echo "🔍 Validating .env.production configuration..."
	@bash -c '\
		source .env.production 2>/dev/null; \
		MISSING_VARS=""; \
		PLACEHOLDER_FOUND=0; \
		VALIDATION_FAILED=0; \
		for var in JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATABASE_URL GF_SECURITY_ADMIN_PASSWORD; do \
			val=$${!var}; \
			if [ -z "$$val" ]; then \
				MISSING_VARS="$$MISSING_VARS $$var"; \
			elif echo "$$val" | grep -qE "(TODO|REPLACE|your_value_here|xxx|GENERATE_|<.*>|change_me|dummy)"; then \
				echo "❌ ERROR: $$var contains placeholder value: $$val"; \
				PLACEHOLDER_FOUND=1; \
			fi; \
		done; \
		if [ ! -z "$$MISSING_VARS" ]; then \
			echo "❌ ERROR: Required variables missing:$$MISSING_VARS"; \
			echo "📝 Please set all required variables in .env.production"; \
			exit 1; \
		fi; \
		if [ $$PLACEHOLDER_FOUND -eq 1 ]; then \
			echo "❌ ERROR: Placeholder values detected in .env.production"; \
			echo "🔐 Replace all placeholder values with secure, production-ready secrets"; \
			echo "💡 Generate JWT secrets with: openssl rand -hex 32"; \
			exit 1; \
		fi; \
		if ! echo "$$DATABASE_URL" | grep -qE "^(postgres://|postgresql://)"; then \
			if echo "$$DATABASE_URL" | grep -qE "(file:|sqlite:|localhost|127\\.0\\.0\\.1)"; then \
				echo "❌ ERROR: DATABASE_URL uses insecure scheme or localhost for production"; \
				echo "🔐 Production database must use postgres:// or postgresql:// with a remote host"; \
				exit 1; \
			fi; \
		fi; \
		if ! (echo "$$JWT_ACCESS_SECRET" | grep -qE "^[0-9a-fA-F]{64,}$$" || echo "$$JWT_ACCESS_SECRET" | grep -qE "^[A-Za-z0-9+/]{43,}=*$$" || [ "$${#JWT_ACCESS_SECRET}" -ge 32 ]) || \
		   ! (echo "$$JWT_REFRESH_SECRET" | grep -qE "^[0-9a-fA-F]{64,}$$" || echo "$$JWT_REFRESH_SECRET" | grep -qE "^[A-Za-z0-9+/]{43,}=*$$" || [ "$${#JWT_REFRESH_SECRET}" -ge 32 ]); then \
			echo "❌ ERROR: JWT secrets must be hexadecimal (64+ chars), base64, or at least 32 bytes"; \
			echo "💡 Generate secure secrets with:"; \
			echo "   Hex: openssl rand -hex 32"; \
			echo "   Base64: openssl rand -base64 32"; \
			exit 1; \
		fi; \
		if [ "$${#GF_SECURITY_ADMIN_PASSWORD}" -lt 12 ]; then \
			echo "❌ ERROR: GF_SECURITY_ADMIN_PASSWORD must be at least 12 characters"; \
			echo "💡 Use a password manager to generate a strong password"; \
			exit 1; \
		fi; \
		if echo "$$GF_SECURITY_ADMIN_PASSWORD" | grep -qiE "^(admin|password|changeme|grafana|123456|default)$$"; then \
			echo "❌ ERROR: GF_SECURITY_ADMIN_PASSWORD is a common weak password"; \
			echo "💡 Use a password manager to generate a strong password"; \
			exit 1; \
		fi; \
		if ! echo "$$GF_SECURITY_ADMIN_PASSWORD" | grep -q '[A-Z]' || \
		   ! echo "$$GF_SECURITY_ADMIN_PASSWORD" | grep -q '[a-z]' || \
		   ! echo "$$GF_SECURITY_ADMIN_PASSWORD" | grep -q '[0-9]' || \
		   ! echo "$$GF_SECURITY_ADMIN_PASSWORD" | grep -q '[^A-Za-z0-9]'; then \
			echo "❌ ERROR: GF_SECURITY_ADMIN_PASSWORD must contain uppercase, lowercase, digit, and symbol"; \
			echo "💡 Use a password manager to generate a strong password"; \
			exit 1; \
		fi; \
		echo "✅ Configuration validation passed"'
	@echo "🔨 Building production images..."
	@$(MAKE) ENV_FILE=.env.production build
	@ENV_FILE=.env.production $(DOCKER_COMPOSE) -f docker-compose.production.yml up -d
	@echo "🎉 Production environment started!"
	@echo "🌐 Check your domain configuration"

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