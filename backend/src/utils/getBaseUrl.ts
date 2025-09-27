/**
 * Get the base URL for constructing full URLs
 * Shared utility to ensure consistency across services
 */
export function getBaseUrl(): string {
  // Priority order for base URL determination
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL;
  }

  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }

  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }

  // Default fallback for development
  return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';
}
