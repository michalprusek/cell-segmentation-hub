# 🔒 Automatická ochrana kódu - Rychlý setup

## 🚀 Rychlé nastavení (1 minuta)

### Varianta A: Pomocí GitHub CLI (nejjednodušší)

```bash
# 1. Nainstalujte GitHub CLI (pokud ještě nemáte)
brew install gh  # macOS
# nebo
sudo apt install gh  # Linux

# 2. Přihlaste se
gh auth login

# 3. Spusťte automatické nastavení
./scripts/quick-protection-setup.sh
```

**Hotovo! ✅** Branch protection je aktivní.

### Varianta B: Pomocí setup skriptu

```bash
# 1. Spusťte setup skript
./scripts/setup-branch-protection.sh

# 2. Vložte GitHub token když se zeptá
# (vytvořte na: https://github.com/settings/tokens)

# 3. Potvrďte nastavení pro branch 'main'
```

### Varianta C: Manuálně na GitHubu (2 minuty)

1. Jděte na: `https://github.com/[váš-username]/[repo]/settings/branches`
2. Klikněte **"Add rule"** u main branch
3. Zaškrtněte:
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass** → vyberte: `merge-ready`
   - ✅ **Include administrators**
   - ✅ **Require conversation resolution**
4. Klikněte **"Create"**

## ✅ Co to udělá?

Po nastavení:

- ❌ **Nelze mergovat PR dokud všechny testy neprojdou**
- ❌ **Nelze pushovat přímo do main** (pouze přes PR)
- ✅ **Automatické spuštění testů** při každém PR
- ✅ **Blokování merge tlačítka** při selhání

## 🧪 Jak to otestovat?

```bash
# 1. Vytvořte testovací branch
git checkout -b test-protection

# 2. Udělejte změnu
echo "test" > test.txt
git add . && git commit -m "test: branch protection"

# 3. Pushněte a vytvořte PR
git push origin test-protection
gh pr create --title "Test protection" --body "Testing"

# 4. Sledujte na GitHubu
# - Uvidíte běžící testy
# - Merge tlačítko bude disabled dokud testy neprojdou
```

## 📊 Co se kontroluje?

Při každém PR se automaticky spustí:

| Check          | Popis                            | Blokuje merge? |
| -------------- | -------------------------------- | -------------- |
| `code-quality` | Formátování, linting, TypeScript | ✅ Ano         |
| `unit-tests`   | Unit testy (frontend + backend)  | ✅ Ano         |
| `build`        | Build aplikace                   | ✅ Ano         |
| `security`     | Bezpečnostní scan                | ✅ Ano         |
| `e2e-tests`    | End-to-end testy                 | ✅ Ano         |
| `merge-ready`  | Finální check všeho              | ✅ Ano         |

## 🛠️ Konfigurace

### Změna nastavení

```bash
# Zobrazit aktuální nastavení
./scripts/setup-branch-protection.sh --status

# Odstranit ochranu
./scripts/setup-branch-protection.sh --remove

# Znovu nastavit
./scripts/setup-branch-protection.sh
```

### Environment proměnné

```bash
# Zkopírujte a upravte
cp .env.hooks.example .env.hooks

# Načtěte před commitem
source .env.hooks

# Například: povolit commit s warningy
export STRICT_MODE=false
git commit -m "feat: new feature"
```

## ❓ Časté otázky

### Proč nemohu mergovat?

- Zkontrolujte záložku "Checks" v PR
- Všechny musí být zelené ✅
- Zejména `merge-ready` check

### Jak obejít ochranu? (NOUZOVĚ)

```bash
# Pouze admin může Force merge na GitHubu
# Settings → Branches → Temporarily disable

# POZOR: Toto je nebezpečné!
```

### Testy lokálně projdou, na GitHubu ne?

```bash
# Spusťte přesně stejné testy jako CI
./scripts/pre-merge-check.sh

# Nebo v Dockeru
docker compose -f docker-compose.staging.yml up -d
npm test
```

## 📞 Potřebujete pomoc?

1. Zkontrolujte: `docs/hooks-guide.md`
2. Spusťte: `./scripts/pre-merge-check.sh` pro diagnostiku
3. Podívejte se na: Actions tab na GitHubu

---

**🎉 Gratulujeme!** Váš kód je nyní chráněný proti chybám v produkci!
