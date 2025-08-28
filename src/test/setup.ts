import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Import all context mocks
import './mocks/contexts';

// Set required environment variables for tests
process.env.VITE_API_URL = 'http://localhost:3001/api';
process.env.VITE_ML_SERVICE_URL = 'http://localhost:8000';
process.env.VITE_WS_URL = 'ws://localhost:3001';

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Enhanced WebSocket mock with more comprehensive functionality
class WebSocketMock {
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen(new Event('open'));
    }, 0);
  }

  send(data: string | ArrayBuffer | Blob) {
    // Mock send
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose(new CloseEvent('close'));
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === 'open' && this.readyState === WebSocket.OPEN) {
      setTimeout(() => listener(new Event('open')), 0);
    }
  }

  removeEventListener() {}
}

// Add WebSocket constants
WebSocketMock.CONNECTING = 0;
WebSocketMock.OPEN = 1;
WebSocketMock.CLOSING = 2;
WebSocketMock.CLOSED = 3;

global.WebSocket = WebSocketMock as any;

// Enhanced Canvas API mocking with comprehensive methods including WebGL
import { createMockCanvasContext } from '@/test-utils/canvasTestUtils';

// WebGL context mock
const createMockWebGLContext = () => ({
  canvas: { width: 800, height: 600 },
  drawingBufferWidth: 800,
  drawingBufferHeight: 600,
  getExtension: vi.fn(),
  getParameter: vi.fn(),
  createBuffer: vi.fn(),
  createShader: vi.fn(),
  createProgram: vi.fn(),
  createTexture: vi.fn(),
  bindBuffer: vi.fn(),
  bindTexture: vi.fn(),
  bufferData: vi.fn(),
  texImage2D: vi.fn(),
  texParameteri: vi.fn(),
  enableVertexAttribArray: vi.fn(),
  vertexAttribPointer: vi.fn(),
  useProgram: vi.fn(),
  uniformMatrix4fv: vi.fn(),
  uniform1i: vi.fn(),
  uniform1f: vi.fn(),
  uniform2f: vi.fn(),
  uniform3f: vi.fn(),
  uniform4f: vi.fn(),
  drawArrays: vi.fn(),
  drawElements: vi.fn(),
  viewport: vi.fn(),
  clear: vi.fn(),
  clearColor: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  blendFunc: vi.fn(),
  depthFunc: vi.fn(),
  cullFace: vi.fn(),
  frontFace: vi.fn(),
  getUniformLocation: vi.fn(),
  getAttribLocation: vi.fn(),
  compileShader: vi.fn(),
  shaderSource: vi.fn(),
  linkProgram: vi.fn(),
  getProgramParameter: vi.fn(() => true),
  getShaderParameter: vi.fn(() => true),
});

// Mock Canvas API with comprehensive contexts
HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
  if (contextType === '2d') {
    return createMockCanvasContext();
  }
  if (contextType === 'webgl' || contextType === 'webgl2') {
    return createMockWebGLContext();
  }
  return null;
});

// Mock canvas properties and additional methods
HTMLCanvasElement.prototype.toDataURL = vi.fn(
  () => 'data:image/png;base64,mock-data'
);
HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
  callback(new Blob(['mock-canvas-data'], { type: 'image/png' }));
});

// Mock getBoundingClientRect for all elements
Element.prototype.getBoundingClientRect = vi.fn(() => ({
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  bottom: 600,
  right: 800,
  x: 0,
  y: 0,
  toJSON: vi.fn(),
}));

// Mock requestAnimationFrame and cancelAnimationFrame
let rafId = 1;
global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  setTimeout(callback, 16);
  return rafId++;
});
global.cancelAnimationFrame = vi.fn();

// Mock performance.now
Object.defineProperty(global.performance, 'now', {
  writable: true,
  value: vi.fn(() => Date.now()),
});

// Enhanced Image constructor for testing image loading
class ImageMock {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  width = 100;
  height = 100;
  naturalWidth = 100;
  naturalHeight = 100;
  complete = false;

  constructor() {
    setTimeout(() => {
      this.complete = true;
      if (this.onload) this.onload();
    }, 0);
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === 'load' && this.complete) {
      setTimeout(() => listener(new Event('load')), 0);
    }
  }

  removeEventListener() {}
}

global.Image = ImageMock as any;

