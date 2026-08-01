"""Tests for the Automated Essays worker's decision logic.

This file exists because the worker had none, while the TypeScript half of the
same feature had five. All the state logic lives here: which device a job gets,
whether landing on CPU was a fault or mere contention, and whether a run that
exited 0 was actually complete.

Everything below runs with plain pytest and monkeypatch — no GPU, no cloned
module, no checkpoint. The GPU is precisely the thing being mocked, so the
CLAUDE.md exclusion for "tests requiring infrastructure not gated on
availability" does not reach these.

Run: pytest backend/essays/tests/ (see the recipe in the module docstring of
backend/segmentation/tests/test_microtubule_model.py for the container form).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

essays_api = pytest.importorskip("essays_api")


@pytest.fixture(autouse=True)
def _no_status_writes(monkeypatch, tmp_path):
    """Keep _set_status in memory — these tests are about decisions, not I/O."""
    written: list[dict] = []
    monkeypatch.setattr(
        essays_api, "_set_status",
        lambda job_id, out_dir, **f: written.append({"jobId": job_id, **f}))
    essays_api._written = written  # type: ignore[attr-defined]
    return written


def _no_sleep(monkeypatch):
    monkeypatch.setattr(essays_api.time, "sleep", lambda _s: None)


# --- _gpu_free_mib: the four outcomes -------------------------------------

def test_probe_quiet_on_a_genuinely_cpu_only_host(monkeypatch, capsys):
    """No nvidia-smi and no NVIDIA_VISIBLE_DEVICES is expected, not a fault."""
    monkeypatch.setattr(essays_api.shutil, "which", lambda _n: None)
    monkeypatch.delenv("NVIDIA_VISIBLE_DEVICES", raising=False)

    probe = essays_api._gpu_free_mib()

    assert probe == (None, False)
    assert capsys.readouterr().err == ""


def test_probe_flags_a_missing_nvidia_smi_in_a_gpu_declared_container(
        monkeypatch, capsys):
    """nvidia-smi is hook-injected, not in the image.

    So its absence inside a `runtime: nvidia` container means the hook did not
    run — a fault, even though the same condition on a plain host is normal.
    """
    monkeypatch.setattr(essays_api.shutil, "which", lambda _n: None)
    monkeypatch.setenv("NVIDIA_VISIBLE_DEVICES", "all")

    probe = essays_api._gpu_free_mib()

    assert probe.free_mib is None and probe.degraded is True
    assert "hook did not inject" in capsys.readouterr().err


def test_probe_reports_free_vram(monkeypatch):
    monkeypatch.setattr(essays_api.shutil, "which", lambda _n: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(essays_api.subprocess, "check_output",
                        lambda *_a, **_k: "20480\n")

    assert essays_api._gpu_free_mib() == (20480, False)


def test_probe_flags_a_failing_nvidia_smi(monkeypatch, capsys):
    monkeypatch.setattr(essays_api.shutil, "which", lambda _n: "/usr/bin/nvidia-smi")

    def _boom(*_a, **_k):
        raise subprocess.CalledProcessError(255, "nvidia-smi")

    monkeypatch.setattr(essays_api.subprocess, "check_output", _boom)

    probe = essays_api._gpu_free_mib()

    assert probe.free_mib is None and probe.degraded is True
    assert "nvidia-smi is unusable" in capsys.readouterr().err


def test_probe_can_be_silenced_for_pollers(monkeypatch, capsys):
    """/health polls every 30 s; a broken GPU must not log 2 880 times a day."""
    monkeypatch.setattr(essays_api.shutil, "which", lambda _n: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(essays_api.subprocess, "check_output",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("x")))

    probe = essays_api._gpu_free_mib(warn=False)

    assert probe.degraded is True
    assert capsys.readouterr().err == ""


# --- _await_gpu: device + reason, per exit --------------------------------

def _probe(monkeypatch, *results):
    """Feed _await_gpu a scripted sequence of probe outcomes."""
    seq = list(results)
    monkeypatch.setattr(
        essays_api, "_gpu_free_mib",
        lambda warn=True: seq.pop(0) if len(seq) > 1 else seq[0])


def test_await_gpu_returns_cuda_when_there_is_room(monkeypatch):
    _probe(monkeypatch, essays_api.GpuProbe(20480, False))

    assert essays_api._await_gpu("j", "/out") == ("cuda", None)


def test_await_gpu_is_quiet_on_a_cpu_only_host(monkeypatch, capsys):
    _probe(monkeypatch, essays_api.GpuProbe(None, False))

    assert essays_api._await_gpu("j", "/out") == ("cpu", None)
    assert capsys.readouterr().err == ""


def test_await_gpu_reports_an_unreachable_gpu_as_a_fault(monkeypatch, capsys):
    _probe(monkeypatch, essays_api.GpuProbe(None, True))

    assert essays_api._await_gpu("j", "/out") == ("cpu", "fault")
    assert "GPU unreachable" in capsys.readouterr().err


def test_await_gpu_calls_a_busy_card_busy_not_broken(monkeypatch, capsys):
    """The distinction this whole change exists for.

    A shared card that never frees 13 GiB is doing its job. Reporting it as a
    fault put "please report this" on the most ordinary CPU exit there is, while
    /health in the same container said the GPU was fine.
    """
    _no_sleep(monkeypatch)
    monkeypatch.setattr(essays_api, "GPU_WAIT_TIMEOUT_S", 0.0)
    _probe(monkeypatch, essays_api.GpuProbe(1024, False))

    device, reason = essays_api._await_gpu("j", "/out")

    assert (device, reason) == ("cpu", "busy")
    err = capsys.readouterr().err
    assert "still below" in err and "unreachable" not in err


def test_await_gpu_treats_a_mid_wait_disappearance_as_a_fault(monkeypatch, capsys):
    """It answered a moment ago, so vanishing is a fault regardless of env."""
    _no_sleep(monkeypatch)
    _probe(monkeypatch,
           essays_api.GpuProbe(1024, False),      # first: busy, so we wait
           essays_api.GpuProbe(None, True))       # then: gone
    monkeypatch.setattr(essays_api, "GPU_WAIT_TIMEOUT_S", 3600.0)

    assert essays_api._await_gpu("j", "/out") == ("cpu", "fault")
    assert "vanished mid-wait" in capsys.readouterr().err


# --- /health --------------------------------------------------------------

@pytest.mark.parametrize("probe,expected", [
    (essays_api.GpuProbe(20480, False), "ok"),
    (essays_api.GpuProbe(None, False), "none"),
    (essays_api.GpuProbe(None, True), "unreachable"),
])
def test_health_maps_every_probe_state(monkeypatch, probe, expected):
    monkeypatch.setattr(essays_api, "_gpu_free_mib", lambda warn=True: probe)

    body = essays_api.health()

    assert body["gpu"] == expected
    assert body["gpuFreeMib"] == probe.free_mib
    # Deliberately still "ok" when degraded: the worker IS serving, just slowly.
    assert body["status"] == "ok"


def test_health_does_not_spam_the_log(monkeypatch):
    """The poller must pass warn=False, or a broken GPU floods the log."""
    seen: list[bool] = []
    monkeypatch.setattr(
        essays_api, "_gpu_free_mib",
        lambda warn=True: seen.append(warn) or essays_api.GpuProbe(None, True))

    essays_api.health()

    assert seen == [False]


# --- output parsing: the module's own accounting ---------------------------

def test_device_line_matches_the_modules_real_output():
    """Pinned against the literal line evaluate.py prints."""
    m = essays_api._DEVICE_LINE.search(
        "[info] device=cpu  threshold=0.5  mt_width=3 bg_gap=2 bg_width=4")
    assert m and m.group(1) == "cpu"
    # ...and must not swallow the well-count line the other regex needs.
    assert not essays_api._DEVICE_LINE.search(
        "[info] 180 well file(s) to process from /in")
    # ...nor the channel-roles line added alongside the IRM segmentation fix.
    # Three [info] lines now share this stream; only one carries the device, and
    # a device parsed out of the wrong one would put a false value in the UI.
    # Literal copied from a real run.
    channels = ("[info] segmenting channel ~'irm', measuring intensity on "
                "channel ~'tirf', solution channel ~'insol,in sol,solution'")
    assert not essays_api._DEVICE_LINE.search(channels)
    assert not essays_api._INFO_TOTAL.search(channels)
    assert not essays_api._OK_LINE.search(channels)
    assert not essays_api._DIAG_LINE.search(channels)


@pytest.mark.parametrize("line,n_fail", [
    ("[done] 720 positions, 51553 microtubules, 0 failures in 12.3 min", 0),
    ("[done] 4 positions, 12 microtubules, 2 failures in 0.4 min", 2),
    ("[done] 1 position, 1 microtubule, 1 failure in 0.1 min", 1),
])
def test_done_line_extracts_the_failure_count(line, n_fail):
    """evaluate.py returns 0 even when wells failed; this line is the only
    machine-readable record that they did."""
    m = essays_api._DONE_LINE.search(line)
    assert m and int(m.group(3)) == n_fail


def test_exit_error_carries_the_output_that_explains_it():
    import collections

    tail = collections.deque(["Traceback (most recent call last):",
                              "ValueError: bad well"])
    msg = essays_api._exit_error(1, tail)

    assert "exited with code 1" in msg and "ValueError: bad well" in msg


def test_exit_error_without_output_is_still_readable():
    import collections

    assert essays_api._exit_error(2, collections.deque()) == \
        "evaluate.py exited with code 2"


# --- _build_cmd: the option pass-through ----------------------------------
#
# These flags are the ONLY way a caller can reach evaluate.py, so a missing
# entry in _VALUE_FLAGS is not a broken option — it is an option that silently
# runs on the module's default. `irmName` is the one that matters most: without
# it a user could not point segmentation at their IRM channel, which is the
# whole subject of the 2026-08 channel-role fix.

def _req(**options):
    return essays_api.ProcessRequest(
        jobId="job-1", inputDir="/in", outDir="/out", options=options or None)


def test_build_cmd_has_the_invariant_head():
    cmd = essays_api._build_cmd(_req(), "cuda")

    assert cmd[:2] == ["python", "evaluate.py"]
    assert cmd[cmd.index("--data") + 1] == "/in"
    assert cmd[cmd.index("--out") + 1] == "/out"
    assert cmd[cmd.index("--device") + 1] == "cuda"
    assert cmd[cmd.index("--weights") + 1] == essays_api.WEIGHTS


def test_build_cmd_passes_both_channel_roles_separately():
    cmd = essays_api._build_cmd(_req(irmName="reflect", tirfName="epi"), "cpu")

    assert cmd[cmd.index("--irm-name") + 1] == "reflect"
    assert cmd[cmd.index("--tirf-name") + 1] == "epi"


@pytest.mark.parametrize("key,flag,value,expected", [
    ("threshold", "--threshold", 0.6, "0.6"),
    ("mtWidth", "--mt-width", 7, "7"),
    ("bgGap", "--bg-gap", 2, "2"),
    ("bgWidth", "--bg-width", 4, "4"),
    ("irmName", "--irm-name", "irm", "irm"),
    ("tirfName", "--tirf-name", "tirf", "tirf"),
    ("solutionName", "--solution-name", "insol", "insol"),
    ("limitWells", "--limit-wells", 3, "3"),
])
def test_build_cmd_maps_every_value_option(key, flag, value, expected):
    cmd = essays_api._build_cmd(_req(**{key: value}), "cpu")

    assert cmd[cmd.index(flag) + 1] == expected


def test_build_cmd_omits_unset_options():
    """An absent option must not become an empty-string argument."""
    cmd = essays_api._build_cmd(_req(), "cpu")

    for flag in essays_api._VALUE_FLAGS.values():
        assert flag not in cmd
    for flag in essays_api._BOOL_FLAGS.values():
        assert flag not in cmd


def test_build_cmd_treats_bool_flags_as_presence_only():
    on = essays_api._build_cmd(_req(noOverlays=True, noJson=False), "cpu")

    assert "--no-overlays" in on and "--no-json" not in on
