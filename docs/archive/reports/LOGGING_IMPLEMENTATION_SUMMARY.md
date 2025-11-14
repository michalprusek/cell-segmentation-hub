# Implementace access logování - Souhrn změn

## 📋 Přehled

Implementován kompletní systém přístupového logování pro auditní účely IT sekce UTIA. Systém zachycuje všechny přístupy na doménu spherosegapp.utia.cas.cz včetně IP adres, uživatelských jmen a všech relevantních informací.

## ✅ Implementované komponenty

### 1. **Backend Access Logger Middleware**

- **Soubor**: `/backend/src/middleware/accessLogger.ts`
- **Funkce**:
  - Loguje každý HTTP požadavek s IP adresou a uživatelským jménem
  - Extrahuje skutečnou IP z `X-Real-IP` a `X-Forwarded-For` headerů
  - Identifikuje uživatele z JWT tokenu
  - Měří dobu zpracování požadavku
  - Sanitizuje user-agent proti log injection útokům

- **Aktivace**: Automaticky v `/backend/src/server.ts` (řádek 167-169)

### 2. **Struktura adresářů pro logy**

```
/home/cvat/cell-segmentation-hub/logs/
├── blue/                    # Produkční prostředí
│   ├── backend/
│   │   └── access.log
│   └── nginx/
│       ├── access.log
│       └── error.log
└── green/                   # Staging prostředí
    ├── backend/
    │   └── access.log
    └── nginx/
        ├── access.log
        └── error.log
```

### 3. **Nginx konfigurace**

- **Soubor**: `/docker/nginx/nginx.blue.conf`
- **Změny**:
  - Přidán vlastní log formát `access_audit` (řádky 5-10)
  - Konfigurace access/error logů pro HTTPS server (řádky 67-69)
  - Persistentní úložiště pro logy

### 4. **Docker volume mounts**

- **Backend** (`docker-compose.blue.yml`, řádek 62):

  ```yaml
  - ./logs/blue/backend:/app/logs
  ```

- **Nginx** (`docker-compose.blue.yml`, řádek 188):
  ```yaml
  - ./logs/blue/nginx:/var/log/nginx
  ```

### 5. **Logrotate konfigurace**

- **Backend**: `/docker/logrotate/spheroseg-backend.conf`
  - Denní rotace
  - 90denní retence
  - Automatická komprese
  - Separate konfigurace pro blue a green

- **Nginx**: `/docker/logrotate/spheroseg-nginx.conf`
  - Denní rotace
  - 90denní retence
  - Reload nginx po rotaci

- **Cron script**: `/docker/logrotate/logrotate-cron.sh`
  - Automatické spouštění ve 2:00 AM

### 6. **Git ignore**

- **Soubor**: `.gitignore`
- **Změny**: Přidáno `logs/` pro ignorování všech log souborů

### 7. **Dokumentace**

- **Kompletní dokumentace**: `/docs/ACCESS_LOGGING.md`
  - Formát logů
  - Umístění souborů
  - Retence a rotace
  - Bezpečnost a GDPR
  - Monitorování a analýza
  - Řešení problémů

- **Setup guide**: `/docs/ACCESS_LOGGING_SETUP.md`
  - Rychlý start
  - Checklist aktivace
  - Příklady použití
  - Troubleshooting

## 📝 Formát logů

### Backend Access Log

```
[2025-10-06T10:15:30.123Z] 147.231.12.83 user@example.com GET /api/projects 200 45ms "Mozilla/5.0..."
```

**Pole**:

- Timestamp (ISO 8601 UTC)
- IP adresa (skutečná klientská IP)
- Username (email nebo "anonymous")
- HTTP metoda
- URL
- Status kód
- Doba zpracování (ms)
- User agent

### Nginx Access Log

```
147.231.12.83 - - [06/Oct/2025:10:15:30 +0000] "GET /api/projects HTTP/2.0" 200 1234 "https://spherosegapp.utia.cas.cz" "Mozilla/5.0..." "-" rt=0.045 uct="0.001" uht="0.005" urt="0.044"
```

## 🚀 Aktivace

### Blue prostředí (produkce)

```bash
# 1. Restart backend
docker restart blue-backend

# 2. Reload nginx
docker exec nginx-blue nginx -s reload

# 3. Ověření
tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

### Nastavení automatické rotace

```bash
# Přidání do crontab
crontab -e

