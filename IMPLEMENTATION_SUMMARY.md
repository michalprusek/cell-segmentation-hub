# Staging Environment Implementation Summary

Tato dokumentace shrnuje implementaci staging prostředí vedle produkčního prostředí pro SpheroSeg aplikaci.

## 📋 Implementované komponenty

### ✅ Základní konfigurace

1. **docker-compose.staging.yml** - Staging Docker Compose konfigurace
2. **.env.staging** - Staging environment proměnné s vlastními secrets
3. **STAGING.md** - Podrobná dokumentace pro staging environment
4. **README.md** - Aktualizováno o staging informace

### ✅ Nginx konfigurace

1. **docker/nginx/staging.conf** - Interní nginx konfigurace pro staging kontejner
2. **docker/nginx/sites/staging.spherosegapp.conf** - Staging subdoména konfigurace
3. **docker/nginx/nginx.conf** - Přidány staging upstreams (staging_backend, staging_ml_service, etc.)

### ✅ SSL certifikáty

1. **scripts/init-letsencrypt-staging.sh** - SSL setup pro staging subdoménu
2. **Rozšířený certifikát** - Pokrývá jak produkci tak staging (spherosegapp.utia.cas.cz + staging.spherosegapp.utia.cas.cz)

### ✅ Deployment skripty

1. **scripts/deploy-staging.sh** - Automatizované staging deployment
2. **scripts/deploy-production.sh** - Vylepšené production deployment s rollback možnostmi
3. **scripts/staging-manager.sh** - Kompletní management nástroj pro staging
4. **scripts/test-staging.sh** - Automatizované testování staging konfigurace

### ✅ Monitoring a metrics

1. **monitoring/staging-prometheus.yml** - Prometheus konfigurace pro staging
2. **Separátní Grafana instance** - Staging Grafana na portu 3031
3. **Oddělené metriky** - Staging má vlastní metrics collection

## 🏗️ Architektura řešení

### Izolace prostředí

- **Kontejnery**: `staging-*` vs `spheroseg-*` prefixes
- **Sítě**: `staging-network` (izolovaná) + `spheroseg-network` (pro nginx routing)
- **Databáze**: `spheroseg_staging` vs `spheroseg_prod`
- **Volumes**: Samostatné `staging-*` volumes
- **Ports**: Staging používá interní porty + port 3031 pro Grafana

### URL schema

- **Production**: https://spherosegapp.utia.cas.cz
- **Staging**: https://staging.spherosegapp.utia.cas.cz
- **Staging Grafana**: http://localhost:3031

### Resource optimization

- **Staging má redukované zdroje**: Menší memory limity, méně workerů
- **Kratší retention**: 7 dní pro Prometheus vs 30 pro produkci
- **Debug mode**: Zapnutý pro staging, detailnější logování

## 🚀 Deployment workflow

### 1. Počáteční setup

```bash
# DNS setup (manuálně)
# staging.spherosegapp.utia.cas.cz -> server IP

# SSL certifikát pro staging
./scripts/init-letsencrypt-staging.sh

# Test konfigurace
./scripts/test-staging.sh
```

### 2. Staging deployment

```bash
# Deploy staging
./scripts/deploy-staging.sh

# Alternativně pomocí manageru
./scripts/staging-manager.sh deploy
```

### 3. Production deployment

```bash
# Production deployment s možnostmi
./scripts/deploy-production.sh
./scripts/deploy-production.sh --skip-backup
./scripts/deploy-production.sh --force-rebuild
```

### 4. Denní management

```bash
# Staging status
./scripts/staging-manager.sh status

# Logy
./scripts/staging-manager.sh logs -f

# Backup/restore
./scripts/staging-manager.sh backup
./scripts/staging-manager.sh restore backup.sql

# Shell access
./scripts/staging-manager.sh shell backend
```

## 🔒 Bezpečnostní aspekty

### Oddělené secrets

- Staging má vlastní JWT secrets (různé od produkce)
- Vlastní DB hesla
- Vlastní session secrets
- Vlastní Grafana přístupy

### Security headers

