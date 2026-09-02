"""Every generated tile, drawn at the size the hover card draws it.

This is the review step, and it is not optional: SQL cannot see that a
candidate is a figure lifted from a publication, that a 16-bit channel decoded
to near-black, or that a confident segmentation is visually wrong. All three
were in the first pool and all three were caught here.

    docker run --rm -v /tmp/specimen-previews:/work -v "$PWD:/repo:ro" \
      cell-segmentation-hub-ml python /repo/scripts/specimen-previews/contact-sheet.py

Writes /work/contact-sheet.png. Point SPECIMEN_ASSETS at another directory to
review a candidate pass rendered elsewhere.
"""

import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

REPO = '/repo'
WORK = os.environ.get('SPECIMEN_WORK', '/work')
ASSETS = os.environ.get('SPECIMEN_ASSETS',
                        os.path.join(REPO, 'public', 'specimens', 'previews'))
TILE = 150   # the card's rendered tile size
LABEL = 16
COLS = 6

NEURON = {'neurite': (6, 182, 212), 'soma': (217, 70, 239)}
SPERM_PARTS = {'head': (34, 197, 94), 'midpiece': (245, 158, 11),
               'tail': (6, 182, 212)}


def _int32(value):
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value >= 0x80000000 else value


def _hsl_to_rgb(hue, sat, light):
    c = (1 - abs(2 * light - 1)) * sat
    x = c * (1 - abs((hue / 60.0) % 2 - 1))
    m = light - c / 2
    r, g, b = [(c, x, 0), (x, c, 0), (0, c, x),
               (0, x, c), (x, 0, c), (c, 0, x)][int(hue / 60) % 6]
    return tuple(int(round((v + m) * 255)) for v in (r, g, b))


def instance_colour(seed):
    """Mirror of `colorFromInstanceId`: the same djb2-style hash, so the sheet
    shows the hues the browser will."""
    if not seed:
        return (153, 153, 153)  # NEUTRAL_COLOR, hsl(0, 0%, 60%)
    hash_ = 0
    for ch in seed:
        hash_ = _int32((hash_ << 5) - hash_ + ord(ch))
    return _hsl_to_rgb(abs(hash_) % 360, 0.70, 0.55)


def stroke(outline):
    """Mirror of `specimenStroke`."""
    if outline.get('x'):
        return (150, 150, 150)
    if outline.get('g') != 'l':
        if outline.get('c') == 'core':
            return (34, 197, 94)
        if outline.get('c') in NEURON:
            return NEURON[outline['c']]
        return (14, 165, 233) if outline.get('t') == 'i' else (239, 68, 68)
    if outline.get('c') in SPERM_PARTS:
        return SPERM_PARTS[outline['c']]
    return instance_colour(outline.get('s', ''))


def path_points(d):
    """The generated paths are only M/L/Z, so a split is enough of a parser."""
    numbers = [float(tok) for tok in
               d.replace('M', ' ').replace('L', ' ').replace('Z', ' ').split()]
    points = [(numbers[i] / 1000.0 * TILE, numbers[i + 1] / 1000.0 * TILE)
              for i in range(0, len(numbers) - 1, 2)]
    return points, d.endswith('Z')


def main():
    ids = sorted(name[:-len('.webp')] for name in os.listdir(ASSETS)
                 if name.endswith('.webp'))
    rows = math.ceil(len(ids) / COLS)
    sheet = Image.new('RGB', (COLS * (TILE + 8), rows * (TILE + LABEL)), (24, 24, 27))
    label = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
    except OSError:
        font = ImageFont.load_default()

    for n, id_ in enumerate(ids):
        tile = Image.open(os.path.join(ASSETS, id_ + '.webp')).resize(
            (TILE, TILE), Image.LANCZOS)
        draw = ImageDraw.Draw(tile)
        with open(os.path.join(ASSETS, id_ + '.geom.json')) as fh:
            for outline in json.load(fh)['outlines']:
                points, closed = path_points(outline['d'])
                if len(points) >= 2:
                    draw.line(points + ([points[0]] if closed else []),
                              fill=stroke(outline), width=1)
        x, y = (n % COLS) * (TILE + 8), (n // COLS) * (TILE + LABEL)
        sheet.paste(tile, (x, y))
        label.text((x + 2, y + TILE + 2), id_, fill=(220, 220, 220), font=font)

    out = os.path.join(WORK, 'contact-sheet.png')
    sheet.save(out)
    print('%d tiles -> %s' % (len(ids), out))


if __name__ == '__main__':
    main()
