# 🚀 Blue-Green Deployment - Průvodce

## Co je Blue-Green Deployment?

Blue-Green deployment je technika, která umožňuje **bezpečné aktualizace aplikace s nulovým výpadkem**. Funguje tak, že máte dvě identická prostředí:

- **🔵 BLUE** - Jedno prostředí (např. současná produkce)
- **🟢 GREEN** - Druhé prostředí (pro novou verzi)

Když je nová verze připravená, jednoduše přepnete provoz z jednoho prostředí na druhé.

## Vaše Nastavení

### Porty a Prostředí

| Prostředí | Frontend | Backend | ML Service | Databáze        |
| --------- | -------- | ------- | ---------- | --------------- |
| **BLUE**  | 4000     | 4001    | 4008       | spheroseg_blue  |
| **GREEN** | 5000     | 5001    | 5008       | spheroseg_green |

**Hlavní doména**: https://spherosegapp.utia.cas.cz (směřuje na aktivní prostředí)

### Struktura Souborů

```
cell-segmentation-hub/
├── docker-compose.blue.yml    # Blue prostředí konfigurace
├── docker-compose.green.yml   # Green prostředí konfigurace
├── docker/nginx/
│   └── nginx.prod.conf       # Nginx konfigurace (přepíná mezi Blue/Green)
└── scripts/
    ├── switch-blue-green.sh   # Přepínání mezi prostředími
    └── migrate-database.sh    # Migrace databází
```

## 📋 Základní Příkazy

### 1. Zjistit Aktuální Stav

```bash
# Zobrazit, které prostředí je aktivní
./scripts/switch-blue-green.sh status
```

Ukáže vám:

- Které prostředí je aktivní (BLUE nebo GREEN)
- Stav všech kontejnerů
- Zdraví obou prostředí

### 2. Spustit Prostředí

```bash
# Spustit BLUE prostředí
docker-compose -f docker-compose.blue.yml up -d

# Spustit GREEN prostředí
docker-compose -f docker-compose.green.yml up -d
```

### 3. Přepnout Mezi Prostředími

```bash
# Přepnout na GREEN (nová verze)
./scripts/switch-blue-green.sh green

# Přepnout zpět na BLUE (rollback)
./scripts/switch-blue-green.sh blue
```

**⚡ Přepnutí trvá < 1 sekundu!**

### 4. Migrovat Databázi

```bash
# Zkopírovat data z BLUE do GREEN před přepnutím
./scripts/migrate-database.sh blue-to-green

# Nebo opačným směrem
./scripts/migrate-database.sh green-to-blue
```

## 🔄 Deployment Workflow

### Krok 1: Příprava

```bash
# 1. Zjistit aktuální stav
./scripts/switch-blue-green.sh status

# Řekněme, že BLUE je aktivní produkce
```

### Krok 2: Připravit Novou Verzi

```bash
# 2. Stáhnout nejnovější kód do GREEN
git pull

# 3. Sestavit a spustit GREEN prostředí
docker-compose -f docker-compose.green.yml up -d --build
```

### Krok 3: Migrovat Data

```bash
# 4. Zkopírovat produkční data do GREEN
./scripts/migrate-database.sh blue-to-green
```

### Krok 4: Test Nové Verze

```bash
# 5. Otestovat GREEN prostředí (běží na portu 5000)
curl http://localhost:5000/health
curl http://localhost:5001/api/health

# Můžete také otevřít v prohlížeči:
# http://SERVER_IP:5000
```

### Krok 5: Přepnutí na Produkci

```bash
# 6. Když je vše OK, přepnout produkci na GREEN
./scripts/switch-blue-green.sh green

# Aplikace na https://spherosegapp.utia.cas.cz nyní běží z GREEN!
```

### Krok 6: V Případě Problémů - Rychlý Rollback

```bash
# Okamžitě vrátit zpět na BLUE
./scripts/switch-blue-green.sh blue

# Hotovo! Aplikace běží ze staré verze
```

## 🛡️ Bezpečnostní Funkce

