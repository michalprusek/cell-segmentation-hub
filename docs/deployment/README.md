# Deployment

Production is a **single stack**. Blue-green deployment was removed in May 2026
together with its orchestration scripts — if you find a doc or a script
referring to blue/green environments, staging subdomains,
`docker-compose.prod.yml`, `scripts/deploy-production.sh` or
`rollback-deployment.sh`, it is describing a system that no longer exists.

---

## The stack

| Service       | Container            | Production port |
| ------------- | -------------------- | --------------- |
| nginx (TLS)   | `spheroseg-nginx`    | 80 / 443        |
| Frontend      | `spheroseg-frontend` | 4000            |
| Backend       | `spheroseg-backend`  | 4001            |
| ML            | `spheroseg-ml`       | 4008            |
| Essays worker | (essays)             | loopback only   |
| PostgreSQL    | `spheroseg-postgres` | internal        |
| Redis         | `spheroseg-redis`    | internal        |

Compose file `docker-compose.production.yml` with `--env-file .env.production`.
Database `spheroseg`.

---

## Deploying a change

```bash
# 1. Build only what changed
make build-service SERVICE=backend       # or frontend / ml

# 2. Recreate that service
docker compose -f docker-compose.production.yml \
  --env-file .env.production \
  up -d --no-deps --force-recreate backend

# 3. If you recreated the backend, restart nginx
docker restart spheroseg-nginx

# 4. Verify
curl https://spherosegapp.utia.cas.cz/health
```

`make prod` rebuilds and recreates everything — useful for a large change,
unnecessary for a service-scoped one.

### Deploy checklist

- [ ] The branch is up to date with `main`. A build bakes the working tree, so
      deploying from a stale branch ships stale code.
- [ ] `make ci` passes.
- [ ] For a frontend change, the **production bundle** was built and clicked
      through locally — minification, tree-shaking and chunk splitting behave
      differently from the dev server.
- [ ] Migrations, if any, applied with `prisma migrate deploy` (never
      `migrate dev`).
- [ ] After deploying, the change was verified **in a real browser** with the
      console open.

---

## Gotchas

Each of these has caused a production incident.

**Always pass `--env-file .env.production`.** Without it environment variables
are silently empty inside the container. Verify with
`docker exec <container> env | grep <VAR>`.

**Restart nginx after recreating the backend.** Its upstream DNS cache pins the
old container's IP and every request 502s.

**Bind-mounted configs need `--force-recreate`, not `nginx -s reload`.** An
in-place `sed` rewrites the inode; the running container still holds the old
one.

**GPU access comes from `device_cgroup_rules`, not `devices:`.** A running
container can silently lose its GPU when any cgroup rewrite happens —
`torch.cuda.is_available()` keeps saying `True` while every new process gets the
CPU. Do **not** "fix" this by switching to `devices:`: Docker re-resolves those
host paths on every start, and `/dev/nvidia-uvm` is created lazily, so with
`restart: always` a boot race becomes a crash loop instead of a degradation. The
ML health endpoint probes `/dev/nvidiactl` for exactly this reason; recreate the
container to recover.

**The HuggingFace cache bind mount must exist with the right ownership** before
the ML container starts. It is still load-bearing for SegFormer and sperm, which
call `from_pretrained`. The **microtubule model does not need it** — its
checkpoint carries every weight and nothing is downloaded at run time.

**Upload limits are coupled across three layers** — a frontend constant, the
multer config and nginx's `client_max_body_size`. The smallest wins. Images
20 MB, videos and ND2 100 GB.

**Migration history can diverge.** Never run a blind `migrate deploy` against
production without checking what it will apply.

**Some names are historical.** Volumes still carry a `_blue_data` suffix and the
upload directory is still mounted from a `blue` path on the host. These are
internal identifiers, never user-visible; renaming them would require downtime
and a manual volume copy. The database password string containing `blue` is a
fixed credential, not a database name.

---

## Model weights

Checkpoints are not in the repository. Stage them once with
`scripts/download-microtubule-weights.sh` and the other weight scripts, then
verify with `make check-weights`. See
[Model weights setup](../MODEL_WEIGHTS_SETUP.md).

## Related

- [Docker build system](DOCKER_BUILD_MIGRATION.md)
- [API monitoring](api-monitoring.md)
- [GPU configuration](../GPU-CONFIGURATION.md)
- [Database backup](../database-backup.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
