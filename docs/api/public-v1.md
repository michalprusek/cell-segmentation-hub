# Public API (`/api/v1`)

Segment microscopy images with the SpheroSeg models from a script: send one
image, get the objects back in the format you choose. Nothing is stored — no
project is created, and the image and its result are gone when the response
is sent.

- **Base URL**: `https://spherosegapp.utia.cas.cz/api/v1`
- **Machine-readable contract**: [`/api/v1/openapi.json`](https://spherosegapp.utia.cas.cz/api/v1/openapi.json) (OpenAPI 3.1)
- **Interactive reference**: [`/api/v1/docs`](https://spherosegapp.utia.cas.cz/api/v1/docs)

The code is in `backend/src/api/v1/`. This page is checked against it by
`backend/src/api/v1/__tests__/docs.test.ts`.

## Quick start

1. In the app, open **Settings → API** and create a key. It is shown once.
2. Send it in the `Authorization` header:

```bash
export SPHEROSEG_KEY=sseg_...

# Which models are there, and what does each one read and return?
curl -s -H "Authorization: Bearer $SPHEROSEG_KEY" \
  https://spherosegapp.utia.cas.cz/api/v1/models

# Segment an image.
curl -s -H "Authorization: Bearer $SPHEROSEG_KEY" \
  -F image=@spheroid.tif -F model=segformer \
  https://spherosegapp.utia.cas.cz/api/v1/segment

# The same, as a 16-bit label image.
curl -s -H "Authorization: Bearer $SPHEROSEG_KEY" \
  -F image=@spheroid.tif -F model=segformer -F output_format=mask_tiff \
  -o spheroid.labels.tif \
  https://spherosegapp.utia.cas.cz/api/v1/segment
```

```python
import requests

API = "https://spherosegapp.utia.cas.cz/api/v1"
headers = {"Authorization": f"Bearer {KEY}"}

with open("spheroid.tif", "rb") as f:
    r = requests.post(
        f"{API}/segment",
        headers=headers,
        files={"image": f},
        data={"model": "segformer"},
        timeout=300,
    )
if not r.ok:
    problem = r.json()          # application/problem+json
    raise SystemExit(f"{problem['code']}: {problem.get('detail')}")

result = r.json()
for obj in result["objects"]:
    print(obj["label"], obj["class"], len(obj["points"]), "points",
          len(obj.get("holes", [])), "holes")
for w in result["warnings"]:
    print("warning:", w["code"], "-", w["detail"])
```

Reading a label image back:

```python
import io, tifffile          # or: from PIL import Image
labels = tifffile.imread(io.BytesIO(r.content))   # uint16, 0 = background
```

## Authentication

`Authorization: Bearer <key>` on every request, and nothing else.

- A key in the query string (`api_key`, `apikey`, `access_token`, `key`,
  `token`) is refused with 400 `credentials-in-url`. URLs end up in logs;
  treat such a key as leaked and revoke it.
- The app's session cookie is not accepted here, and a key is not accepted by
  the app's own routes. A key cannot create or revoke keys.
- Keys can carry an expiry and are revoked instantly from **Settings → API**.
- `GET /openapi.json`, `GET /docs` and `GET /problems/{code}` need no key.

## Endpoints

| Method | Path               | Purpose                                                    |
| ------ | ------------------ | ---------------------------------------------------------- |
| GET    | `/models`          | Every model: what it returns and which parameters it reads |
| GET    | `/models/{id}`     | One model                                                  |
| POST   | `/segment`         | Segment one image                                          |
| GET    | `/openapi.json`    | The OpenAPI 3.1 document (public)                          |
| GET    | `/docs`            | Swagger UI over that document (public)                     |
| GET    | `/problems/{code}` | What a problem `type` URI resolves to (public)             |

### `POST /segment`

`multipart/form-data`:

| Field           | Required | Meaning                                                                 |
| --------------- | -------- | ----------------------------------------------------------------------- |
| `image`         | yes      | One file. PNG, JPEG, TIFF or BMP, recognised by content, not by name    |
| `model`         | yes      | A model id from `/models`                                               |
| `threshold`     | no       | 0.1–0.99. **Only** for models that read it (table below)                |
| `detect_holes`  | no       | `true` / `false`. **Only** for models that read it                      |
| `page`          | no       | Zero-based page of a multi-page TIFF. Default 0                         |
| `output_format` | no       | `json` (default), `coco`, `mask_png`, `mask_tiff`, `imagej_roi`, `yolo` |

A field the chosen model does not read is **refused with 422**, not ignored —
so is a field name the endpoint does not know. A request that "worked" while
silently dropping your threshold would be worse than one that fails.

Limits for this synchronous endpoint:

- at most **4096 × 4096 pixels** (16 777 216) and **64 MiB** per image;
- at most **2 segmentations in flight** per key, and 120 requests per minute;
- inference is serial across the whole service (one GPU), so a request can
  wait behind others. Allow a client timeout of a few minutes.

## Models

| id                        | Name                           | Geometry | Classes                                    | `threshold`       | `detect_holes`     | Input depth |
| ------------------------- | ------------------------------ | -------- | ------------------------------------------ | ----------------- | ------------------ | ----------- |
| `hrnet`                   | HRNet                          | polygon  | `spheroid`                                 | yes (default 0.5) | yes (default true) | 8bit        |
| `cbam_resunet`            | CBAM-ResUNet                   | polygon  | `spheroid`                                 | yes (default 0.5) | yes (default true) | 8bit        |
| `unet_spherohq`           | U-Net (SpheroHQ)               | polygon  | `spheroid`                                 | yes (default 0.5) | yes (default true) | 8bit        |
| `spheroid_disintegration` | Spheroid Disintegration        | polygon  | `spheroid`, `core`                         | no                | no                 | 8bit        |
| `segformer`               | SegFormer                      | polygon  | `spheroid`                                 | yes (default 0.5) | yes (default true) | 8bit        |
| `mamba_unet`              | Mamba-UNet                     | polygon  | `spheroid`                                 | yes (default 0.5) | yes (default true) | 8bit        |
| `sperm`                   | Sperm Morphology               | polyline | `sperm` / parts `head`, `midpiece`, `tail` | no                | no                 | 8bit        |
| `sperm_2part`             | Sperm Morphology (head + tail) | polyline | `sperm` / parts `head`, `tail`             | no                | no                 | 8bit        |
| `wound`                   | Wound Healing                  | polygon  | `wound`                                    | yes (default 0.5) | yes (default true) | 8bit        |
| `microtubule`             | Microtubule                    | polyline | `microtubule`                              | no                | no                 | native      |
| `microcapsule`            | Microcapsule                   | polygon  | `microcapsule`, `membrane`                 | yes (default 0.5) | no                 | 8bit        |
| `neurite_soma`            | Neurite / Soma                 | polygon  | `neurite`, `soma`                          | no                | no                 | native      |

- **`spheroid_disintegration`** — Runs at the native resolution of the image. Validated on 2048 x 2048 px frames; other sizes are reported in the result warnings. Holes are never emitted for this model.
- **`microtubule`** — IRM (label-free) images only. On fluorescence (TIRF) frames the output does not track image content. The detection cut is part of the fitted model and cannot be set.
- **`microcapsule`** — A membrane outline encloses its capsule, so the two overlap. In mask outputs the smaller object is drawn on top.
- **`neurite_soma`** — Single-channel images. A colour image is accepted only if its channels are identical. Holes are never emitted for this model.

**Input depth.** `native` models use a 16-bit or float image at full depth.
For `8bit` models such an image is first stretched from its 0.1–99.9
percentile range to 0–255, and the result carries an `input_depth_converted`
warning with the range used. (Before 2026-10-06 these models received a
16-bit frame clipped at 255 — a white rectangle — and found nothing.) An
8-bit image is passed through untouched.

## The result (`output_format=json`)

```json
{
  "model": "segformer",
  "image": { "width": 1000, "height": 1000, "page": 0, "page_count": 1 },
  "parameters": { "threshold": 0.5, "detect_holes": true },
  "objects": [
    {
      "label": 1,
      "geometry": "polygon",
      "class": "spheroid",
      "confidence": 0.98,
      "points": [
        [412, 380],
        [415, 380],
        [417, 382]
      ],
      "holes": [
        [
          [450, 420],
          [455, 420],
          [455, 426]
        ]
      ]
    }
  ],
  "warnings": [],
  "timing": { "inference_ms": 214 }
}
```

- **Coordinates** are `[x, y]` in pixels of the image as uploaded, origin
  top-left. Polygon vertices are pixel centres of the region's boundary
  pixels, which belong to the region.
- **`points`** is a closed ring for a polygon (the first point is not
  repeated) and an open path for a polyline.
- **`holes`** belong to their object. An island inside a hole is a separate
  object.
- **`label`** is the object's position in the list, from 1 — and its pixel
  value in the mask formats, so the two can be joined.
- **`part`** / **`instance`** appear for sperm: each centerline is one part
  (`head`, `midpiece`, `tail`) of the cell named by `instance`.
- **`metrics`** appears for `spheroid_disintegration` (the Disintegration
  Index and related values).
- **`parameters`** are what the model actually ran with — empty for a model
  that reads none.

### Warnings

| Code                       | Meaning                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `multipage_image`          | The file has several pages; only `page` was segmented         |
| `input_depth_converted`    | A high-bit-depth image was stretched to 8 bits for this model |
| `model_warning`            | The model's own remark, e.g. an unvalidated frame size        |
| `no_objects`               | Nothing was found                                             |
| `invalid_geometry_dropped` | Objects with too few or non-finite points were left out       |
| `orphan_holes_dropped`     | Holes that belonged to no object were left out                |

For every format but `json` the codes travel in the `SpheroSeg-Warnings`
response header, and the object count in `SpheroSeg-Object-Count`.

## Output formats

| `output_format` | Media type         | What you get                                              |
| --------------- | ------------------ | --------------------------------------------------------- |
| `json`          | `application/json` | The result above                                          |
| `coco`          | `application/json` | COCO instance annotations                                 |
| `mask_png`      | `image/png`        | 16-bit label image                                        |
| `mask_tiff`     | `image/tiff`       | 16-bit label image, uncompressed baseline TIFF            |
| `imagej_roi`    | `application/zip`  | `RoiSet.zip` for ImageJ / Fiji                            |
| `yolo`          | `application/zip`  | `labels/<name>.txt` + `classes.txt` (polygon models only) |

What each format cannot express — choose with this in mind:

- **Label images** are always 16-bit, whatever the number of objects, so the
  pixel type never depends on the image. Pixel value = `label`, 0 =
  background. A region is its interior _and_ its outline, which reproduces
  the model's own mask exactly. Polylines are drawn one pixel wide. Where
  objects overlap (a microcapsule's membrane encloses the capsule; a
  disintegration core lies inside the spheroid) the smaller one is on top.
  More than 65 535 objects is a 422.
- **COCO**: a polygon without holes is a standard polygon annotation. COCO's
  polygon form cannot hold a hole, so a polygon _with_ holes is written as
  uncompressed RLE with `iscrowd: 1`. Polylines have no COCO form; they are
  written as one coordinate list with `area: 0` and
  `attributes.geometry: "polyline"` — an extension your loader must opt in to.
  Categories are the model's classes (for sperm, its parts).
- **ImageJ**: one `.roi` per object, named `0001-<class>.roi`. A hole is a
  separate ROI, `0001-<class>-hole1.roi` — select the object and its holes in
  the ROI Manager and use _XOR_ to cut them.
- **YOLO**: `class x1 y1 x2 y2 …` per polygon, normalised to 0–1. Holes cannot
  be expressed and are left out. Not offered for polyline models.

`Accept` is checked but does not choose: three formats share
`application/json` or `application/zip`. If you send an `Accept` that excludes
the media type of your `output_format` you get 406.

## Errors

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
document, `application/problem+json`:

```json
{
  "type": "https://spherosegapp.utia.cas.cz/api/v1/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "One or more request fields are invalid.",
  "code": "validation-failed",
  "errors": [
    {
      "field": "threshold",
      "detail": "The microtubule model does not use a threshold."
    }
  ]
}
```

Switch on `code`; `detail` is for people. The `type` URI resolves to a
description of the problem.

| Status | `code`                         | Meaning                                                                                                                                                                |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `credentials-in-url`           | A key was sent as a query parameter. URLs are logged; treat that key as leaked, revoke it, and send keys only in the Authorization header.                             |
| 401    | `authentication-required`      | No credentials were sent. Send an API key as `Authorization: Bearer <key>`; create one under Settings → API.                                                           |
| 401    | `invalid-api-key`              | The key is malformed, unknown, revoked or expired. These cases are deliberately not distinguished.                                                                     |
| 404    | `not-found`                    | No such endpoint or resource in this API version.                                                                                                                      |
| 406    | `not-acceptable`               | The Accept header excludes the media type of the chosen `output_format`. Accept is a check on the format, not the way to choose it.                                    |
| 413    | `image-too-large`              | The image has more pixels than a synchronous request accepts (`max_pixels`).                                                                                           |
| 413    | `payload-too-large`            | The upload exceeds the size limit in bytes (`max_bytes`).                                                                                                              |
| 415    | `unsupported-media-type`       | The request body must be multipart/form-data with the image in a file part named `image`.                                                                              |
| 422    | `output-not-representable`     | The result cannot be written in the requested format, for example more objects than a 16-bit label image can number.                                                   |
| 422    | `unsupported-image`            | The upload is not a readable PNG, JPEG, TIFF or BMP image. The file is judged by its content, not its name.                                                            |
| 422    | `validation-failed`            | One or more request fields are invalid. `errors` lists every one as `{field, detail}`. A parameter the chosen model does not read is refused here rather than ignored. |
| 429    | `rate-limit-exceeded`          | Too many requests. Wait the number of seconds given in the Retry-After header.                                                                                         |
| 429    | `too-many-concurrent-requests` | This key already has the maximum number of segmentations in flight. Wait for one to finish.                                                                            |
| 500    | `internal-error`               | An unexpected error. Nothing about the cause is disclosed; the server log has it.                                                                                      |
| 502    | `segmentation-failed`          | The segmentation service could not process the image.                                                                                                                  |
| 503    | `server-busy`                  | Too many segmentations are queued. Retry after the number of seconds in Retry-After.                                                                                   |
| 504    | `segmentation-timeout`         | The model did not finish in time.                                                                                                                                      |

A 401 carries a `WWW-Authenticate: Bearer` challenge (RFC 6750). A 429 or 503
carries `Retry-After`, in seconds.

## Rate limits

120 requests per minute per key, announced on every authenticated response:

```
RateLimit-Policy: "120-in-1min"; q=120; w=60
RateLimit: "120-in-1min"; r=117; t=42
```

These two headers follow an IETF **draft** (`draft-ietf-httpapi-ratelimit-headers`),
not yet an RFC; `Retry-After` on the 429 is the standard part. There is also a
limit of 600 requests per minute per IP address ahead of authentication.

## Versioning

The major version is in the path. Within `v1` changes are additive only: new
endpoints, new optional request fields, new response fields, new warning and
problem codes. **Ignore fields you do not know.** Removing or renaming
anything, or changing a default, would be `v2`.

## Not in v1

- **Asynchronous jobs** for larger images and batches — planned as
  `/api/v1/jobs`.
- **Image by URL** — deliberately absent; fetching URLs on a caller's behalf
  is a server-side request forgery risk.
- **Videos, ND2 files and cross-frame tracking** — use the app.
