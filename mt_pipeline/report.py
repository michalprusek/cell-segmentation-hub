"""Output writers: results CSV, QC overlay PNGs, polyline annotation JSON.

The CSV is written incrementally (one flush per position) so a long batch run
keeps usable partial results if it is interrupted.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

# Column order for the results table (one row per microtubule). New columns are
# APPENDED, never inserted: users' downstream scripts index this CSV by column
# position as often as by name.
COLUMNS = [
    "well_id", "position", "mt_id",
    "solution_intensity_median",
    "length_px", "length_um",
    "mt_mean_intensity", "mt_std_intensity", "mt_sum_intensity",
    "bg_mean_intensity", "bg_median_intensity", "bg_sum_intensity",
    "net_mean_intensity",
    "n_px_mt", "n_px_bg",
    "source_file",
    # When the well was recorded on the microscope, ISO-8601 UTC. This is the
    # only run identifier that survives renaming, re-uploading or re-running the
    # folder, which is why it lives in the table and not just in a directory
    # name. Blank when the ND2 carries no timestamp.
    "acquired_at",
]


class CsvWriter:
    """Append-as-you-go CSV writer with a fixed header."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "w", newline="")
        self._w = csv.DictWriter(self._fh, fieldnames=COLUMNS, extrasaction="ignore")
        self._w.writeheader()
        self._fh.flush()
        self.n_rows = 0

    def write_rows(self, rows: list[dict]) -> None:
        for r in rows:
            self._w.writerow(r)
        self.n_rows += len(rows)
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


def _normalize_for_display(frame: np.ndarray) -> np.ndarray:
    """Percentile-stretch (1 / 99.5) to uint8 for visualisation."""
    img = frame.astype(np.float32)
    lo, hi = np.percentile(img, [1, 99.5])
    img = np.clip((img - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    return (img * 255).astype(np.uint8)


def save_overlay(frame: np.ndarray, centerlines_rc: list[np.ndarray],
                 out_path: Path) -> None:
    """Render MT centerlines (distinct colour per instance) over ``frame``.

    Called once per channel that is worth eyeballing: over IRM it shows whether
    the segmentation matched what the model actually saw, over TIRF whether the
    measured band sits on the signal being integrated. Drawing only the latter
    is how a whole batch of TIRF-segmented runs looked plausible for weeks.
    """
    import cv2

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gray = _normalize_for_display(frame)
    rgb = np.repeat(gray[:, :, None], 3, axis=2)
    for idx, cl in enumerate(centerlines_rc):
        pts = np.asarray(cl)[:, ::-1].round().astype(np.int32)  # (row,col)->(x,y)
        hue = int((idx * 47) % 180)
        color = cv2.cvtColor(np.uint8([[[hue, 220, 255]]]),
                             cv2.COLOR_HSV2BGR)[0, 0].tolist()
        cv2.polylines(rgb, [pts.reshape(-1, 1, 2)], False, color, 1, cv2.LINE_AA)
    cv2.imwrite(str(out_path), rgb)


def save_annotation_json(well_id: str, position: int, source_file: str,
                         image_shape: tuple[int, int],
                         centerlines_rc: list[np.ndarray], rows: list[dict],
                         out_path: Path, acquired_at: str | None = None) -> None:
    """Write MT centerlines as polylines (points are ``{x, y}`` = col, row px)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    polylines = []
    for cl, row in zip(centerlines_rc, rows):
        pts = [{"x": float(c), "y": float(r)} for r, c in np.asarray(cl)]
        polylines.append({
            "mt_id": row["mt_id"],
            "class": "microtubule",
            "geometry": "polyline",
            "points": pts,
            "vertices_count": len(pts),
            "length_px": row["length_px"],
            "length_um": row["length_um"],
        })
    payload = {
        "well_id": well_id,
        "position": position,
        "source_file": source_file,
        "acquired_at": acquired_at,
        "image_size": {"width": int(image_shape[1]), "height": int(image_shape[0])},
        "num_microtubules": len(polylines),
        "polylines": polylines,
    }
    out_path.write_text(json.dumps(payload, indent=2))
