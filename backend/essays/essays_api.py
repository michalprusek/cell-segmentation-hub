"""Automated Essays worker — thin FastAPI job runner over the essays module.

The Node backend stages an uploaded folder of ``.nd2`` wells onto the shared
uploads volume, then POSTs here. This service runs the module's ``evaluate.py``
(vendored at ``backend/essays/module``) as a subprocess (one job at a time),
honouring a passive GPU guard so a batch never OOMs interactive segmentation on
the shared A5000, and writes a ``status.json`` next to the output dir that the
backend polls.

It has NO auth layer — like the ``ml`` service it is bound to loopback and only
the backend reaches it over the docker network.
"""
from __future__ import annotations

import collections
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Literal, NamedTuple

from fastapi import FastAPI
from pydantic import BaseModel

MODULE_DIR = Path(os.environ.get("ESSAYS_MODULE_DIR", "/app/essays_module"))
WEIGHTS = os.environ.get("ESSAYS_WEIGHTS", "/app/mt_weights/microtubule_v7.pt")
# A microtubule-v7 forward pass on a full-frame TIRF well peaks near ~12.5 GiB
# (measured on a 1024²+ well), so the start-gate waits for that much free VRAM
# before launching, and the per-process cap sits at 0.6 (~14 GiB, matching the
# ml service's ML_MEMORY_LIMIT_GB) — high enough not to self-OOM, low enough not
# to grab the whole shared A5000.
GPU_MIN_FREE_GB = float(os.environ.get("ESSAYS_GPU_MIN_FREE_GB", "13"))
GPU_MEM_FRACTION = os.environ.get("ESSAYS_GPU_MEM_FRACTION", "0.6")
GPU_WAIT_TIMEOUT_S = float(os.environ.get("ESSAYS_GPU_WAIT_TIMEOUT_S", "1800"))
GPU_POLL_S = float(os.environ.get("ESSAYS_GPU_POLL_S", "10"))

# Module CLI options the backend may pass through, mapped to evaluate.py flags.
_VALUE_FLAGS = {
    "threshold": "--threshold",
    "mtWidth": "--mt-width",
    "bgGap": "--bg-gap",
    "bgWidth": "--bg-width",
    # Two channel roles, two flags: the module segments IRM and measures TIRF.
    "irmName": "--irm-name",
    "tirfName": "--tirf-name",
    "solutionName": "--solution-name",
    "limitWells": "--limit-wells",
}
_BOOL_FLAGS = {"noOverlays": "--no-overlays", "noJson": "--no-json"}

_INFO_TOTAL = re.compile(r"\[info\]\s+(\d+)\s+well file")
_OK_LINE = re.compile(r"\[ok\]\s+\((\d+)/(\d+)\)\s+(\S+):\s+(\d+)\s+MT")
# evaluate.py resolves the device itself and downgrades a `--device cuda` run to
# CPU when torch cannot init CUDA (nvidia-smi needs only /dev/nvidia0 +
# /dev/nvidiactl, CUDA also needs /dev/nvidia-uvm, so our own probe is not
# enough). It prints a `[warn]` we capture but did not parse, so the silence was
# in status.json: the job kept reporting `device: cuda` while running on CPU —
# worse than the bug this file exists to surface, because the field was then
# actively wrong rather than merely unwatched.
_DEVICE_LINE = re.compile(r"\[info\]\s+device=(\S+)")
# evaluate.py catches per-well read failures and per-position segmentation
# failures, counts them, prints them as [warn], and then returns 0 REGARDLESS.
# The worker checked only the exit code, so a run where most wells failed to read
# was reported as `completed, 100%` with a downloadable zip — and because the
# parse loop dropped every unmatched line, the reasons existed nowhere. For a
# scientific pipeline that is worse than crashing: a crash demands attention,
# this produces data someone trusts.
#
# The count below is still the only number we parse, but it is no longer the
# only record: evaluate.py now writes failures.csv into the output dir (and so
# into the download) naming every lost well and its exception. Echoing the
# [warn] lines to stderr stays as an operator convenience, but it is no longer
# load-bearing — that log dies with the container, which is exactly how two
# runs' failure reasons became unrecoverable in 2026-08.
_DONE_LINE = re.compile(
    r"\[done\]\s+(\d+)\s+positions?,\s+(\d+)\s+microtubules?,\s+(\d+)\s+failures?")