// Enhanced File, FileReader, and DataTransfer mocks for file upload testing
class FileMock {
  name: string;
  size: number;
  type: string;
  lastModified: number;

  constructor(chunks: any[], name: string, options?: { type?: string }) {
    this.name = name;
    this.size = chunks.reduce(
      (size: number, chunk: any) => size + chunk.length,
      0
    );
    this.type = options?.type || '';
    this.lastModified = Date.now();
  }

  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(0));
  }
  text() {
    return Promise.resolve('');
  }
  stream() {
    return new ReadableStream();
  }
  slice() {
    return new FileMock([], 'slice', { type: this.type });
  }
}

global.File = FileMock as any;

class FileReaderMock {
  result: string | ArrayBuffer | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onloadstart: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onprogress: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
  readyState: number = 0;

  readAsDataURL(file: Blob) {
    setTimeout(() => {
      this.result = 'data:image/png;base64,mock-data';
      this.readyState = 2;
      if (this.onload)
        this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
    }, 0);
  }

  readAsText(file: Blob) {
    setTimeout(() => {
      this.result = 'mock text content';
      this.readyState = 2;
      if (this.onload)
        this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
    }, 0);
  }

  readAsArrayBuffer(file: Blob) {
    setTimeout(() => {
      this.result = new ArrayBuffer(8);
      this.readyState = 2;
      if (this.onload)
        this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
    }, 0);
  }

  abort() {
    this.readyState = 2;
    if (this.onabort)
      this.onabort(new ProgressEvent('abort') as ProgressEvent<FileReader>);
  }
}

global.FileReader = FileReaderMock as any;

// DataTransfer and DragEvent mocks
class DataTransferMock {
  items: DataTransferItem[] = [];
  files: FileList = [] as any;
  types: string[] = [];
  effectAllowed: string = 'none';
  dropEffect: string = 'none';

  setData(format: string, data: string) {
    this.types.push(format);
  }

  getData(format: string): string {
    return '';
  }

  clearData(format?: string) {
    if (format) {
      this.types = this.types.filter(t => t !== format);
    } else {
      this.types = [];
    }
  }
}

global.DataTransfer = DataTransferMock as any;

class DragEventMock extends Event {
  dataTransfer = new DataTransferMock();

  constructor(type: string, init?: DragEventInit) {
    super(type, init);
  }
}

global.DragEvent = DragEventMock as any;

// Mock URL methods
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage with specific return values for contexts
const localStorageMock = {
  getItem: vi.fn((key: string) => {
    if (key === 'theme') return 'system';
    if (key === 'language') return 'en';
    if (key === 'access_token') return null;
    if (key === 'refresh_token') return null;
    return null;
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.sessionStorage = sessionStorageMock;

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    ...window.location,
    reload: vi.fn(),
    assign: vi.fn(),
    replace: vi.fn(),
    href: 'http://localhost:3000/',
    pathname: '/',
    search: '',
    hash: '',
  },
  writable: true,
});

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    getRandomValues: vi.fn().mockReturnValue(new Uint8Array(16)),
  },
});

// Mock DOMMatrix for canvas transformations
global.DOMMatrix = vi
  .fn()
  .mockImplementation((values?: number[] | DOMMatrix) => {
    const matrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      m11: 1,
      m12: 0,
      m13: 0,
      m14: 0,
      m21: 0,
      m22: 1,
      m23: 0,
      m24: 0,
      m31: 0,
      m32: 0,
      m33: 1,
      m34: 0,
      m41: 0,
      m42: 0,
      m43: 0,
      m44: 1,
      is2D: true,
      isIdentity: true,

      multiply: vi.fn().mockReturnThis(),
      scale: vi.fn().mockReturnThis(),
      rotate: vi.fn().mockReturnThis(),
      translate: vi.fn().mockReturnThis(),
      inverse: vi.fn().mockReturnThis(),
      transformPoint: vi.fn(point => point),
      toString: vi.fn(() => 'matrix(1, 0, 0, 1, 0, 0)'),
    };

    // Initialize with values if provided
    if (Array.isArray(values) && values.length >= 6) {
      matrix.a = values[0];
      matrix.b = values[1];
      matrix.c = values[2];
      matrix.d = values[3];
      matrix.e = values[4];
      matrix.f = values[5];
    }

    return matrix;
  }) as any;

