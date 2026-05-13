"""Shared error-response helpers for FastAPI routes.

Centralises the pattern of "log full traceback, surface a sanitised error
detail with a correlation id" so individual routes don't repeat it (and
don't accidentally leak internal paths, weight names, or library tracebacks
via the response body).
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException


def internal_error(
    logger: logging.Logger,
    context: str,
    exc: BaseException,
    status_code: int = 500,
) -> HTTPException:
    """Build a sanitised HTTPException and log the full traceback.

    Returns the HTTPException so callers can ``raise`` it. The detail given
    to the client is generic; the correlation id is the only specific
    piece of info that surfaces, enabling support to grep server logs.
    """

    correlation_id = uuid.uuid4().hex[:8]
    logger.exception("[%s] %s: %s", correlation_id, context, exc)
    return HTTPException(
        status_code=status_code,
        detail=f"Internal error (id: {correlation_id})",
    )
