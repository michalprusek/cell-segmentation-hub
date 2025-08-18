# CI/CD Setup Guide

## Overview

This project uses GitHub Actions for automated testing, building, and deployment. The CI/CD pipeline supports three environments: development, staging, and production.

## Workflow Structure

### 1. Test Workflow (`test.yml`)

- **Triggers**: Pull requests, pushes to dev branch
- **Jobs**: Linting, type checking, unit tests, integration tests, E2E tests, security scanning
- **Purpose**: Ensures code quality before merging

### 2. Staging Deployment (`staging.yml`)

- **Triggers**: Push to `staging` branch
- **Process**: Test → Build → Deploy to staging server
- **Features**: Automated testing, Docker image building, health checks

### 3. Production Deployment (`production.yml`)

- **Triggers**: Push to `main` branch or version tags (v\*)
- **Process**: Approval → Backup → Build → Deploy → Verify
- **Features**: Manual approval, database backup, blue-green deployment, automatic rollback

## GitHub Secrets Configuration

You need to configure the following secrets in your GitHub repository settings:

### Required Secrets

#### SSH Access

- `STAGING_SSH_KEY`: Private SSH key for staging server access
- `STAGING_HOST`: Staging server IP/hostname
- `STAGING_USER`: SSH username for staging server
- `PRODUCTION_SSH_KEY`: Private SSH key for production server access
- `PRODUCTION_HOST`: Production server IP/hostname
- `PRODUCTION_USER`: SSH username for production server

#### Notifications (Optional)

- `SLACK_WEBHOOK`: Slack webhook URL for deployment notifications

### How to Add Secrets

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add each secret with its name and value

## Deployment Strategies

### Staging Deployment

- Automatic deployment on push to `staging` branch
- No approval required
- Runs smoke tests after deployment

### Production Deployment

#### Option 1: CI/CD Pipeline

Push to `main` branch or create a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

#### Option 2: Manual Deployment from Staging

Use the provided script to promote staging to production:

```bash
./scripts/deploy-from-staging.sh
```

This script:

1. Verifies staging health
2. Backs up production database
3. Tags and promotes staging images
4. Deploys with minimal downtime
5. Provides rollback capability

#### Rollback

If deployment fails, use the rollback script:

```bash
./scripts/rollback-production.sh
```

## Environment Configuration

### Branch Strategy

- `dev`: Development branch (auto-tests only)
- `staging`: Staging deployments
- `main`: Production deployments

### Docker Registry

The pipeline uses GitHub Container Registry (ghcr.io) to store Docker images:

- Images are tagged with branch names and commit SHAs
- Production images also get semantic version tags

## Local Development

### Running Tests Locally

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# All checks (as in CI)
npm run lint && npm run type-check && npm run test
```

### Manual Deployment

#### Deploy to Staging

```bash
# On staging server
cd /home/cvat/cell-segmentation-hub
docker compose -f docker-compose.staging.yml pull
docker compose -f docker-compose.staging.yml up -d
```

#### Deploy to Production

```bash
# On production server
cd /home/cvat/cell-segmentation-hub
./scripts/deploy-from-staging.sh
```

## Monitoring Deployments

### GitHub Actions Dashboard

View deployment status at: `https://github.com/[your-org]/cell-segmentation-hub/actions`

### Deployment Environments

GitHub tracks deployments in the Environments tab:

- Staging: `https://staging.spherosegapp.utia.cas.cz`
- Production: `https://spherosegapp.utia.cas.cz`

## Best Practices

1. **Always test on staging first**: Let changes run on staging for at least a few hours before production
2. **Use version tags**: Tag production releases with semantic versions
3. **Monitor after deployment**: Check Grafana dashboards and logs after deployment
4. **Keep backups**: Production deployment automatically backs up the database
5. **Document changes**: Update CHANGELOG.md with significant changes

## Troubleshooting

### Common Issues

#### SSH Connection Failed

- Verify SSH keys are correctly added to GitHub Secrets
- Ensure server allows SSH key authentication
- Check firewall rules

#### Docker Build Failed

- Check Dockerfile syntax
- Verify all required files are committed
- Review build logs in GitHub Actions

#### Deployment Health Check Failed

- Check service logs: `docker compose logs [service]`
- Verify environment variables are set correctly
- Ensure database migrations ran successfully

#### Rollback Needed

1. Use the rollback script: `./scripts/rollback-production.sh`
2. Or manually revert in GitHub and trigger new deployment
3. Check logs to identify the issue before re-deploying

## Security Considerations

1. **Never commit secrets**: Use GitHub Secrets for sensitive data
2. **Rotate secrets regularly**: Update JWT secrets, passwords periodically
3. **Use strong passwords**: Generate random, complex passwords for production
4. **Limit access**: Use deployment environments for approval gates
5. **Audit logs**: Review GitHub Actions logs regularly

## Support

For issues with CI/CD:

1. Check GitHub Actions logs
2. Review this documentation
3. Contact the DevOps team
4. Create an issue in the repository
