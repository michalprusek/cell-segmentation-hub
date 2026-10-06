/** Requests per key per minute. Inference endpoints add their own limits. */
export const V1_RATE_LIMIT_PER_MINUTE = 120;

/** Requests per IP per minute, counted before authentication. */
export const V1_UNAUTHENTICATED_LIMIT_PER_MINUTE = 600;
