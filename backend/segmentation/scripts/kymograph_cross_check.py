"""Independent kymograph cross-check.

Re-implements the kymograph algorithm from scratch and compares against
the live ``/api/segmentation/kymograph`` response. Confirms the deployed
endpoint produces the same raw-intensity values this script computes
locally — i.e. the BE→ML→PIL→scipy pipeline isn't silently transforming
the data (no interpolation, no off-by-one, no axis swap).

Usage: see ``--help`` for the full argument list. The script needs an
account credential pair (sourced from environment), a video container
id + polyline id + seed-frame index, and a postgres DSN to resolve
frame PNG paths. Run inside the ml container so the image paths
referenced in the DB resolve correctly.
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import requests
from PIL import Image as PILImage
from scipy.ndimage import map_coordinates


TARGET_WIDTH = 200


def login(base_url: str, email: str, password: str) -> str:
    r = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("accessToken") or body.get("data", {}).get("accessToken")
    if not token:
        raise SystemExit(f"login: no accessToken in {body!r}")
    return token


def fetch_app_kymograph(
    base_url: str,
    token: str,
    video_container_id: str,
    polyline_id: str,
    frame_index: int,
    source_channel: str | None = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "videoContainerId": video_container_id,
        "polylineId": polyline_id,
        "frameIndex": frame_index,
    }
    if source_channel is not None:
        payload["sourceChannel"] = source_channel
    r = requests.post(
        f"{base_url}/api/segmentation/kymograph",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("data", body)


def decode_csv(csv_b64: str) -> Tuple[List[int], np.ndarray]:
    """Decode the CSV payload returned by the API.

    Returns ``(frames, kymo)`` where ``kymo`` has shape ``(F, target_width)``
    of raw float intensities (pre-normalisation).
    """
    raw = base64.b64decode(csv_b64).decode("utf-8")
    reader = csv.reader(io.StringIO(raw))
    header = next(reader)
    assert header[0] == "frame", f"unexpected header: {header[:3]}"
    frames: List[int] = []
    rows: List[List[float]] = []
    for row in reader:
        frames.append(int(row[0]))
        rows.append([float(x) for x in row[1:]])
    return frames, np.array(rows, dtype=np.float32)


# ----------------------------------------------------------------------
# Independent reimplementation — mirrors backend/segmentation/api/tracker_kymograph.py
# but written here for cross-checking. Any divergence here vs. there is a bug.
# ----------------------------------------------------------------------


def _arc_length_resample_polyline(
    pts_rc: np.ndarray, n_samples: int
) -> np.ndarray:
    """Resample polyline to ``n_samples`` arc-length-uniform points.

    Identical contract to the BE (``_arc_length_resample_polyline`` in
    tracker_kymograph.py) — any drift here vs there is a bug.
    """
    if pts_rc.shape[0] < 2 or n_samples < 2:
        return pts_rc.astype(np.float32)
    segs = np.diff(pts_rc, axis=0)
    seg_lengths = np.sqrt(np.sum(segs * segs, axis=1))
    cum = np.concatenate([[0.0], np.cumsum(seg_lengths)])
    total = float(cum[-1])
    if total <= 0.0:
        return np.tile(pts_rc[0], (n_samples, 1)).astype(np.float32)
    targets = np.linspace(0.0, total, n_samples, dtype=np.float64)
    seg_idx = np.searchsorted(cum, targets, side="right") - 1
    seg_idx = np.clip(seg_idx, 0, len(segs) - 1)
    seg_start_cum = cum[seg_idx]
    seg_len_at = seg_lengths[seg_idx]
    local = np.where(
        seg_len_at > 0.0,
        (targets - seg_start_cum) / np.maximum(seg_len_at, 1e-12),
        0.0,
    )
    local = np.clip(local, 0.0, 1.0)[:, None]
    out = pts_rc[seg_idx] + local * segs[seg_idx]
    return out.astype(np.float32)


def compute_kymograph_independent(
    frames: List[Dict[str, Any]], target_width_cap: int = TARGET_WIDTH
) -> np.ndarray:
    """Recompute the kymograph row-by-row from frame paths + polyline geometry.

    ``frames`` is a list of dicts with keys ``frame: int``, ``image_path: str``,
    ``polyline_rc: List[List[float]]``. Returns a ``(F, n_samples)`` float32
    array of raw intensities — the SAME thing the BE puts into the CSV.
    """
    frames_sorted = sorted(frames, key=lambda f: f["frame"])
    seed_pts = np.asarray(frames_sorted[0]["polyline_rc"], dtype=np.float64)
    if seed_pts.shape[0] < 2:
        raise ValueError("seed-frame polyline has fewer than 2 vertices")
    seed_arc = float(np.sum(np.linalg.norm(np.diff(seed_pts, axis=0), axis=1)))
    n_samples = max(2, min(int(round(seed_arc)) + 1, target_width_cap))
    rows: List[np.ndarray] = []
    for f in frames_sorted:
        path = Path(f["image_path"])
        if not path.exists():
            raise FileNotFoundError(f"frame {f['frame']}: missing {path}")
        pil = PILImage.open(path)
        if pil.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
            img = np.array(pil, dtype=np.float32)
        else:
            img = np.array(pil.convert("L"), dtype=np.float32)
        pts = np.asarray(f["polyline_rc"], dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
            rows.append(np.zeros(n_samples, dtype=np.float32))
            continue
        sampled = _arc_length_resample_polyline(pts, n_samples)
        profile = map_coordinates(
            img,
            np.stack([sampled[:, 0], sampled[:, 1]]),
            order=0,
            mode="constant",
            cval=0.0,
        )
        rows.append(profile.astype(np.float32))
    return np.stack(rows, axis=0)


# ----------------------------------------------------------------------
# DB-backed input gathering (when running inside the ML container with
# postgres reachable). For host runs, the polyline + path info can be
# passed in via --input-json instead.
# ----------------------------------------------------------------------


def gather_frames_from_db(
    pg_dsn: str,
    video_container_id: str,
    polyline_id_or_trackid: str,
    upload_dir: str,
    source_channel: str,
) -> List[Dict[str, Any]]:
    """Pull the same frame bundle the BE assembles, straight from postgres.

    Frame PNG paths are built with the SAME convention the BE uses
    (``backend/src/services/kymographService.ts:framePngPath``):
    ``<upload_dir>/projects/<projectId>/images/<videoContainerId>/frames/<NNNN>/<channel>.png``.

    Polyline is matched by ``id`` or ``trackId``; first match wins.
    """
    import psycopg2  # type: ignore

    conn = psycopg2.connect(pg_dsn)
    out: List[Dict[str, Any]] = []
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT i.id, i."frameIndex", i."projectId", s.polygons
            FROM images i
            LEFT JOIN segmentations s ON s."imageId" = i.id
            WHERE i."parentVideoId" = %s
            ORDER BY i."frameIndex" ASC
            """,
            (video_container_id,),
        )
        for image_id, frame_idx, project_id, polygons_json in cur.fetchall():
            if not polygons_json or frame_idx is None:
                continue
            polys = (
                json.loads(polygons_json)
                if isinstance(polygons_json, str)
                else polygons_json
            )
            chosen = next(
                (
                    p
                    for p in polys
                    if p.get("id") == polyline_id_or_trackid
                    or p.get("trackId") == polyline_id_or_trackid
                ),
                None,
            )
            if not chosen:
                continue
            pts = [[pt["y"], pt["x"]] for pt in chosen.get("points", [])]
            if len(pts) < 2:
                continue
            img_path = (
                Path(upload_dir)
                / "projects"
                / project_id
                / "images"
                / video_container_id
                / "frames"
                / f"{int(frame_idx):04d}"
                / f"{source_channel}.png"
            )
            out.append(
                {
                    "frame": int(frame_idx),
                    "polyline_rc": pts,
                    "image_path": str(img_path),
                }
            )
    finally:
        conn.close()
    return out


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--video-container-id", required=True)
    ap.add_argument("--polyline-id", required=True)
    ap.add_argument("--frame-index", type=int, required=True)
    ap.add_argument("--source-channel", default=None)
    ap.add_argument(
        "--pg-dsn",
        required=True,
        help=(
            "Postgres DSN for the frames-bundle reconstruction. "
            "Read the credentials from your deployment .env, e.g. "
            "$PG_DSN — do NOT hardcode."
        ),
    )
    ap.add_argument(
        "--upload-dir",
        default="/app/uploads",
        help="Mount point where frame PNGs live (BE convention)",
    )
    ap.add_argument(
        "--tolerance",
        type=float,
        default=1e-3,
        help="Per-pixel max absolute diff allowed (default 1e-3)",
    )
    args = ap.parse_args()

    print(f"[1/4] login as {args.email}…")
    token = login(args.base_url, args.email, args.password)

    print("[2/4] fetching app kymograph via API…")
    app_kymo = fetch_app_kymograph(
        args.base_url,
        token,
        args.video_container_id,
        args.polyline_id,
        args.frame_index,
        args.source_channel,
    )
    frames_app, kymo_app = decode_csv(app_kymo["csvBase64"])
    print(
        f"      app csv: {kymo_app.shape[0]} frames × {kymo_app.shape[1]} px "
        f"(tracked={app_kymo.get('tracked')}, length={app_kymo.get('lengthPx')})"
    )

    print("[3/4] gathering frame bundle from postgres…")
    if not args.source_channel:
        raise SystemExit("--source-channel is required to resolve frame PNG paths")
    bundle = gather_frames_from_db(
        args.pg_dsn,
        args.video_container_id,
        args.polyline_id,
        args.upload_dir,
        args.source_channel,
    )
    print(f"      bundle: {len(bundle)} frames with polyline geometry")
    if not bundle:
        print(
            "FAIL: no frames carried a matching polyline. "
            "Pass the trackId instead of the polylineId if you want the "
            "tracked geometry; otherwise the seed-frame static line.",
            file=sys.stderr,
        )
        return 2

    print("[4/4] recomputing kymograph independently…")
    kymo_local = compute_kymograph_independent(bundle, target_width_cap=TARGET_WIDTH)
    print(f"      local : {kymo_local.shape[0]} frames × {kymo_local.shape[1]} px")

    if kymo_app.shape != kymo_local.shape:
        print(
            f"FAIL: shape mismatch — app {kymo_app.shape} vs local {kymo_local.shape}",
            file=sys.stderr,
        )
        return 1

    diff = np.abs(kymo_app - kymo_local)
    max_abs = float(diff.max())
    mean_abs = float(diff.mean())
    pct_diff = float((diff > args.tolerance).mean() * 100.0)

    print()
    print(f"max |diff|  : {max_abs:.6f}")
    print(f"mean |diff| : {mean_abs:.6f}")
    print(f"pixels above tolerance ({args.tolerance}): {pct_diff:.4f} %")

    if max_abs <= args.tolerance:
        print("PASS — app and local kymograph match within tolerance.")
        return 0
    print(
        "FAIL — divergence above tolerance. Inspect:\n"
        "  - bit-depth handling (8-bit vs 16-bit)\n"
        "  - polyline-rc orientation (row,col vs col,row)\n"
        "  - frame ordering (DB orderBy vs ML re-sort)\n"
        "  - per-channel selection (different sourceChannel)",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
