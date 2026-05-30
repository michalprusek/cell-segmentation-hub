# Model Registry SSOT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the scattered per-language model enumerations into one derived registry per language (FE/BE/Python) so adding/removing a model is one entry per side, with cross-language drift caught by checkers.

**Architecture:** Per-language SSOT registry (no shared package — respects the project's deliberate "duplicate-and-verify" choice). Each language authors one `MODEL_REGISTRY` keyed by model id; all existing enumerations become derivations. FE↔BE kept in sync by the existing `verify-shared-types.cjs`; Python↔BE by a new parity check; i18n completeness by an extended `check-i18n.cjs`.

**Tech Stack:** TypeScript (Vite FE, Node/tsc BE), Python (FastAPI ML), Vitest, pytest, Node scripts.

**Canonical model set (verified, 9):** `hrnet, cbam_resunet, unet_spherohq, unet_attention_aspp, segformer, mamba_unet, sperm, wound, microtubule`.

**Verified compat map (must be reproduced exactly):**
`spheroid: [hrnet, cbam_resunet, unet_spherohq, segformer, mamba_unet]`,
`spheroid_invasive: [unet_attention_aspp]`, `wound: [wound]`, `sperm: [sperm]`, `microtubules: [microtubule]`.

**Drift to remove:** `resunet_advanced`, `resunet_small` (deleted models still in `segmentationModels.ts`).

**Branch:** `refactor/model-registry-ssot` (already created; spec committed).

**Golden rule for every task:** re-verify the current file content with a fresh isolated Read _immediately before editing_ (this session has shown intermittent read truncation). Never edit against a stale/elided read.

---

## File structure

| File                                                       | Responsibility                                                                 | Action             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------ |
| `backend/src/constants/modelRegistry.ts`                   | BE SSOT: id→{compatibleProjectTypes, batchLimit, dispatch} + derivations       | Create             |
| `backend/src/constants/segmentationModels.ts`              | Re-export `SEGMENTATION_MODELS` derived from registry                          | Modify             |
| `backend/src/types/validation.ts`                          | `KnownModelId`/`MODEL_TYPE_COMPATIBILITY` derived from registry                | Modify             |
| `backend/src/services/queueService.ts`                     | `BATCH_LIMITS`/`SERIAL_DISPATCH_MODELS` derived from registry                  | Modify             |
| `backend/src/constants/__tests__/modelRegistry.test.ts`    | Snapshot/equivalence tests for BE derivations                                  | Create             |
| `src/lib/models/modelRegistry.ts`                          | FE SSOT: id→display+compat metadata + derivations                              | Create             |
| `src/lib/modelUtils.ts`                                    | Thin localization wrapper over FE registry                                     | Modify             |
| `src/types/index.ts`                                       | `KnownModelId`/`MODEL_TYPE_COMPATIBILITY` derived (kept diff-compatible w/ BE) | Modify             |
| `src/lib/models/__tests__/modelRegistry.test.ts`           | FE derivation equivalence tests                                                | Create             |
| `backend/segmentation/ml/model_loader.py`                  | Python registry-of-factories; `load_model` = lookup                            | Modify             |
| `backend/segmentation/api/models.py`                       | `ModelType` enum (kept; parity-tested)                                         | Verify/keep        |
| `backend/segmentation/tests/test_model_registry_parity.py` | Python registry ids == canonical 9                                             | Create             |
| `scripts/check-model-parity.cjs`                           | Assert Python registry ids == BE registry ids                                  | Create             |
| `scripts/check-i18n.cjs`                                   | Extend: every model id has name+description in 6 locales                       | Modify             |
| `scripts/verify-shared-types.cjs`                          | Extend `SHARED_CONSTS` if derived const text changes shape                     | Modify (if needed) |

---

## Task 1: Backend model registry (additive, no consumer change yet)

**Files:**

- Create: `backend/src/constants/modelRegistry.ts`
- Create: `backend/src/constants/__tests__/modelRegistry.test.ts`

- [ ] **Step 1: Read current values to transcribe.** Fresh Reads of `backend/src/types/validation.ts` (KnownModelId + MODEL_TYPE_COMPATIBILITY), `backend/src/constants/segmentationModels.ts` (SEGMENTATION_MODELS), and `backend/src/services/queueService.ts` (grep `BATCH_LIMITS` and `SERIAL_DISPATCH_MODELS`, record exact values). Write the exact current `BATCH_LIMITS` and `SERIAL_DISPATCH_MODELS` values into a scratch note — they become the registry's `batchLimit`/`dispatch`.

- [ ] **Step 2: Write the failing test** (`modelRegistry.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  SEGMENTATION_MODELS,
  MODEL_TYPE_COMPATIBILITY,
  BATCH_LIMITS,
  SERIAL_DISPATCH_MODELS,
} from '../modelRegistry';

const CANONICAL_IDS = [
  'hrnet',
  'cbam_resunet',
  'unet_spherohq',
  'unet_attention_aspp',
  'segformer',
  'mamba_unet',
  'sperm',
  'wound',
  'microtubule',
] as const;

describe('model registry (backend)', () => {
  it('registry keys are exactly the canonical 9', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual(
      [...CANONICAL_IDS].sort()
    );
  });
  it('SEGMENTATION_MODELS derives from registry and drops deleted models', () => {
    expect([...SEGMENTATION_MODELS].sort()).toEqual([...CANONICAL_IDS].sort());
    expect(SEGMENTATION_MODELS).not.toContain('resunet_advanced');
    expect(SEGMENTATION_MODELS).not.toContain('resunet_small');
  });
  it('MODEL_TYPE_COMPATIBILITY reproduces the verified matrix exactly', () => {
    expect(MODEL_TYPE_COMPATIBILITY).toEqual({
      spheroid: [
        'hrnet',
        'cbam_resunet',
        'unet_spherohq',
        'segformer',
        'mamba_unet',
      ],
      spheroid_invasive: ['unet_attention_aspp'],
      wound: ['wound'],
      sperm: ['sperm'],
      microtubules: ['microtubule'],
    });
  });
  // NOTE at impl: add explicit assertions for BATCH_LIMITS and SERIAL_DISPATCH_MODELS
  // using the EXACT current values transcribed in Step 1 (do not guess).
});
```

- [ ] **Step 3: Run test, verify it fails.** Run: `cd backend && npx vitest run src/constants/__tests__/modelRegistry.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `modelRegistry.ts`.** Author one record; derive the rest. Fill `batchLimit`/`dispatch` from Step 1's transcribed values; fill `compatibleProjectTypes` by inverting the verified compat matrix (each model lists the project types whose array contains it).

```ts
/** Single source of truth for backend model facts. Add/remove a model HERE. */
export type ProjectTypeKey =
  | 'spheroid'
  | 'spheroid_invasive'
  | 'wound'
  | 'sperm'
  | 'microtubules';

interface BackendModelSpec {
  /** project types whose picker offers this model */
  compatibleProjectTypes: readonly ProjectTypeKey[];
  /** max images per ML batch request */
  batchLimit: number;
  /** 'serial' = one-at-a-time dispatch (e.g. heavy MT pipeline) */
  dispatch: 'serial' | 'parallel';
}

export const MODEL_REGISTRY = {
  hrnet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: /* from Step 1 */ 8,
    dispatch: 'parallel',
  },
  cbam_resunet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: /* from Step 1 */ 4,
    dispatch: 'parallel',
  },
  unet_spherohq: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: /* from Step 1 */ 8,
    dispatch: 'parallel',
  },
  unet_attention_aspp: {
    compatibleProjectTypes: ['spheroid_invasive'],
    batchLimit: /* from Step 1 */ 4,
    dispatch: 'parallel',
  },
  segformer: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: /* from Step 1 */ 8,
    dispatch: 'parallel',
  },
  mamba_unet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: /* from Step 1 */ 4,
    dispatch: 'parallel',
  },
  sperm: {
    compatibleProjectTypes: ['sperm'],
    batchLimit: /* from Step 1 */ 1,
    dispatch: 'parallel',
  },
  wound: {
    compatibleProjectTypes: ['wound'],
    batchLimit: /* from Step 1 */ 1,
    dispatch: 'parallel',
  },
  microtubule: {
    compatibleProjectTypes: ['microtubules'],
    batchLimit: /* from Step 1 */ 1,
    dispatch: 'serial',
  },
} as const satisfies Record<string, BackendModelSpec>;

