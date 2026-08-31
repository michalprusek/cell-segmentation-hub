"""Tests for turning an annotated z-stack into labelled training examples."""
import numpy as np
import pytest

from focus_qc.zstack import IN_FOCUS, EXCLUDED, OUT_OF_FOCUS, defocus_um, label_planes


class TestDefocusUm:
    def test_is_zero_at_the_annotated_sharp_plane(self):
        assert defocus_um(n_planes=41, sharp_plane=28, z_step_um=0.1)[27] == pytest.approx(0.0)

    def test_grows_by_the_z_step_away_from_focus(self):
        d = defocus_um(n_planes=41, sharp_plane=28, z_step_um=0.1)
        assert d[26] == pytest.approx(0.1)
        assert d[31] == pytest.approx(0.4)

    def test_rejects_a_sharp_plane_outside_the_stack(self):
        with pytest.raises(ValueError):
            defocus_um(n_planes=41, sharp_plane=42, z_step_um=0.1)

    def test_treats_the_sharp_plane_as_one_based(self):
        """The colleague's annotation counts the first plane as 1, not 0."""
        assert np.argmin(defocus_um(n_planes=41, sharp_plane=1, z_step_um=0.1)) == 0


class TestLabelPlanes:
    def _labels(self, tol=0.3, guard=0.1):
        return label_planes(n_planes=41, sharp_plane=21, z_step_um=0.1,
                            tolerance_um=tol, guard_um=guard)

    def test_marks_planes_within_the_tolerance_as_in_focus(self):
        labels = self._labels()
        assert list(labels[17:24]) == [IN_FOCUS] * 7          # planes 18..24 => |dz| <= 0.3 um

    def test_marks_planes_beyond_tolerance_plus_guard_as_out_of_focus(self):
        labels = self._labels()
        assert labels[15] == OUT_OF_FOCUS                      # plane 16, |dz| = 0.5 um
        assert labels[25] == OUT_OF_FOCUS

    def test_excludes_the_guard_band_where_the_annotation_is_uncertain(self):
        """The eyeballed sharp plane is +-1 plane at best; do not train on the boundary."""
        labels = self._labels()
        assert labels[16] == EXCLUDED                          # plane 17, |dz| = 0.4 um
        assert labels[24] == EXCLUDED

    def test_a_zero_guard_leaves_no_excluded_planes(self):
        assert EXCLUDED not in self._labels(guard=0.0)

    def test_labels_every_plane_of_the_stack(self):
        assert len(self._labels()) == 41


class TestFrameAxis:
    """The ND2 loader assumes (frame, channel, Y, X); anything else must fail loudly.

    Silently mis-indexing a differently-shaped file would score the wrong pixels
    and still return plausible numbers, which is the worst possible failure here.
    """

    def test_accepts_a_z_stack(self):
        from focus_qc.zstack import frame_axis

        assert frame_axis({"Z": 41, "C": 2, "Y": 1400, "X": 1400}) == "Z"

    def test_accepts_a_timelapse(self):
        from focus_qc.zstack import frame_axis

        assert frame_axis({"T": 120, "C": 2, "Y": 512, "X": 512}) == "T"

    def test_rejects_a_single_frame_file_with_no_frame_axis(self):
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="single frame"):
            frame_axis({"C": 2, "Y": 512, "X": 512})

    def test_rejects_a_file_with_both_time_and_z(self):
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="T.*Z|both"):
            frame_axis({"T": 10, "Z": 5, "C": 2, "Y": 512, "X": 512})

    def test_rejects_a_file_whose_image_axes_are_transposed(self):
        """(Z, C, X, Y) would be scored sideways and still look plausible."""
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="Y, X"):
            frame_axis({"Z": 3, "C": 2, "X": 5, "Y": 4})

    def test_rejects_a_file_with_no_channel_axis(self):
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="channel"):
            frame_axis({"T": 10, "Y": 512, "X": 512})

    def test_names_the_actual_layout_in_the_error(self):
        """The message has to be actionable without opening the file in Fiji."""
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="T.*Z.*C.*Y.*X"):
            frame_axis({"T": 10, "Z": 5, "C": 2, "Y": 512, "X": 512})


