# Segmentation editor

The full manual for the editor at `/segmentation/:projectId/:imageId` — every
mode, every gesture, every shortcut.

A one-page shortcut table lives at
[reference/keyboard-shortcuts.md](../reference/keyboard-shortcuts.md).

---

## Layout

| Area              | Contains                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Top toolbar**   | Undo, Redo, **Resegment frame**, the saved/unsaved indicator, **Save**                                                                                                            |
| **Left rail**     | The seven edit modes, then Zoom in / Zoom out / Reset view                                                                                                                        |
| **Canvas**        | The image with polygons drawn over it. A coloured 4 px border tells you which mode you are in, and an instruction card in the corner tells you what to click                      |
| **Right sidebar** | The **Display** card (brightness, contrast, **Smooth image**; Min/Max on 16-bit data), channel controls on videos, and the shape list (or the microtubule / sperm instance panel) |
| **Footer**        | Shape and vertex counts, and a **Shortcuts** button                                                                                                                               |
| **Header**        | Breadcrumbs, image navigation, and — on videos — the frame slider and playback controls                                                                                           |

**Save is disabled when there is nothing to save.** A greyed-out Save button
means "all changes saved", which is also stated in words next to it.

---

## Edit modes

Seven modes. Switch with the left rail, a keyboard letter, or <kbd>Tab</kbd> to
cycle. Clicking the button of the mode you are already in returns you to View.

| Mode                | Key          | What you do                                                                      |
| ------------------- | ------------ | -------------------------------------------------------------------------------- |
| **View**            | <kbd>V</kbd> | Select, pan, zoom. Clicking a shape selects it **and switches to Edit vertices** |
| **Edit vertices**   | <kbd>E</kbd> | Drag vertices. Right-click a vertex to delete it                                 |
| **Add points**      | <kbd>A</kbd> | Insert vertices, extend a polyline, or join two polylines                        |
| **Create polygon**  | <kbd>N</kbd> | Click out a closed shape                                                         |
| **Create polyline** | <kbd>P</kbd> | Click out an open path (microtubule, sperm part)                                 |
| **Slice**           | <kbd>S</kbd> | Cut a shape with a two-click line                                                |
| **Delete polygon**  | <kbd>D</kbd> | Click shapes to delete them, one after another                                   |

**Edit vertices** and **Add points** need a shape selected first — their buttons
are disabled and marked with a pulsing dot until you select one. **Slice does
not**: press <kbd>S</kbd> first and select the shape afterwards. (The in-app
shortcut dialog claims otherwise; the behaviour described here is what the
editor actually does.)

<kbd>Esc</kbd> always returns to View, clears whatever you were drawing, and
clears the selection.

Where each mode goes when it finishes:

- Add points → **Edit vertices**
- Create polygon, Create polyline, Slice → **View**
- Delete polygon **stays**, so you can delete several in a row.

---

## Mouse

Hit radii are constant in _screen_ pixels — they scale with zoom, so a vertex is
equally easy to grab at 1× and at 8×. A polyline gets an invisible click band
**24 px wide on screen** (8× its drawn 3 px) at every zoom from 0.7× up, so a
thin microtubule is comfortably clickable without the band of one swallowing
its neighbour. (Until 2026-10-08 the band was in image units above 4× and
reached 60 px at 10×.)

