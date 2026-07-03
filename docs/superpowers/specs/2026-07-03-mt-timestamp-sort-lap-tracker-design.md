# MT video pipeline: timestamp frame-sort + LAP filament tracker with gap closing

- **Date:** 2026-07-03
- **Status:** Approved (design), pending spec review
- **Scope:** Two independent parts. Part A (frame-sort) is a small Python-only change; Part B (tracker) is the substantial one. They can ship separately.

---

## 1. Motivation & current state

Microtubule (MT) analysis relies on two things being correct across a video: (1) frames are in true acquisition-time order, and (2) each filament keeps a stable `trackId` across frames (drives per-MT color, kymographs, velocity, ImageJ ROI names).

### 1a. Frame order (current)

Frames are stored in the **container's internal sequence** — ND2 T-axis, TIFF page order, ffmpeg decode order — assigned as a plain loop index `0..N-1`:

- ND2: `backend/src/services/video/pythonHelpers/extract_nd2.py::_write_frames` writes `frames/{t:04d}/` for `t in range(...)` over the T-axis of `normalize_to_tcyx`.
- TIFF: `extract_tiff_stack.py` writes `frames/{t:04d}/` for `t in range(T)` in page order.
- Video: `ffmpegExtractor.ts` sorts `%06d.png` by filename (ffmpeg presentation order).
- DB: `videoUploadService.ts::finalizeContainer` sets `frameIndex = displayOrder = i`, and `frameStorageKey(...,i,...)` maps `frameIndex` → the on-disk `frames/<i>/` dir. **`frameIndex` is hard-coupled to the on-disk directory number.**

Per-frame acquisition timestamps **are already parsed** — ND2 `_event_timestamps_s` (`events['Time [s]']`), TIFF OME `<Plane DeltaT>` / ImageJ per-slice `Labels` — but only collapsed to a median `frameIntervalMs` and discarded. For a normal acquisition T-axis order equals time order, but nothing guarantees it.

### 1b. Tracker (current)

`backend/segmentation/api/tracker_kymograph.py::track()` is **Hungarian assignment, but only between adjacent frame pairs, chained greedily forward** (`for prev_f, next_f in zip(frames, frames[1:])`). Cost (`_build_cost_matrix`):

```
cost[i,j] = (1 − cosine(mean_emb_i, mean_emb_j)) + 0.3 · (‖centroid_i − centroid_j‖ / img_diag)
```

Each filament is reduced to **one centroid + one mean 32-d DINOv3 embedding**; all shape, endpoints, orientation, length discarded. `img_diag` is a per-batch bbox heuristic. Weaknesses:

- **Blob reduction:** two crossing MTs share a centroid; the averaged embedding barely separates them.
- **Greedy error accumulation:** one mismatched pair mislabels a track for the rest of the movie; no global optimization.
- **No gap closing:** one missed/empty frame reseeds fresh IDs → identity/color flip (`zip(frames, frames[1:])` empty-frame reseed + unmatched-branch fresh IDs).
- **Implicit birth/death**, no motion model, no split/merge.

The rich per-pixel `(M,32)` embeddings sampled along each centerline (`wrapper.py:206-212`) and the centerline geometry are already in the `/track` payload — just averaged away.

### Orchestration (unchanged by this work)

`queueService.ts:892` → `scheduleTrackingForContainer` fire-and-forget after each frame reaches a final status; `trackerService.ts::_runTrackingForContainerInner` reads frames ordered by `frameIndex`, POSTs polylines + base64 `_embedding` to ML `/track`, and writes the returned `trackId` map back in chunked transactions. **This plumbing stays as-is** for both parts.

---

## 2. Part A — Timestamp frame-sort (robustness guarantee)

**Goal:** guarantee frames are ordered by embedded acquisition timestamp so `frameIndex = true time rank`, with zero backend/DB/wire change. New uploads only.

**Design:** in `extract_nd2.py` and `extract_tiff_stack.py`, after the frame array and per-frame timestamps are available and **before** frame directories are written:

1. Compute a **stable** ordering permutation `order = argsort(timestamps, kind='stable')`.
2. Iterate frames in `order` when writing `frames/<rank>/` so `frames/0000/` holds the earliest-timestamp frame. Reorder the per-frame timestamp list (and any per-frame arrays used for interval calc) consistently.

Because the extractor's on-disk rank becomes the time rank and the backend derives `frameIndex` from that rank, **no backend/DB/wire/consumer change is required** — tracker, kymograph, editor already sort by `frameIndex`.

