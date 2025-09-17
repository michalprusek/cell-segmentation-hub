# Staging Environment - Complete Setup Guide

Kompletní dokumentace pro nastavení a používání staging prostředí vedle produkčního prostředí pro SpheroSeg aplikaci.

## ✅ Status: PLNĚ FUNKČNÍ

Staging prostředí je nasazeno a běží paralelně s produkcí s úplnou izolací.

## 🏗️ Architektura

Staging prostředí běží paralelně s produkcí na stejném serveru s úplnou izolací:

- **Separované kontejnery**: `staging-*` vs `spheroseg-*`
- **Vlastní databáze**: `spheroseg_staging` vs `spheroseg_prod`
- **Oddělené sítě**: `staging-network` + `spheroseg-network` (pro nginx routing)
- **Vlastní volumes**: `staging-*` volumes
- **Vlastní subdoména**: `staging.spherosegapp.utia.cas.cz`
- **Shared SSL**: Certifikát pokrývá obě domény
- **Network routing**: Production nginx směruje staging traffic

## 🚀 Rychlé spuštění (po DNS konfiguraci)

### Kompletní setup jedním příkazem:

```bash
./scripts/complete-staging-setup.sh
```

Tento skript automaticky:

1. ✅ Ověří DNS konfiguraci
2. 🔐 Rozšíří SSL certifikát o staging subdoménu
3. 🌐 Aktivuje HTTPS pro staging
4. 🧪 Otestuje všechny endpointy
5. 📋 Poskytne přístupové informace

## 📋 Požadavky před spuštěním

### 1. DNS konfigurace (POVINNÉ)

Přidej DNS A záznam do zóny utia.cas.cz:

**Možnost 1 - A Record:**

```dns
staging.spherosegapp.utia.cas.cz    A    147.231.160.153
```

**Možnost 2 - CNAME Record:**

```dns
staging.spherosegapp.utia.cas.cz    CNAME    cvat2.utia.cas.cz
```

**Ověření DNS propagace:**

```bash
nslookup staging.spherosegapp.utia.cas.cz
# Mělo by vrátit: 147.231.160.153
```

## 🛠️ Manuální kroky (pokud nechcete použít complete-staging-setup.sh)

### 1. Nasazení staging prostředí

```bash
# Deploy staging kontejnery
./scripts/deploy-staging.sh
```

### 2. SSL certifikát pro staging subdoménu

```bash
# Rozšíř SSL certifikát o staging subdoménu
./scripts/expand-ssl-staging.sh
```

### 3. Aktivace HTTPS pro staging

```bash
# Aktivuj HTTPS redirect a SSL
./scripts/enable-staging-https.sh
```

## 🌐 Aktuálně dostupné URL (bez DNS)

**Pro testování bez DNS (pomocí Host header):**

```bash
# Health check
curl -H "Host: staging.spherosegapp.utia.cas.cz" http://localhost/health

# API test
curl -H "Host: staging.spherosegapp.utia.cas.cz" http://localhost/api/auth/me

# ML API test
curl -H "Host: staging.spherosegapp.utia.cas.cz" http://localhost/api/ml/health
```

## 🌐 Plné URL po DNS konfiguraci

### Production prostředí:

- **Frontend**: https://spherosegapp.utia.cas.cz
- **API**: https://spherosegapp.utia.cas.cz/api
- **ML API**: https://spherosegapp.utia.cas.cz/api/ml
- **Grafana**: https://spherosegapp.utia.cas.cz/grafana (port 3030)

### Staging prostředí:

- **Frontend**: https://staging.spherosegapp.utia.cas.cz
- **API**: https://staging.spherosegapp.utia.cas.cz/api
- **ML API**: https://staging.spherosegapp.utia.cas.cz/api/ml
- **Grafana**: https://staging.spherosegapp.utia.cas.cz/grafana
- **Direct Grafana**: http://localhost:3031

## 🛠️ Management příkazy

### Staging služby status

