"""Render the hover-preview specimen tiles from real production segmentations.

Reads the reviewed selection in `chosen.tsv` plus a staging directory of stored
polygons (see `dump-polygons.sh` and `infer-missing.sh`) and writes, per row:

    public/specimens/previews/<id>.webp        the frame, cropped and windowed
    public/specimens/previews/<id>.geom.json   the outlines, as SVG paths

...and one generated index, `src/lib/specimens/previewIndex.ts`.

Runs inside the ml image, which carries PIL / numpy; the repo's own node has
neither BMP support (sharp cannot read one, and four source frames are BMPs:
`cbam_resunet-2` and all three `spheroid_disintegration` tiles) nor a 16-bit
path. The uploads are supplied by the `-v` below, not by the image:

    docker run --rm \
      -v "$PWD:/repo" -v /tmp/specimen-previews:/work \
      -v /data/uploads/blue:/uploads:ro \
      cell-segmentation-hub-ml python /repo/scripts/specimen-previews/generate.py

WHAT IS DELIBERATE HERE, because each of these was a wrong first guess that the
rendered contact sheets corrected:

* The tile is a CROP, sized from the objects rather than the frame. A 2048-px
  field of 60-px spheroids drawn into a 123-px tile puts each object at 3.6 px,
  which is noise. The window is sized so the median object spans
  ZOOM_TARGET_RATIO of it, but must also be big enough for the
  90th-percentile object — without that second term a wound frame (two
  frame-spanning regions plus debris) zoomed inside the wound and left its
  outline outside the tile. It is a size floor, not a containment guarantee:
  placement is chosen separately, so an object larger than the window still
  overflows it. Two further rules decide most real tiles and are easy to miss:
  the window never exceeds the frame's short side (14 of the 33 clamp there)
  and never falls below MIN_CROP_FRAC of it (3 do).
* 16-bit frames are stretched min..max over the frame's own samples. That is
  what `applyRanges` in ImageDisplayContext does when a channel is first seen,
  so the tile shows the picture the editor would open — not ImageJ's
  0.35 %-saturation auto-contrast, which the product never applies.
* Outlines carry the polygon's IDENTITY (`t`/`c`/`g`/`s`/`x`), not a colour.
  `specimenStroke()` resolves the stroke in the browser from the same modules
  the canvas uses, so a palette change in the editor reaches these tiles and
  the two can never drift.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

REPO = '/repo'
WORK = os.environ.get('SPECIMEN_WORK', '/work')
UPLOADS = '/uploads'
DEFAULT_ASSETS = os.path.join(REPO, 'public', 'specimens', 'previews')
# Overridable so a candidate pass can be rendered somewhere else and reviewed
# with contact-sheet.py without touching the shipped tiles.
ASSETS = os.environ.get('SPECIMEN_ASSETS', DEFAULT_ASSETS)
CHOSEN = os.environ.get('SPECIMEN_CHOSEN', '')
INDEX_TS = os.path.join(REPO, 'src', 'lib', 'specimens', 'previewIndex.ts')
HERE = os.path.dirname(os.path.abspath(__file__))

TILE = 512          # stored webp side; the card renders it at ~123 css px
VIEWBOX = 1000.0    # SVG user units the outlines are mapped into
RDP_EPS = 3.0       # viewBox units: 0.37 px at the rendered tile size
# The card is 26rem wide with 1rem of padding and two 0.5rem gaps, so three
# tiles land at (416 - 32 - 16) / 3 = 123 css px. `contact-sheet.py` draws at
# the same number — it exists to judge legibility at shipping size, so a
# generous value there would pass tiles the card cannot show.
DISPLAY_PX = 123
ZOOM_TARGET_RATIO = 0.10
CONTAIN_P90_RATIO = 0.9
MIN_CROP_FRAC = 0.25
WEBP_QUALITY = 82


def load_image(path):
    """8-bit RGB of the frame, windowed the way the editor windows it."""
    img = Image.open(path)
    img.load()
    if img.mode in ('I;16', 'I;16B', 'I;16L', 'I', 'F'):
        a = np.asarray(img).astype(np.float64)
        lo, hi = float(a.min()), float(a.max())
        a = np.zeros_like(a) if hi <= lo else (a - lo) * (255.0 / (hi - lo))
        return Image.fromarray(a.astype(np.uint8), mode='L').convert('RGB')
    return img.convert('RGB')


def rdp(points, eps):
    """Ramer-Douglas-Peucker. Iterative: a stored contour in this very
    selection carries up to 5786 vertices, which recursion would not
    survive."""
    n = len(points)
    if n < 3:
        return list(points)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = points[i]
        bx, by = points[j]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        between = points[i + 1:j]
        if not between:
            continue
        px = np.array([p[0] for p in between])
        py = np.array([p[1] for p in between])
        if seg == 0:
            dist = np.hypot(px - ax, py - ay)
        else:
            dist = np.abs(dy * px - dx * py + bx * ay - by * ax) / seg
        k = int(np.argmax(dist))
        if dist[k] > eps:
            idx = i + 1 + k
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [points[i] for i in range(n) if keep[i]]


def outline_flags(poly):
    """The fields `specimenStroke()` needs, and nothing else."""
    flags = {}
    is_polyline = poly.get('geometry') == 'polyline'
    if is_polyline:
        flags['g'] = 'l'
    if poly.get('complete') is False:
        flags['x'] = 1
    part = poly.get('partClass')
    if part:
        flags['c'] = part
    if poly.get('parent_id') or poly.get('type') == 'internal':
        flags['t'] = 'i'
    if is_polyline and not part:
        seed = poly.get('trackId') or poly.get('instanceId') or poly.get('id')
        if seed:
            flags['s'] = seed
    return flags


def fmt(v):
    """Integer viewBox units. One unit is 0.12 px at the rendered size, so a
    decimal place would be invisible; measured across the 33 shipped files it
    would add ~44 % to the coordinate text."""
    return str(int(round(float(v))))


def to_path(points, closed):
    d = ['M%s %s' % (fmt(points[0][0]), fmt(points[0][1]))]
    d.extend('L%s %s' % (fmt(x), fmt(y)) for x, y in points[1:])
    if closed:
        d.append('Z')
    return ''.join(d)


def choose_crop(polys, w, h):
    """Square window: sized so objects survive the thumbnail, placed where the
    annotations are.

    Position comes from an integral image of the annotation points rather than
    their centroid, which on a bimodal field lands in the empty middle.
    """
    short = min(w, h)
    pts = np.array([[p['x'], p['y']] for poly in polys for p in poly['points']],
                   dtype=np.float64)
    if not len(pts):
        return (w - short) // 2, (h - short) // 2, short

    diags = []
    for poly in polys:
        a = np.array([[p['x'], p['y']] for p in poly['points']], dtype=np.float64)
        diags.append(float(math.hypot(a[:, 0].ptp(), a[:, 1].ptp())))
    median_diag = float(np.median(diags))
    p90_diag = float(np.percentile(diags, 90))

    readable = median_diag / ZOOM_TARGET_RATIO if median_diag > 0 else short
    contains = p90_diag / CONTAIN_P90_RATIO if p90_diag > 0 else 0.0
    side = max(contains, min(readable, short))
    side = int(round(min(short, max(short * MIN_CROP_FRAC, side))))

    steps = 64
    cell = max(1.0, side / 8.0)
    gw, gh = int(math.ceil(w / cell)), int(math.ceil(h / cell))
    grid = np.zeros((gh, gw), dtype=np.float64)
    gx = np.clip((pts[:, 0] / cell).astype(int), 0, gw - 1)
    gy = np.clip((pts[:, 1] / cell).astype(int), 0, gh - 1)
    np.add.at(grid, (gy, gx), 1.0)
    # ZERO-PADDED first row and column, because `contained` indexes this as a
    # standard summed-area table (sum of cells strictly before the index).
    # Without the pad the rectangle sum silently drops the window's own first
    # row and column of cells — an eighth of the window on each axis — and the
    # densest-window search then answers a different question than the one
    # documented above.
    integral = np.zeros((gh + 1, gw + 1), dtype=np.float64)
    integral[1:, 1:] = grid.cumsum(0).cumsum(1)

    def contained(x0, y0):
        x1 = min(gw, int((x0 + side) / cell))
        y1 = min(gh, int((y0 + side) / cell))
        xg, yg = int(x0 / cell), int(y0 / cell)
        return (integral[y1, x1] - integral[yg, x1]
                - integral[y1, xg] + integral[yg, xg])

    best, best_n = (0, 0), -1.0
    for i in range(steps + 1):
        for j in range(steps + 1):
            x0 = int(round((w - side) * i / steps))
            y0 = int(round((h - side) * j / steps))
            n = contained(x0, y0)
            if n > best_n:
                best, best_n = (x0, y0), n
    return best[0], best[1], side


def render(row, polys):
    src = (os.path.join(WORK, row['source'][5:]) if row['source'].startswith('work:')
           else os.path.join(UPLOADS, row['source']))
    if not os.path.exists(src):
        raise SystemExit('missing source frame for %s: %s' % (row['id'], src))
    img = load_image(src)
    iw, ih = img.size

    # Polygon space is the frame the model saw; rescale if the row disagrees.
    # A ZERO dimension is fatal, not a reason to skip the rescale:
    # `dump-polygons.sh` manufactures one via `COALESCE(..., 0)` when a row has
    # no recorded size, and falling back to a scale of 1.0 there would ship a
    # tile whose outlines sit in the wrong coordinate space over the right
    # frame — wrong in a way only a human looking at it would catch.
    if not row['width'] or not row['height']:
        raise SystemExit(
            'no image dimensions recorded for %s; refusing to guess the '
            'polygon scale' % row['id']
        )
    sx = iw / float(row['width'])
    sy = ih / float(row['height'])
    if abs(sx - 1) > 0.01 or abs(sy - 1) > 0.01:
        for poly in polys:
            for p in poly['points']:
                p['x'] *= sx
                p['y'] *= sy

    x0, y0, side = choose_crop(polys, iw, ih)
    tile = img.crop((x0, y0, x0 + side, y0 + side)).resize((TILE, TILE), Image.LANCZOS)
    tile.save(os.path.join(ASSETS, row['id'] + '.webp'), 'WEBP',
              quality=WEBP_QUALITY, method=6)

    k = VIEWBOX / side
    outlines, diags = [], []
    for poly in polys:
        pts = [((p['x'] - x0) * k, (p['y'] - y0) * k) for p in poly['points']]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if max(xs) < 0 or min(xs) > VIEWBOX or max(ys) < 0 or min(ys) > VIEWBOX:
            continue  # wholly outside the crop: bytes that draw nothing
        simple = rdp(pts, RDP_EPS)
        if len(simple) < 2:
            continue
        rec = {'d': to_path(simple, poly.get('geometry') != 'polyline')}
        rec.update(outline_flags(poly))
        outlines.append(rec)
        diags.append(math.hypot(max(xs) - min(xs), max(ys) - min(ys)))
    if not outlines:
        raise SystemExit('no outline inside the crop for %s' % row['id'])

    with open(os.path.join(ASSETS, row['id'] + '.geom.json'), 'w') as fh:
        json.dump({'outlines': outlines}, fh, separators=(',', ':'))

    return {
        'objects': len(outlines),
        'cropSide': side,
        'frameShort': min(iw, ih),
        'medianDiagPx': round(float(np.median(diags)) / VIEWBOX * DISPLAY_PX, 1),
        'webpBytes': os.path.getsize(os.path.join(ASSETS, row['id'] + '.webp')),
        'geomBytes': os.path.getsize(os.path.join(ASSETS, row['id'] + '.geom.json')),
    }


def read_chosen():
    rows = []
    with open(CHOSEN or os.path.join(HERE, 'chosen.tsv')) as fh:
        for line in fh:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            id_, model, ptype, image_id, w, h, source, origin = line.split('\t')
            rows.append({'id': id_, 'model': model, 'projectType': ptype,
                         'imageId': image_id, 'width': int(w), 'height': int(h),
                         'source': source, 'origin': origin})
    return rows


def read_meta():
    meta = {}
    path = os.path.join(WORK, 'meta.tsv')
    if os.path.exists(path):
        for line in open(path):
            if not line.strip():
                continue
            image_id, w, h, source = line.rstrip('\n').split('\t')
            meta[image_id] = (int(w), int(h), source)
    return meta


def write_index(records):
    lines = [
        '/**',
        ' * GENERATED by `scripts/specimen-previews/generate.py` — do not hand-edit.',
        ' *',
        ' * One entry per preview tile shown on hover in the project-type and model',
        ' * pickers. Each is a real production frame with the outlines the named model',
        ' * actually produced; the geometry is fetched on hover from `geometry`, never',
        ' * bundled, because the full set is ~200 kB of path data.',
        ' *',
        ' * `model` is the id, not a display name: the picker reads the name out of',
        ' * MODEL_REGISTRY so a rename cannot leave a stale copy here.',
        ' */',
        '',
        "import type { ModelType } from '@/lib/models/modelRegistry';",
        "import type { ProjectType } from '@/types';",
        '',
        'export interface SpecimenPreview {',
        '  /** Stable id; also the asset basename. */',
        '  readonly id: string;',
        '  readonly model: ModelType;',
        '  readonly projectType: ProjectType;',
        '  /** Tile under /public, 512 px square. */',
        '  readonly image: string;',
        '  /** Outline geometry under /public, fetched on hover. */',
        '  readonly geometry: string;',
        '  /** Outlines in the tile — the caption quotes it. */',
        '  readonly objects: number;',
        '}',
        '',
        'export const SPECIMEN_PREVIEWS: readonly SpecimenPreview[] = [',
    ]
    for rec in records:
        lines.extend([
            '  {',
            "    id: '%s'," % rec['id'],
            "    model: '%s'," % rec['model'],
            "    projectType: '%s'," % rec['projectType'],
            "    image: '/specimens/previews/%s.webp'," % rec['id'],
            "    geometry: '/specimens/previews/%s.geom.json'," % rec['id'],
            '    objects: %d,' % rec['objects'],
            '  },',
        ])
    lines.extend(['] as const;', ''])
    os.makedirs(os.path.dirname(INDEX_TS), exist_ok=True)
    with open(INDEX_TS, 'w') as fh:
        fh.write('\n'.join(lines))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    meta = read_meta()
    records, total_webp, total_geom = [], 0, 0
    for row in read_chosen():
        if row['origin'] == 'db':
            if row['imageId'] not in meta:
                raise SystemExit('no dump for %s — run dump-polygons.sh first' % row['id'])
            row['width'], row['height'], row['source'] = meta[row['imageId']]
        with open(os.path.join(WORK, 'polys', row['imageId'] + '.json')) as fh:
            polys = json.load(fh)
        stats = render(row, polys)
        records.append({**row, **stats})
        total_webp += stats['webpBytes']
        total_geom += stats['geomBytes']
        print('%-26s obj=%-4d crop=%d/%d medianObj=%.1fpx webp=%dkB geom=%dkB' % (
            row['id'], stats['objects'], stats['cropSide'], stats['frameShort'],
            stats['medianDiagPx'], stats['webpBytes'] // 1024, stats['geomBytes'] // 1024))
    # A candidate pass renders elsewhere and must not rewrite the shipped index.
    if ASSETS == DEFAULT_ASSETS:
        write_index(records)
    print('\n%d tiles — %d kB of webp, %d kB of geometry (fetched on hover, never bundled)'
          % (len(records), total_webp // 1024, total_geom // 1024))


if __name__ == '__main__':
    sys.exit(main())
