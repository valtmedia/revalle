# ===========================================
# Proxy Node System - Makefile
# ===========================================

.PHONY: help build up down restart logs test lint clean deploy

# Default target
help: ## Show this help message
	@echo "Proxy Node System - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ===========================================
# Docker Commands
# ===========================================

build: ## Build all Docker images
	docker compose build

build-no-cache: ## Build all Docker images without cache
	docker compose build --no-cache

up: ## Start all services
	docker compose up -d
	@echo "\n✅ Services started!"
	@echo "  Dashboard: http://localhost:8080"
	@echo "  API:       http://localhost:3000"
	@echo "  Grafana:   http://localhost:3001"
	@echo "  Proxy:     localhost:3128"

down: ## Stop all services
	docker compose down

down-volumes: ## Stop all services and remove volumes
	docker compose down -v

restart: ## Restart all services
	docker compose restart

restart-api: ## Restart only the control plane
	docker compose restart control-plane

logs: ## Follow all service logs
	docker compose logs -f

logs-api: ## Follow control plane logs only
	docker compose logs -f control-plane

logs-squid: ## Follow squid proxy logs
	docker compose logs -f squid-proxy

ps: ## Show running containers
	docker compose ps

# ===========================================
# Development
# ===========================================

dev: ## Start in development mode
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

dev-api: ## Run API locally (without Docker)
	cd control-plane && npm run dev

install: ## Install Node.js dependencies
	cd control-plane && npm install

# ===========================================
# Testing
# ===========================================

test: ## Run all tests
	cd control-plane && npm test

test-watch: ## Run tests in watch mode
	cd control-plane && npm run test:watch

test-coverage: ## Run tests with coverage report
	cd control-plane && npm run test:coverage

test-docker: ## Run tests in Docker
	docker compose -f docker-compose.yml -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from control-plane
	docker compose -f docker-compose.yml -f docker-compose.test.yml down -v

# ===========================================
# Linting & Quality
# ===========================================

lint: ## Run ESLint
	cd control-plane && npm run lint

lint-fix: ## Run ESLint with auto-fix
	cd control-plane && npm run lint:fix

# ===========================================
# Database
# ===========================================

migrate: ## Run database migrations
	docker compose exec control-plane node scripts/migrate.js

seed: ## Seed the database with test data
	docker compose exec control-plane node scripts/seed.js

db-shell: ## Open MySQL shell
	docker compose exec mysql mysql -u proxy_admin -p proxy_system

redis-shell: ## Open Redis CLI
	docker compose exec redis redis-cli

# ===========================================
# Monitoring
# ===========================================

health: ## Check service health
	@echo "Control Plane:"
	@curl -sf http://localhost:3000/health | python3 -m json.tool 2>/dev/null || echo "  ❌ Not reachable"
	@echo "\nProxy:"
	@curl -sf --proxy http://localhost:3128 http://httpbin.org/ip 2>/dev/null && echo "  ✅ Proxy working" || echo "  ❌ Proxy not working"

stats: ## Get system statistics
	@curl -sf http://localhost:3000/api/stats/overview | python3 -m json.tool 2>/dev/null || echo "API not reachable"

nodes: ## List proxy nodes
	@curl -sf http://localhost:3000/api/nodes | python3 -m json.tool 2>/dev/null || echo "API not reachable"

# ===========================================
# Backup
# ===========================================

backup: ## Create a manual backup
	docker compose exec control-plane node -e "require('./src/backupManager').createBackup()"

# ===========================================
# Deployment
# ===========================================

deploy-init: ## Initialize Terraform
	cd ../terraform && terraform init

deploy-plan: ## Plan Terraform deployment
	cd ../terraform && terraform plan

deploy-apply: ## Apply Terraform deployment
	cd ../terraform && terraform apply -auto-approve

deploy-destroy: ## Destroy Terraform deployment
	cd ../terraform && terraform destroy -auto-approve

# ===========================================
# Cleanup
# ===========================================

clean: ## Remove all containers, images, and volumes
	docker compose down -v --rmi all --remove-orphans

clean-logs: ## Clean log files
	rm -rf control-plane/logs/*.log

clean-data: ## Clean data directory (⚠️ destructive!)
	rm -rf control-plane/data/*

prune: ## Docker system prune
	docker system prune -f
