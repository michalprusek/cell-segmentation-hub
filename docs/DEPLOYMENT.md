# 🚀 SpheroSeg Deployment Guide

## Overview

SpheroSeg používá **Blue-Green deployment** strategii pro nasazení bez výpadku. Systém může běžet ve dvou prostředích:

- **Staging** (modrá) - testovací prostředí
- **Production** (zelená) - produkční prostředí

Nginx funguje jako reverzní proxy a směruje provoz na aktivní prostředí.

## 📋 Prerequisites

1. **Server Requirements**
   - Ubuntu 20.04+ nebo podobná Linux distribuce
   - Docker & Docker Compose v2+
   - Minimálně 8GB RAM, doporučeno 16GB
   - 50GB volného místa na disku
   - SSL certifikát (Let's Encrypt)

2. **Připravte environment soubory**
   ```bash
   cp .env.staging.example .env.staging
   cp .env.production.example .env.production
   # Vyplňte hodnoty v obou souborech
   ```

## 🔄 Deployment Workflow

### 1. První nasazení (Initial Setup)

```bash
# 1. Naklonujte repository
git clone https://github.com/your-org/spheroseg-app.git
cd spheroseg-app

# 2. Nastavte práva pro skripty
chmod +x scripts/*.sh

# 3. Vytvořte Docker network
docker network create spheroseg-network

# 4. Spusťte nginx container
docker run -d \
  --name spheroseg-nginx \
  --network spheroseg-network \
  -p 80:80 -p 443:443 \
  -v $(pwd)/docker/nginx/nginx.prod.conf:/etc/nginx/nginx.conf:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  nginx:alpine

# 5. Spusťte staging prostředí
docker compose -f docker-compose.staging.yml up -d

# 6. Ověřte zdraví
./scripts/deployment-health-check.sh
```

### 2. Nasazení nové verze (Zero-Downtime Deployment)

```bash
# 1. Stáhněte nejnovější kód
git pull origin main

# 2. Spusťte blue-green deployment
./scripts/deploy-blue-green.sh

# Script automaticky:
# - Detekuje aktivní prostředí (staging/production)
# - Zálohuje databázi
# - Nasadí novou verzi do neaktivního prostředí
# - Spustí migrace databáze
# - Přepne nginx na nové prostředí
# - Nechá staré prostředí běžet pro rychlý rollback
```

### 3. Rollback (v případě problémů)

```bash
# Okamžitý rollback na předchozí prostředí
./scripts/rollback-deployment.sh

# Rollback trvá pouze několik sekund
```

## 📊 Monitoring

### Health Check

```bash
# Kompletní health check obou prostředí
./scripts/deployment-health-check.sh
```

### Logy

```bash
# Staging logy
docker logs staging-backend -f
docker logs staging-frontend -f
docker logs staging-ml -f

# Production logy
docker logs production-backend -f
docker logs production-frontend -f
docker logs production-ml -f

# Nginx logy
docker logs spheroseg-nginx -f
```

### Metriky

- Grafana staging: http://server:3031
- Grafana production: http://server:3032

## 🔧 Ruční přepínání prostředí

### Přepnout na production

```bash
# 1. Ujistěte se, že production běží
docker compose -f docker-compose.production.yml up -d

# 2. Počkejte na health check
docker exec production-backend curl -f http://localhost:3001/health

# 3. Přepněte nginx
sed -i 's/staging-/production-/g' docker/nginx/nginx.prod.conf
docker exec spheroseg-nginx nginx -s reload
```

### Přepnout na staging

```bash
# 1. Ujistěte se, že staging běží
docker compose -f docker-compose.staging.yml up -d

# 2. Počkejte na health check
docker exec staging-backend curl -f http://localhost:3001/health

# 3. Přepněte nginx
sed -i 's/production-/staging-/g' docker/nginx/nginx.prod.conf
docker exec spheroseg-nginx nginx -s reload
```

## 🗄️ Databázové migrace

### Automatické migrace při deploymentu

Migrace se spouští automaticky během `deploy-blue-green.sh`.

### Ruční migrace

```bash
# Staging
docker exec staging-backend npx prisma migrate deploy

# Production
docker exec production-backend npx prisma migrate deploy
```

### Backup databáze

```bash
# Staging backup
docker exec staging-db pg_dump -U spheroseg spheroseg_staging | gzip > backup_staging_$(date +%Y%m%d).sql.gz

# Production backup
docker exec production-db pg_dump -U spheroseg spheroseg_production | gzip > backup_production_$(date +%Y%m%d).sql.gz
```

### Restore databáze

```bash
# Restore staging
gunzip -c backup_staging_20250820.sql.gz | docker exec -i staging-db psql -U spheroseg spheroseg_staging

# Restore production
gunzip -c backup_production_20250820.sql.gz | docker exec -i production-db psql -U spheroseg spheroseg_production
```

## 🔒 Bezpečnost

1. **SSL Certifikáty**

   ```bash
   # Obnovení Let's Encrypt certifikátu
   certbot renew
   docker exec spheroseg-nginx nginx -s reload
   ```

2. **Firewall pravidla**

   ```bash
   # Povolte pouze potřebné porty
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 22/tcp
   ufw enable
   ```

3. **Secrets management**
   - Nikdy necommitujte `.env` soubory
   - Používejte silná hesla a JWT secrets
   - Pravidelně rotujte credentials

## 📝 Deployment Checklist

### Před deploymentem

- [ ] Otestováno lokálně
- [ ] Testy prošly (npm test, npm run test:e2e)
- [ ] Databázové migrace připraveny
- [ ] Environment variables aktualizovány
- [ ] Záloha databáze vytvořena

### Během deploymentu

- [ ] Health check starého prostředí OK
- [ ] Nové prostředí nastartováno
- [ ] Migrace proběhly úspěšně
- [ ] Health check nového prostředí OK
- [ ] Nginx přepnut na nové prostředí

### Po deploymentu

- [ ] Veřejný endpoint funguje
- [ ] Login funguje
- [ ] WebSocket připojení funguje
- [ ] ML inference funguje
- [ ] Monitoring ukazuje normální hodnoty

## 🚨 Troubleshooting

### Nginx nefunguje

```bash
# Zkontrolujte konfiguraci
docker exec spheroseg-nginx nginx -t

# Restartujte nginx
docker restart spheroseg-nginx

# Zkontrolujte logy
docker logs spheroseg-nginx
```

### Backend nereaguje

```bash
# Zkontrolujte health
curl http://localhost:4001/health  # staging
curl http://localhost:5001/health  # production

# Zkontrolujte logy
docker logs staging-backend --tail 100
```

### Databáze nefunguje

```bash
# Zkontrolujte připojení
docker exec staging-db pg_isready

# Zkontrolujte logy
docker logs staging-db

# Restartujte databázi
docker restart staging-db
```

### Nedostatek místa na disku

```bash
# Vyčistěte Docker
docker system prune -a --volumes

# Vyčistěte logy
truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

## 📞 Kontakty

V případě kritických problémů kontaktujte:

- DevOps tým: devops@example.com
- On-call inženýr: +420 XXX XXX XXX
