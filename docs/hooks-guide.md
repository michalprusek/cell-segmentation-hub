# Git Hooks Guide for SpheroSeg Project

## Overview

This project uses comprehensive Git hooks to ensure code quality and prevent issues before they reach production. The hooks are managed by Husky and provide multiple layers of validation.

## Available Hooks

### 1. Pre-Commit Hook (`.husky/pre-commit`)

**Purpose**: Validates code quality before each commit

**Checks performed** — the eleven numbered steps in the hook, in order:

1. Branch protection — direct commits to `main` are refused
2. Merge conflict markers
3. `debugger` / `console.log` (test files, logger files and comments excluded)
4. TODO / FIXME comments (warning only)
5. Potential secrets (currently disabled — too many false positives)
6. Large files (> 1 MB)
7. ESLint on staged **frontend** files, zero warnings, no auto-fix
   - 7b. `scripts/eslint-baseline.mjs` — whole-tree baseline gate on
     `backend/src`, because the root ESLint config ignores `backend/**`
8. TypeScript, frontend and backend (`scripts/type-check-baseline.mjs`)
9. Python files, if any changed
10. `lint-staged` (Prettier, `scripts/code-quality-check.js`, madge,
    `scripts/verify-shared-types.cjs`)
11. Commit message format, when the message is already available

**It does not run unit tests, a security audit, or any Docker or dependency
validation.** Those either live in the pre-push hook (below) or do not exist.

**There is no hook configuration.** Earlier revisions of this page documented
`STRICT_MODE`, `AUTO_FIX`, `SKIP_TESTS` and `DOCKER_CHECKS` environment
variables and an `.env.hooks` file to hold them. No hook has ever read any of
them — `grep -rniE 'STRICT_MODE|AUTO_FIX|SKIP_TESTS|DOCKER_CHECKS' .husky/`
returns nothing — so setting one is a no-op and the full checks run anyway.
To change what a hook does, edit the hook.

### 2. Pre-Merge Hook (`.husky/pre-merge`)

**Purpose**: Comprehensive validation before merging to main/production branches

**Test suites:**

1. **Branch Protection** - Ensures branch is up-to-date
2. **Code Compilation** - Builds frontend and backend
3. **Unit Tests** - Runs all unit test suites
4. **Integration Tests** - Tests with Docker services
5. **E2E Tests** - Playwright end-to-end tests
6. **Performance Tests** - Bundle size and memory leak checks
7. **Security Scan** - Vulnerability and secrets scanning
8. **Database Migrations** - Schema validation
9. **Documentation** - Checks for updates
10. **Dependencies** - Outdated and unused dependencies

**Usage:**

```bash
# Run locally before creating PR
./scripts/pre-merge-check.sh

# Specify target branch
./scripts/pre-merge-check.sh production
```

### 2b. Pre-Push Hook (`.husky/pre-push`)

**Purpose**: the heavier checks, too slow for every commit

1. `npm audit` on frontend and backend dependencies
2. Circular dependencies (`npx madge --circular src/`)
3. Bundle size, if a build output is present
4. Test coverage
5. Documentation check

Only step 2 blocks unconditionally — a circular import is a hard `exit 1`.
Steps 1 and 4 prompt interactively and continue on their own in a
non-interactive shell, so in CI-like conditions treat their output as
advisory. The merge gate is `.github/workflows/ci.yml`, not this hook.

### 3. Commit Message Hook (`.husky/commit-msg`)

**Purpose**: Ensures commit messages follow conventional commits format

**Valid formats:**

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `chore:` - Maintenance tasks
- `perf:` - Performance improvements
- `ci:` - CI/CD changes

**Examples:**

```bash
git commit -m "feat: add user authentication"
git commit -m "fix: resolve memory leak in image processing"
git commit -m "docs: update API documentation"
```

## GitHub Actions Integration