```bash
docker compose -f docker-compose.staging.yml -p staging ps
```

### Staging logy

```bash
# Všechny služby
docker compose -f docker-compose.staging.yml -p staging logs -f

# Specifická služba
docker compose -f docker-compose.staging.yml -p staging logs -f backend
```

### Staging management skript

```bash
# Status check
./scripts/staging-manager.sh status

# Restart služeb
./scripts/staging-manager.sh restart

# Stop služeb
./scripts/staging-manager.sh stop

# Start služeb
./scripts/staging-manager.sh start

# Logy
./scripts/staging-manager.sh logs -f

# Shell do kontejneru
./scripts/staging-manager.sh shell backend
```

### Deployment a updates

```bash
# Deploy nové verze do staging
./scripts/deploy-staging.sh

# Test staging konfigurace
./scripts/test-staging.sh
```

## 🔒 Bezpečnostní aspekty

### Úplná izolace dat

- ✅ **Database**: `spheroseg_staging` vs `spheroseg_prod`
- ✅ **Redis**: Vlastní staging instance na jiném portu
- ✅ **File storage**: `./backend/uploads/staging/` vs `./backend/uploads/`
- ✅ **Volumes**: `staging-*` vs `spheroseg-*` prefixes

### Secrets a konfigurace

- ✅ **JWT secrets**: 64-char secrets, rozdílné od produkce
- ✅ **Session secrets**: Vlastní staging session key
- ✅ **DB passwords**: Vlastní heslo pro staging DB
- ✅ **Environment**: NODE_ENV=production (pro Zod validaci)

### Network security

- ✅ **Staging headers**: `X-Environment: staging` na všech responses
- ✅ **SEO blocking**: `X-Robots-Tag: noindex, nofollow`
- ✅ **Shorter HSTS**: 86400s místo 31536000s pro produkci
- ✅ **Relaxed CSP**: Mírnější Content Security Policy

## 🔍 Monitoring a debugging

### Grafana dashboards

- **Staging Grafana**: http://localhost:3031 (admin/admin)
- **Production Grafana**: http://localhost:3030

### Health checks

```bash
# Staging služby health
curl -H "Host: staging.spherosegapp.utia.cas.cz" http://localhost/health
curl -H "Host: staging.spherosegapp.utia.cas.cz" http://localhost/api/ml/health

# Container health
docker compose -f docker-compose.staging.yml -p staging ps
```

### SSL certificate check

```bash
# Zkontroluj expiraci certifikátu
./scripts/check-ssl-expiry.sh

# Detaily SSL certifikátu
openssl x509 -in /etc/letsencrypt/live/spherosegapp.utia.cas.cz/fullchain.pem -text -noout | grep -A1 "Subject Alternative Name"
```

## 🔄 Deployment workflow

### Development → Staging

1. **Commit změny** do `staging` branch
2. **Deploy staging**: `./scripts/deploy-staging.sh`
3. **Test na staging**: https://staging.spherosegapp.utia.cas.cz
4. **Ověř funkčnost**: API, ML, UI components

### Staging → Production

1. **Po úspěšných testech**: merge `staging` → `main`
2. **Deploy production**: `./scripts/deploy-production.sh`
3. **Monitor produkční metriky**: Grafana dashboards
4. **Rollback možný**: přes Docker image restore

## ❗ Troubleshooting

### Staging kontejnery neběží

```bash
# Restart všech služeb
./scripts/staging-manager.sh restart

# Zkontroluj logy
docker compose -f docker-compose.staging.yml -p staging logs backend
```

### SSL problémy

```bash
# Znovu rozšíř certifikát
./scripts/expand-ssl-staging.sh

# Test SSL spojení
openssl s_client -connect staging.spherosegapp.utia.cas.cz:443
```

### Network connectivity problémy

```bash
# Zkontroluj network připojení
docker network inspect staging_staging-network
docker network inspect spheroseg-app_spheroseg-network

# Reconnect production nginx to staging network
docker network connect staging_staging-network spheroseg-nginx
```

