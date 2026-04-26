# Database backup

Production runs PostgreSQL (`spheroseg_blue` on container `spheroseg-postgres`).
This page covers the automated backup / retention strategy and how to restore.

## Status

`scripts/backup-database.sh` exists and works (PostgreSQL `pg_dump` with
gzip + integrity check + retention pruning), but historically nothing
scheduled it. Two install paths are documented below — pick one.

## Layout

| Path                                          | Purpose                                                                        | Owner  |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| `~/spheroseg-backups/`                        | Daily compressed dumps, named `postgres_spheroseg_blue_YYYYMMDD_HHMMSS.sql.gz` | `cvat` |
| `~/spheroseg-backups/backup.log`              | Append-only log of each run                                                    | `cvat` |
| `scripts/backup-database.sh`                  | The actual backup script (env-overridable)                                     | repo   |
| `scripts/spheroseg-backup.service` + `.timer` | systemd units (oneshot daily)                                                  | repo   |
| `scripts/install-backup-systemd.sh`           | Helper to install the units                                                    | repo   |

`BACKUP_DIR`, `LOG_FILE`, and `RETENTION_DAYS` are env-overridable, so
the script also works when invoked directly without root privileges.

## Install (systemd, recommended)

```bash
cd /home/cvat/cell-segmentation-hub
./scripts/install-backup-systemd.sh
```

That:

1. Installs both unit files into `/etc/systemd/system/`.
2. Creates `~/spheroseg-backups/` with `0750` perms.
3. `systemctl enable --now spheroseg-backup.timer`.

Next firing:

```bash
sudo systemctl list-timers spheroseg-backup.timer
```

Run on demand:

```bash
sudo systemctl start spheroseg-backup.service
journalctl -u spheroseg-backup.service -n 50
```

## Install (cron alternative)

If you don't have systemd or prefer cron, drop this into `crontab -e`:

```cron
30 3 * * *   cd /home/cvat/cell-segmentation-hub && BACKUP_DIR=$HOME/spheroseg-backups LOG_FILE=$HOME/spheroseg-backups/backup.log /bin/bash scripts/backup-database.sh
```

The script self-tolerates non-writable log paths, so it'll fall back to
stderr (which cron mails to root by default).

## What the script does

1. Reads `DATABASE_URL` from `.env.production` (parsed via Python `urllib`).
2. Creates a temporary `~/.pgpass`-style file (mode `0600`, removed in `trap EXIT`).
3. `pg_dump --no-owner --no-acl --clean --if-exists | gzip` → `BACKUP_DIR/postgres_<db>_<ts>.sql.gz`.
4. Verifies gzip integrity (`gunzip -t`).
5. Prunes files older than `RETENTION_DAYS` (default 30) in `BACKUP_DIR`.

## Restore

```bash
# Pick the dump you want (latest example)
LATEST=$(ls -t ~/spheroseg-backups/postgres_spheroseg_blue_*.sql.gz | head -1)

# Stop services that write to the DB so the restore is consistent
docker compose -f docker-compose.production.yml stop backend ml

# Drop + recreate the schema (SQL contains DROP TABLE/INDEX/etc.)
gunzip -c "$LATEST" | docker exec -i spheroseg-postgres psql \
    -U spheroseg -d spheroseg_blue

# Restart writers
docker compose -f docker-compose.production.yml start backend ml
```

> ⚠️ The dump uses `--clean --if-exists`, which means restore wipes the
> existing schema before reloading. Confirm you have the right file
> before running this against production. For a partial restore, extract
> specific tables from the .sql.gz with `grep`/`pg_restore`'s
> `--list`/`--use-list` flow.

## Off-site copy (recommended next step)

Local backups protect against application-level corruption but not
against host loss. After confirming the daily timer fires, add an
off-site copy: `rclone sync ~/spheroseg-backups/ remote:spheroseg-bak/`
in a second timer is a one-line addition.

## Verification checklist

After installing:

- [ ] `sudo systemctl start spheroseg-backup.service` produces a `.sql.gz` in `~/spheroseg-backups/`.
- [ ] `gunzip -t` on the latest file exits 0.
- [ ] Smoke-test restore against a throwaway database (`docker run --rm postgres ...`).
- [ ] `systemctl list-timers spheroseg-backup.timer` shows the next run within 24h.