The chronically-failing pre-merge / CI-CD / quality-gates workflows were
removed in PR #161 (see `chore(ci): remove broken workflows, add nightly
drift`). The surface that remains is intentionally minimal, but one of the
three workflows **is** a blocking gate.

### Active workflows

- **`.github/workflows/ci.yml`** — the merge gate. Four jobs: `frontend`
  (TypeScript baseline, ESLint at zero warnings, i18n across six locales,
  Vitest with a coverage floor), `backend` (TypeScript, ESLint baseline gate,
  Vitest with a coverage floor), `pins` (Python undefined names, parse check,
  ML/essays pin agreement) and `python-tests`. The repository's
  `main-protection` ruleset requires the `frontend` and `backend` contexts,
  so those two block the merge.
- **`.github/workflows/codeql.yml`** — passive security scanning. Results
  appear in the repo's Security tab, never blocks PRs.
- **`.github/workflows/nightly-drift.yml`** — daily cron on `main`.
  Runs full TypeScript / ESLint / Vitest / i18n / `npm audit`. On failure
  it opens a GitHub Issue labelled `nightly-drift` rather than blocking
  PR merges. GitGuardian (installed as a GitHub App) catches secret leaks.

### Local equivalent

```bash
make ci        # TypeScript + ESLint + i18n + doc links + Python, ~30 s
npx vitest run # what `make ci` leaves out and CI gates on
```

`make ci` is fast because it skips the unit suites. Running it green is not
the same as passing CI.

## Installation & Setup

### Initial Setup

```bash
# Install Husky
npm install

# Initialize Husky (if not already done)
npx husky init

# Make hooks executable
chmod +x .husky/*
```

### Troubleshooting

#### Hook not running

```bash
# Reinstall Husky
rm -rf .husky
npx husky init
# Copy hook files back
```

#### ESLint/Prettier issues

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

#### Docker services needed by a check

```bash
# There is no staging compose file; use the production one locally
docker compose -f docker-compose.production.yml --env-file .env.production up -d
docker compose -f docker-compose.production.yml ps
```

## Bypassing Hooks

**Don't.** `git commit --no-verify` is not an accepted escape hatch in this
project — the hooks are what keep `main` releasable, and the failures they
catch (a hard backend ESLint error, a `console.log`, a direct commit to
`main`) are exactly the ones that reach production otherwise. If a hook is
wrong, fix the hook in its own commit.

The environment variables earlier revisions of this page offered as a softer
bypass (`STRICT_MODE`, `SKIP_TESTS`, `DOCKER_CHECKS`) were never implemented;
setting them changes nothing.

## Best Practices

1. **Always run pre-merge check before creating PR**

   ```bash
   ./scripts/pre-merge-check.sh
   ```

2. **Fix issues immediately**
   - Don't accumulate warnings
   - Address security vulnerabilities promptly

3. **Keep dependencies updated**

   ```bash
   npm update
   npm audit fix
   ```

4. **Write meaningful commit messages**
   - Use conventional commits format
   - Be descriptive but concise

5. **Test locally first**
   ```bash
   # Run all checks locally
   npm run format
   npm run lint
   npm run type-check
   npm test
   ```

## Hook Configuration

### Custom Configuration

Modify hook behavior by editing the hooks directly:

```bash
# Edit pre-commit hook
vim .husky/pre-commit

# Edit pre-merge hook
vim .husky/pre-merge
```

## Monitoring & Metrics

Track hook performance and issues:

```bash
# View hook execution time
time git commit -m "test"

# Check hook logs
git commit -m "test" 2>&1 | tee commit.log

# Analyze failures
grep "fail\|error" commit.log
```

## Support

For issues or questions:

1. Check this documentation
2. Review hook output carefully
3. Run `./scripts/pre-merge-check.sh` for detailed validation
4. Contact the development team

## Quick Reference

```bash
# Normal commit
git commit -m "feat: add new feature"

# The local gate, before opening a PR
make ci
npx vitest run

# Full pre-merge validation
./scripts/pre-merge-check.sh

# Check specific branch
./scripts/pre-merge-check.sh production
```

---

**Remember**: These hooks protect our production environment. Use them wisely! 🛡️
