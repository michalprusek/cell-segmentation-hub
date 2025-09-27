"""
Cancel API endpoints for segmentation operations
Handles cancellation of PyTorch processing jobs
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Dict, Any
import logging
import asyncio
import torch
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

# Global registry for active jobs
active_jobs: Dict[str, Dict[str, Any]] = {}

class CancelRequest(BaseModel):
    job_id: str
    reason: str = "User requested cancellation"

class CancelResponse(BaseModel):
    success: bool
    job_id: str
    message: str
    cancelled_at: str

router = APIRouter()

@asynccontextmanager
async def job_context(job_id: str, operation_type: str = "segmentation"):
    """Context manager to track active jobs for cancellation"""
    try:
        # Register job as active
        active_jobs[job_id] = {
            "type": operation_type,
            "started_at": asyncio.get_event_loop().time(),
            "cancelled": False,
            "cancel_event": asyncio.Event()
        }
        logger.info(f"Started tracking job {job_id}")
        yield active_jobs[job_id]
    finally:
        # Clean up job from registry
        if job_id in active_jobs:
            del active_jobs[job_id]
            logger.info(f"Cleaned up job {job_id}")

def is_job_cancelled(job_id: str) -> bool:
    """Check if a job has been cancelled"""
    if job_id in active_jobs:
        return active_jobs[job_id].get("cancelled", False)
    return False

def get_cancel_event(job_id: str) -> asyncio.Event:
    """Get the cancel event for a job"""
    if job_id in active_jobs:
        return active_jobs[job_id]["cancel_event"]
    return asyncio.Event()

async def cleanup_gpu_resources():
    """Clean up GPU memory and resources"""
    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            logger.info("GPU memory cleared after cancellation")
    except Exception as e:
        logger.warning(f"Failed to clear GPU memory: {e}")

@router.post("/api/v1/cancel/{job_id}", response_model=CancelResponse)
async def cancel_segmentation(
    job_id: str,
    cancel_request: CancelRequest,
    background_tasks: BackgroundTasks
):
    """
    Cancel a running segmentation job

    Args:
        job_id: ID of the job to cancel
        cancel_request: Cancellation details
        background_tasks: Background task manager for cleanup

    Returns:
        CancelResponse with cancellation status
    """
    try:
        if job_id not in active_jobs:
            raise HTTPException(
                status_code=404,
                detail=f"Job {job_id} not found or already completed"
            )

        job_info = active_jobs[job_id]

        # Mark job as cancelled
        job_info["cancelled"] = True
        job_info["cancel_reason"] = cancel_request.reason

        # Trigger cancel event to notify job
        job_info["cancel_event"].set()

        # Schedule GPU cleanup
        background_tasks.add_task(cleanup_gpu_resources)

        logger.info(f"Job {job_id} marked for cancellation: {cancel_request.reason}")

        return CancelResponse(
            success=True,
            job_id=job_id,
            message=f"Job cancellation requested: {cancel_request.reason}",
            cancelled_at=str(asyncio.get_event_loop().time())
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel job {job_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel job: {str(e)}"
        )

@router.get("/api/v1/jobs/active")
async def get_active_jobs():
    """Get list of currently active jobs"""
    try:
        jobs_info = {}
        current_time = asyncio.get_event_loop().time()

        for job_id, job_data in active_jobs.items():
            jobs_info[job_id] = {
                "type": job_data["type"],
                "duration": current_time - job_data["started_at"],
                "cancelled": job_data["cancelled"]
            }

        return {
            "active_jobs": jobs_info,
            "total_count": len(active_jobs)
        }

    except Exception as e:
        logger.error(f"Failed to get active jobs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get active jobs: {str(e)}"
        )

@router.post("/api/v1/cancel-all")
async def cancel_all_jobs(background_tasks: BackgroundTasks):
    """Cancel all active jobs (emergency stop)"""
    try:
        cancelled_jobs = []

        for job_id, job_info in active_jobs.items():
            if not job_info["cancelled"]:
                job_info["cancelled"] = True
                job_info["cancel_reason"] = "Emergency stop - all jobs cancelled"
                job_info["cancel_event"].set()
                cancelled_jobs.append(job_id)

        # Schedule GPU cleanup
        background_tasks.add_task(cleanup_gpu_resources)

        logger.warning(f"Emergency cancellation of {len(cancelled_jobs)} jobs")

        return {
            "success": True,
            "cancelled_jobs": cancelled_jobs,
            "count": len(cancelled_jobs),
            "message": "All active jobs cancelled"
        }

    except Exception as e:
        logger.error(f"Failed to cancel all jobs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel all jobs: {str(e)}"
        )

# Export utilities for use in segmentation modules
__all__ = [
    "router",
    "job_context",
    "is_job_cancelled",
    "get_cancel_event",
    "active_jobs"
]