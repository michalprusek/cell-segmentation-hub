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
_DONE_LINE = re.compile(r"\[done\]\s+(\d+)\s+positions,\s+(\d+)\s+microtubules")

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
        sp.write_text(json.dumps(snapshot))
    except Exception as e:
        # In-memory status is still served, but the backend reconciles from the
        # file — surface the failure loudly (a silent miss here looks like a
        # permanently "queued" job). Most likely a shared-volume uid mismatch.
        print(f"[essays] WARN: cannot write {out_dir}/../status.json: {e}",
              file=sys.stderr, flush=True)


def _gpu_free_mib() -> int | None:
    """Free VRAM in MiB via nvidia-smi, or None if there is no usable GPU."""
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free",
             "--format=csv,noheader,nounits"],
            text=True, timeout=15,
        )
        return int(out.strip().splitlines()[0])
    except Exception:
        return None


def _await_gpu(job_id: str, out_dir: str) -> str:
    """Wait until the GPU has room, else fall back to CPU. Returns the device."""
    if _gpu_free_mib() is None:
        return "cpu"
    need = int(GPU_MIN_FREE_GB * 1024)
    deadline = time.monotonic() + GPU_WAIT_TIMEOUT_S
    waited = False
    while True:
        free = _gpu_free_mib()
        if free is None:
            return "cpu"
        if free >= need:
            return "cuda"
        if time.monotonic() >= deadline:
            # Never block a job forever — a slow CPU run beats a stuck queue.
            return "cpu"
        if not waited:
            waited = True
            _set_status(job_id, out_dir, state="waiting_gpu",
                        message=f"waiting for GPU ({free} MiB free, need {need})")
        time.sleep(GPU_POLL_S)


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
    if not Path(req.inputDir).is_dir() and not Path(req.inputDir).exists():
        _set_status(job_id, out_dir, state="failed",
                    error=f"input path not found: {req.inputDir}")
        return

    device = _await_gpu(job_id, out_dir)
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    _set_status(job_id, out_dir, state="running", device=device, progress=0,
                wellsTotal=0, wellsDone=0, positionsDone=0, mtCount=0, error=None)

    env = dict(os.environ)
    if device == "cuda":
        env["ESSAYS_APPLY_GPU_CAP"] = "1"
        env["ESSAYS_GPU_MEM_FRACTION"] = GPU_MEM_FRACTION
        # expandable_segments cuts fragmentation on the shared card, which the
        # module's large TIRF frames are prone to; set before torch inits CUDA.
        env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    wells_total = 0
    try:
        proc = subprocess.Popen(
            _build_cmd(req, device), cwd=str(MODULE_DIR), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
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
    while True:
        req = _work.get()
        try:
            _run_job(req)
        finally:
            _work.task_done()


threading.Thread(target=_worker, daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "queued": _work.qsize()}


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