**Applies to:** ND2 and TIFF (they carry timestamps). Video is untouched (no acquisition timestamps).

**Safety — never a regression (pure guarantee):**

- All timestamps finite + already monotonic non-decreasing → stable sort is a **no-op** (byte-identical to today).
- Non-monotonic → reordered to time order.
- Timestamps absent, partial, or any non-finite → **skip the sort**, keep sequence order (do not risk corrupting order with bad metadata).
- Equal/duplicate timestamps → stable sort preserves original relative order.

Emit a one-line `log`/warning when a reorder actually changes the order (so a genuinely out-of-order container is visible in extraction logs).

**Non-goals (Part A):** persisting per-frame timestamps to the DB; switching kymograph velocity from median interval to true per-frame Δt; re-sorting already-uploaded videos. (All deliberately out of scope.)

**Files:** `extract_nd2.py`, `extract_tiff_stack.py` (Python only).

**Tests (pytest, no GPU):**

- Monotonic timestamps → permutation is identity (no-op).
- Shuffled timestamps → permutation restores time order; frame dirs written in sorted order.
- Missing / partial / NaN timestamps → no reorder, sequence order preserved.
- Duplicate timestamps → stable order preserved.
- Extract the factor being tested (the sort/permutation) into a small pure helper so it's unit-testable without running a full extraction.

---

## 3. Part B — LAP filament tracker with gap closing

**Goal:** replace greedy adjacent-pair Hungarian with a TrackMate/u-track-style **two-step Linear Assignment Problem** tracker using a filament-aware cost, so crossings and frame dropouts stop flipping identities. ML-only; output contract (`polylineId → trackId`) unchanged.

### 3a. Filament-aware cost (replaces centroid + mean-embedding)

For filaments `i`, `j` with centerlines `P_i, P_j` (arrays of `[row,col]`) and per-sample embeddings `E_i (M_i,32)`, `E_j`:

Each term normalized to ~[0,1]:

- **Embedding** `d_emb = (1 − cosine(mean(E_i), mean(E_j))) / 2` ∈ [0,1]. (Keep the mean-embedding as the primary identity signal; per-sample DTW matching is a documented future option, not in this spec.)
- **Endpoint** `d_end = min( ‖A_i−A_j‖+‖B_i−B_j‖ , ‖A_i−B_j‖+‖B_i−A_j‖ ) / (2·img_diag)`, clamped to [0,1], where `A=P[0]`, `B=P[-1]`. The min over the two head/tail pairings handles arbitrary endpoint order; endpoints (not centroid) separate crossing MTs.
- **Orientation** `d_orient = 1 − |cos(θ_i − θ_j)|` ∈ [0,1], with `θ = atan2` of the (undirected) endpoint-to-endpoint vector `B−A`. `|cos|` makes it undirected (the model's orientation is undirected cos2θ).
- **Length** `d_len = |len_i − len_j| / max(len_i, len_j)` ∈ [0,1] (arc length of the centerline).

```
cost(i,j) = 0.5·d_emb + 0.3·d_end + 0.1·d_orient + 0.1·d_len          # ∈ [0,1]
```

`img_diag` = diagonal of the **actual frame H×W** (passed in the payload), not the current per-batch point-spread heuristic. Missing/corrupt embeddings → substitute the median valid `d_emb` (preserve current graceful-degradation + `degraded` reporting).

### 3b. Step 1 — frame-to-frame linking (LAP with birth/death)

For each adjacent frame pair, solve `scipy.optimize.linear_sum_assignment` on the Jaqaman block-cost matrix so appearance/disappearance are first-class:

```
[ link(N_prev × N_next)      death(N_prev × N_prev diag) ]
[ birth(N_next × N_next diag) aux(N_next × N_prev)       ]
```

- `link[i,j] = cost(i,j)` if `cost(i,j) ≤ COST_THRESHOLD` else ∞.
- `death[i,i] = birth[j,j] = COST_THRESHOLD` (a link costing more than an appearance/disappearance is rejected → the pair is born/dies instead). Off-diagonal death/birth = ∞.
- Produces track **segments** (tracklets): matched next-frame filaments inherit the prev trackId; unmatched → born (fresh trackId); prev unmatched → the segment ends.

### 3c. Step 2 — gap closing (second LAP over segment ends → starts)

After frame-to-frame linking yields segments, link **segment end → segment start** across a temporal gap:

- Candidate link: segment A ends at frame `t_end`, segment B starts at frame `t_start`, with `1 ≤ (t_start − t_end) ≤ MAX_GAP`.
- Cost = `cost(A_end_filament, B_start_filament) · (1 + GAP_PENALTY·(gap − 1))`; reject if the base cost > `COST_THRESHOLD`.
- Solve one LAP (segment-ends × segment-starts) with a no-link alternative cost = `COST_THRESHOLD` so most segments stay separate. Linked segments are merged under A's trackId.
- Result: a filament that vanishes for ≤ `MAX_GAP` frames and returns keeps its **original trackId**.

Per the chosen scope: **birth/death + gap-closing only — no split/merge, no Kalman motion model** (the "full u-track" option, explicitly not selected).

### 3d. Defaults (all overridable via the `/track` payload)

| Param                           | Default              | Meaning                                                 |
| ------------------------------- | -------------------- | ------------------------------------------------------- |
| `w_emb, w_end, w_orient, w_len` | `0.5, 0.3, 0.1, 0.1` | Cost weights (sum to 1.0)                               |
| `COST_THRESHOLD`                | `0.6`                | Max acceptable link cost = birth/death alternative cost |
| `MAX_GAP`                       | `2`                  | Max frame gap the gap-closer bridges                    |
| `GAP_PENALTY`                   | `0.5`                | Linear per-frame gap cost multiplier                    |

`trackerService.ts` currently hardcodes `cost_threshold: 0.5, spatial_weight: 0.3`; replace with this param set (defaults applied ML-side if omitted). Add frame `image_hw` to the payload for normalization. Payload stays backward-compatible (new fields optional).

**Files:** `backend/segmentation/api/tracker_kymograph.py` (cost + `track()` rewrite), small payload addition in `backend/src/services/tracking/trackerService.ts`.

**Tests (pytest, no GPU — pure geometry/assignment):**

- **Cost:** endpoint min-pairing is order-invariant; crossing filaments (shared centroid, different orientation/endpoints) get high cost; orientation & length terms behave.
- **Frame-to-frame LAP:** birth (new filament → fresh id), death (filament gone → segment ends), stable 1:1 under small motion.
- **Gap closing:** a filament absent for 1 and 2 frames (≤ MAX_GAP) regains its trackId; absent for `> MAX_GAP` gets a new id; two crossing filaments keep distinct ids through the crossing.
- **Degradation:** missing/corrupt embeddings fall back to geometry without crashing; `degraded` still reported.

---

## 4. Cross-cutting dependency: transformers pin (deploy/validation only)

Per memory `project_mt_transformers_4572_regression`: **transformers 4.57.6 silently breaks DINOv3 MT segmentation** (blobby/random MTs), hotfixed live to `4.57.1` but **not durable** — an ML image rebuild reverts it. Deploying Part B rebuilds the ML image, so the rebuild **must** pin `transformers==4.57.1` in `backend/segmentation/requirements.txt`, or it ships broken segmentation (and tracking can't be validated on garbage centerlines). **Action:** fold the durable `transformers==4.57.1` pin into this work's rollout. Tracker _implementation/unit tests_ don't depend on it; _real-data validation and deploy_ do.

---

## 5. Validation plan

- Unit tests above (Part A + Part B), runnable without GPU.
- **Real-data (GPU one-off / dev ML container):** run `runTrackingForContainer` on the test 621-frame MT ND2 (account `12bprusek`), before/after:
  - trackId stability improves (fewer distinct ids per underlying filament; stable per-MT color across frames; fewer flips at crossings/dropouts).
  - kymographs + MT export still build (trackId plumbing intact).
- Frame-sort: extract a real ND2/TIFF and confirm frame order equals ascending timestamp; confirm a monotonic file is byte-identical (no-op).

## 6. Success criteria

1. Part A: for any ND2/TIFF with finite per-frame timestamps, `frameIndex` order equals ascending acquisition time; monotonic inputs unchanged; missing-timestamp inputs unchanged.
2. Part B: on the test MT video, a filament surviving a ≤2-frame dropout keeps one trackId; two crossing filaments keep distinct trackIds; no regression in kymograph/export.
3. All new unit tests pass; no existing tracker/extractor test regresses.

## 7. Non-goals

Per-frame Δt persistence; kymograph velocity from non-uniform Δt; re-sorting existing uploads; split/merge & Kalman; per-sample embedding DTW; directed plus/minus-end polarity (model gives only undirected orientation).

## 8. Rollout

Part A and Part B are independent; Part A can land first as a safe quick win. ML-only + backend-tiny. **No production deploy without explicit go-ahead**; deploy rebuilds ML (must include the transformers pin) + recreate ml, then verify tracking on the test video.