// Enhanced react-i18next mock with comprehensive translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        // Toast messages
        'toast.unexpectedError': 'An unexpected error occurred',
        'toast.somethingWentWrong': 'Something went wrong',
        'toast.returnToHome': 'Return to Home',

        // Dashboard
        'dashboard.projects': 'Projects',
        'dashboard.totalImages': 'Total Images',
        'dashboard.storageUsed': 'Storage Used',

        // Settings
        'settings.account': 'Account',
        'settings.deleteAccount': 'Delete Account',
        'settings.profile': 'Profile',
        'settings.cancel': 'Cancel',
        'settings.deleting': 'Deleting...',
        'settings.accountDeleted': 'Account successfully deleted',
        'settings.deleteAccountError':
          'Failed to delete account. Please try again.',
        'settings.confirmDelete':
          'Confirmation text is required and must match your email address.',
        'settings.enterEmail': 'Enter your email to confirm',

        // Delete Account Dialog
        'settings.deleteAccountDialog.title': 'Delete Account',
        'settings.deleteAccountDialog.description':
          'This action cannot be undone. This will permanently delete your account and remove all of your data from our servers.',
        'settings.deleteAccountDialog.whatWillBeDeleted':
          'What will be deleted:',
        'settings.deleteAccountDialog.deleteItems.account':
          'Your user account and profile',
        'settings.deleteAccountDialog.deleteItems.projects':
          'All your projects and images',
        'settings.deleteAccountDialog.deleteItems.segmentation':
          'All segmentation data and results',
        'settings.deleteAccountDialog.deleteItems.settings':
          'Account settings and preferences',
        'settings.deleteAccountDialog.confirmationLabel':
          'Please type {0} to confirm:',
        'settings.deleteAccountDialog.confirmationPlaceholder':
          'Enter email to confirm',

        // Common
        'common.delete': 'Delete',
        'common.cancel': 'Cancel',
        'common.confirm': 'Confirm',
        'common.save': 'Save',
        'common.edit': 'Edit',
        'common.loading': 'Loading...',
        'common.close': 'Close',
        'common.ok': 'OK',
        'common.yes': 'Yes',
        'common.no': 'No',

        // Auth
        'auth.login': 'Login',
        'auth.logout': 'Logout',
        'auth.register': 'Register',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.username': 'Username',
        'auth.confirmPassword': 'Confirm Password',

        // Projects
        'projects.create': 'Create Project',
        'projects.name': 'Project Name',
        'projects.description': 'Description',
        'projects.noProjects': 'No projects found',
        'projects.createFirst': 'Create your first project',

        // Images
        'images.upload': 'Upload Images',
        'images.processing': 'Processing...',
        'images.noImages': 'No images found',
        'images.uploadFirst': 'Upload your first images',

        // Segmentation
        'segmentation.editor': 'Segmentation Editor',
        'segmentation.polygons': 'Polygons',
        'segmentation.noPolygons': 'No polygons found',
        'segmentation.startSegmentation': 'Start Segmentation',

        // Queue
        'queue.processing': 'Processing',
        'queue.queued': 'Queued',
        'queue.completed': 'Completed',
        'queue.failed': 'Failed',
        'queue.empty': 'Queue is empty',

        // Theme
        'theme.light': 'Light',
        'theme.dark': 'Dark',
        'theme.system': 'System',

        // Navigation
        'nav.dashboard': 'Dashboard',
        'nav.projects': 'Projects',
        'nav.settings': 'Settings',
        'nav.home': 'Home',
        'nav.profile': 'Profile',

        // Errors
        'error.generic': 'An error occurred',
        'error.networkError': 'Network error',
        'error.notFound': 'Not found',
        'error.unauthorized': 'Unauthorized',
        'error.forbidden': 'Forbidden',
        'error.serverError': 'Server error',

        // Validation
        'validation.required': 'This field is required',
        'validation.email': 'Please enter a valid email address',
        'validation.minLength': 'Minimum length is {0} characters',
        'validation.maxLength': 'Maximum length is {0} characters',

        // Models
        'models.hrnet': 'HRNet V2',
        'models.resunet_small': 'ResUNet Small',
        'models.resunet_advanced': 'ResUNet Advanced',
      };

      // Handle dynamic replacements like {0}, {email}, etc.
      let result = translations[key] || key;

      // Handle interpolation options
      if (options) {
        if (typeof options === 'string') {
          result = result.replace('{0}', options);
        } else if (typeof options === 'object') {
          Object.keys(options).forEach(optKey => {
            result = result.replace(`{${optKey}}`, options[optKey]);
            result = result.replace(`{0}`, options[optKey]); // Fallback for numbered placeholders
          });
        }
      }

      // Handle specific key replacements
      if (key === 'settings.deleteAccountDialog.confirmationLabel') {
        result = result.replace('{0}', 'test@example.com');
      }

      return result;
    },
    i18n: {
      changeLanguage: vi.fn(),
      language: 'en',
    },
  }),
  Trans: ({ children }: any) => children,
  I18nextProvider: ({ children }: any) => children,
}));