# Přidat řádek:
0 2 * * * /home/cvat/cell-segmentation-hub/docker/logrotate/logrotate-cron.sh
```

## 🔒 Bezpečnost a compliance

### GDPR compliance

- ✅ Logy obsahují osobní údaje (IP, email)
- ✅ Omezený přístup (pouze cvat user a root)
- ✅ 90denní retence
- ✅ Automatická rotace a archivace

### Oprávnění

```bash
# Adresáře: drwxrwxr-x (775) cvat:cvat
# Soubory: -rw-rw-r-- (664) cvat:cvat
```

### Ochrana dat

- Log injection prevence (sanitizace user-agent)
- Bezpečné extrahování IP z proxy headerů
- Žádné citlivé údaje v logách (hesla, tokeny)

## 📊 Užitečné příkazy

### Analýza logů

```bash
# Top 10 IP adres
awk '{print $2}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  sort | uniq -c | sort -rn | head -10

# Přihlášení uživatelé dnes
grep "$(date +%Y-%m-%d)" /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log | \
  awk '{print $3}' | grep -v "anonymous" | sort -u

# Chybové požadavky
awk '$5 >= 400 {print}' /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
```

### Monitoring

```bash
# Živé sledování
tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log

# Kontrola velikosti
du -sh /home/cvat/cell-segmentation-hub/logs/blue/
```

## 🎯 Splněné IT požadavky

- ✅ **IP adresy**: Zachyceny včetně proxy chain
- ✅ **Uživatelská jména**: Email z JWT tokenu
- ✅ **Timestamp**: ISO 8601 formát v UTC
- ✅ **Kompletní audit trail**: Metoda, URL, status, doba zpracování
- ✅ **Perzistentní úložiště**: Logy v textových souborech
- ✅ **Automatická rotace**: Denní s 90denní retencí
- ✅ **Bezpečnost**: Omezená práva, GDPR compliance

## 📁 Změněné soubory

### Nové soubory

```
backend/src/middleware/accessLogger.ts        # Access log middleware
docker/logrotate/logrotate-cron.sh           # Cron script pro rotaci
docs/ACCESS_LOGGING.md                        # Kompletní dokumentace
docs/ACCESS_LOGGING_SETUP.md                  # Setup guide
```

### Upravené soubory

```
backend/src/server.ts                         # Aktivace middleware (řádky 167-169)
docker/nginx/nginx.blue.conf                  # Nginx log konfigurace
docker/logrotate/spheroseg-backend.conf       # Backend rotace config
docker/logrotate/spheroseg-nginx.conf         # Nginx rotace config
docker-compose.blue.yml                       # Volume mounts pro logy
.gitignore                                    # Ignorování logů
```

### Vytvořené adresáře

```
logs/blue/backend/                            # Backend logy (blue)
logs/blue/nginx/                              # Nginx logy (blue)
logs/green/backend/                           # Backend logy (green)
logs/green/nginx/                             # Nginx logy (green)
```

## 🔧 Následující kroky

1. **Aktivovat v produkci**:

   ```bash
   docker restart blue-backend
   docker exec nginx-blue nginx -s reload
   ```

2. **Nastavit cron job**:

   ```bash
   crontab -e
   # Přidat: 0 2 * * * /home/cvat/.../docker/logrotate/logrotate-cron.sh
   ```

3. **Ověřit funkčnost**:

   ```bash
   tail -f /home/cvat/cell-segmentation-hub/logs/blue/backend/access.log
   ```

4. **Informovat IT sekci**:
   - Odeslat dokumentaci: `docs/ACCESS_LOGGING.md`
   - Umístění logů: `/home/cvat/cell-segmentation-hub/logs/blue/`
   - Retence: 90 dní
   - Formát: Strukturované textové logy

## 📞 Kontakt

Pro dotazy nebo problémy:

- **Dokumentace**: `/docs/ACCESS_LOGGING.md`
- **Setup guide**: `/docs/ACCESS_LOGGING_SETUP.md`
- **Tým**: SpheroSeg Development Team
- **IT sekce**: UTIA IT Department

---

**Implementováno**: 2025-10-06
**Verze**: 1.0
**Status**: ✅ Připraveno k aktivaci