_DIAG_LINE = re.compile(r"\[(warn|error)\]")
# Unmatched output is kept in a bounded tail so a traceback can reach the user
# instead of only `evaluate.py exited with code 1`.
_OUTPUT_TAIL_LINES = 100

# The two values this worker ever sends (`evaluate.py` also accepts `auto` and
# `mps`, which we never use). A CPU-with-a-reason state deliberately is NOT here:
# this value goes straight onto the command line, so a third value would be an
# invalid argument — the reason travels beside it as CpuReason.
Device = Literal["cuda", "cpu"]

# Why a run that wanted the GPU ended up on CPU. "fault" is worth reporting
# (the container lost its GPU, or torch could not init CUDA); "busy" is not —
# the card is shared with the ml service and Maptimize and simply never freed
# ESSAYS_GPU_MIN_FREE_GB in time. Collapsing these into one flag made the
# ordinary case wear the incident badge, so they stay distinct all the way to
# the UI. A host with no GPU at all is neither — it gets None.
CpuReason = Literal["fault", "busy"]

app = FastAPI(title="Automated Essays Worker", version="1.0")

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_work: "queue.Queue[dict]" = queue.Queue()


class ProcessRequest(BaseModel):
    jobId: str
    inputDir: str
    outDir: str
    options: dict | None = None


def _status_path(out_dir: str) -> Path:
    # status.json sits beside the output dir (i.e. in the per-job dir) so the
    # backend can read it directly off the shared volume.
    return Path(out_dir).parent / "status.json"


def _set_status(job_id: str, out_dir: str, **fields) -> None:
    with _jobs_lock:
        state = _jobs.setdefault(job_id, {"jobId": job_id})
        state.update(fields)
        snapshot = dict(state)
    try:
        sp = _status_path(out_dir)
        sp.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file then os.replace() so the backend reconciler can
        # never read a torn/partial status.json (the write is otherwise not
        # atomic and a mid-write read would fail JSON.parse).
        tmp = sp.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(snapshot))
        os.replace(tmp, sp)
    except Exception as e:
        # In-memory status is still served, but the backend reconciles from the
        # file — surface the failure loudly (a silent miss here looks like a
        # permanently "queued" job). Most likely a shared-volume uid mismatch.
        # The backend's staleness watchdog is the safety net if this persists.
        print(f"[essays] WARN: cannot write {out_dir}/../status.json: {e}",
              file=sys.stderr, flush=True)


class GpuProbe(NamedTuple):
    """What one GPU probe found (the no-nvidia-smi branch runs no query).

    ``degraded`` is the whole point of this type, and this docstring is the one
    place the incident behind it is written down.

    A CPU run because the host has no GPU is normal. A CPU run because a
    GPU-declared container lost its card is the incident that hid for weeks
    behind a ``device: cpu`` field nobody watched: one 180-well job took 36 h on
    CPU on 2026-07-27 where the same-sized job had taken 1 h 20 m on GPU on
    07-08 (27x, though per-well work differed too, so treat it as one measured
    pair rather than a standing multiplier).

    Returning a bare ``int | None`` collapses the two and makes every caller
    guess which it got, so the probe reports it instead. Note ``degraded=False``
    means "nvidia-smi answered", not "the GPU is healthy" — it can answer while
    /dev/nvidia-uvm is gone, which is what _DEVICE_LINE exists for.
    """

    free_mib: int | None
    degraded: bool


