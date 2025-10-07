#!/bin/bash
# Skript pro aktivaci access logování v produkčním prostředí
# Použití: ./ACTIVATE_LOGGING.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "  AKTIVACE ACCESS LOGOVÁNÍ"
echo "======================================"
echo ""

# Set the base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR"

# Check if .active-environment exists
if [ ! -f ".active-environment" ]; then
    echo -e "${RED}Error: .active-environment file not found${NC}"
    echo "Run ./scripts/switch-environment.sh [blue|green] first"
    exit 1
fi

# Load active environment
ACTIVE_ENV=$(grep ACTIVE_COLOR .active-environment | cut -d'=' -f2)
echo -e "${GREEN}✓ Aktivní prostředí: $ACTIVE_ENV${NC}"

# Load environment variables
if [ ! -f ".env.${ACTIVE_ENV}" ]; then
    echo -e "${RED}Error: .env.${ACTIVE_ENV} file not found${NC}"
    exit 1
fi

if [ ! -f ".env.common" ]; then
    echo -e "${RED}Error: .env.common file not found${NC}"
    exit 1
fi

echo "Loading environment configuration..."
set -a  # automatically export all variables
source .env.common
source .env.${ACTIVE_ENV}
set +a

echo -e "${GREEN}✓ Configuration loaded${NC}"
echo ""

# Verify backend container exists
if ! docker ps -a --format "{{.Names}}" | grep -q "^${ACTIVE_ENV}-backend$"; then
    echo -e "${RED}Error: Backend container ${ACTIVE_ENV}-backend not found${NC}"
    echo "Start the environment first: docker compose -f docker-compose.${ACTIVE_ENV}.yml up -d"
    exit 1
fi

# Restart backend pro aktivaci middleware
echo "1. Restartování backend kontejneru..."
if docker restart ${ACTIVE_ENV}-backend; then
    echo -e "${GREEN}✓ Backend restartován${NC}"
else
    echo -e "${RED}Error: Failed to restart backend${NC}"
    exit 1
fi
echo ""

# Verify nginx container exists
if ! docker ps -a --format "{{.Names}}" | grep -q "^nginx-${ACTIVE_ENV}$"; then
    echo -e "${YELLOW}⚠ Warning: nginx-${ACTIVE_ENV} container not found${NC}"
    echo "Nginx reload will be skipped"
    SKIP_NGINX=true
fi

# Reload nginx pro novou konfiguraci
if [ "$SKIP_NGINX" != "true" ]; then
    echo "2. Reload nginx konfigurace..."
    if docker exec nginx-${ACTIVE_ENV} nginx -t 2>/dev/null; then
        if docker exec nginx-${ACTIVE_ENV} nginx -s reload; then
            echo -e "${GREEN}✓ Nginx konfigurace reloadována${NC}"
        else
            echo -e "${YELLOW}⚠ Warning: Nginx reload failed${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Warning: Nginx configuration test failed${NC}"
    fi
    echo ""
fi

# Počkat 3 sekundy na inicializaci
echo "Waiting for backend initialization..."
sleep 3

# Ověření, že logy fungují
echo "3. Testování access logování..."
echo "   Generuji testovací požadavek..."

# Build health check URL from environment variables
HEALTH_URL="https://${SSL_DOMAIN}/api/health"
echo "   Testing: $HEALTH_URL"

# Test with retries
MAX_RETRIES=3
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s -f --max-time 10 "$HEALTH_URL" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Health check successful${NC}"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo -e "${YELLOW}⚠ Health check failed, retrying ($RETRY_COUNT/$MAX_RETRIES)...${NC}"
            sleep 2
        else
            echo -e "${YELLOW}⚠ Warning: Health check failed after $MAX_RETRIES attempts${NC}"
            echo "   This may be normal if the service is still initializing"
        fi
    fi
done

sleep 1

# Kontrola log souborů
BACKEND_LOG="/home/cvat/cell-segmentation-hub/logs/${ACTIVE_ENV}/backend/access.log"
NGINX_LOG="/home/cvat/cell-segmentation-hub/logs/${ACTIVE_ENV}/nginx/access.log"

echo ""
echo "4. Kontrola log souborů..."
echo ""

if [ -s "$BACKEND_LOG" ]; then
    echo "✓ Backend access log aktivní:"
    echo "  Umístění: $BACKEND_LOG"
    echo "  Poslední záznam:"
    tail -n 1 "$BACKEND_LOG" | sed 's/^/    /'
else
    echo "⚠ Backend access log zatím prázdný (očekávejte záznamy po prvním API požadavku)"
fi

echo ""

if [ -s "$NGINX_LOG" ]; then
    echo "✓ Nginx access log aktivní:"
    echo "  Umístění: $NGINX_LOG"
    echo "  Poslední záznam:"
    tail -n 1 "$NGINX_LOG" | sed 's/^/    /'
else
    echo "⚠ Nginx access log zatím prázdný"
fi

echo ""
echo "======================================"
echo "  AKTIVACE DOKONČENA"
echo "======================================"
echo ""
echo "📝 Další kroky:"
echo ""
echo "1. Nastavte automatickou rotaci logů:"
echo "   crontab -e"
echo "   # Přidejte:"
echo "   0 2 * * * /home/cvat/cell-segmentation-hub/docker/logrotate/logrotate-cron.sh"
echo ""
echo "2. Sledujte živé logy:"
echo "   tail -f $BACKEND_LOG"
echo ""
echo "3. Dokumentace pro IT sekci:"
echo "   cat docs/ACCESS_LOGGING.md"
echo ""
echo "4. Rychlý setup guide:"
echo "   cat docs/ACCESS_LOGGING_SETUP.md"
echo ""
echo "======================================"