| Gesture                                           | Effect                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Left-click a shape                                | Select it (in View, this also enters Edit vertices)                        |
| **Shift**-click a shape                           | Add/remove it from the **multi-selection**                                 |
| Double-click a shape                              | Open it in Edit vertices                                                   |
| Left-drag empty canvas (View, nothing selected)   | Pan                                                                        |
| **Middle**-drag, or **Alt**/**Space** + left-drag | Pan, in _any_ mode                                                         |
| Wheel                                             | Zoom around the mouse pointer                                              |
| Right-click a **vertex** (Edit vertices)          | Delete vertex                                                              |
| Right-click a **shape**                           | The context menu (see below)                                               |
| Right-click empty canvas                          | Step back: clear what you were drawing, then deselect, then return to View |

Multi-selected shapes draw with a thicker dashed outline and show their
vertices. A plain click clears the multi-selection, and **it is cleared whenever
you change frame** — shape ids are per frame.

### Zoom and pan

- One wheel notch is 1.2×, anchored **at the cursor**. The toolbar buttons and
  <kbd>+</kbd>/<kbd>−</kbd> use the same factor anchored at the canvas centre.
  The step is proportional to how far the wheel moved (`1.2 ^ (delta / notch)`,
  one notch at most per event), so a trackpad zooms smoothly instead of a full
  1.2× per frame, and several notches spun quickly all count — they are added
  up and applied once per animation frame.
- <kbd>R</kbd> or <kbd>0</kbd> fits the image with a small margin and never
  zooms past 100 %.
- Maximum 10×. The minimum goes _below_ fit-to-view so a large image can always
  be zoomed back out.
- Above 1× panning is unconstrained; below it, a margin keeps the image
  reachable.
- The view auto-fits when you open an image from the gallery, but not when you
  navigate between images inside the editor.

### What stays the same size when you zoom

Everything drawn over the image has a **constant size on screen**, as in CVAT:

| Element                                   | On screen (zoom ≥ 0.7×) |
| ----------------------------------------- | ----------------------- |
| Polygon outline / hovered                 | 2 px / 2.6 px           |
| Polyline / hovered                        | 3 px / 5 px             |
| Polyline click band                       | 24 px                   |
| Vertex handle / hovered                   | 5 px radius / 6.5 px    |
| Selection glow                            | 8 px blur               |
| Drawing preview line, sperm endpoint dots | 2 px, 3 px radius       |
| Shared-neurite stripes (colour by soma)   | 10 px per colour        |

Below 0.7× the outlines thin out (to 60 %, then 40 % of those widths under
0.5×) so they do not bury a large image shown small. Sizes follow the zoom
_during_ the wheel gesture, not after it.

### Smooth image

The **Display** card in the right sidebar — present for stills and videos alike
— opens with a **Smooth image** switch, on by default:

- **On**: the browser interpolates between image pixels when you zoom in, so
  you see a continuous image rather than squares. This is CVAT's setting of the
  same name and its default.
- **Off**: each image pixel is drawn as a hard-edged square
  (`image-rendering: pixelated`) — what you want when placing a vertex on an
  exact pixel.

It changes only how the image is drawn; shapes are vectors and are sharp
either way. The choice is remembered in the browser across reloads, and
**Reset** in the same card does not touch it. From the keyboard, <kbd>Tab</kbd>
to it and press <kbd>Enter</kbd> — <kbd>Space</kbd> is the editor's pan and
play key and does not activate buttons.

---

## Working with shapes

### Creating a closed polygon

<kbd>N</kbd>, then click each vertex. From the third point on, clicking within
about 15 screen pixels of the **first** point closes the ring — the first point
shows a ring and the closing line turns solid when you are in range. Minimum
3 points. Hold **Shift** while moving to drop points automatically every ~10 px.

### Creating a polyline

<kbd>P</kbd>, then click each point. **Finish with <kbd>Enter</kbd> or a
double-click.** Minimum 2 points; polylines never close. Right-click removes the
last point, one at a time.

What the new polyline becomes depends on the project type, not on any guess:

- **sperm** — takes the active part (head/midpiece/tail) and the active
  instance from the sperm panel;
- **microtubules** — gets a new microtubule instance id, no part class;
- anything else — a generic polyline instance id.

Neurite projects produce **closed polygons**, so a shape you draw there is an
ordinary polygon with no class. Segmented shapes carry one, and the canvas and
the shape list colour them by it: **cyan** for `neurite` (the processes) and
**magenta** for `soma` (the cell body), the same two colours the model's own
overlay uses. Unlike the sperm part classes, there is no menu for changing a
neuron class after the fact.

### Adding vertices

<kbd>A</kbd> with a shape selected. Two behaviours:

**Closed polygon.** Click vertex A, click a path of new points, then click a
different vertex B. The drawn run replaces one of the two arcs between A and B —
specifically **the replacement that gives the larger outline**. Clicking B
immediately after A with nothing in between **deletes every vertex between
them**.

**Open polyline.** You do not need to click a vertex first: the tool anchors to
whichever _endpoint_ is nearer and treats your click as the first new point.
Press <kbd>Enter</kbd> to commit. If you **Shift**-click a vertex in the middle
of the polyline first, that vertex becomes a pivot: the arm running the way your
drawn path points is replaced, the other arm survives.

You can also just hold **Shift** and move over a selected polyline — it anchors
and starts dropping points on its own.

### Deleting a vertex

Right-click it in Edit vertices mode. Only the selected shape shows vertices, so
you cannot delete a vertex of a shape you have not selected. The minimum is
2 points for a polyline, 3 for a polygon; below that the delete is refused with
a message.

### Moving a vertex

Drag it in Edit vertices. There is no drag threshold and no snapping. Nothing is
committed until you release the mouse, and the whole move lands as **one** undo
step.

### Slicing

<kbd>S</kbd>, select a shape if you have not already, then click two points to
define a cut line.

- A **closed polygon** must be crossed exactly twice. If your stroke was too
  short the tool retries as an infinite line through the two points, so a short
  stroke inside the shape usually still works.
- An **open polyline** must be crossed exactly once. Polyline slicing works in
  every project type.
- Both halves must keep at least 2 points.

On success the original is replaced by two shapes and you return to View. On
failure you get a specific message — "does not intersect", "only touches at one
point", "intersects too many edges" — rather than a silent no-op.

### Deleting a shape

Two routes, with different safety:

- **Delete polygon mode** — click and it is gone, **no confirmation**, and the
  mode stays active.
- **Right-click → Delete** — asks for confirmation. For a tracked microtubule
  the wording changes to make clear it removes the track from every frame.

<kbd>Delete</kbd> or <kbd>Backspace</kbd> removes the selected shape while in
View, Edit vertices or Delete mode.

### Joining two polylines

In **Add points** with polyline A selected, click within the vertex hit radius
of an **endpoint of a different polyline B**. A valid target highlights with a
ring as you hover; an invalid one simply never becomes a target, and your click
falls through to the ordinary add-points behaviour.

The rules:

- both must be polylines with at least 2 points, in the **same frame**;
- **sperm projects** — the same `partClass` (you cannot join a head to a tail);
- **microtubule projects** — the same type label; two untyped ones match;
- other project types — always allowed.

If you had already drawn points, they become the **bridge** between the two.
**A keeps its identity** (its id, track, name and type); **B is removed.** You
land in Edit vertices.

---

## The shape list

For every project type except microtubules the sidebar shows **Polygon List**:
one row per shape with a checkbox (multi-select), a colour dot, the name, a
summary line ("N vertices • External • area px²"), an eye toggle, and a ⋮ menu
with **Rename** and **Delete**. The header has a select-all checkbox and a
**Hide all / Show all** toggle.

Renaming is inline — <kbd>Enter</kbd> or clicking away commits,
<kbd>Esc</kbd> cancels. **A rename is only persisted when you save.**

Hidden shapes vanish from the canvas and are counted in the footer. The only way
back is the eye icon or the bulk toggle.

### Why hiding and selection survive a frame change

A shape's `id` is re-minted by the model on every inference, so it differs on
every frame of a video. The **`trackId`** written by the cross-frame tracker is
the same across frames for the same object. The editor therefore keys its
cross-frame state on `trackId` where one exists, falling back to `id`:

- hiding a microtubule on frame 3 keeps it hidden when you scrub to frame 40;
- the selection follows the same object between frames (and is simply lost if
  that object is absent from the new frame);
- the colour follows it too, so an object keeps its colour while scrubbing.

---

## Undo and redo

<kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Y</kbd> (or
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>).

**Scope: shape geometry and shape fields only.** Not zoom, not pan, not
selection, not hide/show, not mode changes.

**History does not cross frames.** It is reset to a single entry every time you
change image or frame, and on every reload (resegment, or a completion arriving
from the server). Undoing back to the last-saved state correctly clears the
"unsaved changes" badge.

One deliberate asymmetry: assigning a **microtubule type label** writes to every
frame of the track on the server as well as locally, so undo reverts only the
current frame — the other frames keep the label.

---

## Saving

**There is no continuous autosave.** Saving happens on exactly four occasions:

1. **Manually** — the Save button or <kbd>Ctrl</kbd>+<kbd>S</kbd>.
2. **Switching image or frame** — saved in the background before the editor
   resets.
3. **Clicking a breadcrumb** — navigation happens _immediately_ and the save
   races a 3-second timeout in the background. **A slow save can be dropped
   here.** If you have substantial edits, press <kbd>Ctrl</kbd>+<kbd>S</kbd>
   before clicking away.
4. **Closing or reloading the tab** — the browser's native "unsaved changes"
   prompt appears. In-app navigation is _not_ guarded by it.

Everything on a shape is persisted: points, external/internal type, class,
geometry, sperm part class and instance, track id, name and microtubule type.

### Saving a video frame has cross-frame effects

On a video, saving diffs the tracked polylines against their previous state and
mirrors some changes to **every frame of the same track**:

- **renames** and **sperm part-class changes** propagate to all frames;
- **deleting a tracked polyline and saving deletes it from every frame of the
  video**;
- geometry stays per frame, and a freshly created track does not propagate.

---

## Resegment

The circular-arrow button in the top toolbar re-runs the model on the current
frame.

On a **multi-channel video** a channel picker opens first, pre-selecting the
channel currently marked as the segmentation source. On single-channel data the
run starts immediately.

The model is **the project's**, shown next to the project type at the top of
the project page. Plain spheroid projects choose among five models and sperm projects between
two; every other type has exactly one compatible model and is forced to it.

> **Resegmenting replaces the frame's segmentation.** Manual edits to that frame
> are overwritten by the new model output, and unsaved local edits are discarded
> when the result lands. There is no confirmation dialog on the single-channel
> path.

Completion is detected by a background poll rather than by the WebSocket, so the
canvas repaints and the success toast fires even if the socket has dropped —
including when the new result happens to have the same number of shapes as the
old one.

---

## Microtubule projects

The generic shape list is replaced by the **Microtubule Instances** panel.

- Rows are sorted by track, so ordering is stable across frames. Each row shows
  a colour swatch, the name, its type-label chip, and its **length in pixels**.
- **Colour by** toggles between **Instance** (a stable per-track hue) and
  **Label** (the assigned type's colour, grey when untyped). This is a view
  preference and is remembered in your browser.
- Bulk **Hide all / Show all** and a select-all checkbox.

### Type (class) labels

There is **no built-in palette** — you create labels per project, each with a
name and a colour, from the "Type labels" section at the bottom of the panel.
Names are unique, case-insensitively.

Assign a type by right-clicking a microtubule → **Set type**. With two or more
selected the item reads _"Set type for N selected"_ and applies to all of them.

**Assignment is per track, not per frame:** the label is written to every frame
of each selected track. An untracked, hand-drawn polyline is still a valid
target — its label just lives on that one frame.

**Deleting a label clears it from every microtubule that used it**, which revert
to neutral.

### Track operations

Right-click a microtubule:

| Item                                    | Effect                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propagate to following frames**       | Stamps this polyline's exact current shape into **every later frame** of the video. Confirmed; cannot be undone. A frame that already holds exactly this shape (same points, name and track) is left untouched, and the toast counts only the frames actually written; when none were, it says there was nothing to change. |
| **Propagate selected microtubules (N)** | The same, for two or more selected microtubules, each keeping its own track. The toast counts the microtubules that changed, or says there was nothing to change. Partial failures are reported.                                                                                                                            |
| **Delete whole track**                  | For a tracked microtubule, removes it from all frames — the confirmation names the frame count. An untracked one is simply deleted.                                                                                                                                                                                         |
| **Show kymograph**                      | Opens the kymograph modal (videos only).                                                                                                                                                                                                                                                                                    |

### The kymograph modal

Pick a source channel, optionally enable velocity analysis, and set the
intensity width (1–50 px). A badge tells you whether the line is **tracked
across frames** or a **static line**. Drag to pan, scroll to zoom; axes are
"Time (frames)" downward and "Along microtubule (px)" rightward.

With velocity analysis on, a table lists per trajectory: net velocity, run
length (µm), run time (s), intensity minus background, and the `bright` and
`edge` flags with an SNR. Downloads: velocity CSV, the PNG, and the raw CSV.
Notices appear when the pixel size is uncalibrated or when trajectories were
hidden below 0.01 µm/s.

> Per-microtubule **intensity** is not shown in the editor — the only number
> here is length in pixels. Intensities are computed at export time; see
> [Export](export.md#microtubule-exports).

---

## Sperm projects

The sidebar shows the **Sperm Instances** panel.

At the top are the controls that decide what your _next_ drawn polyline becomes:
an **instance** dropdown, a **+** button that mints the next `sperm_N`, and a
**Head / Midpiece / Tail** selector. Parts are colour-coded everywhere —
head green, midpiece orange, tail cyan.

Each instance row shows three dots, coloured when that part exists and grey when
it is missing, so you can see at a glance which cells are incomplete. Expanding
a row lists its polylines with their lengths. Polylines with no instance appear
in an **Unassigned** section.

Right-click a polyline for **Set as Head / Midpiece / Tail** and an **Assign to**
list of instances.

On a video, renames and part-class changes propagate to every frame of the track
when you save.

---

## Invasive spheroid projects

One editor-specific behaviour: a polygon classed as the **core** is drawn
**green** with a translucent green fill, while the corona and everything else
use the normal red/blue.

There is **no core/corona assignment UI** — the class is written by the model.
And there is **no Disintegration Index panel in the editor**: the index is
computed at export time. See
[Metrics → Disintegration Index](../reference/metrics.md#disintegration-index-di).

---

## Videos

See [Videos, frames and channels](videos-and-channels.md) for the frame slider,
channel overlay controls and the per-channel window/level sliders. In brief:
<kbd>←</kbd>/<kbd>→</kbd> step frames, <kbd>Space</kbd> plays and pauses at a
fixed 10 fps, and the sidebar gains a **Channels** section above the
**Display** card that stills have too.

---

## Performance notes

Things you will notice, all deliberate:

- **Every visible shape is drawn, always.** There is no viewport culling — an
  earlier culling pass dropped on-screen pieces of fragmented spheroids.
- **Pan and zoom are one plain 2D transform on one container.** A pan moves
  an already-drawn layer and re-draws nothing. A zoom step re-draws the shapes
  at the new scale — that is what keeps their edges sharp at 10× — so its cost
  grows with shape count: measured on a synthetic 2000-polyline frame, about
  6 ms per step on a workstation GPU (a steady 60 fps).
- **The view is deliberately not "GPU accelerated" with `will-change`.** That
  hint makes zooming about ten times cheaper by keeping the layer as a bitmap
  and stretching it — measured, it turned a 0.6 px stroke edge into a 5 px
  blur for as long as the hint was on. The earlier `perspective` /
  `translate3d` hints bought nothing measurable and, with the brightness /
  contrast filter, bled one screen pixel across every image-pixel boundary.
- **The drawn position is snapped to whole device pixels.** A view parked on
  a fractional pixel made the browser resample the whole overlay (stroke edge
  1.1–1.6 device px instead of about 0.8, at 100 %, 125 %, 150 % and 200 %
  display scaling). Only what is drawn is snapped; pans still accumulate
  sub-pixel movement.
- **A zoom step re-renders no shape.** Stroke widths, vertex handles and the
  selection glow read the zoom from two CSS custom properties on the overlay,
  so one style write resizes everything, in the same frame as the zoom.
- **Vertices are drawn only for the selected shape**, and only those near the
  viewport.
- **The sidebar list lags the canvas by one render on purpose**, so playback and
  undo bursts keep their frame budget. The header count stays live.
- On videos, a window of 5 frames back and 10 ahead is prefetched, and a
  skeleton covers the canvas until a new frame has decoded.
- **Shortcut keys are global.** <kbd>V</kbd>, <kbd>E</kbd>, <kbd>A</kbd>,
  <kbd>N</kbd>, <kbd>P</kbd>, <kbd>S</kbd>, <kbd>D</kbd>, <kbd>R</kbd>,
  <kbd>0</kbd> and <kbd>H</kbd> fire whenever you are not typing in a text
  field — including while the mouse is over the sidebar.
- Append `?perf=1` to the URL for a frame-rate overlay.

## Related

- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
- [Project types](project-types.md)
- [Export](export.md)
