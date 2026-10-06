/** Requests per key per minute. Inference endpoints add their own limits. */
export const V1_RATE_LIMIT_PER_MINUTE = 120;

/** Requests per IP per minute, counted before authentication. */
export const V1_UNAUTHENTICATED_LIMIT_PER_MINUTE = 600;

/**
 * Pixels a synchronous `/segment` request accepts: 4096 x 4096. A synchronous
 * request holds a connection for the whole inference, and inference is
 * serial across the entire deployment (one GPU, one lock). The slowest model
 * takes about 15 s at 2048^2 and about 150 s at 6657^2 (measured, A5000 —
 * see the note in `backend/segmentation/api/routes.py`), so 4096^2 keeps the
 * worst case near a minute. Larger frames go to `/jobs`.
 */
export const SYNC_MAX_PIXELS = 4096 * 4096;
