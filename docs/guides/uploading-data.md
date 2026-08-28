# Uploading data

What the platform accepts, how big it may be, and what happens to a file after
you drop it.

---

## Accepted formats

| Kind                  | Extensions                                                                | Max size   |
| --------------------- | ------------------------------------------------------------------------- | ---------- |
| **Still images**      | `.jpg` `.jpeg` `.png` `.tif` `.tiff` `.bmp`                               | **20 MB**  |
| **Videos and stacks** | `.mp4` `.avi` `.mov` `.mkv` `.webm` `.nd2`, and multi-page `.tif`/`.tiff` | **100 GB** |

That is the uploader's own list, and it is authoritative. (The API layer also
tolerates WebP and GIF, but they are not offered in the interface.) `.nd2` has
no registered MIME type — browsers report it as a generic binary — so it is
recognised by extension in three separate places.

A batch may contain at most **10 000 files**; images are sent in chunks of 100
files or 500 MB, whichever comes first. Videos are uploaded **one at a time,
sequentially**.

---

## Image or video? The platform decides, not the extension

A `.tif` can be either a single micrograph or a whole time-lapse stack, so
extension alone is not enough. The routing rule is:

A file goes to the **video** path if **any** of these hold:

1. its MIME type starts with `video/`, or
2. its extension is `.mp4` `.avi` `.mov` `.mkv` `.webm` `.nd2`, or
3. it is a `.tif`/`.tiff` **larger than 20 MB**, or
4. it is a `.tif`/`.tiff` that **actually contains more than one page**.

Rule 4 is checked by reading the first ~14 bytes of the file and walking its
IFD chain — cheap at any file size, and the reason a **small** multi-channel
TIFF (say a 1 MB two-channel 512² IRM+TIRF frame) is still handled as a video.
That matters: without it the single-image path would read only page 0 and
render 16-bit data near-black.

> **If the sniff fails** — a truncated or corrupt stack, or a browser without
> the `Blob` API — a real stack is handled as a single image and renders very
> dark. There is no user-visible warning; only a debug log line. Re-uploading
> usually fixes it.

---

## What happens to each kind

### Still images

Stored as-is, with a generated thumbnail. One `Image` row per file. They appear
in the project gallery immediately and can be segmented individually or in
bulk.

### Videos and stacks

One **container** row plus one **frame** row per frame. See
[Videos, frames and channels](videos-and-channels.md) for the whole model. The
short version:

| Source                       | Becomes                                                           |
| ---------------------------- | ----------------------------------------------------------------- |
| MP4 / AVI / MOV / MKV / WebM | One container, N frames, **one** channel named `video`            |
| Multi-page TIFF              | One container, N frames, one channel per detected channel         |
| ND2 with a single position   | One container, N frames, one channel per acquisition channel      |
| ND2 with P positions (P > 1) | **P separate containers**, each named `<file> — <position label>` |

Frames are named `"<video name> (frame N)"` with **N starting at 1**, while the
internal frame index starts at 0.

### Bit depth is preserved

16-bit source data is written to per-frame PNGs **losslessly as 16-bit
grayscale**. 8-bit stays 8-bit. Signed 16-bit is offset into unsigned
reversibly. Only unusual dtypes get a per-frame min–max rescale, and that is
logged. The one place 8 bits are used is the playback proxy, which never feeds
measurements — see
[the playback proxy](videos-and-channels.md#the-playback-proxy).

---

## Uploading

Three ways, all equivalent:

- **Drag and drop** files onto the upload area.
- **Click** the upload area to open a file browser.
- Drop a whole **folder** — it is walked recursively.

There is an **"Auto-segment images after upload"** checkbox: tick it and every
uploaded image is queued with your default model as soon as it lands.

**Cancel** aborts the upload actually in flight and marks everything still
queued as cancelled.

### A video upload is one long request

Transfer _and_ server-side extraction happen inside a single HTTP request. The
client timeout is proportional to file size — roughly 1 MiB/s with 50 % head
room, clamped to a **20-minute floor and a 4-hour ceiling**; the reverse proxy
allows up to 4 hours. A 40 GB ND2 therefore takes as long as it takes, and the
progress bar can sit at 100 % for a long time while frames are being extracted.

---

## Calibration metadata

The platform reads physical calibration out of the file when the format carries
it:

| Value             | Source                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `pixelSizeUm`     | ND2 voxel size, OME-TIFF `PhysicalSizeX`, or ImageJ TIFF metadata |
| `frameIntervalMs` | Wall-clock interval between frames, when recorded                 |

Both are stored on the **container** row, and are surfaced on frames so the
export dialog can pre-fill the pixel scale. If a file carries no calibration,
lengths and areas are reported in pixels and you can supply a scale manually at
export time.

---

## Where files live

```
<uploads>/projects/<projectId>/images/<containerId>/
    original.<ext>                     the uploaded file
    thumbnail.jpg                      300×300
    frames/<NNNN>/<channel>.png        one PNG per frame per channel
    frames/<NNNN>/<channel>.p<R>.webp  playback proxy (generated lazily)
    registration.json                  only if channel registration was used
```

For a **multi-position ND2** the uploaded `.nd2` is **deleted** after
extraction; each of the P containers instead owns a self-contained single-position
16-bit OME-TIFF as its `original.tif`. Do not expect to download the original
`.nd2` back out of the platform.

---

## Limits and failure modes worth knowing

| Situation                                                          | What happens                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image over 20 MB                                                   | Rejected before upload starts.                                                                                                                                                                                                                                                                                                                     |
| TIFF over 20 MB                                                    | Routed as a video, so the 100 GB limit applies instead.                                                                                                                                                                                                                                                                                            |
| ND2 with more than **1536 positions**                              | Rejected. That is a hard cap.                                                                                                                                                                                                                                                                                                                      |
| Channel name longer than 64 characters, or with unusual characters | **The upload fails, loudly.** Channel names are restricted to `A–Z a–z 0–9 _ -`, max 64. In August 2026 a Fiji/Bio-Formats export that embedded a ~140-character source filename in every slice label made nine containers permanently unreadable; uploads now refuse rather than persist such a container. Re-export with shorter channel labels. |
| Upload interrupted                                                 | Nothing is committed for that file; re-upload it.                                                                                                                                                                                                                                                                                                  |
| Deleting the last frame of a video                                 | The container row and its files are removed too, in the same transaction.                                                                                                                                                                                                                                                                          |

## Related

- [Videos, frames and channels](videos-and-channels.md)
- [Project types](project-types.md) — which modality each model expects
- [User guide](user-guide.md)
