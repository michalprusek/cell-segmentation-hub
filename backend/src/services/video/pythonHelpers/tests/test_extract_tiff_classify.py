"""`classify_tiff` decides whether an upload is a colour photograph or a stack.

It exists because of one real file: a single 4104 x 2174 RGB brightfield frame
(Olympus DP28), 26.8 MB uncompressed. Over the 20 MB still-image cap the browser
routes any `.tif` to the stack extractor, which answered

    Cannot interpret TIFF axes='YXS' shape=(2174, 4104, 3); expected T[Z]CYX / TYX

The interesting cases are the ones that look like that file and are not: a
multi-sample GRAYSCALE page has the same `YXS` axes, and an RGB *sequence* has
the same photometric tag. Each rule in the classifier is the only thing standing
between one of those and being stored as a photograph, so each has its own
fixture here. Axes are what tifffile 2026.9.20 actually reports, measured in the
backend image, not what the TIFF spec suggests they should be.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

tifffile = pytest.importorskip("tifffile")

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from extract_tiff_stack import (  # noqa: E402
    UnsupportedTiffAxes,
    _load_and_resolve,
    classify_tiff,
)


def _u8(*shape):
    return np.random.default_rng(0).integers(0, 255, shape, dtype=np.uint8)


def _write(tmp_path: Path, name: str, arr: np.ndarray, **kw) -> Path:
    p = tmp_path / name
    tifffile.imwrite(str(p), arr, **kw)
    return p


@pytest.mark.parametrize(
    "name,arr,kw,axes",
    [
        ("rgb.tif", _u8(20, 30, 3), {"photometric": "rgb"}, "YXS"),
        (
            "rgb16.tif",
            _u8(20, 30, 3).astype(np.uint16) * 257,
            {"photometric": "rgb"},
            "YXS",
        ),
        (
            "rgba.tif",
            _u8(20, 30, 4),
            {"photometric": "rgb", "extrasamples": ["unassalpha"]},
            "YXS",
        ),
        # planar colour: samples lead, and the axes say so
        (
            "planar.tif",
            _u8(3, 20, 30),
            {"photometric": "rgb", "planarconfig": "separate"},
            "SYX",
        ),
        # an RGB still that happens to have been saved by ImageJ
        ("ij.tif", _u8(20, 30, 3), {"photometric": "rgb", "imagej": True}, "YXS"),
    ],
)
def test_single_colour_page_is_a_still(tmp_path, name, arr, kw, axes):
    got = classify_tiff(_write(tmp_path, name, arr, **kw))
    assert got["axes"] == axes, "fixture no longer has the layout it is named for"
    assert got["kind"] == "colour_still"


@pytest.mark.parametrize(
    "name,arr,kw,axes",
    [
        ("gray.tif", _u8(20, 30), {"photometric": "minisblack"}, "YX"),
        ("pages.tif", _u8(3, 20, 30), {"photometric": "minisblack"}, "QYX"),
        (
            "cyx.tif",
            _u8(3, 20, 30),
            {"photometric": "minisblack", "metadata": {"axes": "CYX"}},
            "CYX",
        ),
        # Same YXS axes as a photograph, but three MEASUREMENTS per pixel.
        # Only the photometric rule keeps this out.
        (
            "multisample.tif",
            _u8(20, 30, 3),
            {"photometric": "minisblack", "planarconfig": "contig"},
            "YXS",
        ),
        # Same photometric as a photograph, but a sequence of them. Only the
        # axes rule keeps these out.
        ("rgb_pages.tif", _u8(5, 20, 30, 3), {"photometric": "rgb"}, "QYXS"),
        (
            "rgb_ij_stack.tif",
            _u8(5, 20, 30, 3),
            {"photometric": "rgb", "imagej": True},
            "CYXS",
        ),
    ],
)
def test_everything_else_stays_a_stack(tmp_path, name, arr, kw, axes):
    got = classify_tiff(_write(tmp_path, name, arr, **kw))
    assert got["axes"] == axes, "fixture no longer has the layout it is named for"
    assert got["kind"] == "stack"


def test_colour_with_more_than_one_extra_sample_is_left_alone(tmp_path):
    """RGB plus two extra samples is still `YXS` and still photometric RGB, so
    only the sample count keeps it out. Nobody has measured what the image path
    does with five samples; until someone does, it is not sent there."""
    src = _write(
        tmp_path,
        "rgb_plus_two.tif",
        _u8(20, 30, 5),
        photometric="rgb",
        extrasamples=["unspecified", "unspecified"],
    )
    got = classify_tiff(src)
    assert (got["axes"], got["shape"], got["photometric"]) == ("YXS", [20, 30, 5], 2)
    assert got["kind"] == "stack"


def test_ycbcr_is_a_colour_too(tmp_path):
    """JPEG-in-TIFF, which is what a camera's "compressed TIFF" usually is,
    declares YCbCr rather than RGB. The fixture is an RGB page whose tag is
    rewritten in place: writing a real one needs `imagecodecs`, which this
    environment deliberately mirrors production in not having."""
    src = _write(tmp_path, "ycbcr.tif", _u8(20, 30, 3), photometric="rgb")
    with tifffile.TiffFile(str(src), mode="r+") as tf:
        tf.pages[0].tags["PhotometricInterpretation"].overwrite(6)
    got = classify_tiff(src)
    assert (got["axes"], got["photometric"]) == ("YXS", 6)
    assert got["kind"] == "colour_still"


def test_a_still_is_exactly_what_the_extractor_cannot_read(tmp_path):
    """The two halves must agree: what is classified as a photograph is what
    `_load_and_resolve` refuses. If the extractor ever learns to read colour,
    this fails and the routing has to be decided again rather than left to
    silently override it."""
    src = _write(tmp_path, "rgb.tif", _u8(20, 30, 3), photometric="rgb")
    assert classify_tiff(src)["kind"] == "colour_still"
    with pytest.raises(UnsupportedTiffAxes):
        _load_and_resolve(src)


def test_no_pixels_are_decoded(tmp_path, monkeypatch):
    """Header only. The backend image has no `imagecodecs`, so a compressed
    page cannot be decoded there at all — a classifier that called `asarray`
    would turn every LZW photograph into a failed upload."""

    def boom(*_a, **_k):
        raise AssertionError("classify_tiff decoded pixel data")

    src = _write(tmp_path, "rgb.tif", _u8(20, 30, 3), photometric="rgb")
    monkeypatch.setattr(tifffile.TiffFile, "asarray", boom)
    monkeypatch.setattr(tifffile.TiffPage, "asarray", boom)
    assert classify_tiff(src)["kind"] == "colour_still"


def test_cli_prints_one_json_line_and_writes_nothing(tmp_path):
    src = _write(tmp_path, "rgb.tif", _u8(20, 30, 3), photometric="rgb")
    before = sorted(p.name for p in tmp_path.iterdir())
    out = subprocess.run(
        [sys.executable, str(HELPERS / "extract_tiff_stack.py"), "--classify", str(src)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(out.stdout) == {
        "kind": "colour_still",
        "axes": "YXS",
        "shape": [20, 30, 3],
        "photometric": 2,
    }
    assert sorted(p.name for p in tmp_path.iterdir()) == before
