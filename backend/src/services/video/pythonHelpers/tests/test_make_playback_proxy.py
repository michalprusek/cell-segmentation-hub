"""Tests for the 8-bit WebP playback proxy converter."""

import json
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from make_playback_proxy import (  # noqa: E402
    convert_frame,
    frame_dirs,
    main,
    map_to_8bit,
)


def write_png(path: str, samples: np.ndarray) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(samples.astype(np.uint16)).save(path)


class TestMapTo8Bit:
    def test_maps_the_range_ends_onto_the_output_ends(self):
        out = map_to_8bit(np.array([0, 2047], dtype=np.uint16), 2047)
        assert list(out) == [0, 255]

    def test_maps_the_midpoint_near_the_middle(self):
        out = map_to_8bit(np.array([1024], dtype=np.uint16), 2047)
        assert 127 <= int(out[0]) <= 128

    def test_does_not_overflow_on_bright_samples(self):
        # samples * 255 exceeds uint16 above 257; done in uint16 this wraps and
        # bright pixels come out black, which would read as dropouts.
        out = map_to_8bit(np.array([1566, 2047], dtype=np.uint16), 2047)
        assert list(out) == [195, 255]

    def test_preserves_monotonicity_across_the_whole_range(self):
        values = np.arange(0, 2048, dtype=np.uint16)
        out = map_to_8bit(values, 2047).astype(np.int32)
        assert np.all(np.diff(out) >= 0)

    def test_refuses_a_zero_range(self):
        with pytest.raises(ValueError):
            map_to_8bit(np.array([1], dtype=np.uint16), 0)


class TestConvertFrame:
    def test_writes_a_webp_next_to_the_png(self, tmp_path):
        png = str(tmp_path / "0000" / "488_nm.png")
        webp = str(tmp_path / "0000" / "488_nm.webp")
        write_png(png, np.full((32, 32), 1000))

        result = convert_frame(png, webp, 2047)

        assert result["status"] == "written"
        assert os.path.exists(webp)
        assert result["bytes"] == os.path.getsize(webp)

    def test_leaves_no_partial_file_behind(self, tmp_path):
        png = str(tmp_path / "0000" / "488_nm.png")
        webp = str(tmp_path / "0000" / "488_nm.webp")
        write_png(png, np.full((32, 32), 1000))

        convert_frame(png, webp, 2047)

        assert not os.path.exists(webp + ".partial")

    def test_refuses_to_clip_a_frame_brighter_than_the_range(self, tmp_path):
        # The whole point of the guard: this frame's brightest structures would
        # be flattened to 255 and become unmeasurable. Serve the original.
        png = str(tmp_path / "0000" / "488_nm.png")
        webp = str(tmp_path / "0000" / "488_nm.webp")
        write_png(png, np.full((32, 32), 2601))

        result = convert_frame(png, webp, 2047)

        assert result["status"] == "over-range"
        assert result["max"] == 2601
        assert not os.path.exists(webp)

    def test_does_not_redo_work(self, tmp_path):
        png = str(tmp_path / "0000" / "488_nm.png")
        webp = str(tmp_path / "0000" / "488_nm.webp")
        write_png(png, np.full((32, 32), 1000))
        convert_frame(png, webp, 2047)

        assert convert_frame(png, webp, 2047)["status"] == "skipped-exists"


class TestMain:
    def test_reports_one_line_per_frame_and_skips_uncovered_ones(
        self, tmp_path, capsys
    ):
        for i, value in enumerate([500, 900, 2601]):
            write_png(str(tmp_path / f"{i:04d}" / "488_nm.png"), np.full((16, 16), value))
        # A frame the channel does not cover at all.
        os.makedirs(tmp_path / "0003", exist_ok=True)

        main(
            [
                "--frames-dir",
                str(tmp_path),
                "--channel",
                "488_nm",
                "--range-max",
                "2047",
            ]
        )

        lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
        assert [l["frame"] for l in lines] == ["0000", "0001", "0002"]
        assert [l["status"] for l in lines] == ["written", "written", "over-range"]

    def test_frame_dirs_are_returned_in_frame_order(self, tmp_path):
        for name in ["0010", "0002", "0001"]:
            os.makedirs(tmp_path / name)
        assert frame_dirs(str(tmp_path)) == ["0001", "0002", "0010"]

    def test_a_missing_frames_dir_is_empty_rather_than_an_error(self, tmp_path):
        assert frame_dirs(str(tmp_path / "nope")) == []
