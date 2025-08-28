import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import {
  renderHook as rtlRenderHook,
  RenderHookOptions,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ModelProvider } from '@/contexts/ModelContext';

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

// Mock providers that wrap components during testing
interface AllTheProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
  initialAuthState?: {
    user?: any;
    isAuthenticated?: boolean;
    isLoading?: boolean;
  };
}

export const AllTheProviders: React.FC<AllTheProvidersProps> = ({
  children,
  queryClient,
  initialAuthState = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
  },
}) => {
  const testQueryClient = queryClient || createTestQueryClient();

  // Mock auth context value
  const mockAuthContext = {
    ...initialAuthState,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    updateProfile: vi.fn(),
    deleteAccount: vi.fn(),
  };

  // Mock theme context value
  const mockThemeContext = {
    theme: 'system' as const,
    setTheme: vi.fn(),
    resolvedTheme: 'light' as const,
  };

  // Mock language context value
  const mockLanguageContext = {
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  };

  // Mock model context value
  const mockModelContext = {
    selectedModel: 'hrnet_v2' as const,
    setSelectedModel: vi.fn(),
    threshold: 0.5,
    setThreshold: vi.fn(),
  };

  return (
    <BrowserRouter>
      <QueryClientProvider client={testQueryClient}>
        <AuthProvider value={mockAuthContext}>
          <ThemeProvider value={mockThemeContext}>
            <LanguageProvider value={mockLanguageContext}>
              <ModelProvider value={mockModelContext}>{children}</ModelProvider>
            </LanguageProvider>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

// Custom render function that includes providers
export const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    queryClient?: QueryClient;
    initialAuthState?: AllTheProvidersProps['initialAuthState'];
  }
) => {
  const { queryClient, initialAuthState, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders
        queryClient={queryClient}
        initialAuthState={initialAuthState}
      >
        {children}
      </AllTheProviders>
    ),
    ...renderOptions,
  });
};

// Custom renderHook function that includes providers
export const renderHook = <TProps, TResult>(
  hook: (props: TProps) => TResult,
  options?: RenderHookOptions<TProps> & {
    queryClient?: QueryClient;
    initialAuthState?: AllTheProvidersProps['initialAuthState'];
  }
) => {
  const { queryClient, initialAuthState, ...hookOptions } = options || {};

  return rtlRenderHook(hook, {
    wrapper: ({ children }) => (
      <AllTheProviders
        queryClient={queryClient}
        initialAuthState={initialAuthState}
      >
        {children}
      </AllTheProviders>
    ),
    ...hookOptions,
  });
};

// Enhanced user event setup
export const setupUser = () =>
  userEvent.setup({
    delay: null, // Remove delay in tests
    pointerEventsCheck: 0, // Skip pointer events check
  });

// Helper to mock form submission
export const mockFormSubmit = (onSubmit: vi.Mock) => {
  return (e: Event) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    onSubmit(data);
  };
};

// Helper to mock API errors with proper structure
export const mockApiError = (status: number, message: string) => {
  const error = new Error(message) as any;
  error.response = {
    status,
    data: { message, error: true },
    headers: {},
  };
  error.isAxiosError = true;
  return Promise.reject(error);
};

// Helper to mock successful API responses
export const mockApiSuccess = (data: any) => {
  return Promise.resolve({ data });
};

// Helper to wait for async operations in tests
export const waitFor = async (
  fn: () => void | Promise<void>,
  timeout = 1000
) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fn();
      return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
};

// Helper to create mock file objects
export const createMockFile = (
  name: string,
  content: string | ArrayBuffer = 'mock content',
  type = 'text/plain'
) => {
  const file = new File([content], name, { type });
  return file;
};

// Helper to create mock image files
export const createMockImageFile = (
  name = 'test-image.jpg',
  width = 100,
  height = 100
) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return new Promise<File>(resolve => {
    canvas.toBlob(blob => {
      if (blob) {
        const file = new File([blob], name, { type: 'image/jpeg' });
        resolve(file);
      }
    });
  });
};

// Helper to simulate drag and drop events
export const mockDragAndDrop = (
  element: HTMLElement,
  files: File[],
  user: ReturnType<typeof setupUser>
) => {
  const dataTransfer = new DataTransfer();
  files.forEach(file => {
    dataTransfer.items.add(file);
  });

  return user.upload(element, files);
};

// Helper to create mock WebSocket instance
export const createMockWebSocket = () => ({
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  removeAllListeners: vi.fn(),
});

// Helper to create mock canvas context with comprehensive methods
export const createMockCanvasContext2D = () => ({
  arc: vi.fn(),
  arcTo: vi.fn(),
  beginPath: vi.fn(),
  bezierCurveTo: vi.fn(),
  clearRect: vi.fn(),
  clip: vi.fn(),
  closePath: vi.fn(),
  createImageData: vi.fn(),
  createLinearGradient: vi.fn(),
  createPattern: vi.fn(),
  createRadialGradient: vi.fn(),
  drawImage: vi.fn(),
  ellipse: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  getImageData: vi.fn(),
  getLineDash: vi.fn(() => []),
  isPointInPath: vi.fn(() => false),
  lineTo: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  moveTo: vi.fn(),
  putImageData: vi.fn(),
  quadraticCurveTo: vi.fn(),
  rect: vi.fn(),
  restore: vi.fn(),
  rotate: vi.fn(),
  save: vi.fn(),
  scale: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  strokeText: vi.fn(),
  transform: vi.fn(),
  translate: vi.fn(),

  // Canvas state properties
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
});

// Re-export everything from testing library
export * from '@testing-library/react';
export { customRender as render };
