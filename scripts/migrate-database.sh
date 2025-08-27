#!/bin/bash

# ================================================================
# Database Migration Script for Blue-Green Deployment
# ================================================================
# Tento skript migruje data z jedné databáze do druhé
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

# Databázové parametry
DB_USER="${DB_USER:-spheroseg}"
DB_PASSWORD="${DB_PASSWORD:?Error: DB_PASSWORD environment variable is required}"
BACKUP_DIR="${BACKUP_DIR:-/home/cvat/cell-segmentation-hub/backups}"

# Funkce pro zobrazení nápovědy
show_help() {
    cat << EOF
Database Migration Tool
=======================

Použití:
  $0 [blue-to-green|green-to-blue|backup|restore]

Příkazy:
  blue-to-green  - Migruje data z Blue do Green databáze
  green-to-blue  - Migruje data z Green do Blue databáze
  backup [env]   - Vytvoří zálohu databáze (blue/green)
  restore [env] [file] - Obnoví databázi ze zálohy

Příklady:
  $0 backup blue         # Zálohuje blue databázi
  $0 blue-to-green       # Migruje data z blue do green
  $0 restore green backup.sql  # Obnoví green databázi

EOF
    exit 0
}

# Funkce pro vytvoření adresáře pro zálohy
ensure_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        echo -e "${GREEN}[✓]${NC} Vytvořen adresář pro zálohy: $BACKUP_DIR"
    fi
}

# Funkce pro zálohu databáze
backup_database() {
    local env=$1
    local container="postgres-${env}"
    local db_name="spheroseg_${env}"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/${db_name}_${timestamp}.sql"
    
    ensure_backup_dir
    
    echo -e "${BLUE}[INFO]${NC} Zálohuji databázi $db_name..."
    
    # Kontrola existence kontejneru
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${RED}[CHYBA]${NC} Kontejner $container neběží!"
        return 1
    fi
    
    # Vytvoření zálohy
    # Capture stderr for debugging
    local stderr_file=$(mktemp)
    if docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' pg_dump -U '$DB_USER' '$db_name'" > "$backup_file" 2>"$stderr_file"; then
        local size=$(du -h "$backup_file" | cut -f1)
        echo -e "${GREEN}[✓]${NC} Záloha vytvořena: $backup_file (velikost: $size)" >&2
        echo "$backup_file"  # Only output path to stdout for machine consumption
        rm -f "$stderr_file"
    else
        echo -e "${RED}[CHYBA]${NC} Nepodařilo se vytvořit zálohu!" >&2
        if [ -s "$stderr_file" ]; then
            echo -e "${RED}[CHYBA]${NC} Detaily chyby:" >&2
            cat "$stderr_file" >&2
        fi
        rm -f "$backup_file" "$stderr_file"
        return 1
    fi
}

# Funkce pro obnovu databáze
restore_database() {
    local env=$1
    local backup_file=$2
    local container="postgres-${env}"
    local db_name="spheroseg_${env}"
    
    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}[CHYBA]${NC} Soubor zálohy neexistuje: $backup_file"
        return 1
    fi
    
    echo -e "${BLUE}[INFO]${NC} Obnovuji databázi $db_name ze zálohy..."
    
    # Kontrola existence kontejneru
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${RED}[CHYBA]${NC} Kontejner $container neběží!"
        return 1
    fi
    
    # Drop a recreate databáze
    echo -e "${YELLOW}[VAROVÁNÍ]${NC} Tato operace smaže všechna současná data v $db_name!"
    read -p "Opravdu chcete pokračovat? (ano/ne): " confirm
    
    if [ "$confirm" != "ano" ]; then
        echo -e "${YELLOW}[INFO]${NC} Operace zrušena"
        return 0
    fi
    
    # Drop databáze
    docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -c \"DROP DATABASE IF EXISTS $db_name;\" postgres" 2>/dev/null || true
    
    # Create databáze
    docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -c \"CREATE DATABASE $db_name;\" postgres"
    
    # Restore dat
    if docker exec -i "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' '$db_name'" < "$backup_file"; then
        echo -e "${GREEN}[✓]${NC} Databáze úspěšně obnovena"
    else
        echo -e "${RED}[CHYBA]${NC} Nepodařilo se obnovit databázi!"
        return 1
    fi
}