- `X-Environment: staging` - identifikace prostředí
- `X-Robots-Tag: noindex, nofollow` - blokování robotů
- Méně přísné CSP než produkce
- Kratší HSTS doba

### Izolace dat

- Staging nemá přístup k produkčním datům
- Oddělené Redis instance
- Samostatné file storage (`./backend/uploads/staging/`)
- Možnost kopírování produkčních dat do staging při potřebě

## ⚡ Performance a optimalizace

### Staging optimalizace

- **ML Service**: 1 worker vs 2 v produkci, menší memory limit (4G vs 8G)
- **Redis**: 256MB vs 512MB v produkci
- **Prometheus**: 7 dní retention vs 30 dní
- **Cache timeouts**: Kratší než v produkci

### Resource sharing

- Stejný server jako produkce
- Sdílené base images
- Optimalizovaný build cache

## 🎯 Výhody implementace

### ✅ Úplná izolace

- Staging nemůže ovlivnit produkci
- Nezávislé databáze a služby
- Oddělené networking

### ✅ Blue-Green ready

- Staging může sloužit jako "green" environment
- Možnost rychlého přepnutí
- Zero-downtime deployment možnosti

### ✅ Vývojářská produktivita

- Rychlé testování na staging
- Reprodukovatelné prostředí
- Automatizované deployment

### ✅ DevOps best practices

- Infrastructure as Code
- Automatizované skripty
- Comprehensive monitoring

## 📊 Monitoring a observability

### Metriky

- **Staging Prometheus**: http://localhost:9090 (staging-prometheus)
- **Staging Grafana**: http://localhost:3031
- **Business metriky**: Separátní tracking pro staging

### Logging

```bash
# Centralizované staging logy
docker compose -f docker-compose.staging.yml -p staging logs -f

# Specifické služby
./scripts/staging-manager.sh logs backend -f
```

### Zdravotní kontroly

- Automatické health checks pro všechny služby
- Deployment validation
- Pre-deployment testy

## 🛠️ Maintenance

### Pravidelné úkony

1. **SSL obnova**: Automatická každých 12 hodin
2. **Database backup**: Automaticky před každým deployment
3. **Log rotation**: Automatická přes Docker
4. **Security updates**: Pravidelné rebuild base images

### Troubleshooting

```bash
# Status check
./scripts/staging-manager.sh status

# Service restart
./scripts/staging-manager.sh restart

# Clean environment
./scripts/staging-manager.sh clean  # Warning: removes all data
```

## 🔄 Migration strategy

### Z development do staging

1. Commit změny do `staging` branch
2. `./scripts/deploy-staging.sh`
3. Test na https://staging.spherosegapp.utia.cas.cz

### Ze staging do production

1. Po úspěšných testech: merge do `main`
2. `./scripts/deploy-production.sh`
3. Monitoring produkčních metrik

### Rollback

- Staging: `./scripts/staging-manager.sh restore <backup>`
- Production: Docker image rollback možný

## 📝 Poznámky pro budoucí rozšíření

### Možná vylepšení

1. **Automated testing**: CI/CD pipeline pro staging deployment
2. **Blue-green switching**: Automatické přepínání prod/staging
3. **Data sync**: Automatická synchronizace produkčních dat do staging
4. **Multi-environment**: Přidání dalších prostředí (dev, test, UAT)

### Scaling možnosti

- **Multiple staging**: Více staging prostředí pro různé features
- **Geographic staging**: Staging v různých regionech
- **Load testing**: Staging optimalizované pro zátěžové testy

## ✨ Shrnutí

Implementace staging prostředí poskytuje:

- **100% izolovaný staging** běžící paralelně s produkcí
- **Kompletní tooling** pro management a deployment
- **Production-ready** architektura s best practices
- **Zero-downtime** deployment možnosti
- **Comprehensive monitoring** a observability
- **Security-first** přístup s oddělenými secrets
- **Developer-friendly** workflow a nástroje

Staging prostředí je nyní připraveno pro použití a umožňuje bezpečné testování nových funkcí bez ovlivnění produkčního prostředí.