class TestPlanesFromArray:
    """Frame iteration, separated from file reading so the guards are testable."""

    SIZES = {"Z": 3, "C": 2, "Y": 4, "X": 5}
    NAMES = ["IRM", "TIRF 488"]

    def _specs(self):
        from focus_qc.detect import ChannelSpec

        return (ChannelSpec("IRM", "irm"), ChannelSpec("TIRF 488", "fluor"))

    def _array(self):
        return np.arange(3 * 2 * 4 * 5).reshape(3, 2, 4, 5)

    def test_yields_one_dict_per_frame(self):
        from focus_qc.zstack import planes_from_array

        planes = list(planes_from_array(self._array(), self.SIZES, self.NAMES, self._specs()))
        assert len(planes) == 3
        assert set(planes[0]) == {"IRM", "TIRF 488"}

    def test_maps_each_channel_name_to_its_own_slice(self):
        from focus_qc.zstack import planes_from_array

        array = self._array()
        planes = list(planes_from_array(array, self.SIZES, self.NAMES, self._specs()))
        assert np.array_equal(planes[1]["IRM"], array[1, 0])
        assert np.array_equal(planes[1]["TIRF 488"], array[1, 1])

    def test_follows_the_file_channel_order_not_the_spec_order(self):
        """If the ND2 stores channels in the other order, the names must still track."""
        from focus_qc.zstack import planes_from_array

        array = self._array()
        swapped = ["TIRF 488", "IRM"]
        planes = list(planes_from_array(array, self.SIZES, swapped, self._specs()))
        assert np.array_equal(planes[0]["IRM"], array[0, 1])
        assert np.array_equal(planes[0]["TIRF 488"], array[0, 0])

    def test_refuses_a_layout_the_indexing_does_not_match(self):
        """This is the wiring that stops a mis-shaped file being scored silently."""
        from focus_qc.zstack import planes_from_array

        bad = {"T": 3, "Z": 2, "C": 2, "Y": 4, "X": 5}
        with pytest.raises(ValueError):
            list(planes_from_array(self._array(), bad, self.NAMES, self._specs()))

    def test_reports_a_declared_channel_the_file_does_not_have(self):
        from focus_qc.zstack import planes_from_array

        with pytest.raises(KeyError, match="TIRF 488"):
            list(planes_from_array(self._array(), self.SIZES, ["IRM", "other"], self._specs()))


class TestFrameAxisIsRestrictedByName:
    """A multipoint file iterated as a focus series is the silent-wrong-answer case.

    (P, C, Y, X) has the same *shape* as a z-stack, so a layout-only check accepts
    it and scores unrelated stage positions as if they were a defocus series.
    """

    def test_rejects_a_multipoint_acquisition(self):
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError, match="P"):
            frame_axis({"P": 9, "C": 2, "Y": 512, "X": 512})

    def test_rejects_an_unrecognised_frame_axis_name(self):
        from focus_qc.zstack import frame_axis

        with pytest.raises(ValueError):
            frame_axis({"Q": 9, "C": 2, "Y": 512, "X": 512})

    def test_still_accepts_the_two_axes_that_are_focus_series(self):
        from focus_qc.zstack import frame_axis

        assert frame_axis({"Z": 41, "C": 2, "Y": 8, "X": 8}) == "Z"
        assert frame_axis({"T": 41, "C": 2, "Y": 8, "X": 8}) == "T"


class TestEmptyFrameAxis:
    def test_refuses_a_file_with_no_frames(self):
        """frame_axis checks names, not lengths; a truncated acquisition has zero frames."""
        from focus_qc.detect import ChannelSpec
        from focus_qc.zstack import planes_from_array

        with pytest.raises(ValueError, match="no frames"):
            list(planes_from_array(
                np.zeros((0, 2, 4, 5)), {"T": 0, "C": 2, "Y": 4, "X": 5},
                ["IRM", "TIRF 488"],
                (ChannelSpec("IRM", "irm"), ChannelSpec("TIRF 488", "fluor")),
            ))