export type KnownModelId = keyof typeof MODEL_REGISTRY;

export const SEGMENTATION_MODELS = Object.keys(
  MODEL_REGISTRY
) as KnownModelId[];

export const MODEL_TYPE_COMPATIBILITY = (() => {
  const out = {} as Record<ProjectTypeKey, KnownModelId[]>;
  for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
    for (const pt of spec.compatibleProjectTypes) {
      (out[pt] ??= []).push(id as KnownModelId);
    }
  }
  return out;
})();

export const BATCH_LIMITS = Object.fromEntries(
  Object.entries(MODEL_REGISTRY).map(([id, s]) => [id, s.batchLimit])
) as Record<KnownModelId, number>;

export const SERIAL_DISPATCH_MODELS = new Set(
  (Object.entries(MODEL_REGISTRY) as [KnownModelId, BackendModelSpec][])
    .filter(([, s]) => s.dispatch === 'serial')
    .map(([id]) => id)
);
```

> ⚠️ Inversion order: the test asserts `MODEL_TYPE_COMPATIBILITY.spheroid` equals `[hrnet, cbam_resunet, unet_spherohq, segformer, mamba_unet]` in that order. The registry above is declared in that id order, so the inversion preserves it. Keep registry declaration order = current `spheroid` array order.

- [ ] **Step 5: Run test, verify pass.** `cd backend && npx vitest run src/constants/__tests__/modelRegistry.test.ts` → PASS. Fix the `/* from Step 1 */` numbers + add the BATCH/SERIAL assertions until green.

- [ ] **Step 6: Commit.** `git add backend/src/constants/modelRegistry.ts backend/src/constants/__tests__/modelRegistry.test.ts && git commit -m "feat(models): backend model registry SSOT (additive)"`

---

## Task 2: Re-point backend consumers to the registry

**Files:** Modify `backend/src/constants/segmentationModels.ts`, `backend/src/types/validation.ts`, `backend/src/services/queueService.ts`.

- [ ] **Step 1:** Fresh Read each file. In `segmentationModels.ts`, replace the literal `SEGMENTATION_MODELS` array with `export { SEGMENTATION_MODELS } from './modelRegistry';` (keep `SegmentationModel` type + `SEGMENTATION_MODEL_ERROR_MESSAGE` deriving from it). Confirm `resunet_advanced/small` are gone.
- [ ] **Step 2:** In `validation.ts`, replace the `KnownModelId` union + `MODEL_TYPE_COMPATIBILITY` literal with imports from `../constants/modelRegistry`. Keep `isModelCompatibleWithType` as-is (it reads the map). Preserve `PROJECT_TYPES`/`ProjectType` exactly (verify-shared-types pairs them with FE).
- [ ] **Step 3:** In `queueService.ts`, replace the local `BATCH_LIMITS` + `SERIAL_DISPATCH_MODELS` with imports from `../constants/modelRegistry`.
- [ ] **Step 4:** Run: `cd backend && npx tsc --noEmit --skipLibCheck` → 0 errors. Then `npx vitest run src/constants src/services/__tests__/queueService.parallel.test.ts` → PASS (or triage real failures).
- [ ] **Step 5:** Run `node scripts/verify-shared-types.cjs`. If it fails because BE `MODEL_TYPE_COMPATIBILITY` text shape changed vs FE literal, defer the fix to Task 4 (FE side) — note it and continue.
- [ ] **Step 6: Commit.** `git add -A backend/src && git commit -m "refactor(models): backend consumers derive from registry; drop deleted resunet_* ids"`

---

## Task 3: Frontend model registry + re-point modelUtils

**Files:** Create `src/lib/models/modelRegistry.ts`, `src/lib/models/__tests__/modelRegistry.test.ts`; Modify `src/lib/modelUtils.ts`.

- [ ] **Step 1:** Fresh Read `src/lib/modelUtils.ts` fully. Record the exact `ModelInfo` type, `BASIC_MODEL_INFO` entries (id, size, category, defaultThreshold, performance, name/displayName/description fallbacks), `baseModels`, `keyMap`, and `getAllLocalizedModels()` order.
- [ ] **Step 2: Write failing test** asserting `ModelType` keys == canonical 9, `getAllLocalizedModels()` returns 9 in the current order, and `BASIC_MODEL_INFO` has an entry for each id with the recorded shape. Run `npx vitest run src/lib/models` → FAIL.
- [ ] **Step 3:** Create `src/lib/models/modelRegistry.ts` with `MODEL_REGISTRY` carrying the FE display facts (size, category, defaultThreshold, performance, i18nKey, compatibleProjectTypes). Derive `ModelType`, `ALL_MODEL_IDS`, FE `MODEL_TYPE_COMPATIBILITY`, and a `BASIC_MODEL_INFO` builder. Transcribe values from Step 1 exactly.
- [ ] **Step 4:** Rewrite `modelUtils.ts` to derive `ModelType`, `baseModels`, `keyMap`, `getAllLocalizedModels()`, `BASIC_MODEL_INFO` from the registry; keep `getLocalizedModelInfo()` public API/signature identical (consumers unchanged).
- [ ] **Step 5:** Run `npx vitest run src/lib/models` + `npx tsc --noEmit` → PASS/0 errors.
- [ ] **Step 6: Commit.** `git commit -am "feat(models): frontend model registry SSOT; modelUtils derives from it"`

---

## Task 4: Frontend types + keep FE↔BE verify green

**Files:** Modify `src/types/index.ts`; possibly `scripts/verify-shared-types.cjs`.

- [ ] **Step 1:** Fresh Read `src/types/index.ts` `KnownModelId` + `MODEL_TYPE_COMPATIBILITY`. Re-point them to derive from `@/lib/models/modelRegistry` (or import the FE registry's compat map). Keep `PROJECT_TYPES`/`coerceProjectType` unchanged.
- [ ] **Step 2:** Run `node scripts/verify-shared-types.cjs`. The checker extracts `const` block TEXT and diffs FE vs BE. Because both sides are now _derived_ (not literals), update `verify-shared-types.cjs` `SHARED_CONSTS` strategy: either (a) point it at a small literal that both sides still expose, or (b) replace the textual diff for `MODEL_TYPE_COMPATIBILITY` with a runtime import-and-deep-equal check. Implement (b): add a check that imports both compiled maps via `tsx` and `assert.deepEqual`. Keep `PROJECT_TYPES` textual check as-is.
- [ ] **Step 3:** Run `node scripts/verify-shared-types.cjs` → PASS. Run `npx tsc --noEmit` → 0.
- [ ] **Step 4: Commit.** `git commit -am "refactor(models): FE types derive from registry; verify-shared-types deep-equals compat maps"`

---

## Task 5: Python registry-of-factories

**Files:** Modify `backend/segmentation/ml/model_loader.py`; create `backend/segmentation/tests/test_model_registry_parity.py`; verify `backend/segmentation/api/models.py`.

- [ ] **Step 1:** Fresh Read `model_loader.py` `load_model()` in full (recon flagged ~L302–380). Identify per-model branches: if a branch does ONLY instantiation, it folds into a factory; if it does pre/post-processing setup, keep that inside the factory body (do not flatten away).
- [ ] **Step 2: Write failing parity test** (`test_model_registry_parity.py`):

```python
CANONICAL = {
    'hrnet','cbam_resunet','unet_spherohq','unet_attention_aspp',
    'segformer','mamba_unet','sperm','wound','microtubule',
}
def test_registry_ids_match_canonical():
    from ml.model_loader import ModelLoader
    assert set(ModelLoader.AVAILABLE_MODELS.keys()) == CANONICAL