// Mock socket.io-client for WebSocket functionality
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  default: vi.fn(() => ({
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

// Silence console errors during tests unless explicitly testing them
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  console.error = vi.fn((message: any) => {
    // Allow through specific error patterns we want to test
    if (typeof message === 'string' && message.includes('Error Boundary')) {
      originalError(message);
    }
  });
  console.warn = vi.fn();
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

// Mock axios with enhanced responses and error handling
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    request: vi.fn(() => Promise.resolve({ data: {} })),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: {
      headers: {
        common: {},
        post: { 'Content-Type': 'application/json' },
        get: {},
        put: { 'Content-Type': 'application/json' },
        patch: { 'Content-Type': 'application/json' },
        delete: {},
      },
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      ...mockAxiosInstance,
    },
    // Add named exports for error handling
    AxiosError: class extends Error {
      response: any;
      constructor(
        message: string,
        code?: string,
        config?: any,
        request?: any,
        response?: any
      ) {
        super(message);
        this.response = response;
      }
    },
    isAxiosError: vi.fn(() => false),
  };
});

// Enhanced apiClient mock with more comprehensive responses
vi.mock('@/lib/api', () => ({
  apiClient: {
    // Authentication methods
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn().mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: true,
      },
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      },
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: false,
      },
    }),
    refreshAccessToken: vi.fn().mockResolvedValue('new-access-token'),

    // User profile methods
    getUserProfile: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      preferredModel: 'hrnet_v2',
      modelThreshold: 0.5,
      preferredLang: 'en',
      preferredTheme: 'system',
      emailVerified: true,
    }),
    updateUserProfile: vi.fn().mockResolvedValue(true),
    changePassword: vi.fn().mockResolvedValue(true),
    getUserStorageStats: vi.fn().mockResolvedValue({
      totalSize: 1024000,
      imageCount: 5,
      projectCount: 2,
      formattedSize: '1.0 MB',
    }),
    deleteAccount: vi.fn().mockResolvedValue(undefined),

    // Project methods
    getProjects: vi.fn().mockResolvedValue({
      projects: [],
      total: 0,
      page: 1,
      totalPages: 1,
    }),
    createProject: vi.fn().mockResolvedValue({
      id: 'new-project-1',
      name: 'New Project',
      userId: 'user-1',
      createdAt: new Date().toISOString(),
    }),
    getProject: vi.fn().mockResolvedValue({
      id: 'project-1',
      name: 'Test Project',
      userId: 'user-1',
      imageCount: 0,
    }),
    updateProject: vi.fn().mockResolvedValue(true),
    deleteProject: vi.fn().mockResolvedValue(undefined),

    // Image methods
    getProjectImages: vi.fn().mockResolvedValue({
      images: [],
      total: 0,
      page: 1,
      totalPages: 1,
    }),
    getProjectImagesWithThumbnails: vi.fn().mockResolvedValue([]),
    uploadImages: vi.fn().mockResolvedValue([]),
    getImage: vi.fn().mockResolvedValue({
      id: 'image-1',
      filename: 'test-image.jpg',
      width: 1000,
      height: 800,
    }),
    deleteImage: vi.fn().mockResolvedValue(undefined),

    // Segmentation methods
    requestBatchSegmentation: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getSegmentationResults: vi.fn().mockResolvedValue({
      polygons: [],
      status: 'completed',
      modelUsed: 'hrnet_v2',
    }),
    updateSegmentationResults: vi.fn().mockResolvedValue({ polygons: [] }),
    deleteSegmentationResults: vi.fn().mockResolvedValue(undefined),
    getImageWithSegmentation: vi.fn().mockResolvedValue({
      image: { id: 'image-1', filename: 'test.jpg' },
      segmentation: { polygons: [], status: 'completed' },
    }),

    // Queue management methods
    addImageToQueue: vi.fn().mockResolvedValue({ queueId: 'queue-1' }),
    addBatchToQueue: vi.fn().mockResolvedValue({ queueIds: ['queue-1'] }),
    getQueueStats: vi.fn().mockResolvedValue({
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    }),
    getQueueItems: vi.fn().mockResolvedValue([]),
    removeFromQueue: vi.fn().mockResolvedValue(undefined),

    // Generic HTTP methods
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
  default: {
    // Duplicate all methods for default export
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn().mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      },
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
    }),
    refreshAccessToken: vi.fn().mockResolvedValue('new-access-token'),
    getUserProfile: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      preferredModel: 'hrnet_v2',
      modelThreshold: 0.5,
      preferredLang: 'en',
      preferredTheme: 'system',
    }),
    updateUserProfile: vi.fn().mockResolvedValue(true),
    changePassword: vi.fn().mockResolvedValue(true),
    getUserStorageStats: vi.fn().mockResolvedValue({
      totalSize: 1024000,
      imageCount: 5,
      projectCount: 2,
      formattedSize: '1.0 MB',
    }),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    getProjects: vi.fn().mockResolvedValue({
      projects: [],
      total: 0,
      page: 1,
      totalPages: 1,
    }),
    createProject: vi.fn().mockResolvedValue({
      id: 'new-project-1',
      name: 'New Project',
      userId: 'user-1',
    }),
    getProject: vi.fn().mockResolvedValue({
      id: 'project-1',
      name: 'Test Project',
      userId: 'user-1',
    }),
    updateProject: vi.fn().mockResolvedValue(true),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    getProjectImages: vi.fn().mockResolvedValue({
      images: [],
      total: 0,
      page: 1,
      totalPages: 1,
    }),
    getProjectImagesWithThumbnails: vi.fn().mockResolvedValue([]),
    uploadImages: vi.fn().mockResolvedValue([]),
    getImage: vi.fn().mockResolvedValue({
      id: 'image-1',
      filename: 'test-image.jpg',
    }),
    deleteImage: vi.fn().mockResolvedValue(undefined),
    requestBatchSegmentation: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getSegmentationResults: vi.fn().mockResolvedValue({
      polygons: [],
      status: 'completed',
    }),
    updateSegmentationResults: vi.fn().mockResolvedValue({ polygons: [] }),
    deleteSegmentationResults: vi.fn().mockResolvedValue(undefined),
    getImageWithSegmentation: vi.fn().mockResolvedValue({
      image: { id: 'image-1', filename: 'test.jpg' },
      segmentation: { polygons: [], status: 'completed' },
    }),
    addImageToQueue: vi.fn().mockResolvedValue({ queueId: 'queue-1' }),
    addBatchToQueue: vi.fn().mockResolvedValue({ queueIds: ['queue-1'] }),
    getQueueStats: vi.fn().mockResolvedValue({
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    }),
    getQueueItems: vi.fn().mockResolvedValue([]),
    removeFromQueue: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
  // Helper to mock API errors
  mockApiError: (status: number, message: string) => {
    const error = new Error(message) as any;
    error.response = {
      status,
      data: { message, error: true },
      headers: {},
    };
    error.isAxiosError = true;
    return Promise.reject(error);
  },
}));

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    custom: vi.fn(),
  },
  Toaster: ({ children }: any) => children,
}));

// Mock React Router
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
    useLocation: vi.fn(() => ({
      pathname: '/',
      search: '',
      hash: '',
      state: null,
    })),
    useParams: vi.fn(() => ({})),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
  };
});

// Mock Lucide React icons
vi.mock('lucide-react', () => {
  const MockIcon = (props: any) => {
    return React.createElement('svg', {
      ...props,
      'data-testid': props['data-testid'] || 'mock-icon',
      className: props.className,
    });
  };

  return new Proxy(
    {},
    {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          return MockIcon;
        }
        return target[prop];
      },
    }
  );
});

// Add missing React import for icon mocking
import * as React from 'react';
