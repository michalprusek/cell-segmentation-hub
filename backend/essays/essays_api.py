"""Automated Essays worker — thin FastAPI job runner over AutomatedEssaysModule.

The Node backend stages an uploaded folder of ``.nd2`` wells onto the shared
uploads volume, then POSTs here. This service runs the module's ``evaluate.py``
as a subprocess (one job at a time), honouring a passive GPU guard so a batch
never OOMs interactive segmentation on the shared A5000, and writes a
``status.json`` next to the output dir that the backend polls.

It has NO auth layer — like the ``ml`` service it is bound to loopback and only
the backend reaches it over the docker network.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
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
    "tirfName": "--tirf-name",
    "solutionName": "--solution-name",
    "limitWells": "--limit-wells",
}
_BOOL_FLAGS = {"noOverlays": "--no-overlays", "noJson": "--no-json"}

_INFO_TOTAL = re.compile(r"\[info\]\s+(\d+)\s+well file")
_OK_LINE = re.compile(r"\[ok\]\s+\((\d+)/(\d+)\)\s+(\S+):\s+(\d+)\s+MT")
# evaluate.py resolves the device itself and will silently downgrade a
# `--device cuda` run to CPU when torch cannot init CUDA (nvidia-smi can
# succeed while /dev/nvidia-uvm is missing, so our own probe is not enough).
# Without this the job would keep reporting `device: cuda` while running on
# CPU — worse than the bug this file exists to surface, because the field is
# then actively wrong rather than merely unwatched.
_DEVICE_LINE = re.compile(r"\[info\]\s+device=(\S+)")

# What `evaluate.py --device` accepts and what lands in status.json.
# Anything else here becomes an invalid CLI argument, so the degraded
# case is reported via a separate flag rather than a third value.
Device = Literal["cuda", "cpu"]

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
    """Outcome of one nvidia-smi query.

    ``degraded`` is the whole point of this type. A CPU run because the host
    has no GPU is normal; a CPU run because a GPU-declared container lost its
    card is the incident that hid for weeks behind a ``device: cpu`` field
    nobody watched — one 180-well job took 36 h on CPU on 2026-07-27 where the
    same-sized job had taken 1 h 20 m on GPU on 07-08. Returning a bare
    ``int | None`` collapses the two, and every caller then has to guess which
    one it got — so the probe reports it instead.
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
            text=True, timeout=15,
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


def _await_gpu(job_id: str, out_dir: str) -> tuple[Device, bool]:
    """Wait until the GPU has room, else fall back to CPU.

    Returns ``(device, degraded)``. ``device`` is what goes on the command line,
    so it stays within evaluate.py's two accepted values; ``degraded`` says
    whether landing on CPU was a fault rather than the intent, which is the
    distinction the user cannot otherwise make from a bare "CPU" badge.

    Every CPU exit that was not the operator's intent gets a log line. The
    timeout one matters most in practice: the card is shared with the ml
    service and Maptimize, so "GPU healthy but never free enough" is a far more
    ordinary way to end up on CPU than the driver disappearing.
    """
    probe = _gpu_free_mib()
    if probe.free_mib is None:
        if probe.degraded:
            print(f"[essays] job {job_id}: GPU unreachable, running on CPU",
                  file=sys.stderr, flush=True)
        return "cpu", probe.degraded
    need = int(GPU_MIN_FREE_GB * 1024)
    deadline = time.monotonic() + GPU_WAIT_TIMEOUT_S
    waited = False
    free = probe.free_mib
    while True:
        if free >= need:
            return "cuda", False
        if time.monotonic() >= deadline:
            # Never block a job forever — a slow CPU run beats a stuck queue.
            print(f"[essays] job {job_id}: GPU still below {need} MiB free "
                  f"after {GPU_WAIT_TIMEOUT_S:.0f}s (last saw {free} MiB) — "
                  "running on CPU, which is far slower. Check for a stuck CUDA "
                  "process if this repeats.", file=sys.stderr, flush=True)
            return "cpu", True
        if not waited:
            waited = True
            _set_status(job_id, out_dir, state="waiting_gpu",
                        message=f"waiting for GPU ({free} MiB free, need {need})")
        time.sleep(GPU_POLL_S)
        probe = _gpu_free_mib()
        if probe.free_mib is None:
            print(f"[essays] job {job_id}: GPU vanished mid-wait, running on "
                  "CPU", file=sys.stderr, flush=True)
            return "cpu", True
        free = probe.free_mib


def _build_cmd(req: ProcessRequest, device: str) -> list[str]:
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

        device, degraded = _await_gpu(job_id, out_dir)
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        _set_status(job_id, out_dir, state="running", device=device,
                    deviceDegraded=degraded, progress=0,
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
                device = m.group(1)
                _set_status(job_id, out_dir, device=device,
                            deviceDegraded=True)
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
        code = proc.wait()
        if code == 0:
            _set_status(job_id, out_dir, state="completed", progress=100)
        else:
            _set_status(job_id, out_dir, state="failed",
                        error=f"evaluate.py exited with code {code}")
    except Exception as e:  # noqa: BLE001 — surface any failure to the backend
        _set_status(job_id, out_dir, state="failed", error=str(e))


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
    somebody to go looking. Reporting it on /health puts the degradation in
    front of the container healthcheck, ``make health``, and any Prometheus
    scrape, so it can be noticed without anyone reading logs.

    ``status`` stays "ok" when degraded: the worker is genuinely serving, just
    slowly, and flipping it would make docker restart a container that is
    working. The distinction lives in ``gpu``.
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