### Database migrace

```bash
# Spusť migrace v staging DB
docker exec staging-backend npm run db:push
docker exec staging-backend npm run db:migrate
```

## ✨ Výhody staging prostředí

### ✅ Bezpečné testování

- Zero risk k produkčním datům
- Nezávislé služby a databáze
- Vlastní user data a konfigurace

### ✅ Production-like prostředí

- Stejná architektura jako produkce
- Real SSL certificates
- Stejné API endpointy a routing

### ✅ Easy management

- Automatizované deployment skripty
- Comprehensive monitoring přes Grafana
- Simple commands přes staging-manager.sh

### ✅ Development velocity

- Rychlé testování nových features
- Continuous integration ready
- Blue-green deployment možnosti

## 📞 Support

Pro problémy s staging prostředím:

1. **Zkontroluj logy**: `./scripts/staging-manager.sh logs -f`
2. **Ověř status**: `./scripts/staging-manager.sh status`
3. **Test configuration**: `./scripts/test-staging.sh`
4. **Check DNS**: `nslookup staging.spherosegapp.utia.cas.cz`
5. **SSL verification**: `./scripts/check-ssl-expiry.sh`

---

**🎉 Staging prostředí je připraveno k používání!**

Pro aktivaci external přístupu je potřeba pouze **DNS konfigurace**, poté spusť:

```bash
./scripts/complete-staging-setup.sh
```

## Použití

### Deployment skripty

#### Staging deployment

```bash
./scripts/deploy-staging.sh
```

#### Production deployment

```bash
./scripts/deploy-production.sh [OPTIONS]

Options:
  --skip-backup    # Přeskoč zálohu databáze
  --skip-tests     # Přeskoč health checky
  --force-rebuild  # Forceuj rebuild bez cache
```

### Staging Manager

```bash
# Spusť staging
./scripts/staging-manager.sh start

# Zastav staging
./scripts/staging-manager.sh stop

# Restartuj staging
./scripts/staging-manager.sh restart

# Zobraz logy (následuj)
./scripts/staging-manager.sh logs -f

# Zobraz logy konkrétní služby
./scripts/staging-manager.sh logs backend

# Vstup do kontejneru
./scripts/staging-manager.sh shell backend
./scripts/staging-manager.sh shell postgres
./scripts/staging-manager.sh shell ml-service

# Status prostředí
./scripts/staging-manager.sh status

# Záloha staging databáze
./scripts/staging-manager.sh backup

# Obnovení staging databáze
./scripts/staging-manager.sh restore /path/to/backup.sql

# Vyčištění staging prostředí
./scripts/staging-manager.sh clean
```

### Docker Compose příkazy

```bash
# Manuální správa staging prostředí
export COMPOSE_FILE=docker-compose.staging.yml
export COMPOSE_PROJECT_NAME=staging

# Start
docker compose up -d

# Stop
docker compose stop

# Logy
docker compose logs -f

# Status
docker compose ps

# Build
docker compose build --no-cache
```

## URL adresy

### Staging prostředí:

- **Frontend (local)**: http://localhost:4000 ✅ **USE THIS FOR STAGING**
- **API (local)**: http://localhost:4001/api
- **ML Service (local)**: http://localhost:4008
- **Grafana (local)**: http://localhost:3031
- **Frontend (domain)**: https://staging.spherosegapp.utia.cas.cz
- **API (domain)**: https://staging.spherosegapp.utia.cas.cz/api
- **ML Service (domain)**: https://staging.spherosegapp.utia.cas.cz/api/ml
- **Grafana (domain)**: https://staging.spherosegapp.utia.cas.cz/grafana

### Produkční prostředí:

- **Frontend**: https://spherosegapp.utia.cas.cz
- **API**: https://spherosegapp.utia.cas.cz/api
- **ML Service**: https://spherosegapp.utia.cas.cz/api/ml
- **Grafana**: https://spherosegapp.utia.cas.cz/grafana
- **Local Grafana**: http://localhost:3030

