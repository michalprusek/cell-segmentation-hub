# Rychlý průvodce aktivací access logování

## ⚡ Rychlá aktivace (Blue prostředí)

```bash
# 1. Restart backend pro aktivaci access log middleware
docker restart blue-backend

# 2. Reload nginx pro použití nové konfigurace
docker exec nginx-blue nginx -s reload

# 3. Ověření - zobrazí se živé logy
tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

## 📋 Kompletní checklist

### 1. Ověření struktury adresářů

```bash
ls -la /home/cvat/cell-segmentation-hub/logs/blue/
# Očekávaný výstup:
# drwxrwxr-x backend/
# drwxrwxr-x nginx/
```

### 2. Nastavení automatické rotace logů

```bash
# Přidání cron job pro denní rotaci ve 2:00 AM
crontab -e

# Přidejte tento řádek:
0 2 * * * /home/cvat/cell-segmentation-hub/docker/logrotate/logrotate-cron.sh
```

### 3. Testování logrotate (volitelné)

```bash
# Dry-run test bez změn
/usr/sbin/logrotate -d /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-backend.conf

# Ruční spuštění rotace
/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-backend.conf
/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-nginx.conf
```

### 4. Ověření funkčnosti

```bash
# Vygenerujte testovací požadavek
curl https://spherosegapp.utia.cas.cz/api/health

# Zkontrolujte, zda se objevil v logu
tail -n 5 /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

## 🔍 Příklady log záznamů

### Backend access log (s autentizací)

```
[2025-10-06T10:15:30.123Z] 147.231.12.83 user@example.com POST /api/projects 201 125ms "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
[2025-10-06T10:16:45.789Z] 37.188.128.175 anonymous GET /api/health 200 3ms "curl/7.68.0"
```

### Nginx access log

```
147.231.12.83 - - [06/Oct/2025:10:15:30 +0000] "POST /api/projects HTTP/2.0" 201 1024 "https://spherosegapp.utia.cas.cz" "Mozilla/5.0..." "-" rt=0.125 uct="0.001" uht="0.005" urt="0.124"
```

## 📊 Základní analýza logů

### Top 10 nejaktivnějších IP adres

```bash
awk '{print $2}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  sort | uniq -c | sort -rn | head -10
```

### Seznam přihlášených uživatelů dnes

```bash
grep "$(date +%Y-%m-%d)" /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  awk '{print $3}' | grep -v "anonymous" | sort -u
```

### Chybové požadavky (status ≥ 400)

```bash
awk '$5 >= 400 {print}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

## 🔒 Bezpečnostní kontrola

### Oprávnění souborů

```bash
# Měla by být 644 (rw-rw-r--)
ls -l /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
ls -l /home/cvat/cell-segmentation-hub/logs/blue/nginx/access.log
```

### Velikost logů

```bash
# Kontrola využití disku
du -sh /home/cvat/cell-segmentation-hub/logs/blue/
```

## 🌿 Green prostředí (staging)

Pro aktivaci v green prostředí použijte stejné příkazy s náhradou `blue` → `green`:

```bash
# Restart služeb
docker restart green-backend
docker exec nginx-green nginx -s reload

# Sledování logů
tail -f /home/cvat/cell-segmentation-hub/logs/green/backend/access.log
```

## ❓ Řešení problémů

### Logy se nezapisují

1. **Zkontrolujte volume mount**:

   ```bash
   docker inspect blue-backend | grep -A 5 "Mounts"
   # Mělo by obsahovat: ./logs/blue/backend:/app/logs
   ```

2. **Zkontrolujte aplikační logy**:

   ```bash
   docker logs blue-backend | tail -50
   ```

3. **Ověřte middleware**:
   ```bash
   docker exec blue-backend cat /app/src/server.ts | grep -A 2 "accessLogger"
   ```

### Permission denied chyby

```bash
# Nastavte správná oprávnění
sudo chown -R cvat:cvat /home/cvat/cell-segmentation-hub/logs/
chmod -R 664 /home/cvat/cell-segmentation-hub/logs/blue/backend/*.log
chmod -R 664 /home/cvat/cell-segmentation-hub/logs/blue/nginx/*.log
```

## 📝 Pro IT sekci

**Kompletní dokumentace**: [ACCESS_LOGGING.md](./ACCESS_LOGGING.md)

**Klíčové informace**:

- ✅ Logy obsahují IP adresy, uživatelská jména, timestamp, URL, status kód
- ✅ Retence: 90 dní s automatickou rotací
- ✅ Formát: Strukturované textové logy (snadno parsovatelné)
- ✅ Umístění: `/home/cvat/cell-segmentation-hub/logs/{environment}/`
- ✅ GDPR: Logy obsahují osobní údaje (IP, email) - omezený přístup

## ✅ Finální kontrola

Po aktivaci ověřte všechny body:

- [ ] Backend logy se zapisují do `/logs/blue/backend/access.log`
- [ ] Nginx logy se zapisují do `/logs/blue/nginx/access.log`
- [ ] Autentizovaní uživatelé mají email místo "anonymous"
- [ ] IP adresy jsou správně zachyceny (ne 127.0.0.1)
- [ ] Cron job pro logrotate je nastaven
- [ ] Oprávnění souborů jsou správná (644)
- [ ] Logy jsou v .gitignore

---

**Datum vytvoření**: 2025-10-06
**Verze**: 1.0
**Kontakt**: SpheroSeg Development Team