def _gpu_free_mib(warn: bool = True) -> GpuProbe:
    """Query free VRAM, distinguishing "no GPU here" from "GPU went away".

    ``warn=False`` for pollers: /health calls this on every container
    healthcheck (30 s), and a broken GPU would otherwise emit the same warning
    2 880 times a day, burying the one line that matters. The job path keeps
    warning, and /health reports the state structurally instead.
    """
    if shutil.which("nvidia-smi") is None:
        # In THIS container that is already a fault: nvidia-smi is not in the
        # image, the nvidia runtime hook injects it along with the driver
        # userspace. Its absence means the hook did not run, even though the
        # service is declared `runtime: nvidia`. Elsewhere (a plain CPU host)
        # the env var is unset and we stay quiet.
        if os.environ.get("NVIDIA_VISIBLE_DEVICES") not in (None, "", "void"):
            if warn:
                print(
                    "[essays] WARN: NVIDIA_VISIBLE_DEVICES is set but nvidia-smi "
                    "is absent — the nvidia runtime hook did not inject the "
                    "driver userspace. Jobs will run on CPU. Recreate the "
                    "container.", file=sys.stderr, flush=True)
            return GpuProbe(None, degraded=True)
        return GpuProbe(None, degraded=False)
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free",
             "--format=csv,noheader,nounits"],
            # Must stay well under the compose healthcheck timeout (10 s):
            # /health calls this synchronously, so a longer budget here would
            # let docker kill the healthcheck and mark a serving worker
            # unhealthy instead of letting it report gpu: unreachable.
            text=True, timeout=5,
        )
        return GpuProbe(int(out.strip().splitlines()[0]), degraded=False)
    except Exception as e:
        # Usually a stripped device allowlist, but this also catches the 15 s
        # TimeoutExpired when the shared card is saturated — so name the
        # symptom, not a diagnosis the exception does not support.
        if warn:
            print(f"[essays] WARN: nvidia-smi is unusable ({e}) — jobs will run "
                  "on CPU. Most often the container lost its GPU device "
                  "permissions (recreate it); under heavy load it can also be "
                  "the query timing out.", file=sys.stderr, flush=True)
        return GpuProbe(None, degraded=True)


def _await_gpu(job_id: str, out_dir: str) -> tuple[Device, "CpuReason | None"]:
    """Wait until the GPU has room, else fall back to CPU.

    Returns ``(device, reason)``. ``device`` stays within the two values
    ``evaluate.py`` is ever sent, because it goes straight onto the command
    line. ``reason`` says *why* a GPU run became a CPU run, which is the
    distinction a bare "CPU" badge cannot make.

    Every CPU exit that wanted the GPU gets a log line; the busy one too, since
    a card that never frees up for 30 minutes is worth an operator's attention
    even though it is not the user's problem. A host with no GPU is neither and
    stays silent.
    """
    probe = _gpu_free_mib()
    if probe.free_mib is None:
        if probe.degraded:
            print(f"[essays] job {job_id}: GPU unreachable, running on CPU",
                  file=sys.stderr, flush=True)
            return "cpu", "fault"
        return "cpu", None
    need = int(GPU_MIN_FREE_GB * 1024)
    deadline = time.monotonic() + GPU_WAIT_TIMEOUT_S
    waited = False
    free = probe.free_mib
    while True:
        if free >= need:
            return "cuda", None
        if time.monotonic() >= deadline:
            # Never block a job forever — a slow CPU run beats a stuck queue.
            print(f"[essays] job {job_id}: GPU still below {need} MiB free "
                  f"after {GPU_WAIT_TIMEOUT_S:.0f}s (last saw {free} MiB) — "
                  "running on CPU, which is far slower. Check for a stuck CUDA "
                  "process if this repeats.", file=sys.stderr, flush=True)
            # Healthy card, just never free enough — not a fault to report.
            return "cpu", "busy"
        if not waited:
            waited = True
            _set_status(job_id, out_dir, state="waiting_gpu",
                        message=f"waiting for GPU ({free} MiB free, need {need})")
        time.sleep(GPU_POLL_S)
        probe = _gpu_free_mib()
        if probe.free_mib is None:
            print(f"[essays] job {job_id}: GPU vanished mid-wait, running on "
                  "CPU", file=sys.stderr, flush=True)
            return "cpu", "fault"
        free = probe.free_mib


