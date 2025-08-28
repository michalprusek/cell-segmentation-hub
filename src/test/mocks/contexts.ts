import { vi } from 'vitest';

// Mock all React Context modules with proper implementations
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    updateProfile: vi.fn(),
    deleteAccount: vi.fn(),
    isLoading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'system' as const,
    setTheme: vi.fn(),
    resolvedTheme: 'light' as const,
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  Theme: {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system',
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    socket: {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    isConnected: false,
    connectionStatus: 'disconnected' as const,
    lastUpdate: null,
    queueStats: {
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    },
  }),
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/ModelContext', () => ({
  useModel: () => ({
    selectedModel: 'hrnet_v2' as const,
    setSelectedModel: vi.fn(),
    threshold: 0.5,
    setThreshold: vi.fn(),
    modelConfig: {
      hrnet_v2: { name: 'HRNet V2', threshold: 0.5 },
      resunet_small: { name: 'ResUNet Small', threshold: 0.5 },
      resunet_advanced: { name: 'ResUNet Advanced', threshold: 0.5 },
    },
  }),
  ModelProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/SegmentationContext', () => ({
  useSegmentation: () => ({
    polygons: [],
    setPolygons: vi.fn(),
    selectedPolygonIndex: null,
    setSelectedPolygonIndex: vi.fn(),
    editMode: 'view' as const,
    setEditMode: vi.fn(),
    isLoading: false,
    error: null,
    savePolygons: vi.fn(),
    deletePolygon: vi.fn(),
    addPolygon: vi.fn(),
    updatePolygon: vi.fn(),
  }),
  SegmentationProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock('@/contexts/CanvasContext', () => ({
  useCanvas: () => ({
    canvasRef: { current: null },
    scale: 1,
    setScale: vi.fn(),
    offset: { x: 0, y: 0 },
    setOffset: vi.fn(),
    isDragging: false,
    setIsDragging: vi.fn(),
    viewportSize: { width: 800, height: 600 },
    imageSize: { width: 1000, height: 800 },
    resetTransform: vi.fn(),
    fitToContainer: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    canvasToImage: vi.fn(point => point),
    imageToCanvas: vi.fn(point => point),
  }),
  CanvasProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Export mock factories for custom test scenarios
export const createMockAuthContext = (overrides = {}) => ({
  user: null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  refreshToken: vi.fn(),
  updateProfile: vi.fn(),
  deleteAccount: vi.fn(),
  isLoading: false,
  ...overrides,
});

export const createMockThemeContext = (overrides = {}) => ({
  theme: 'system' as const,
  setTheme: vi.fn(),
  resolvedTheme: 'light' as const,
  ...overrides,
});

export const createMockLanguageContext = (overrides = {}) => ({
  language: 'en',
  setLanguage: vi.fn(),
  t: (key: string) => key,
  ...overrides,
});

export const createMockWebSocketContext = (overrides = {}) => ({
  socket: {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  isConnected: false,
  connectionStatus: 'disconnected' as const,
  lastUpdate: null,
  queueStats: {
    total: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  },
  ...overrides,
});

export const createMockModelContext = (overrides = {}) => ({
  selectedModel: 'hrnet_v2' as const,
  setSelectedModel: vi.fn(),
  threshold: 0.5,
  setThreshold: vi.fn(),
  modelConfig: {
    hrnet_v2: { name: 'HRNet V2', threshold: 0.5 },
    resunet_small: { name: 'ResUNet Small', threshold: 0.5 },
    resunet_advanced: { name: 'ResUNet Advanced', threshold: 0.5 },
  },
  ...overrides,
});