# Funkce pro migraci databáze
migrate_database() {
    local source_env=$1
    local target_env=$2
    
    echo -e "${BLUE}=== Migrace databáze z ${source_env^^} do ${target_env^^} ===${NC}\n"
    
    # 1. Záloha zdrojové databáze
    echo -e "${BLUE}[1/3]${NC} Vytváření zálohy zdrojové databáze..."
    backup_file=$(backup_database "$source_env")
    
    if [ -z "$backup_file" ]; then
        echo -e "${RED}[CHYBA]${NC} Nepodařilo se vytvořit zálohu!"
        return 1
    fi
    
    # 2. Záloha cílové databáze (pro případ problémů)
    echo -e "\n${BLUE}[2/3]${NC} Vytváření bezpečnostní zálohy cílové databáze..."
    backup_database "$target_env" > /dev/null
    
    # 3. Restore do cílové databáze
    echo -e "\n${BLUE}[3/3]${NC} Migrace dat do cílové databáze..."
    restore_database "$target_env" "$backup_file"
    
    echo -e "\n${GREEN}[✓]${NC} Migrace dokončena úspěšně!"
    echo -e "${BLUE}[INFO]${NC} Data byla migrována z ${source_env} do ${target_env}"
}

# Funkce pro zobrazení statistik databáze
show_database_stats() {
    local env=$1
    local container="postgres-${env}"
    local db_name="spheroseg_${env}"
    
    echo -e "\n${BLUE}Statistiky databáze ${db_name}:${NC}"
    
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        # Počet tabulek
        tables=$(docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -d '$db_name' -t -c \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';\"" 2>/dev/null || echo "0")
        
        # Velikost databáze
        size=$(docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -d '$db_name' -t -c \"SELECT pg_size_pretty(pg_database_size('$db_name'));\"" 2>/dev/null || echo "N/A")
        
        # Počet uživatelů
        users=$(docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -d '$db_name' -t -c \"SELECT COUNT(*) FROM \\"User\\";\"" 2>/dev/null || echo "0")
        
        # Počet projektů
        projects=$(docker exec "$container" sh -c "PGPASSWORD='$DB_PASSWORD' psql -U '$DB_USER' -d '$db_name' -t -c \"SELECT COUNT(*) FROM \\"Project\\";\"" 2>/dev/null || echo "0")
        
        echo "  Tabulek: $tables"
        echo "  Velikost: $size"
        echo "  Uživatelů: $users"
        echo "  Projektů: $projects"
    else
        echo -e "  ${RED}Kontejner $container neběží${NC}"
    fi
}

# Hlavní logika
main() {
    case "${1:-}" in
        blue-to-green)
            migrate_database "blue" "green"
            show_database_stats "green"
            ;;
        green-to-blue)
            migrate_database "green" "blue"
            show_database_stats "blue"
            ;;
        backup)
            if [ -z "${2:-}" ]; then
                echo -e "${RED}[CHYBA]${NC} Specifikujte prostředí (blue/green)"
                exit 1
            fi
            backup_database "$2"
            ;;
        restore)
            if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
                echo -e "${RED}[CHYBA]${NC} Použití: $0 restore [env] [backup_file]"
                exit 1
            fi
            restore_database "$2" "$3"
            ;;
        stats)
            echo -e "${BLUE}=== Database Statistics ===${NC}"
            show_database_stats "blue"
            show_database_stats "green"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}[CHYBA]${NC} Neplatný příkaz: ${1:-}"
            echo "Použijte: $0 [blue-to-green|green-to-blue|backup|restore|stats|help]"
            exit 1
            ;;
    esac
}

# Spuštění
main "$@"