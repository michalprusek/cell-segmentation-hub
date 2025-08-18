# Git Hooks Guide for SpheroSeg Project

## Overview

This project uses comprehensive Git hooks to ensure code quality and prevent issues before they reach production. The hooks are managed by Husky and provide multiple layers of validation.

## Available Hooks

### 1. Pre-Commit Hook (`.husky/pre-commit`)

**Purpose**: Validates code quality before each commit

**Checks performed:**
- ✅ Git status (merge conflicts, large files, sensitive files)
- ✅ Code formatting (Prettier)
- ✅ Linting (ESLint)
- ✅ TypeScript type checking (frontend & backend)
- ✅ Unit tests
- ✅ Security audit
- ✅ Code quality (console.log, debugger, TODOs)
- ✅ Docker configuration validation
- ✅ Dependencies validation

**Configuration:**
```bash
# Run with strict mode (blocks commit on errors)
STRICT_MODE=true git commit -m "your message"

# Disable auto-fix
AUTO_FIX=false git commit -m "your message"

# Skip tests (not recommended)
SKIP_TESTS=true git commit -m "your message"

# Disable Docker checks
DOCKER_CHECKS=false git commit -m "your message"
```

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

Pull requests to protected branches trigger automatic validation:

### Workflow: `.github/workflows/pre-merge-checks.yml`

**Jobs:**
1. **code-quality** - Formatting, linting, TypeScript
2. **unit-tests** - Frontend and backend tests with coverage
3. **build** - Build validation and bundle size check
4. **docker-build** - Docker image building
5. **integration-tests** - API and service integration
6. **e2e-tests** - Playwright tests
7. **security** - npm audit, Trivy scan, secret detection
8. **database-check** - Migration validation
9. **merge-ready** - Final status check

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

#### Docker tests failing
```bash
# Ensure Docker services are running
docker compose -f docker-compose.staging.yml up -d

# Check service health
docker compose -f docker-compose.staging.yml ps
```

## Bypassing Hooks (Emergency Only)

⚠️ **WARNING**: Bypassing hooks should only be done in emergencies

```bash
# Bypass pre-commit hook
git commit --no-verify -m "emergency fix"

# Bypass with environment variable
STRICT_MODE=false git commit -m "allow with warnings"

# Skip specific checks
SKIP_TESTS=true DOCKER_CHECKS=false git commit -m "quick fix"
```

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

### Environment Variables

Create `.env.hooks` file for persistent configuration:

```bash
# .env.hooks
STRICT_MODE=true        # Enforce all checks
AUTO_FIX=true          # Auto-fix formatting/linting
DOCKER_CHECKS=true     # Run Docker validations
SKIP_TESTS=false       # Never skip tests
```

Load in your shell:
```bash
source .env.hooks
```

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

# Commit with warnings allowed
STRICT_MODE=false git commit -m "fix: urgent patch"

# Skip tests (development only)
SKIP_TESTS=true git commit -m "wip: work in progress"

# Full pre-merge validation
./scripts/pre-merge-check.sh

# Check specific branch
./scripts/pre-merge-check.sh production
```

---

**Remember**: These hooks protect our production environment. Use them wisely! 🛡️