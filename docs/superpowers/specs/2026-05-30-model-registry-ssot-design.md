# Model Registry SSOT — Design Spec

**Date:** 2026-05-30
**Branch:** `refactor/model-registry-ssot`
**Status:** Design (awaiting user review before plan)

---

## Program context

This is **sub-project 1 of 4** in an extensibility-first cleanup of the app.
The overarching goal (user's words): _make the codebase easier to navigate and
make adding new models/features modular._ Approved sequence:

1. **SP1 — Model Registry SSOT** ← this spec
2. SP2 — Polygon field SSOT (collapse the backend field-by-field mappers)
3. SP3 — Segmentation editor decomposition (extract hook/JSX seams)
4. Folded cleanup (type-only circular dep, verified dead-dep removal, on-disk cruft)

Each sub-project gets its own spec → plan → PR → browser verification per the
CLAUDE.md verification gates. Dead-code removal and perf are folded in only where
they intersect these paths.

---

## Problem statement

Adding one segmentation model today requires **~23 edits across ~15 files**, the
large majority of which are _pure re-enumeration_ of the model id. The model list
is hand-maintained in many independent places, and they have **already drifted**:

| List                                                                     | Count        | Contents                                                                                                  | Status                                       |
| ------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Python `AVAILABLE_MODELS` (`ml/model_loader.py`)                         | 9            | hrnet, cbam_resunet, unet_spherohq, unet_attention_aspp, segformer, mamba_unet, sperm, wound, microtubule | **the truth** (verified read)                |
| BE `KnownModelId` (`backend/src/types/validation.ts`)                    | 9            | same 9                                                                                                    | matches truth ✓                              |
| BE `SEGMENTATION_MODELS` (`backend/src/constants/segmentationModels.ts`) | 11           | the 9 **+ `resunet_advanced`, `resunet_small`**                                                           | **stale** — both extras are deleted models ✗ |
| FE `ModelType` / `BASIC_MODEL_INFO` (`src/lib/modelUtils.ts`)            | (per recon)  | FE-maintained mirror                                                                                      | drift-prone                                  |
| FE `KnownModelId` / `MODEL_TYPE_COMPATIBILITY` (`src/types/index.ts`)    | mirror of BE | kept in sync only by `verify-shared-types.cjs`                                                            | check-only                                   |

Because the model↔project-type compatibility check runs in the **queue worker**
(not at enqueue), FE/BE drift fails _silently and late_: the FE offers a model,
the API returns 200, and the job dies deep in the worker. Collapsing the
enumerations into one derived registry per language closes this correctness gap
**and** cuts the add-a-model cost.

### Verified current touchpoints (the scatter)

- **Python** `backend/segmentation/ml/model_loader.py`
  - conditional import block (per-model `try/except`) — _genuinely per-model_
  - `AVAILABLE_MODELS` dict (id → {class, pretrained_path, finetuned_path, config_path})
  - `load_model()` instantiation path (recon: if/elif ~L302–380) — _partly per-model_
  - `BatchConfig` defaults
  - `backend/segmentation/api/models.py` `ModelType` enum
- **Backend (TS)**
  - `constants/segmentationModels.ts` `SEGMENTATION_MODELS` (+ error message)
  - `types/validation.ts` `KnownModelId` + `MODEL_TYPE_COMPATIBILITY` + `isModelCompatibleWithType`
  - `services/queueService.ts` `BATCH_LIMITS` + `SERIAL_DISPATCH_MODELS`
- **Frontend (TS)**
  - `lib/modelUtils.ts` `ModelType` + `baseModels` + `keyMap` + `getAllLocalizedModels()` + `BASIC_MODEL_INFO`
  - `types/index.ts` `KnownModelId` + `MODEL_TYPE_COMPATIBILITY` (verified mirror of BE)
  - `contexts/ModelContext.tsx` (already derives from `BASIC_MODEL_INFO` — no edit needed)
- **i18n** `src/translations/{en,cs,es,de,fr,zh}.ts` (`name` + `description` per model)

### Verified constraint: no shared package

`scripts/verify-shared-types.cjs` documents a _deliberate_ architectural choice:

> "The frontend (Vite/Vitest) and backend (Node/Vitest) build trees do not share
> an import path, so we keep the canonical declarations in separate files and just
> verify they match. Cheaper than wiring a monorepo / shared package."

This design **respects that choice**. We do NOT introduce a `shared/` package or a
cross-tree import. The chosen approach ("per-language + shared types") means:
collapse within each language to one registry, and keep FE↔BE and ↔Python in sync
via the existing _verify_ mechanism, extended.

---

## Goals

1. Adding/removing a model is **one obvious registry entry per language** plus the
   genuinely per-model code (the Python model wrapper class + its factory). No
   hunting across 15 files.
2. **Within each language, derive everything from one registry** so the
   enumerations (id union, whitelist, compat map, batch limits, dispatch mode, FE
   display metadata) can no longer drift internally.
3. **Cross-language drift caught by a checker**, not by luck: extend
   `verify-shared-types.cjs` to assert FE registry ≡ BE registry ≡ Python registry
   ids (and the compat map), and extend `check-i18n.cjs` to assert every model id
   has `name` + `description` in all 6 locales.
4. **Fix the live drift**: remove the two dead entries (`resunet_advanced`,
   `resunet_small`) so the canonical set is the verified 9. (User confirmed these
   models are already deleted.)
5. **Zero behavior change** for the 9 real models: same picker, same compat
   filtering, same batch/dispatch behavior, same i18n strings.

## Non-goals

- Changing which models are compatible with which project types (pure refactor).
- A monorepo / shared npm package (explicitly rejected by the project).
- Sharing a literal across Python↔TS (impossible; bridged by a parity checker).
- Touching inference logic, weights, or model wrappers themselves.
- SP2–SP4 work.

---

## Target architecture

### A. Frontend registry — `src/lib/models/modelRegistry.ts` (new)

One record keyed by model id is the single authored list. Everything else derives:

```ts
// Illustrative shape — exact fields finalized against current modelUtils.ts at impl.
export const MODEL_REGISTRY = {
  hrnet: {
    compatibleProjectTypes: ['spheroid'],
    size: 'small',
    category: 'spheroid',
    defaultThreshold: 0.5,
    performance: { avgTimePerImage: 0.2, throughput: 5 },
    i18nKey: 'hrnet',
  },
  // …8 more
} as const satisfies Record<string, ModelSpec>;

export type ModelType = keyof typeof MODEL_REGISTRY;
export const ALL_MODEL_IDS = Object.keys(MODEL_REGISTRY) as ModelType[];
// MODEL_TYPE_COMPATIBILITY, BASIC_MODEL_INFO, keyMap, getAllLocalizedModels()
// all become derivations over MODEL_REGISTRY.
```

`modelUtils.ts` shrinks to a thin localization wrapper over the registry
(`getLocalizedModelInfo()` reads `i18nKey` + i18next). `ModelContext.tsx` already
derives from `BASIC_MODEL_INFO`, so it follows for free.

### B. Backend registry — `backend/src/constants/modelRegistry.ts` (new)

Same idea on the BE side:

```ts
export const MODEL_REGISTRY = {
  hrnet: { compatibleProjectTypes: ['spheroid'], batchLimit: 8, dispatch: 'parallel' },
  microtubule: { compatibleProjectTypes: ['microtubules'], batchLimit: 1, dispatch: 'serial' },
  // …
} as const satisfies Record<string, BackendModelSpec>;

export const SEGMENTATION_MODELS = Object.keys(MODEL_REGISTRY);     // → the canonical 9
export type KnownModelId = keyof typeof MODEL_REGISTRY;
export const MODEL_TYPE_COMPATIBILITY = /* derived inversion */;
export const BATCH_LIMITS = /* mapValues(REGISTRY, m => m.batchLimit) */;
export const SERIAL_DISPATCH_MODELS = new Set(/* ids where dispatch==='serial' */);
```

`validation.ts`, `queueService.ts`, and `segmentationModels.ts` re-export / derive
from this. The two stale ids disappear because they're simply not in the registry.

> The compat map MUST reproduce the exact current values (verified):
> `spheroid: [hrnet, cbam_resunet, unet_spherohq, segformer, mamba_unet]`,
> `spheroid_invasive: [unet_attention_aspp]`, `wound: [wound]`, `sperm: [sperm]`,
> `microtubules: [microtubule]`. Note the project-type key is `microtubules`
> (plural) while the model id is `microtubule` (singular) — preserved as-is.

### C. Python registry-of-factories — `backend/segmentation/ml/model_loader.py`

Collapse the import block + `AVAILABLE_MODELS` + `load_model` if/elif + `BatchConfig`
into one registry whose values carry a factory callable and metadata:

```python
# Illustrative — exact shape finalized against current load_model() at impl.
MODEL_REGISTRY = {
    'hrnet': ModelSpec(factory=lambda: HRNetV2(...), weights='weights/hrnet_best_model.pth', batch={...}),
    # …
}
def load_model(name):
    spec = MODEL_REGISTRY.get(name)
    if spec is None: raise ValueError(f"Unknown model: {name}")
    return spec.factory()  # replaces the if/elif chain
```

The per-model `try/except` import and the factory body stay (irreducible — each
model has real, distinct construction code). `api/models.py` `ModelType` derives
from `MODEL_REGISTRY.keys()` (or stays an enum asserted equal by the parity test).

### D. Cross-language + i18n checkers (no shared package)

- Extend `scripts/verify-shared-types.cjs` `SHARED_CONSTS` so the FE and BE
  registries' derived id list + compat map are diffed (fails pre-commit/CI on drift).
- Add a **Python parity check**: a small script (node parsing the Python registry
  ids, or a pytest) asserting `MODEL_REGISTRY` keys (Python) == BE registry ids.
- Extend `scripts/check-i18n.cjs` to assert every registry id has `name` +
  `description` in all 6 translation files.

---

## The add-a-model experience: before → after

| Step                 | Before                                                                  | After                                                |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Python wrapper class | write `models/x.py`                                                     | write `models/x.py` _(unchanged, irreducible)_       |
| Python registration  | 4 edits (import, AVAILABLE_MODELS, load_model elif, BatchConfig) + enum | **1 registry entry** + its import                    |
| BE TS                | 4 edits (whitelist, KnownModelId, compat, batch/dispatch ×2)            | **1 registry entry**                                 |
| FE TS                | 5 edits (ModelType, baseModels, keyMap, getAll…, BASIC_MODEL_INFO)      | **1 registry entry**                                 |
| i18n                 | 6 string edits                                                          | 6 string edits _(checker now enforces completeness)_ |
| Weights              | 1 download entry                                                        | 1 download entry                                     |
| **Total**            | **~23 edits / ~15 files**, drift uncaught                               | **~5 obvious entries**, drift caught by checkers     |

FE and BE remain two entries (deliberate no-shared-package constraint), but the
checker makes mismatches a hard pre-commit failure instead of a silent late bug.

---

## Verification strategy (per CLAUDE.md gates)

SP1 is a **pure refactor**; success = identical behavior + drift now impossible.

1. **Static**: `make ci` (tsc + ESLint 0 + i18n), `verify:shared-types`, new Python
   parity check, `make build-service SERVICE=frontend` (bundle must build).
2. **Backend wire** (gate B): `curl` the segmentation submit endpoint with a valid
   model → 200; with an incompatible model → 400; with a now-removed `resunet_*`
   → 400 (confirming it's gone). Confirm `BATCH_LIMITS`/serial dispatch unchanged
   via a real queued job + `docker logs spheroseg-backend`.
3. **Frontend** (gate A): Playwright on production-parity preview — open the model
   picker, `browser_snapshot` shows the same 9 models per project type as before;
   `browser_console_messages` empty.
4. **Cross-stack** (gate F): run a real segmentation on the test account end-to-end
   for at least one general model + microtubule (serial dispatch) and confirm it
   completes — proving the Python registry refactor didn't break instantiation.
5. **Regression test**: snapshot the current `MODEL_TYPE_COMPATIBILITY` and assert
   the derived map equals it (guards against accidental compat change).

---

## Risks & mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derived compat map silently changes a value                                           | Snapshot test of the exact current matrix; assert equality.                                                                                                   |
| Python `load_model` has per-model branches beyond instantiation (pre/post-processing) | Re-read `load_model()` fully at impl (recon flagged L302–380); keep any genuinely per-model branch inside the factory, don't flatten it away.                 |
| `cbam_resunet` legacy alias / `resunet` naming at the API boundary                    | Audit alias handling during impl; registry keeps any alias map explicitly.                                                                                    |
| Removing `resunet_advanced/small` rejects a request some old client sends             | Confirmed deleted models (user); a 400 is correct. Note in PR.                                                                                                |
| FE/BE registry field shapes differ enough that the checker can't diff them            | Keep the _shared_ facts (ids, compat) in a comparable shape; language-specific extras (FE perf metadata, BE batch) live only on their side and aren't diffed. |
| **Tooling reliability**: some reads this session returned elided/garbled content      | All file:line refs above are re-verified with clean isolated reads before any edit; never edit against an unverified read.                                    |

---

## Open items to resolve during implementation (not blockers)

- Re-read `load_model()` (L~302–380) fully to confirm whether instantiation is the
  only per-model branch or whether pre/post-processing also branches per model.
- Confirm exact `ModelInfo` field set in `modelUtils.ts` so the FE `ModelSpec`
  shape is a faithful superset.
- Decide whether `api/models.py` `ModelType` stays an enum (parity-tested) or is
  generated from the registry keys (lean: keep enum + parity test — less magic).
