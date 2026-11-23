# Deploy gotchas in full

Why production can run older code than main, and every deployment trap with its measurements.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines. Code comments that say "see CLAUDE.md" may mean this page.

**Migrate before you recreate, not after.** The other order — recreate, then
`docker exec spheroseg-backend npx prisma migrate deploy` — works only while
no code touches the new table until a request asks for it. On 2026-10-06 a
worker queried its new table at START-UP, inside the server's "critical
services" `try`: the table did not exist yet, the query threw, the server
exited, and `restart: always` turned that into twelve restarts and about four
minutes with the whole app down. `docker exec` cannot even run while the
container is restarting, so the documented fix was unavailable; the table was
created by piping the (idempotent) migration SQL into `psql`. Step 1b runs the
migration in a throwaway container from the NEW image, on the production
network, and does not touch the running backend.

`make prod` rebuilds and recreates everything; useful for big changes but unnecessary for service-scoped updates.

There are no longer `scripts/deploy-production.sh` / `rollback-deployment.sh` / `migrate-database.sh` etc. — those orchestrated blue↔green switching that doesn't exist now.

- **The service images BAKE their source; only weights/uploads/caches are mounted.** `docker inspect spheroseg-ml` shows three mounts — `weights`, `sperm_final`, `uploads` — and everything under `backend/segmentation/` is COPIED in. Same for `backend/src`. So **a merged PR does not reach production until that service is rebuilt**, and production can silently run older code than `main` while every file in git looks correct. Caught 2026-09-04: the ml container was built at 12:45 and matched commit `28144dba` exactly, two commits behind `main`, and a user-visible bug was nearly diagnosed against code they were not running. **Before diagnosing anything, pin the container to a commit:**
  ```bash
  docker exec spheroseg-ml md5sum /app/models/<file>.py
  git show <commit>:backend/segmentation/models/<file>.py | md5sum
  ```
  To A/B the repo version without touching the running container, import it from a scratch path (`importlib.util.spec_from_file_location`) rather than overwriting `/app`.
