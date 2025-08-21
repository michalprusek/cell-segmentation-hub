interface AppConfig {
  apiBaseUrl: string;
  mlServiceUrl: string;
  wsUrl: string;
}

/**
 * Validates that an environment variable is defined and not empty
 * @param name - Name of the environment variable
 * @param value - Value of the environment variable
 * @returns The validated value
 * @throws Error if the value is missing or empty
 */
function validateEnvVar(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Derives the WebSocket URL from an HTTP(S) URL
 * @param httpUrl - The HTTP(S) URL to convert
 * @returns The WebSocket URL (ws:// or wss://)
 */
function deriveWebSocketUrl(httpUrl: string): string {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  } catch (error) {
    // Fallback for invalid URLs - simple string replacement
    return httpUrl.replace(/^https?:/, match =>
      match === 'https:' ? 'wss:' : 'ws:'
    );
  }
}

/**
 * Application configuration loaded from environment variables
 *
 * Required environment variables:
 * - VITE_API_BASE_URL or VITE_API_URL: Backend API base URL
 * - VITE_ML_SERVICE_URL: ML service URL
 *
 * Optional environment variables:
 * - VITE_WS_URL: WebSocket URL (derived from API URL if not provided)
 */
const config: AppConfig = {
  // API Base URL - prefer VITE_API_BASE_URL, fallback to VITE_API_URL/api
  apiBaseUrl: (() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    if (baseUrl) return baseUrl;

    const apiUrl = import.meta.env.VITE_API_URL;
    if (apiUrl) return `${apiUrl}/api`;

    throw new Error(
      'Missing required environment variable: VITE_API_BASE_URL or VITE_API_URL'
    );
  })(),

  // ML Service URL
  mlServiceUrl: validateEnvVar(
    'VITE_ML_SERVICE_URL',
    import.meta.env.VITE_ML_SERVICE_URL
  ),

  // WebSocket URL - prefer explicit VITE_WS_URL, fallback to derived from API URL
  wsUrl: (() => {
    const wsUrl = import.meta.env.VITE_WS_URL;
    if (wsUrl) return wsUrl;

    const apiUrl = import.meta.env.VITE_API_URL;
    if (apiUrl) {
      // Remove /api suffix if present and convert to WebSocket protocol
      const baseUrl = apiUrl.replace(/\/api\/?$/, '');
      return deriveWebSocketUrl(baseUrl);
    }

    throw new Error(
      'Cannot determine WebSocket URL - VITE_WS_URL or VITE_API_URL required'
    );
  })(),
};

export default config;

export const { apiBaseUrl, mlServiceUrl, wsUrl } = config;
