#!/bin/bash

# ================================================================
# Blue-Green Deployment Switcher for SpheroSeg
# ================================================================
# Tento skript přepíná mezi Blue a Green prostředími
# Autor: Claude Code Assistant
# Datum: 2025-08-26
# ================================================================

set -euo pipefail

# Barvy pro výstup
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Cesta k nginx konfiguraci
NGINX_CONF="/home/cvat/cell-segmentation-hub/docker/nginx/nginx.prod.conf"
NGINX_CONTAINER="nginx-blue"

# Funkce pro zobrazení nápovědy
show_help() {
    cat << EOF
Blue-Green Deployment Switcher
==============================

Použití:
  $0 [blue|green|status]

Příkazy:
  blue    - Přepne na Blue prostředí (porty 4000-4008)
  green   - Přepne na Green prostředí (porty 5000-5008) 
  status  - Zobrazí aktuální stav

Příklady:
  $0 status          # Zobrazí, které prostředí je aktivní
  $0 green           # Přepne na Green prostředí
  $0 blue            # Přepne zpět na Blue prostředí

EOF
    exit 0
}

# Funkce pro zjištění aktuálního prostředí
get_current_env() {
    if grep -q "server blue-backend:3001" "$NGINX_CONF" 2>/dev/null; then
        echo "blue"
    elif grep -q "server green-backend:3001" "$NGINX_CONF" 2>/dev/null; then
        echo "green"
    else
        echo "unknown"
    fi
}

# Funkce pro kontrolu zdraví prostředí
check_environment_health() {
    local env=$1
    local port_frontend=""
    local port_backend=""
    
    if [ "$env" = "blue" ]; then
        port_frontend=4000
        port_backend=4001
    else
        port_frontend=5000
        port_backend=5001
    fi
    
    echo -e "${BLUE}[INFO]${NC} Kontroluji zdraví $env prostředí..."
    
    # Kontrola frontend
    if curl -s -f "http://localhost:${port_frontend}/health" > /dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} ${env^} frontend je dostupný (port $port_frontend)"
    else
        echo -e "${RED}[✗]${NC} ${env^} frontend NENÍ dostupný!"
        return 1
    fi
    
    # Kontrola backend
    if curl -s -f "http://localhost:${port_backend}/health" > /dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} ${env^} backend je dostupný (port $port_backend)"
    else
        echo -e "${RED}[✗]${NC} ${env^} backend NENÍ dostupný!"
        return 1
    fi
    
    return 0
}

# Funkce pro zobrazení statusu
show_status() {
    local current_env=$(get_current_env)
    
    echo -e "\n${BLUE}=== Blue-Green Deployment Status ===${NC}\n"
    
    if [ "$current_env" = "blue" ]; then
        echo -e "Aktivní prostředí: ${BLUE}BLUE${NC} (porty 4000-4008)"
    elif [ "$current_env" = "green" ]; then
        echo -e "Aktivní prostředí: ${GREEN}GREEN${NC} (porty 5000-5008)"
    else
        echo -e "Aktivní prostředí: ${RED}NEZNÁMÉ${NC}"
    fi
    
    echo -e "\n${BLUE}[INFO]${NC} Kontroluji běžící kontejnery...\n"
    
    # Blue kontejnery
    echo -e "${BLUE}Blue prostředí:${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "^blue-" | head -5 || echo "  Žádné blue kontejnery neběží"
    
    echo ""
    
    # Green kontejnery
    echo -e "${GREEN}Green prostředí:${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "^green-" | head -5 || echo "  Žádné green kontejnery neběží"
    
    echo ""
    
    # Kontrola zdraví
    check_environment_health "blue" || true
    echo ""
    check_environment_health "green" || true
    
    echo -e "\n${BLUE}[INFO]${NC} Doména https://spherosegapp.utia.cas.cz směřuje na: ${current_env^^}"
}

# Funkce pro přepnutí prostředí
switch_environment() {
    local target_env=$1
    local current_env=$(get_current_env)
    
    if [ "$current_env" = "$target_env" ]; then
        echo -e "${YELLOW}[VAROVÁNÍ]${NC} Prostředí $target_env je již aktivní!"
        return 0
    fi
    
    echo -e "${BLUE}[INFO]${NC} Přepínám z $current_env na $target_env..."
    
    # Kontrola zdraví cílového prostředí
    if ! check_environment_health "$target_env"; then
        echo -e "${RED}[CHYBA]${NC} Cílové prostředí $target_env není připravené!"
        echo -e "${YELLOW}[TIP]${NC} Spusťte nejdříve: docker-compose -f docker-compose.${target_env}.yml up -d"
        exit 1
    fi
    
    # Záloha konfigurace
    cp "$NGINX_CONF" "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${GREEN}[✓]${NC} Záloha nginx konfigurace vytvořena"
    
    # Přepnutí nginx upstream serverů
    if [ "$target_env" = "green" ]; then
        sed -i 's/server blue-backend:3001/server green-backend:3001/' "$NGINX_CONF"
        sed -i 's/server blue-ml:8000/server green-ml:8000/' "$NGINX_CONF"
        sed -i 's/server blue-frontend:80/server green-frontend:80/' "$NGINX_CONF"
        echo -e "${GREEN}[✓]${NC} Nginx konfigurace přepnuta na GREEN"
    else
        sed -i 's/server green-backend:3001/server blue-backend:3001/' "$NGINX_CONF"
        sed -i 's/server green-ml:8000/server blue-ml:8000/' "$NGINX_CONF"
        sed -i 's/server green-frontend:80/server blue-frontend:80/' "$NGINX_CONF"
        echo -e "${GREEN}[✓]${NC} Nginx konfigurace přepnuta na BLUE"
    fi
    
    # Reload nginx
    echo -e "${BLUE}[INFO]${NC} Reloaduji nginx..."
    if docker exec "$NGINX_CONTAINER" nginx -t 2>/dev/null; then
        docker exec "$NGINX_CONTAINER" nginx -s reload
        echo -e "${GREEN}[✓]${NC} Nginx úspěšně reloadován"
    else
        echo -e "${RED}[CHYBA]${NC} Nginx konfigurace je neplatná!"
        echo -e "${YELLOW}[INFO]${NC} Vracím původní konfiguraci..."
        cp "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)" "$NGINX_CONF"
        exit 1
    fi
    
    echo -e "${GREEN}[✓]${NC} Přepnutí dokončeno! Prostředí $target_env je nyní aktivní."
    echo -e "${BLUE}[INFO]${NC} Doména https://spherosegapp.utia.cas.cz nyní směřuje na ${target_env^^} prostředí"
}

# Hlavní logika
main() {
    case "${1:-}" in
        blue)
            switch_environment "blue"
            ;;
        green)
            switch_environment "green"
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}[CHYBA]${NC} Neplatný příkaz: ${1:-}"
            echo "Použijte: $0 [blue|green|status|help]"
            exit 1
            ;;
    esac
}

# Spuštění
main "$@"