1. **Automatické zálohy** - Při každém přepnutí se vytvoří záloha nginx konfigurace
2. **Health check** - Před přepnutím se kontroluje, že cílové prostředí běží
3. **Okamžitý rollback** - Vrácení na předchozí verzi trvá < 1 sekundu
4. **Databázové zálohy** - Při migraci se automaticky zálohují obě databáze

## ⚠️ Důležitá Upozornění

### Databáze

- **BLUE a GREEN mají ODDĚLENÉ databáze**
- Po nasazení nové verze VŽDY migrujte data
- Rollback vrátí kód, NE data v databázi!

### Porty

- Ujistěte se, že porty 4000-4008 a 5000-5008 jsou volné
- Firewall musí povolit tyto porty pro testování

### První Spuštění

```bash
# Pokud začínáte s čistou instalací:
# 1. Spustit BLUE
docker-compose -f docker-compose.blue.yml up -d

# 2. Nastavit jako aktivní
./scripts/switch-blue-green.sh blue

# 3. Spustit GREEN jako zálohu
docker-compose -f docker-compose.green.yml up -d
```

## 📊 Monitoring

### Kontrola Logů

```bash
# Logy BLUE prostředí
docker logs blue-backend -f
docker logs blue-frontend -f

# Logy GREEN prostředí
docker logs green-backend -f
docker logs green-frontend -f
```

### Kontrola Zdrojů

```bash
# Využití CPU a paměti
docker stats | grep -E "blue|green"
```

## 🔧 Troubleshooting

### Problém: Kontejner neběží

```bash
# Zkontrolovat logy
docker logs [container-name]

# Restartovat prostředí
docker-compose -f docker-compose.[blue|green].yml restart
```

### Problém: Nginx nepřepíná

```bash
# Zkontrolovat nginx konfiguraci
docker exec nginx-blue nginx -t

# Manuální reload nginx
docker exec nginx-blue nginx -s reload
```

### Problém: Databáze není dostupná

```bash
# Zkontrolovat postgres kontejner
docker ps | grep postgres

# Zkontrolovat připojení
docker exec postgres-[blue|green] pg_isready
```

## 📝 Příklad Kompletního Deployment

```bash
# === DEPLOYMENT NOVÉ VERZE ===

# 1. Kontrola stavu
./scripts/switch-blue-green.sh status
# Výstup: BLUE je aktivní

# 2. Pull nejnovější kód
cd /home/cvat/cell-segmentation-hub
git pull origin main

# 3. Build a start GREEN prostředí
docker-compose -f docker-compose.green.yml up -d --build
# Čekat ~2-3 minuty na build

# 4. Kontrola, že GREEN běží
docker ps | grep green
curl http://localhost:5001/health

# 5. Migrovat databázi
./scripts/migrate-database.sh blue-to-green

# 6. Test GREEN prostředí
# Otevřít v prohlížeči: http://SERVER_IP:5000
# Přihlásit se a otestovat funkcionalitu

# 7. Přepnout produkci na GREEN
./scripts/switch-blue-green.sh green

# 8. Ověřit
curl https://spherosegapp.utia.cas.cz/health

# === HOTOVO! ===

# V případě problémů:
./scripts/switch-blue-green.sh blue  # Okamžitý rollback
```

## 💡 Tipy

1. **Vždy testujte novou verzi** před přepnutím produkce
2. **Mějte monitoring** - sledujte logy během přepnutí
3. **Dokumentujte změny** - zapisujte, co se v nové verzi změnilo
4. **Plánujte deployment** - ideálně mimo špičku
5. **Komunikujte** - informujte uživatele o plánované údržbě

## 🆘 Nouzové Kontakty

Pokud něco nefunguje:

1. Zkuste rollback: `./scripts/switch-blue-green.sh blue`
2. Zkontrolujte logy: `docker logs [container-name]`
3. Restartujte problémový kontejner: `docker restart [container-name]`

---

**Vytvořeno**: 26.8.2025
**Verze**: 1.0
**Autor**: Claude Code Assistant
