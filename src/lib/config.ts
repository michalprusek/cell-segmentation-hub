interface AppConfig {
  apiBaseUrl: string;
  mlServiceUrl: string;
  wsUrl: string;
}

// Validate required environment variables
function validateEnvVar(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config: AppConfig = {
  apiBaseUrl: validateEnvVar('VITE_API_URL', import.meta.env.VITE_API_URL),
  mlServiceUrl: validateEnvVar(
    'VITE_ML_SERVICE_URL',
    import.meta.env.VITE_ML_SERVICE_URL
  ),
  wsUrl:
    import.meta.env.VITE_WS_URL ||
    (() => {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        throw new Error(
          'Cannot determine WebSocket URL - VITE_WS_URL or VITE_API_URL required'
        );
      }
      try {
        const url = new URL(apiUrl.replace('/api', ''));
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
      } catch (error) {
        // Fallback to simple string replacement for invalid URLs
        const wsUrl = apiUrl
          .replace('/api', '')
          .replace(/^https?:/, match => (match === 'https:' ? 'wss:' : 'ws:'));
        return wsUrl;
      }
    })(),
};

export default config;

export const { apiBaseUrl, mlServiceUrl, wsUrl } = config;
