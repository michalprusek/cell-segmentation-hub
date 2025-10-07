# Dokumentace přístupového logování pro IT sekci

## Přehled

Aplikace SpheroSeg (spherosegapp.utia.cas.cz) nyní implementuje kompletní systém přístupového logování pro auditní účely. Všechny přístupy k doméně jsou logovány s následujícími informacemi:

- **IP adresa** klienta
- **Uživatelské jméno** (email) přihlášeného uživatele
- **Timestamp** přístupu
- **HTTP metoda a URL**
- **Status kód odpovědi**
- **User agent** prohlížeče
- **Doba zpracování** požadavku

## Umístění log souborů

### Produkční prostředí (Blue)

```
/home/cvat/cell-segmentation-hub/logs/blue/
├── backend/
│   └── access.log          # Backend access log s autentizovanými uživateli
└── nginx/
    ├── access.log           # Nginx access log (všechny požadavky)
    └── error.log            # Nginx error log
```

### Staging prostředí (Green)

```
/home/cvat/cell-segmentation-hub/logs/green/
├── backend/
│   └── access.log
└── nginx/
    ├── access.log
    └── error.log
```

## Formát logů

### Backend Access Log

**Umístění**: `/logs/{environment}/backend/access.log`

**Formát**:

```
[timestamp] IP_ADDRESS USERNAME METHOD URL STATUS_CODE DURATION_MS "USER_AGENT"
```

**Příklad**:

```
[2025-10-06T10:15:30.123Z] 147.231.12.83 user@example.com GET /api/projects 200 45ms "Mozilla/5.0..."
[2025-10-06T10:16:15.456Z] 37.188.128.175 anonymous GET /api/health 200 3ms "curl/7.68.0"
```

**Pole**:

- `timestamp`: ISO 8601 timestamp v UTC
- `IP_ADDRESS`: Skutečná IP adresa klienta (z X-Real-IP nebo X-Forwarded-For)
- `USERNAME`: Email přihlášeného uživatele nebo "anonymous"
- `METHOD`: HTTP metoda (GET, POST, PUT, DELETE, atd.)
- `URL`: Požadovaná URL včetně query parametrů
- `STATUS_CODE`: HTTP status kód odpovědi
- `DURATION_MS`: Doba zpracování v milisekundách
- `USER_AGENT`: Identifikace klientského prohlížeče/aplikace

### Nginx Access Log

**Umístění**: `/logs/{environment}/nginx/access.log`

**Formát** (access_audit):

```
IP - USER [TIMESTAMP] "REQUEST" STATUS BYTES "REFERER" "USER_AGENT" "X_FORWARDED_FOR" rt=REQUEST_TIME uct="UPSTREAM_CONNECT" uht="UPSTREAM_HEADER" urt="UPSTREAM_RESPONSE"
```

**Příklad**:

```
147.231.12.83 - - [06/Oct/2025:10:15:30 +0000] "GET /api/projects HTTP/2.0" 200 1234 "https://spherosegapp.utia.cas.cz" "Mozilla/5.0..." "-" rt=0.045 uct="0.001" uht="0.005" urt="0.044"
```

## Retence logů

### Automatická rotace

- **Frekvence**: Denní (každý den ve 2:00 AM)
- **Retence**: 90 dní (podle compliance požadavků)
- **Komprese**: Starší logy jsou automaticky komprimovány pomocí gzip
- **Formát rotovaných souborů**: `access.log-2025-10-05.gz`

### Logrotate konfigurace

Automatická rotace je řízena pomocí `logrotate` utility:

```bash
# Ruční spuštění rotace
/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-nginx.conf
/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-backend.conf
```

### Nastavení cron job

Pro automatickou rotaci přidejte do crontab:

```bash
# Editace crontab
crontab -e

# Přidejte tento řádek (rotace každý den ve 2:00 AM)
0 2 * * * /home/cvat/cell-segmentation-hub/docker/logrotate/logrotate-cron.sh
```

## Bezpečnost a GDPR

### Ochrana osobních údajů

- Logy obsahují osobní údaje (IP adresy, emaily uživatelů)
- **Přístup k logům je omezen** na:
  - Uživatele `cvat` (vlastník aplikace)
  - Root uživatele systému
  - IT administrátory s odpovídajícími právy

### Oprávnění souborů

```bash
# Adresáře logů
drwxrwxr-x cvat cvat /logs/blue/backend/
drwxrwxr-x cvat cvat /logs/blue/nginx/

# Log soubory
-rw-rw-r-- cvat cvat /logs/blue/backend/access.log
-rw-rw-r-- cvat cvat /logs/blue/nginx/access.log
```

### Doporučení

1. **Pravidelně archivujte** starší logy (>90 dní) do zabezpečeného úložiště
2. **Nastavte monitoring** pro detekci neobvyklých přístupů
3. **Používejte šifrování** při přenosu logů mimo server
4. **Provádějte pravidelné audity** přístupů k log souborům

## Monitorování a analýza

### Zobrazení aktivních logů

