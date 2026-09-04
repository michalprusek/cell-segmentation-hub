# Frontend architecture

React 18 + TypeScript, built by Vite, styled with Tailwind and shadcn/ui (Radix
primitives). Single-page app; every route is lazy-loaded.

---

## Layout of `src/`

| Path                  | Contains                                                          |
| --------------------- | ----------------------------------------------------------------- |
| `pages/`              | One directory or file per route                                   |
| `pages/segmentation/` | The editor — the largest subsystem in the app                     |
| `pages/export/`       | The export dialog and its type-specific sections                  |
| `pages/segmenter/`    | The standalone annotation tool, deliberately self-contained       |
| `components/`         | Shared components; `components/ui/` is the shadcn layer           |
| `contexts/`           | Client state (see below)                                          |
| `hooks/`              | Reusable hooks                                                    |
| `lib/`                | Framework-free helpers: API client, geometry, decoders, constants |
| `services/`           | Heavier client-side services (Excel export, …)                    |
| `translations/`       | Six locale files                                                  |
| `types/`              | Shared types, including the project-type and model unions         |

## Routes

`/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
`/documentation`, `/terms-of-service`, `/privacy-policy`,
`/share/accept/:token` are public. Behind auth: `/dashboard`, `/project/:id`,
`/project/:id/export`, `/segmentation/:projectId/:imageId`, `/settings`,
`/profile`, `/automated-essays`, and `/segmenter`, `/segmenter/:datasetId`,
`/segmenter/:datasetId/image/:imageId`.

> `/segmenter` has **no navigation entry point** anywhere in the interface. It
> is reachable only by URL.

---

## State

**Server state** is React Query (TanStack): optimistic updates and explicit
query invalidation, with the WebSocket used to _trigger_ invalidation rather
than to carry authoritative data.

**Client state** is a set of contexts:

| Context               | Holds                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `AuthContext`         | Session, sign-in/out, token refresh                                       |
| `LanguageContext`     | Active locale; translations are loaded lazily                             |
| `ThemeContext`        | Light/dark                                                                |
| `WebSocketContext`    | The Socket.io connection and its lifecycle                                |
| `UploadContext`       | Upload queue, routing between the image and video endpoints, cancellation |
| `ExportContext`       | Export job state                                                          |
| `ModelContext`        | Selected model, threshold, hole detection                                 |
| `ImageDisplayContext` | Per-channel window/level, colours, opacities (editor only)                |

`ImageDisplayContext` is the one with non-obvious rules — window/level is
**per channel**, session-only; colours and opacities are persisted per user in
browser storage. See
[Videos, frames and channels](../guides/videos-and-channels.md#displaying-16-bit-data-window-and-level).

---

## The segmentation editor

`src/pages/segmentation/`, the most complex feature in the repository.

| Piece                                      | Role                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `SegmentationEditor.tsx`                   | Top-level orchestrator                               |
| `components/SegmentationEditorLayout.tsx`  | The presentational tree                              |
| `useEnhancedSegmentationEditor`            | Core state: polygons, selection, history, transform  |
| `useAdvancedInteractions`                  | Mouse and keyboard, shape creation, vertex editing   |
| `useKeyboardShortcuts`                     | The global key map                                   |
| `config/modeConfig.ts`                     | The single source of truth for per-mode behaviour    |
| `components/canvas/CanvasPolygon.tsx`      | One shape; `React.memo` with a custom comparator     |
| `components/canvas/PolygonVertices.tsx`    | Vertices of the selected shape only                  |
| `components/canvas/MultiChannelCanvas.tsx` | The channel compositor (WebGL2, with a CPU fallback) |

### Things that will bite you

- **`React.memo` comparators are hand-written.** Adding a prop to a memoised
  canvas component without adding it to the comparator means the component never
  re-renders on that prop. This has shipped as a bug more than once.
- **Hook order matters more than TypeScript can see.** A `useCallback`,
  `useMemo` or `useEffect` placed _before_ a `const` it captures throws
  "Cannot access X before initialization" at runtime; in a minified bundle X is
  a single letter. Place hooks after the values they capture.
- **Use `editor.getPolygons()`, not `editor.polygons`,** inside event handlers —
  the latter is a closure snapshot.
- **There is no viewport culling**, deliberately. A previous culling pass
  dropped on-screen pieces of fragmented spheroids.
- **Undo history is per frame** and reset on every image change and reload.
- **`polygonKey(p) = p.trackId ?? p.id`** is a branded type so a `Set` of keys
  cannot be accidentally keyed by something else. Cross-frame UI state uses it.

---

## Decoding 16-bit images

Browsers cannot give you 16-bit samples through a canvas: `createImageBitmap` →
`getImageData` always returns 8-bit RGBA and silently discards the low byte.
`src/lib/png16.ts` is therefore a hand-rolled grayscale PNG decoder (colour type
0, 8 or 16 bit, non-interlaced) built on `DecompressionStream`. It returns
`null` rather than throwing for anything out of scope, and callers degrade to
8 bit.

The playback proxy path adds `src/lib/webpGray.ts`, which re-expands 8-bit WebP
samples back to a 16-bit array so the compositor never sees 8-bit data, plus a
banding guard that falls back to the full-depth PNG when the display window is
narrower than 1/8 of the range.

---

## Internationalisation

Six locales — English, Czech, Spanish, German, French, Chinese — in
`src/translations/`. Every user-facing string must exist in **all six**;
`node scripts/check-i18n.cjs` enforces it and runs in `make ci`. See the
[i18n guide](../i18n-guide.md).

---

## Build and quality gate

- `make ci` — TypeScript (frontend and backend), ESLint at zero warnings, i18n
  completeness, and the Python suites.
- `make build-service SERVICE=frontend` — the production bundle. **Run it before
  claiming a build-affecting change works**: minification, tree-shaking and
  chunk splitting behave differently from the dev server, and removing a
  dependency that is still named in `vite.config.ts`'s `manualChunks` fails only
  here.
- The Vitest suite is green and **is** a gate — but in CI, not in `make ci`.
  `.github/workflows/ci.yml` runs it with coverage in the required `frontend`
  job. See [Testing guide](../testing-guide.md).

## Related

- [Architecture overview](README.md)
- [Segmentation editor guide](../guides/segmentation-editor.md)
- [Polygon rendering](../polygon-rendering-optimization.md)
