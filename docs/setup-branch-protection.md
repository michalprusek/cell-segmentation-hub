# Nastavení automatické ochrany větve (Branch Protection)

## 🔒 Jak zajistit, že selhání testů ZABLOKUJE merge

### 1. Nastavení na GitHubu (DOPORUČENO)

Jděte do nastavení repozitáře na GitHubu:

1. **Settings** → **Branches**
2. Klikněte **Add rule** nebo **Edit** u existujícího pravidla pro `main`
3. Nastavte:

```
✅ Require a pull request before merging
  ✅ Require approvals (alespoň 1)
  ✅ Dismiss stale pull request approvals when new commits are pushed

✅ Require status checks to pass before merging
  ✅ Require branches to be up to date before merging

  Vyberte tyto status checks (z našeho workflow):
  ✅ code-quality
  ✅ unit-tests (frontend)
  ✅ unit-tests (backend)
  ✅ build
  ✅ docker-build
  ✅ integration-tests
  ✅ e2e-tests
  ✅ security
  ✅ database-check
  ✅ merge-ready  ← TENTO JE KLÍČOVÝ!

✅ Require conversation resolution before merging
✅ Require linear history (volitelné)
✅ Include administrators (doporučeno - platí i pro adminy)
```

4. Klikněte **Create** nebo **Save changes**

### 2. Lokální Git Hook (alternativa)

Vytvořte skutečný merge hook pomocí Git aliasu:

```bash
# Přidejte do ~/.gitconfig nebo .git/config
[alias]
    safe-merge = "!f() { \
        echo 'Running pre-merge checks...'; \
        bash .husky/pre-merge $1 || exit 1; \
        git merge $1; \
    }; f"
```

Použití:

```bash
git safe-merge feature-branch
```

### 3. Automatizace pomocí CI/CD

#### GitHub Settings pro automatické blokování:

```yaml
# .github/settings.yml (vyžaduje GitHub Settings App)
repository:
  has_wiki: false
  has_projects: false

branches:
  - name: main
    protection:
      required_status_checks:
        strict: true
        contexts:
          - 'merge-ready' # Náš finální check
      enforce_admins: true
      required_pull_request_reviews:
        required_approving_review_count: 1
        dismiss_stale_reviews: true
      restrictions: null
```

### 4. Použití GitHub API pro programové nastavení

```bash
# Script pro nastavení branch protection přes API
curl -X PUT \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/OWNER/REPO/branches/main/protection \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["merge-ready"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1
    },
    "restrictions": null
  }'
```

## 🎯 Výsledek po nastavení:

1. **PR nelze mergovat dokud:**
   - ✅ Všechny testy neprojdou (zelené checkmarky)
   - ✅ Někdo neschválí PR (code review)
   - ✅ Nejsou vyřešeny všechny komentáře

2. **GitHub zobrazí:**

   ```
   ❌ Merging is blocked
   The base branch requires all status checks to pass before merging.

   Required checks:
   ❌ merge-ready - failing
   ✅ code-quality - passed
   ✅ unit-tests - passed
   ...
   ```

3. **Tlačítko "Merge" bude:**
   - 🔴 Červené a disabled pokud testy selhávají
   - 🟢 Zelené pouze když vše projde

## 📊 Monitoring

Po nastavení můžete sledovat:

1. **Insights → Actions** - historie běhů workflow
2. **Settings → Branches** - aktuální nastavení protection
3. **Pull Requests** - status checks na každém PR

## 🚨 Důležité poznámky:

- **Branch protection funguje pouze na GitHubu** (ne lokálně)
- **Admins mohou protection obejít** (pokud není "Include administrators")
- **Force push je blokován** automaticky s branch protection
- **Změny se projeví okamžitě** na všech otevřených PR

## 🔧 Troubleshooting

Pokud se checks nezobrazují:

1. Zkontrolujte, že workflow běží (Actions tab)
2. Ověřte názvy jobs v workflow
3. Počkejte 1-2 minuty na synchronizaci
4. Zkuste znovu pushnout do PR
