#!/bin/bash
# Skript pro aktivaci access logování v produkčním prostředí
# Použití: ./ACTIVATE_LOGGING.sh

set -e

echo "======================================"
echo "  AKTIVACE ACCESS LOGOVÁNÍ"
echo "======================================"
echo ""

# Kontrola prostředí
ACTIVE_ENV=$(cat .active-environment | grep ACTIVE_COLOR | cut -d'=' -f2)
echo "✓ Aktivní prostředí: $ACTIVE_ENV"
echo ""

# Restart backend pro aktivaci middleware
echo "1. Restartování backend kontejneru..."
docker restart ${ACTIVE_ENV}-backend
echo "✓ Backend restartován"
echo ""

# Reload nginx pro novou konfiguraci
echo "2. Reload nginx konfigurace..."
docker exec nginx-${ACTIVE_ENV} nginx -t && docker exec nginx-${ACTIVE_ENV} nginx -s reload
echo "✓ Nginx konfiguraceReloadována"
echo ""

# Počkat 2 sekundy na inicializaci
sleep 2

# Ověření, že logy fungují
echo "3. Testování access logování..."
echo "   Generuji testovací požadavek..."
curl -s https://spherosegapp.utia.cas.cz/api/health > /dev/null
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