## Workflow

### Doporučený vývoj workflow:

1. **Development branch**: Práce na nové funkci v `dev` nebo `feature/xyz` branch
2. **Staging deployment**:
   ```bash
   git checkout staging
   git merge feature/xyz
   ./scripts/deploy-staging.sh
   ```
3. **Testování**: Test funkčnosti na staging.spherosegapp.utia.cas.cz
4. **Production deployment**:
   ```bash
   git checkout main
   git merge staging
   ./scripts/deploy-production.sh
   ```

### Blue-Green deployment (budoucí rozšíření):

- Staging může sloužit jako "green" prostředí
- Po úspěšném testingu na staging można přepnout produkci
- Možnost okamžitého rollbacku na původní verzi

## Monitoring

### Grafana dashboardy:

- **Staging Grafana**: http://localhost:3031 (admin/STAGING_GRAFANA_ADMIN_PASSWORD)
- **Production Grafana**: http://localhost:3030 (admin/GRAFANA_ADMIN_PASSWORD)

### Prometheus metriky:

- **Staging**: Kratší retenční doba (7 dní)
- **Production**: Standardní retence (30 dní)

### Logs:

```bash
# Všechny staging logy
docker compose -f docker-compose.staging.yml -p staging logs -f

# Konkrétní služba
docker compose -f docker-compose.staging.yml -p staging logs -f backend
```

## Troubleshooting

### Staging nefunguje:

```bash
# Zkontroluj status služeb
./scripts/staging-manager.sh status

# Zkontroluj logy
./scripts/staging-manager.sh logs -f

# Restart služeb
./scripts/staging-manager.sh restart
```

### SSL problémy:

```bash
# Zkontroluj certifikát
./scripts/check-ssl-expiry.sh

# Obnov certifikát se staging doménou
./scripts/init-letsencrypt-staging.sh
```

### Databázové problémy:

```bash
# Připoj se k staging DB
./scripts/staging-manager.sh shell postgres

# Záloha staging DB
./scripts/staging-manager.sh backup

# Migrace
docker exec staging-backend npm run db:migrate
```

### Porty a networking:

```bash
# Zkontroluj běžící kontejnery
docker ps | grep staging

# Zkontroluj síťe
docker network ls | grep staging

# Test konektivity
docker exec staging-backend curl -f http://staging-ml:8000/health
```

## Bezpečnostní aspekty

### Staging security headers:

- `X-Environment: staging` - identifikace prostředí
- `X-Robots-Tag: noindex, nofollow` - blokování indexování
- Méně striktní CSP než produkce
- Kratší HSTS doba než produkce

### Staging údaje:

- **Vlastní JWT secrets** (odlišné od produkce)
- **Vlastní DB hesla**
- **Debug režim zapnutý**
- **Podrobnější logování**

### Izolace:

- Staging nemá přístup k produkční databázi
- Oddělené Redis instance
- Oddělené file storage (./backend/uploads/staging/)

## Poznámky

- Staging prostředí má snížené resource limity oproti produkci
- Používá kratší cache timeouts
- Debug mode je zapnutý pro lepší troubleshooting
- Staging databáze se automaticky zálohuje před každým deployment
- SSL certifikát pokrývá obě domény (production + staging)

## Backup a obnova

### Automatické zálohy:

- Záloha před každým staging deployment
- Uloženo v `./scripts/db-backup/staging/`

### Manuální backup:

```bash
./scripts/staging-manager.sh backup
```

### Obnova ze zálohy:

```bash
./scripts/staging-manager.sh restore ./scripts/db-backup/staging/backup-20240101_120000.sql
```

### Kopírování produkčních dat do staging:

```bash
# Záloha produkce
docker exec spheroseg-db pg_dump -U spheroseg -d spheroseg_prod > prod-backup.sql

# Obnova do staging
./scripts/staging-manager.sh restore prod-backup.sql
```
