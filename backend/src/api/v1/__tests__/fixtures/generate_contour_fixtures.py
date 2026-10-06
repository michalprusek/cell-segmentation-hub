"""Regenerate contours_*.json: masks and the contours OpenCV traces from them.

    docker run --rm -v $PWD/backend/src/api/v1/__tests__/fixtures:/f \
      --entrypoint python cell-segmentation-hub-ml /f/generate_contour_fixtures.py

The masks are procedural (a thresholded, smoothed random field), not derived
from anyone's images. What matters is that the CONTOURS are OpenCV's own,
traced with the exact call the ML service uses
(`cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)`), and typed
the way `ModelLoader.predict` types them: a contour with a parent is
`internal`, whatever its depth. The test then requires that rasterising those
contours gives back the mask, pixel for pixel.
"""
import base64, json, os
import cv2, numpy as np
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))

def make(seed, h, w, sigma, level):
    rng = np.random.default_rng(seed)
    field = gaussian_filter(rng.standard_normal((h, w)), sigma)
    mask = (field > np.quantile(field, level)).astype(np.uint8)
    return mask

def trace(mask):
    contours, hierarchy = cv2.findContours(mask * 255, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    items = []
    for i, c in enumerate(contours):
        parent = int(hierarchy[0][i][3])
        item = {"id": f"polygon_{i}", "type": "internal" if parent != -1 else "external",
                "points": [{"x": float(p[0][0]), "y": float(p[0][1])} for p in c]}
        if parent != -1:
            item["parent_id"] = f"polygon_{parent}"
        items.append(item)
    depth = lambda i: 0 if hierarchy[0][i][3] == -1 else 1 + depth(int(hierarchy[0][i][3]))
    return items, max((depth(i) for i in range(len(contours))), default=0)

CASES = {"blobs": (7, 96, 128, 6.0, 0.55), "lace": (11, 120, 120, 2.2, 0.45),
         "nested": (None, 90, 90, 0, 0), "edges": (23, 64, 80, 4.0, 0.35), "specks": (5, 70, 70, 1.0, 0.6)}
for name, (seed, h, w, sigma, level) in CASES.items():
    if name == "nested":
        # ring > hole > island > hole-in-island > speck: depth 4, by construction
        mask = np.zeros((h, w), np.uint8)
        for k, r in enumerate([40, 31, 22, 13, 5]):
            cv2.circle(mask, (45, 45), r, 1 - (k % 2), -1)
        mask[2:6, 2:9] = 1  # touches nothing; a second top-level object
    else:
        mask = make(seed, h, w, sigma, level)
    items, depth = trace(mask)
    json.dump({"name": name, "width": int(mask.shape[1]), "height": int(mask.shape[0]),
               "max_depth": depth, "polygons": items,
               "mask_bits": base64.b64encode(np.packbits(mask).tobytes()).decode()},
              open(os.path.join(HERE, f"contours_{name}.json"), "w"), separators=(",", ":"))
    print(name, mask.shape, "contours", len(items), "depth", depth, "foreground", int(mask.sum()),
          "single-pixel-wide:", int(sum(len(i["points"]) < 3 for i in items)))