```bash
# Sledování backend access logu v reálném čase
tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log

# Sledování nginx access logu
tail -f /home/cvat/cell-segmentation-hub/logs/blue/nginx/access.log

# Zobrazení posledních 100 záznamů
tail -n 100 /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

### Užitečné příkazy pro analýzu

#### Top 10 IP adres podle počtu požadavků

```bash
awk '{print $2}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  sort | uniq -c | sort -rn | head -10
```

#### Všichni přihlášení uživatelé za dnešek

```bash
grep "$(date +%Y-%m-%d)" /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  awk '{print $3}' | grep -v "anonymous" | sort -u
```

#### Počet požadavků podle uživatele

```bash
awk '{print $3}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  sort | uniq -c | sort -rn
```

#### Chybové požadavky (4xx, 5xx)

```bash
awk '$5 >= 400 {print}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

#### Průměrná doba zpracování požadavků

```bash
awk '{gsub(/ms/, "", $6); sum+=$6; count++} END {print "Average:", sum/count, "ms"}' \
  /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

## Technická implementace

### Backend Access Logger

**Middleware**: `/backend/src/middleware/accessLogger.ts`

Zachycuje každý HTTP požadavek a loguje:

- Extrahuje skutečnou IP z `X-Real-IP` nebo `X-Forwarded-For` headerů
- Identifikuje uživatele z JWT tokenu (pokud je přihlášen)
- Měří dobu zpracování požadavku
- Zapisuje do `/app/logs/access.log` (mapováno na host)

**Aktivace**: Middleware je automaticky aktivován v `server.ts` před ostatními middleware

### Nginx Access Logger

**Konfigurace**: `/docker/nginx/nginx.blue.conf`

Používá vlastní log formát `access_audit`:

- Loguje všechny požadavky na HTTPS port 443
- Měří upstream response time
- Zaznamenává X-Forwarded-For pro určení původní IP

### Docker Volume Mounts

**Backend** (`docker-compose.blue.yml`):

```yaml
volumes:
  - ./logs/blue/backend:/app/logs
```

**Nginx** (`docker-compose.blue.yml`):

```yaml
volumes:
  - ./logs/blue/nginx:/var/log/nginx
```

## Aktivace logování

### Pro blue prostředí (produkce)

```bash
# 1. Restart backend pro aktivaci middleware
docker restart blue-backend

# 2. Reload nginx pro novou konfiguraci
docker exec nginx-blue nginx -s reload

# 3. Ověření, že logy se zapisují
tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

### Pro green prostředí (staging)

```bash
# Stejný postup s green kontejnery
docker restart green-backend
docker exec nginx-green nginx -s reload
tail -f /home/cvat/cell-segmentation-hub/logs/green/backend/access.log
```

## Řešení problémů

### Logy se nezapisují

1. **Zkontrolujte oprávnění**:

```bash
ls -la /home/cvat/cell-segmentation-hub/logs/blue/backend/
# Mělo by být: -rw-rw-r-- cvat cvat
```

2. **Zkontrolujte, zda adresář existuje**:

```bash
ls -la /home/cvat/cell-segmentation-hub/logs/blue/
```

3. **Zkontrolujte volume mount v kontejneru**:

```bash
docker exec blue-backend ls -la /app/logs/
# Měl by existovat access.log soubor
```

4. **Zkontrolujte logy aplikace**:

```bash
docker logs blue-backend | grep -i "access"
```

### Log rotace nefunguje

1. **Zkontrolujte cron job**:

```bash
crontab -l | grep logrotate
```

2. **Testujte logrotate ručně**:

```bash
/usr/sbin/logrotate -d /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-backend.conf
# -d = debug mode (zkouší bez změn)
```

3. **Zkontrolujte state soubory**:

```bash
cat /home/cvat/cell-segmentation-hub/logs/.logrotate-backend.state
```

### Vysoké využití disku

1. **Zkontrolujte velikost logů**:

```bash
du -sh /home/cvat/cell-segmentation-hub/logs/blue/backend/
du -sh /home/cvat/cell-segmentation-hub/logs/blue/nginx/
```

2. **Ručně archivujte staré logy**:

```bash
# Komprese logů starších 30 dní
find /home/cvat/cell-segmentation-hub/logs -name "*.log" -mtime +30 -exec gzip {} \;
```

3. **Snížení retence** (pokud 90 dní je příliš):

```bash
# Upravte rotate hodnotu v logrotate konfiguracích
# /docker/logrotate/spheroseg-backend.conf
# /docker/logrotate/spheroseg-nginx.conf
```

## Kontakt a podpora

Pro dotazy ohledně access logování kontaktujte:

- **Aplikační tým**: SpheroSeg Development Team
- **IT sekce**: UTIA IT Department
- **Server správce**: cvat@spherosegapp.utia.cas.cz

## Verze dokumentace

- **Verze**: 1.0
- **Datum**: 2025-10-06
- **Autor**: SpheroSeg Development Team
- **Poslední aktualizace**: 2025-10-06