```

(Run via the ML container/GPU one-off recipe; see memory `reference_run_ml_python_tests`.)

- [ ] **Step 3:** Refactor: keep per-model `try/except` imports (irreducible). Replace the `load_model` if/elif instantiation chain with a registry entry per model carrying a `factory` callable (lambda or function) + paths; `load_model` becomes lookup → `spec.factory()`. Preserve all current instantiation params exactly. Keep `AVAILABLE_MODELS.keys()` == canonical 9.
- [ ] **Step 4:** Confirm `api/models.py` `ModelType` enum has exactly the 9; add a comment pointing to the registry as SSOT.
- [ ] **Step 5:** Run the parity test in the ML container → PASS. Smoke: `docker exec spheroseg-ml python -c "from ml.model_loader import ModelLoader; print(sorted(ModelLoader.AVAILABLE_MODELS))"`.
- [ ] **Step 6: Commit.** `git commit -am "refactor(ml): model_loader registry-of-factories; load_model = lookup"`

---

## Task 6: Cross-language + i18n checkers

**Files:** Create `scripts/check-model-parity.cjs`; Modify `scripts/check-i18n.cjs`.

- [ ] **Step 1:** `check-model-parity.cjs`: parse the 9 ids from `backend/src/constants/modelRegistry.ts` (regex on `MODEL_REGISTRY` keys) and from `backend/segmentation/api/models.py` `ModelType` (regex on enum members); assert equal; exit 1 with a diff otherwise. Run it → PASS.
- [ ] **Step 2:** Fresh Read `scripts/check-i18n.cjs`; add a rule: for each id in the FE registry, assert `settings.modelSelection.models.<id>.{name,description}` exists in all of en/cs/es/de/fr/zh. Run `node scripts/check-i18n.cjs` → PASS (fix any missing locale strings first).
- [ ] **Step 3:** Wire `check-model-parity.cjs` into `package.json` `verify:shared-types` chain or `make ci`. Commit. `git commit -am "test(models): python↔backend id parity + i18n model-completeness checks"`

---

## Task 7: Full verification (CLAUDE.md gates) + cleanup of dead code

- [ ] **Step 1: Static.** `make ci` (tsc + ESLint 0 + i18n) → green. `node scripts/verify-shared-types.cjs` + `node scripts/check-model-parity.cjs` → green. `make build-service SERVICE=frontend` → builds.
- [ ] **Step 2: Dead code.** Grep the repo for `resunet_advanced` / `resunet_small` — zero hits outside historical docs. Remove any now-unused helper left by the refactor (e.g. an obsolete inline literal, unused import). (Standing rule: leave no dead code.)
- [ ] **Step 3: Backend wire (gate B).** With dev stack up: `curl` segmentation submit with `hrnet` on a spheroid project → 200; with `microtubule` on spheroid → 400; with `resunet_advanced` → 400. (Use the test account; see CLAUDE.md.)
- [ ] **Step 4: Frontend (gate A).** Playwright on the production-parity preview: open a project's model picker for each project type; `browser_snapshot` shows the same 9-model distribution as before; `browser_console_messages` empty.
- [ ] **Step 5: Cross-stack (gate F).** Run a real segmentation end-to-end on the test account for one general model + `microtubule` (serial dispatch) → completes. Tail `docker logs spheroseg-ml` to confirm inference + `spheroseg-backend` for dispatch.
- [ ] **Step 6: Open the PR.** Push branch; `gh pr create` summarizing: 23→~5 add-a-model edits, drift removed, checkers added, zero behavior change verified.

---

## Self-review notes

- **Spec coverage:** Goals 1–5 map to Tasks 1–6; verification = Task 7. Non-goals respected (no shared package; inference untouched).
- **Type consistency:** `MODEL_REGISTRY`, `KnownModelId`, `SEGMENTATION_MODELS`, `MODEL_TYPE_COMPATIBILITY`, `BATCH_LIMITS`, `SERIAL_DISPATCH_MODELS` names are identical across tasks and match current exported names (drop-in replacements).
- **Known deferrals (not placeholders):** exact `batchLimit`/`dispatch` numbers and `BASIC_MODEL_INFO`/`ModelInfo` field shapes are transcribed from the real files in Tasks 1/3 Step 1 (the equivalence tests guard correctness) — they are read-then-transcribe instructions, not vague TODOs.
