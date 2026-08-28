"""Tests for the neurite/soma model (nnU-Net ResEnc-M 2D, 3 folds, 3 classes).

Four layers, in increasing cost:

1. **The sliding-window primitives** -- tile placement, the Gaussian tile weight
   and the mirroring TTA subsets. These are nnU-Net behaviours that a plausible
   rewrite silently changes (a plain ``range()`` shifts every tile; an unfloored
   Gaussian divides by zero at the tile corners), and they are pure functions, so
   they are pinned directly.

2. **Normalisation.** The model was trained on 1 - 99.5 percentile-stretched
   8-bit frames, and this service applies that stretch UNCONDITIONALLY because an
   upload carries no provenance. These tests pin both halves of that decision:
   it must be free on input that was already stretched, and it must actually
   change a raw 16-bit frame -- the second is what goes red if the stretch is
   ever dropped, because the first stays green either way.

3. **Wiring.** The registry entry, the ModelType enum, the batch config, and --
   the one that matters -- that ``/segment`` dispatches ``neurite_soma`` to
   ``predict_neurite_soma``. Without that branch the request falls through to the
   generic ImageNet-normalised single-channel path, which does not fail: it
   returns confident-looking garbage.

4. **The full pipeline**, skipped unless the ~1.6 GB weight bundle has been
   staged by ``scripts/download-neurite-soma-weights.sh``.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

WEIGHTS_DIR = SEG_ROOT / "weights" / "neurite_soma"
WEIGHTS_PRESENT = all(
    (WEIGHTS_DIR / f).is_file()
    for f in ("fold_0.pth", "fold_1.pth", "fold_2.pth", "plans.json", "dataset.json")
)


# ---------------------------------------------------------------------------
# 1. Sliding-window primitives
# ---------------------------------------------------------------------------
def test_compute_steps_places_the_last_tile_flush_with_the_edge():
    """nnU-Net's spacing, not ``range(0, extent, stride)``.

    The real stride is smaller than ``0.5 * tile`` because the last origin is
    pinned to ``extent - tile``. A plain range would put the last tile at 512 and
    run 12 px off a 1024-px axis; every tile after the first would sit somewhere
    else, and the Gaussian-weighted average would be taken over a different
    partition of the frame.
    """
    from models.neurite_soma.wrapper import compute_steps

    steps = compute_steps((1024, 700), (512, 512), 0.5)
    assert steps[0] == [0, 256, 512]
    assert steps[0][-1] == 1024 - 512
    # 700 is not a multiple of the nominal 256 stride: nnU-Net compresses to
    # 188, a plain range() would emit [0, 256, 512] and overrun by 324 px.
    assert steps[1] == [0, 188]
    assert steps[1][-1] == 700 - 512


def test_compute_steps_emits_one_origin_when_the_frame_equals_the_patch():
    from models.neurite_soma.wrapper import compute_steps

    assert compute_steps((512, 512), (512, 512), 0.5) == [[0], [0]]


def test_gaussian_tile_weight_has_no_zero_and_peaks_at_one():
    """A zero weight makes the accumulator divide by zero.

    Every pixel is covered by at least one tile; a pixel covered by EXACTLY one
    lands in ``norm`` with only that tile's weight, so a zero at the tile corner
    would be a 0/0 in ``acc /= norm``. nnU-Net floors the zeros; so must this.
    """
    torch = pytest.importorskip("torch")
    from models.neurite_soma.wrapper import compute_gaussian

    g = compute_gaussian((64, 64), 0.125, dtype=torch.float32, device="cpu").numpy()
    assert g.shape == (64, 64)
    assert float(g.max()) == pytest.approx(1.0)
    assert float(g.min()) > 0.0, "unfloored zero weight would divide by zero"
    # The floor is the smallest non-zero value, so the corners sit at the floor
    # rather than at some arbitrary epsilon.
    assert float(g[0, 0]) == pytest.approx(float(g.min()))


def test_mirror_combinations_covers_every_non_empty_subset_in_tensor_dims():
    """4 forward passes per tile: identity + 3 flips, on dims 2 and 3.

    The axes in the checkpoint are SPATIAL (0, 1); flipping dims 0 and 1 of a
    (B, C, H, W) tensor would mirror the batch and the class channel instead.
    """
    from models.neurite_soma.wrapper import mirror_combinations

    assert mirror_combinations((0, 1)) == [[2], [3], [2, 3]]
    assert mirror_combinations(()) == []
    assert mirror_combinations((0,)) == [[2]]


# ---------------------------------------------------------------------------
# 2. Normalisation -- the decision this integration turns on
# ---------------------------------------------------------------------------
def _stretch_to_uint8(a: np.ndarray) -> np.ndarray:
    """The 1 - 99.5 percentile stretch, written out independently of the wrapper."""
    lo, hi = np.percentile(a, [1.0, 99.5])
    x = np.clip((a.astype(np.float32) - lo) / max(float(hi - lo), 1e-8), 0, 1)
    return (x * 255).round().astype(np.uint8)


@pytest.fixture
def model():
    """An unloaded wrapper -- ``_preprocess`` needs no weights."""
    from models.neurite_soma import NeuriteSomaModel

    return NeuriteSomaModel()


def test_percentile_stretch_is_the_identity_on_an_already_stretched_frame(model):
    """Applying stage 1 to its own output changes nothing -- by construction.

    The stretch clips >= 1 % of pixels to 0 and >= 0.5 % to 255, so the 1.0 and
    99.5 percentiles of its output are exactly 0 and 255 and re-applying it is
    the identity map. This is what makes "always apply it" free on the CVAT
    export frames the model was trained from. Measured on the real 6657x6664
    sample: 0 of 44 362 248 pixels change and the two label maps are identical.
    """
    rng = np.random.default_rng(0)
    raw16 = (rng.gamma(2.0, 4000.0, size=(400, 400))).astype(np.uint16)
    once = _stretch_to_uint8(raw16)
    twice = _stretch_to_uint8(once)

    assert np.array_equal(once, twice)
    lo, hi = np.percentile(once, [1.0, 99.5])
    assert (lo, hi) == (0.0, 255.0)
    # ...and therefore what reaches the network is identical too.
    assert np.allclose(model._preprocess(once), model._preprocess(twice))


def test_percentile_stretch_actually_changes_a_raw_16_bit_frame(model):
    """The mutation guard for dropping stage 1.

    Skipping the stretch leaves the idempotence test above green -- it is the
    identity on already-stretched input either way. What it does NOT leave green
    is this: on a raw 16-bit frame with a long bright tail, clipping at the 99.5th
    percentile is exactly the thing that keeps the tail from inflating the std and
    flattening the faint processes. (The z-score is affine-invariant, so the
    RESCALE half of stage 1 washes out; the CLIP is the whole point.)
    """
    rng = np.random.default_rng(1)
    raw16 = (rng.gamma(2.0, 3000.0, size=(400, 400))).astype(np.uint16)
    raw16[:5, :5] = 65535  # the bright tail a real microscope frame carries

    with_stage1 = model._preprocess(raw16)
    x = raw16.astype(np.float32)
    without_stage1 = (x - x.mean()) / max(float(x.std()), 1e-8)

    assert not np.allclose(with_stage1, without_stage1, atol=1e-3), (
        "the percentile stretch is a no-op on a raw 16-bit frame -- stage 1 is "
        "not being applied"
    )
    # It must agree with pre-stretching the frame by hand, which is the property
    # that makes the unconditional application correct.
    assert np.allclose(with_stage1, model._preprocess(_stretch_to_uint8(raw16)))


def test_preprocess_is_invariant_to_an_affine_rescale(model):
    """A 16-bit frame that is exactly 257x an 8-bit one must reach the network
    identically -- this is what lets predict_neurite_soma pass through native
    bit depth instead of quantising with ``convert('L')``."""
    rng = np.random.default_rng(2)
    eight = rng.integers(0, 256, size=(200, 200), dtype=np.uint8)
    sixteen = eight.astype(np.uint16) * 257

    assert np.allclose(model._preprocess(eight), model._preprocess(sixteen), atol=1e-4)


def test_preprocess_output_is_zero_mean_unit_std(model):
    rng = np.random.default_rng(3)
    frame = rng.integers(0, 256, size=(300, 300), dtype=np.uint8)
    out = model._preprocess(frame)

    assert out.dtype == np.float32
    assert float(out.mean()) == pytest.approx(0.0, abs=1e-4)
    assert float(out.std()) == pytest.approx(1.0, abs=1e-4)


def test_preprocess_survives_a_constant_frame(model):
    """A blank tile has zero spread at both stages; neither may produce NaN.

    An all-zero network input is a legitimate answer for a blank frame; a NaN one
    poisons the whole logit accumulator and takes the rest of the frame with it.
    """
    out = model._preprocess(np.full((64, 64), 7, np.uint16))

    assert np.isfinite(out).all()
    assert float(np.abs(out).max()) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 3. Wiring
# ---------------------------------------------------------------------------
def test_model_type_enum_carries_neurite_soma():
    from api.models import ModelType

    assert ModelType.NEURITE_SOMA.value == "neurite_soma"


def test_batch_config_carries_neurite_soma():
    """``/api/v1/models`` serves these numbers, and a VRAM-budget decision reads
    them. A registry entry with no batch config silently reports the fallback."""
    config = json.loads((SEG_ROOT / "config" / "batch_sizes.json").read_text())
    entry = config["batch_configurations"]["neurite_soma"]

    assert entry["optimal_batch_size"] == 1
    assert entry["max_safe_batch_size"] == 1
    assert entry["memory_limit_mb"] >= 3600, (
        "measured 3.35 GiB reserved on a native 6657x6664 frame plus the CUDA "
        "context; a lower budget under-reserves for this model"
    )


@pytest.mark.asyncio
async def test_segment_route_dispatches_neurite_soma_to_its_own_predictor():
    """Without this branch the request falls into the generic ImageNet path.

    That path does not raise: it resizes to 1024x1024, applies ImageNet mean/std
    to a frame the model has never seen normalised that way, and sigmoids a
    3-channel logit as if it were binary. The output is polygons, so nothing
    downstream notices. This test is the reason the branch cannot be dropped by a
    refactor of the if/elif chain.
    """
    from fastapi import UploadFile
    from PIL import Image

    from api import routes

    buf = io.BytesIO()
    Image.new("L", (64, 64), color=17).save(buf, format="PNG")
    buf.seek(0)

    calls: list[tuple] = []

    class _Loader:
        device = "cpu"
        last_batch_size = 1

        def predict_neurite_soma(self, image, threshold, detect_holes):
            calls.append(("neurite_soma", threshold, detect_holes))
            return {"model_used": "neurite_soma", "polygons": [], "polylines": []}

        def predict(self, *a, **kw):  # pragma: no cover - must never be reached
            raise AssertionError(
                "neurite_soma fell through to the generic ImageNet predict path"
            )

    result = await routes.segment_image(
        file=UploadFile(file=buf, filename="frame.png"),
        model="neurite_soma",
        threshold=0.5,
        detect_holes=True,
        loader=_Loader(),
    )

    assert calls == [("neurite_soma", 0.5, True)]
    assert result["model_used"] == "neurite_soma"
    assert result["success"] is True


def test_emitted_polygons_carry_partclass_not_only_class():
    """``partClass`` is what survives the Node side; ``class`` is not.

    ``backend/src/utils/polygonValidation.ts`` passes through an explicit
    whitelist -- ``partClass | instanceId | trackId | name | complete | mtType``
    -- and ``class`` is not on it. A polygon tagged only with ``class`` reaches
    the editor with the neurite/soma distinction stripped, and nothing anywhere
    raises: the biologist just sees one undifferentiated set of shapes. This is
    the "polygon enumerative-drop" trap CLAUDE.md documents, and this test is
    what fails if the tag is dropped back to a single field.

    The network is stubbed with a hand-made label map rather than run: the
    tagging contract is the thing under test, and a real frame might legitimately
    contain no soma, which would make the assertion loop vacuous -- i.e. green
    with the field removed.
    """
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("ml.model_loader imports mamba_ssm/Triton, which need CUDA")
    from PIL import Image

    from ml.model_loader import ModelLoader

    label = np.zeros((200, 200), np.uint8)
    label[20:80, 20:80] = 1  # a neurite blob, comfortably over the 50 px minimum
    label[120:180, 120:180] = 2  # and a soma one

    class _StubNet:
        def predict(self, image_np):
            return label

    loader = ModelLoader(base_path=str(SEG_ROOT))
    # Pre-populating loaded_models makes get_model() return without touching the
    # 1.6 GB bundle, so this runs the REAL polygonisation and tagging.
    loader.loaded_models["neurite_soma"] = _StubNet()

    result = loader.predict_neurite_soma(Image.fromarray(np.zeros((200, 200), np.uint8)))

    polys = result["polygons"]
    assert len(polys) == 2, f"expected one polygon per class, got {len(polys)}"
    assert {p["partClass"] for p in polys} == {"neurite", "soma"}, (
        "polygons carry no usable partClass — the class distinction is stripped "
        "by the Node polygon validator before the editor sees it"
    )
    for poly in polys:
        assert poly["class"] == poly["partClass"]
        assert poly["type"] == "external"
    assert result["processing_info"]["num_per_class"] == {"neurite": 1, "soma": 1}
    assert len({p["id"] for p in polys}) == 2


def test_registry_entry_points_at_a_directory_bundle():
    """Unique among the models here: the weights path is a DIRECTORY.

    ``load_model`` guards on ``Path.exists()``, which is true for a directory, and
    ``get_model_info`` reports ``has_pretrained`` from the same check -- so a
    change that starts requiring a FILE would report the bundle as missing rather
    than fail loudly.
    """
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("ml.model_loader imports mamba_ssm/Triton, which need CUDA")
    from ml.model_loader import ModelLoader

    entry = ModelLoader.AVAILABLE_MODELS["neurite_soma"]
    assert entry["class"] is not None, "NeuriteSomaModel guard fired"
    assert entry["pretrained_path"] == "weights/neurite_soma"
    assert entry["finetuned_path"] == entry["pretrained_path"]
    assert not entry["pretrained_path"].endswith((".pth", ".pt"))


def test_class_ids_are_single_sourced_and_checked_against_the_checkpoint():
    """Polygon classes are assigned by integer label id.

    If a retrain renumbers the labels, every neurite comes back tagged 'soma' and
    nothing downstream can tell. ``load_weights`` compares the checkpoint's own
    ``dataset.json`` against ``EXPECTED_LABELS`` for exactly that reason; this
    pins the mapping the loader iterates and the guard that backs it.
    """
    pytest.importorskip("torch")
    from models.neurite_soma import NEURITE_SOMA_CLASSES
    from models.neurite_soma.wrapper import EXPECTED_LABELS

    assert NEURITE_SOMA_CLASSES == ((1, "neurite"), (2, "soma"))
    assert EXPECTED_LABELS == {"background": 0, "neurite": 1, "soma": 2}
    # The ids the loader labels polygons with must be the ids the guard accepts.
    assert {name: cid for cid, name in NEURITE_SOMA_CLASSES}.items() <= EXPECTED_LABELS.items()


def test_load_weights_rejects_a_checkpoint_that_renumbered_the_labels(tmp_path):
    pytest.importorskip("torch")
    from models.neurite_soma import NeuriteSomaModel

    bundle = tmp_path / "renumbered"
    bundle.mkdir()
    (bundle / "plans.json").write_text("{}")
    (bundle / "dataset.json").write_text(
        json.dumps({"channel_names": {"0": "tubulin"},
                    "labels": {"background": 0, "soma": 1, "neurite": 2}})
    )
    for fold in (0, 1, 2):
        (bundle / f"fold_{fold}.pth").write_bytes(b"")

    with pytest.raises(ValueError, match="mislabel every polygon"):
        NeuriteSomaModel().load_weights(bundle)


def test_vendored_network_library_is_not_duplicated():
    """One copy of ``dynamic_network_architectures``, shared with microtubule.

    Two copies of the microtubule model were allowed to exist once and drifted in
    opposite directions for months. This asserts the neurite/soma package did not
    reintroduce the pattern: it must have no ``vendor`` tree of its own, and the
    tree it borrows must be the microtubule one.
    """
    from models.neurite_soma import wrapper

    assert not (SEG_ROOT / "models" / "neurite_soma" / "vendor").exists()
    assert wrapper._SHARED_VENDOR == SEG_ROOT / "models" / "microtubule" / "vendor"
    assert (wrapper._SHARED_VENDOR / "dynamic_network_architectures").is_dir()


# ---------------------------------------------------------------------------
# 4. Full pipeline (needs the staged 1.6 GB bundle)
# ---------------------------------------------------------------------------
requires_weights = pytest.mark.skipif(
    not WEIGHTS_PRESENT,
    reason=f"neurite/soma bundle not staged at {WEIGHTS_DIR} "
    "(scripts/download-neurite-soma-weights.sh)",
)


@requires_weights
def test_predict_returns_a_three_class_label_map_at_native_size():
    torch = pytest.importorskip("torch")
    from models.neurite_soma import NeuriteSomaModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        pytest.skip("3 folds x 4 mirror variants on CPU is minutes per tile")

    rng = np.random.default_rng(4)
    frame = rng.integers(0, 256, size=(600, 700), dtype=np.uint8)

    m = NeuriteSomaModel().load_weights(WEIGHTS_DIR, torch.device(device))
    label = m.predict(frame)

    assert label.shape == frame.shape
    assert label.dtype == np.uint8
    assert set(np.unique(label)).issubset({0, 1, 2})
    # The checkpoint's own mirroring axes must have survived the load; an empty
    # tuple here means TTA was silently disabled and the accuracy on record no
    # longer applies.
    assert m._mirror_axes == (0, 1)
    assert m._patch == (512, 512)
    assert len(m._nets) == 3


@requires_weights
def test_predict_rejects_a_genuinely_multi_channel_frame():
    torch = pytest.importorskip("torch")
    from models.neurite_soma import NeuriteSomaModel

    if not torch.cuda.is_available():
        pytest.skip("needs CUDA")

    m = NeuriteSomaModel().load_weights(WEIGHTS_DIR, torch.device("cuda"))
    rgb = np.zeros((64, 64, 3), np.uint8)
    rgb[..., 1] = 255  # channels differ -> not a grayscale render

    with pytest.raises(ValueError, match="single tubulin channel"):
        m.predict(rgb)


def test_load_weights_names_the_staging_script_when_the_bundle_is_absent(tmp_path):
    """A missing bundle is the single most likely deploy failure for this model
    (1.6 GB that git does not carry). The error has to say how to fix it."""
    pytest.importorskip("torch")
    from models.neurite_soma import NeuriteSomaModel

    with pytest.raises(FileNotFoundError, match="download-neurite-soma-weights"):
        NeuriteSomaModel().load_weights(tmp_path / "nope")

    incomplete = tmp_path / "half"
    incomplete.mkdir()
    with pytest.raises(FileNotFoundError, match="plans.json"):
        NeuriteSomaModel().load_weights(incomplete)