- **Production migrations use `prisma migrate deploy`**, never `migrate dev` (dev creates new files; deploy applies existing ones to a live DB).
- **Bind-mounted configs need `--force-recreate`**, not just `nginx -s reload`. `sed -i` rewrites the inode; the running container holds the old one. Use `docker compose up -d --no-deps --force-recreate <service>`.
- **Upload limits coupled across 3 layers** — images 20 MB (`FILE_LIMITS.MAX_FILE_SIZE_BYTES` + image multer + nginx). Videos/ND2 100 GB (`MAX_VIDEO_FILE_SIZE_BYTES` + separate `videoUpload` multer + `client_max_body_size 100G`). The smallest wins. **A `.tif` over 20 MB is routed to `/videos` by SIZE** (`isVideoLikeUpload`), which is wrong for one real kind of file: an uncompressed colour photograph (a 4104 × 2174 RGB frame is 26.8 MB). The stack extractor has no branch for `YXS` and must not grow one — every frame it writes is one grayscale plane per channel — so `colourStillTiff.ts` asks `extract_tiff_stack.py --classify` (header only: the backend image has no `imagecodecs`, so tifffile cannot decode LZW/JPEG there) and stores a single-page RGB/YCbCr TIFF through the ordinary image path, up to 512 MB. The `S` axis alone does not mean colour: a multi-sample `minisblack` page is `YXS` too. Measured 2026-10-09 on every production TIFF: 0 of 206 container originals classify as a photograph, and 290 of 325 stills already had exactly this layout.
- **No model fetches from HuggingFace at load time any more** (2026-09-20, PR #556). This used to say `HF_TOKEN` and `.hf-cache` were load-bearing "for SegFormer + sperm, which still call `from_pretrained`". Both halves are now false:
  - **SegFormer**: it only ever fetched the tiny `config.json` — never the ADE weights, which our own checkpoint overwrites wholesale — so the config is vendored at `models/segformer_config.json` and built with `SegformerConfig.from_dict`. Proven bit-identical (208 tensors, same keys and shapes, `max|diff| = 0.000e+00` on the same checkpoint) and proven offline: with `--network none` and no cache the new code loads and the old code dies on `couldn't connect to huggingface.co`. This mattered because SegFormer became the **spheroid default**, so a cold cache or a bad `transformers` bump would have broken the commonest project type rather than only opt-in users.
  - **Sperm**: it never fetched on the shipped path. `Dinov2Model.from_pretrained` (`sperm_final/models/backbone.py:33`) sits on the `DINOv2Backbone` branch, but production takes the **ConvNeXt** branch — the checkpoint's 342 backbone tensors are named `backbone.backbone.stages.N.downsample_layers.*`, and `convnext_backbone.py` contains no fetch of any kind.
    **The trace, so the claim is not larger than its evidence.** `grep -rnE "from_pretrained|hf_hub_download|snapshot_download|huggingface_hub|AutoModel|AutoConfig|AutoProcessor|timm.create_model|torch.hub"` over `backend/segmentation/` and `backend/essays/` returns exactly ONE live call: the dead DINOv2 branch above. Everything else is comments. So no model reaches the Hub through any known entry point, and SegFormer was additionally proven offline empirically (`--network none`, no cache).
  - **Both are now REMOVED from the `ml` service** (PR #559). The deploy-shaped verification the grep could not supply: every model in the production image was loaded with **no cache, no `HF_TOKEN` and `--network none`**, so a fetch could not silently succeed — **11 of 11 loaded**. Run that before adding either back:
    ```bash
    docker run --rm --gpus all --network none \
      -v $PWD/backend/segmentation/weights:/app/weights:ro \
      -v $PWD/backend/segmentation/sperm_final/best_model.pth:/app/sperm_final/best_model.pth:ro \
      --entrypoint python cell-segmentation-hub-ml -c "…loader.get_model(n) for every n…"
    ```
    **Enumerate the models from the loader's own source and assert the count**, or the check silently shrinks: the first version of this script sliced `model_loader.py` starting AT `'hrnet': {` and its `^\s{8}` anchor then dropped that very key, so it tested 10 of 11 and printed a clean `10/10`. The cache that was mounted held **SAM 3** (used to distil the microcapsule model — the distilled checkpoint is local), **DINOv3** and **DINOv2** (the v7 microtubule model and the sperm model's untaken branch) and SegFormer's 32 KB config, now vendored. All leftovers.
- **Always `--env-file .env.production`** when running `docker compose` against production. Without it, env vars silently empty.
- **After backend `--force-recreate`, restart nginx too** — DNS cache pins old container IP.
- **GPU access is granted by `device_cgroup_rules`, not `devices:`** (ml + essays). `runtime: nvidia` alone injects the allowlist via a hook that runs _after_ the OCI spec is built, so `docker update` / `systemctl daemon-reload` / any systemd cgroup rewrite silently strips the GPU from a **running** container — `open('/dev/nvidiactl')` returns EPERM on a mode-0666 node and `torch.cuda.is_available()` flips to False while `/health` keeps saying it is fine. Do **not** "fix" this by switching to `devices:`: docker re-resolves those host paths on every `docker start`, and `/dev/nvidia-uvm` is created lazily by `nvidia-modprobe` — on the 2026-01-13 boot the toolkit hook logged `Could not locate /dev/nvidia-uvm` _while docker was restoring containers_, ~0.6 s before the node appeared. The hook warns and continues; an explicit `devices:` entry fails hard, so with `restart: always` that becomes a crash-loop instead of a degradation. (Wall-clock timestamps from that boot are unusable — the clock jumped +2 h at monotonic 4.65 s; use `journalctl -o short-monotonic`.) If a driver upgrade moves the **dynamic** nvidia-uvm major, `grep nvidia-uvm /proc/devices` and update the `236` rule; the symptom is silent CPU, not a hard failure.
- **Volume names still carry `_blue_data` suffix** (postgres_blue_data, redis_blue_data). Cosmetic-only — internal Docker identifiers, never user-facing. Renaming requires manual volume copy; not worth the downtime for "spheroseg_data" prettiness.
- **Upload directory still mounted from `./backend/uploads/blue`** on host, but container sees neutral `/app/uploads`. 17 GB of production data lives there; renaming the host path would need `docker compose down` + `mv` + remount. Same trade-off as volume names.
- **The DB password is a fixed literal that reads like a DB name** — it carries the obsolete `blue` suffix and is NOT a reference to any database. Its value lives only in `.env.production` (gitignored) as `PG_PASSWORD`; never paste it here. Database itself is `spheroseg` since 2026-05-15. Rotating the password means changing the live user's `PG_PASSWORD` first.