def _build_cmd(req: ProcessRequest, device: Device) -> list[str]:
    cmd = ["python", "evaluate.py", "--data", req.inputDir, "--out", req.outDir,
           "--weights", WEIGHTS, "--device", device]
    opts = req.options or {}
    for key, flag in _VALUE_FLAGS.items():
        if opts.get(key) is not None:
            cmd += [flag, str(opts[key])]
    for key, flag in _BOOL_FLAGS.items():
        if opts.get(key):
            cmd.append(flag)
    return cmd


def _exit_error(code: int, tail: "collections.deque[str]") -> str:
    """Message for a non-zero exit, carrying the output that explains it.

    Without the tail the operator gets only the exit code and every diagnosis
    starts with a re-run — the module's traceback went to a pipe we parsed with
    three regexes and then discarded.
    """
    msg = f"evaluate.py exited with code {code}"
    return f"{msg}. Last output:\n" + "\n".join(tail) if tail else msg


def _run_job(req: ProcessRequest) -> None:
    job_id, out_dir = req.jobId, req.outDir
    # Everything runs inside the try so ANY failure (a bad input dir, an mkdir on
    # a full/read-only volume, a GPU-query error, the subprocess) marks the job
    # failed instead of escaping — an escape would kill the single worker thread
    # (see _worker) and silently deadlock the whole queue.
    try:
        if not Path(req.inputDir).is_dir():
            _set_status(job_id, out_dir, state="failed",
                        error=f"input directory not found: {req.inputDir}")
            return

        device, cpu_reason = _await_gpu(job_id, out_dir)
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        _set_status(job_id, out_dir, state="running", device=device,
                    deviceReason=cpu_reason, progress=0,
                    wellsTotal=0, wellsDone=0, positionsDone=0, mtCount=0,
                    error=None)

        env = dict(os.environ)
        if device == "cuda":
            env["ESSAYS_APPLY_GPU_CAP"] = "1"
            env["ESSAYS_GPU_MEM_FRACTION"] = GPU_MEM_FRACTION
            # expandable_segments cuts fragmentation on the shared card, which
            # the module's large TIRF frames are prone to; set before torch
            # inits CUDA.
            env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

        wells_total = 0
        n_fail: int | None = None
        tail: "collections.deque[str]" = collections.deque(
            maxlen=_OUTPUT_TAIL_LINES)
        proc = subprocess.Popen(
            _build_cmd(req, device), cwd=str(MODULE_DIR), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            m = _DEVICE_LINE.search(line)
            if m and m.group(1) != device:
                print(f"[essays] job {job_id}: module downgraded device "
                      f"{device} -> {m.group(1)}; our nvidia-smi probe said the "
                      "GPU was usable but torch could not initialise CUDA",
                      file=sys.stderr, flush=True)
                reported = m.group(1)
                if reported not in ("cuda", "cpu"):
                    # Keep the Literal honest: anything else is a contract
                    # change in the essays module, not a device we know.
                    print(f"[essays] job {job_id}: unparseable device report "
                          f"{reported!r}; keeping {device}",
                          file=sys.stderr, flush=True)
                    continue
                device = reported
                _set_status(job_id, out_dir, device=device,
                            deviceReason="fault")
                continue
            m = _INFO_TOTAL.search(line)
            if m:
                wells_total = int(m.group(1))
                _set_status(job_id, out_dir, wellsTotal=wells_total)
                continue
            m = _OK_LINE.search(line)
            if m:
                wells_done, total, _stem, mt = (int(m.group(1)), int(m.group(2)),
                                                m.group(3), int(m.group(4)))
                wells_total = wells_total or total
                with _jobs_lock:
                    pos = _jobs.get(job_id, {}).get("positionsDone", 0) + 1
                    mts = _jobs.get(job_id, {}).get("mtCount", 0) + mt
                progress = min(99, int(100 * wells_done / max(wells_total, 1)))
                _set_status(job_id, out_dir, wellsDone=wells_done,
                            positionsDone=pos, mtCount=mts, progress=progress)
                continue
            m = _DONE_LINE.search(line)
            if m:
                n_fail = int(m.group(3))
                continue
            # Anything else: keep it, and echo the module's own diagnostics so a
            # failed well leaves a trace an operator can actually read.
            tail.append(line.rstrip())
            if _DIAG_LINE.search(line):
                print(f"[essays] job {job_id}: {line.rstrip()}",
                      file=sys.stderr, flush=True)
        code = proc.wait()
        if code != 0:
            _set_status(job_id, out_dir, state="failed",
                        error=_exit_error(code, tail))
        elif n_fail:
            # Exit 0 with failures counted is a PARTIAL result. Deliberately
            # still `completed`: the run did finish and the zip is useful — one
            # bad well out of 180 must not withhold the other 179. But it is not
            # a clean success either, so the count travels in `error` and the UI
            # renders it as a warning on a completed run. Withholding the results
            # would be wrong in one direction; saying nothing was wrong in the
            # other.
            print(f"[essays] job {job_id}: module reported {n_fail} "
                  "well/position failure(s) — results are incomplete",
                  file=sys.stderr, flush=True)
            _set_status(
                job_id, out_dir, state="completed", progress=100,
                failures=n_fail,
                error=f"{n_fail} well/position failure(s) — these wells are "
                      "missing from results.csv. failures.csv in the download "
                      "names each one and why it failed.")
        else:
            _set_status(job_id, out_dir, state="completed", progress=100,
                        failures=0, error=None)
    except Exception as e:  # noqa: BLE001 — surface any failure to the backend
        # repr, not str: str(KeyError()) and str(RuntimeError()) are empty, which
        # would put a failed job in the UI with no reason at all.
        traceback.print_exc()
        _set_status(job_id, out_dir, state="failed", error=repr(e))


def _worker() -> None:
    # This is the SINGLE consumer of _work. If an exception ever escaped this
    # loop the thread would die and every future job would sit unqueued forever
    # (a silent deadlock). _run_job already catches its own failures; this is the
    # last-resort guard so nothing — not even a _set_status raise — can kill it.
    while True:
        req = _work.get()
        try:
            _run_job(req)
        except Exception as e:  # noqa: BLE001
            print(f"[essays] worker error on {getattr(req, 'jobId', '?')}: {e}",
                  file=sys.stderr, flush=True)
            try:
                _set_status(req.jobId, req.outDir, state="failed",
                            error=f"worker error: {e}")
            except Exception:
                pass
        finally:
            _work.task_done()


threading.Thread(target=_worker, daemon=True).start()


@app.get("/health")
def health() -> dict:
    """Liveness plus GPU reachability.

    The GPU state belongs here because a stderr line is only marginally better
    than the ``device: cpu`` field that went unwatched for weeks — both need
    somebody to go looking. This at least makes it one `curl`.

    Nothing consumes it yet, and it is worth being honest about that: the
    compose healthcheck only checks the status code, ``make health`` never
    contacts this service, and Prometheus scrapes ``/metrics`` (which this
    worker does not expose) with no essays job configured. Wiring one of those
    up is what would make this field earn its place.

    ``status`` stays "ok" when degraded, deliberately: an ``unhealthy`` marker
    would claim the worker is not serving, which is false — it is serving, just
    slowly. (Plain docker would not restart it either way; only Swarm acts on
    health.) The distinction lives in ``gpu``.
    """
    probe = _gpu_free_mib(warn=False)
    return {
        "status": "ok",
        "queued": _work.qsize(),
        "gpu": ("unreachable" if probe.degraded
                else "none" if probe.free_mib is None else "ok"),
        "gpuFreeMib": probe.free_mib,
    }


@app.post("/process", status_code=202)
def process(req: ProcessRequest) -> dict:
    _set_status(req.jobId, req.outDir, state="queued", progress=0, error=None)
    _work.put(req)
    return {"jobId": req.jobId, "state": "queued", "queuePosition": _work.qsize()}


@app.get("/status/{job_id}")
def status(job_id: str) -> dict:
    with _jobs_lock:
        state = _jobs.get(job_id)
        if state:
            return dict(state)
    return {"jobId": job_id, "state": "unknown"}
