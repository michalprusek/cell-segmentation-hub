# SegmentationEditor logic extraction (structural refactor)

**Date:** 2026-05-30
**Status:** Approved, ready for implementation
**Branch:** `refactor/segmentation-editor-extract-logic`

## Context / problem

`src/pages/segmentation/SegmentationEditor.tsx` is a 2073-line god-component — the
most complex orchestrator in the repo. It juggles ~16 concerns (data loading,
polygon transform, the editor core hook, WebSocket status sync, resegment +
background poll, frame-slider choreography, navigation, auto-center, abort
management, polygon CRUD, MT cross-frame selection, an 8-memo render pipeline,
and a deep JSX tree) in one file: 10 `useState`, ~6 `useRef`, 15 `useMemo`,
15 `useCallback`, 11 `useEffect`.

It is effectively untestable: importing it in a test eagerly pulls
`socket.io-client` (via `useSegmentationQueue`), the full Radix/shadcn tree (via
`CanvasPolygon`/panels), Axios + interceptors, and canvas-compositing libs.
Vitest doesn't code-split, so the combined module graph (~3.8 GB) OOMs the
worker. Only a calibrated ~22-test orchestration file can cover it at all.

## Decision (agreed)

**Goal = testable extracted units, logic-only.** Pull the cohesive _logic_ into
separate **light-import** files so each gets a fast unit test that never imports
socket.io/Radix/Axios. The orchestrator shrinks to a thin coordinator. The
**JSX render tree and its prop-threading are NOT touched** this pass (lowest
regression risk on the part most likely to break behavior subtly); the
JSX-slimming (an `EditorContext` + sub-component split) is a clearly-scoped
future pass. **Zero behavior change** — this is a structural refactor only.

## The 6 extraction units

Each moves to its own file + a focused unit test. Ordered safest → riskiest;
this is also the implementation order (each stage committed + verified before
the next).

| #   | Unit                                              | What moves (current lines)                                                                                                                                                                      | Interface                                                                                             |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `transformSegmentationPolygons()` — **pure util** | `initialPolygons` memo (326-442)                                                                                                                                                                | `(raw: SegmentationPolygon[], dims) => Polygon[]`                                                     |
| 2   | `usePolygonRenderProps()`                         | render memos (1233-1413): `renderablePolygons`, `visiblePolygons`, `frameHiddenIds`, `hasPolylines`, `polylineKind`, `availableInstanceIds`/`availableInstanceKey`, `legacyModes`, `navContext` | `({ editor, hiddenPolygonIds, imageDimensions, … }) => {…}`                                           |
| 3   | `usePolygonHandlers()`                            | CRUD callbacks (1104-1305) + `hiddenPolygonIds` / `hoveredPolygonId` / `persistedSelectionTrackId` state                                                                                        | `({ editor, imageId }) => { handlers…, hiddenPolygonIds, setHovered…, … }`                            |
| 4   | `usePersistedMtSelection()`                       | MT cross-frame selection effect (1150-1187)                                                                                                                                                     | `({ editor, imageId })` (owns `persistedSelectionTrackId`)                                            |
| 5   | `useSegmentationLoader()`                         | data-load cluster (154-844): `segmentationPolygons` + `imageDimensions` state, primary load effect, RQ-cache path, abort/cleanup effects                                                        | `({ projectId, imageId, selectedImage, getSignal, queryClient }) => {…}`                              |
| 6   | `useResegment()`                                  | resegment + poll (1440-1611): `isResegmenting`, `showResegmentChannelDialog`, `resegPollSeqRef`, `effectiveResegmentModel`, `startResegmentPoll`, `runResegment`, `handleResegmentCurrentFrame` | `({ projectId, imageId, projectType, selectedModel, videoChannels, queryClient, onReloaded }) => {…}` |

**Out of scope:** the frame-slider seed + reverse-sync effects (1617-1684) stay
in the orchestrator — highest oscillation risk (`~7 Hz` URL-flip bug), only 2
effects with a `wasPlayingRef`, little to gain by moving. The JSX tree,
prop-threading, and `onSave` closure also stay.

## Hazard containment (the 5 tight couplings)

1. **`previousImageIdRef` dual-writer** (auto-center effect + abort-on-imageId
   effect both write it). → The ref and **both** writer effects stay in the
   orchestrator; neither moves into a hook.
2. **`onSave` wide closure** (`projectImages`, `imageDimensions`, `imageId`,
   `queryClient`, `t`). → Stays inline in the orchestrator, passed to
   `useEnhancedSegmentationEditor` exactly as today. Not extracted.
3. **video↔resegment TDZ** (`handleResegmentCurrentFrame` reads
   `video.container.channels`). → `useResegment` takes `videoChannels` as a
   **parameter**; it never calls `useVideoFrames` itself (would duplicate the
   query). Orchestrator passes `video.container?.channels ?? null` after the
   `const video = …` line — preserving call order.
4. **`editor` fan-out to 14+ sites.** → Untouched (logic-only). Hooks receive
   `editor` as an argument; JSX keeps threading props.
5. **`reloadNonce` bridges loader ↔ editor hook.** → `reloadNonce` +
   `handleReloadedPolygons` **stay in the orchestrator** as the liaison;
   `handleReloadedPolygons` is passed into `useResegment({ onReloaded })` and
   `reloadNonce` into `useEnhancedSegmentationEditor`.

## Testing

- **Per-unit (the coverage win):** each extracted unit gets a focused unit test
  with light imports — fast, no OOM. `transformSegmentationPolygons` is a pure
  function (degenerate-shape filtering, point mapping, id coercion,
  `parentIds→parent_id`); the hooks are tested with `renderHook` + mocked
  `editor`/`apiClient`.
- **Regression safety net:** after every stage —
  `SegmentationEditor.orchestration.test.tsx` +
  `SegmentationEditor.integration.test.tsx` stay green, and `make ci`
  (tsc + eslint 0 warnings + i18n) is clean.

## Verification (CLAUDE.md gates, before claiming done)

Production-mode local preview + Playwright walkthrough of the editor's critical
paths, **0 console errors**:

1. Load an image → polygons render.
2. Video frame-slider: scrub **and** play → converges, no oscillation.
3. Resegment → reload-nonce repaint + success toast (no manual F5).
4. Undo / redo.
5. MT color stability across frames / sperm instance panel.
6. Save → success.

## Sequencing

Staged, safest-first (units 1→6). After each stage: run the new unit test +
both orchestration/integration tests + `make ci`; commit. Riskier units (5
loader, 6 resegment — they own effects) come last, once the pattern is proven.
A stage that shows a Playwright behavior diff reverts cleanly without touching
the others.

## Expected outcome

`SegmentationEditor.tsx` drops from ~2073 → ~1150–1300 LOC (thin coordinator +
the untouched JSX), with ~750–900 LOC of logic relocated into 6 independently
unit-tested files.

## Out of scope

- JSX restructure / `EditorContext` / sub-component split (future pass).
- The frame-slider choreography, `onSave`, and any behavior change.
- `useEnhancedSegmentationEditor` internals (the 1246-line core hook).
