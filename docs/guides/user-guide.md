# User guide

The end-to-end walkthrough: from an account to an exported result. Each step
links to a detailed page.

The same material, searchable and translated into six languages, is available
inside the app at
[`/documentation`](https://spherosegapp.utia.cas.cz/documentation).

---

## 1. Account

Sign-up is open — go to `/sign-up`, enter an e-mail and a password. There is no
approval queue.

In **Settings** you can set:

- your **preferred model** and **default confidence threshold** (used wherever
  the project type allows a choice);
- **language** — English, Czech, Spanish, German, French or Chinese;
- **theme**;
- e-mail notification and data-use consent preferences.

Your profile (username, organisation, bio, avatar) is optional and can be made
public.

---

## 2. Projects and folders

A **project** is a set of images plus the segmentations made from them, and it
has a **type** that decides how everything downstream behaves.

Create one from the dashboard: title, optional description, and the **project
type** — see [Project types](project-types.md) and pick carefully, because the
type determines which models you can run.

Projects can be organised into a **folder tree** that is private to you: two
users can file the same shared project in different folders. Folders nest
arbitrarily; deleting one sweeps its subtree (your own projects are deleted,
shared ones are only unlinked).

Each project card shows its image count, a thumbnail and progress. The owner can
mark a project **verified** ("all annotations reviewed") — so can an
accepted collaborator, unlike the title, description and type, which stay
owner-only.

---

## 3. Upload

Drag files onto the upload area, click to browse, or drop a whole folder.

- **Images**: JPEG, PNG, TIFF, BMP — up to **20 MB** each.
- **Videos and stacks**: MP4, AVI, MOV, MKV, WebM, Nikon ND2 and multi-page
  TIFF — up to **100 GB**.

Tick **Auto-segment images after upload** to queue everything as it lands.

A video, ND2 or multi-page TIFF becomes a **container** with one row per frame.
An ND2 recorded at several stage positions becomes **one project entry per
position**.

Full details, including how the platform decides whether a `.tif` is an image or
a stack: [Uploading data](uploading-data.md) and
[Videos, frames and channels](videos-and-channels.md).

---

## 4. Segment

Select images (or none, for all) and press **Segment**. You choose the model —
where your project type offers a choice — and the confidence threshold. On a
multi-channel video a **channel picker** appears first.

Work is queued and processed in the background:

- progress arrives live over a WebSocket;
- batches of up to **10 000 images** are supported;
- the scheduler deprioritises users who were recently served, so one 200-frame
  video cannot monopolise the GPU;
- interrupted work is recovered rather than lost.

Model compatibility is enforced by the worker, not at submission, so an accepted
job can still be rejected at dispatch if the model does not match the project
type.

---

## 5. Edit

Open any image to enter the [segmentation editor](segmentation-editor.md).

The essentials:

- <kbd>V</kbd> view, <kbd>E</kbd> edit vertices, <kbd>A</kbd> add points,
  <kbd>N</kbd> new polygon, <kbd>P</kbd> new polyline, <kbd>S</kbd> slice,
  <kbd>D</kbd> delete;
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo and redo;
- <kbd>Ctrl</kbd>+<kbd>S</kbd> to save — **there is no continuous autosave**;
- on videos, <kbd>←</kbd>/<kbd>→</kbd> step frames and <kbd>Space</kbd> plays.

The full list is at [Keyboard shortcuts](../reference/keyboard-shortcuts.md).

**Resegment frame** in the top toolbar re-runs the model on the current image and
**replaces** its segmentation — manual edits to that frame are lost.

---

## 6. Export

Open a project → **Export**. Choose what to include, enter a pixel size in
µm/pixel if you have one (it is auto-filled from the file's own calibration when
present), and start. The job runs in the background and downloads itself.

You get one ZIP with the original images, rendered visualisations, annotations
(COCO / YOLO / custom JSON, or ImageJ ROIs and CVAT for microtubule projects),
a metrics workbook whose sheets depend on the project type, and documentation.

Full breakdown: [Export](export.md). Every formula: [Metrics](../reference/metrics.md).

---

## 7. Share

Share a project by **e-mail invitation** or by a **link**. Recipients see the
project in their own dashboard once they accept. See
[Sharing and collaboration](sharing-and-collaboration.md).

---

## Beyond projects

Two tools sit outside the project system:

- **[Automated Essays](automated-essays.md)** — upload a folder of ND2 wells and
  get one CSV row per microtubule. No project, no editor.
- **[Segmenter](segmenter.md)** — a standalone class-based polygon annotation
  tool with its own datasets.

---

## Getting the best results

- **Contrast matters most.** For every model, the difference between the object
  and its background dominates output quality.
- **Match the modality.** The microtubule model is IRM-only; the wound model
  expects scratch assays; the disintegration model expects a visible core.
  Running a model on the wrong modality produces confident nonsense rather than
  an error.
- **Tune the threshold second, not first.** Where it is adjustable, a lower
  threshold finds more objects with weaker evidence. For the microtubule model
  it is not adjustable at all, deliberately.
- **Calibrate.** If your files carry a pixel size it is used automatically; if
  not, enter one at export so lengths and areas are in micrometres.
- **Review before you export.** Segmentation is a starting point; the editor
  exists because models get boundaries slightly wrong.

---

## Troubleshooting

| Symptom                              | Look at                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Upload rejected                      | [Uploading data → limits](uploading-data.md#limits-and-failure-modes-worth-knowing)                   |
| 16-bit frames look black             | [Window and level](videos-and-channels.md#displaying-16-bit-data-window-and-level)                    |
| Model finds nothing / finds nonsense | [Project types](project-types.md), then the model's section in [ML models](../reference/ml-models.md) |
| Colours change between frames        | [Cross-frame tracking](videos-and-channels.md#segmenting-a-multi-channel-video)                       |
| Export missing intensities           | [Export → partial failures](export.md#partial-failures-do-not-fail-the-export)                        |
| Anything else                        | [Troubleshooting](../TROUBLESHOOTING.md)                                                              |

## Privacy

Data handling, retention and deletion are described in the app's own
**Privacy policy** and **Terms of service** pages, reachable from the footer.
Your account and everything in it can be deleted from **Settings → Account**.

## Related

- [Project types](project-types.md)
- [Segmentation editor](segmentation-editor.md)
- [Export](export.md)
- [Documentation index](../README.md)
