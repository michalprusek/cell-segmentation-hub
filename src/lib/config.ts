interface AppConfig {
  apiBaseUrl: string;
  mlServiceUrl: string;
  wsUrl: string;
}

const config: AppConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  mlServiceUrl: import.meta.env.VITE_ML_SERVICE_URL || 'http://localhost:8000',
  wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:3001',
};

export default config;

export const { apiBaseUrl, mlServiceUrl, wsUrl } = config;
