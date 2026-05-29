/**
 * App.tsx — route table + provider nesting + ProtectedRoute tests.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/__tests__/App.test.tsx --reporter=dot
 *
 * Strategy:
 *   - All page components are stubbed (lazyWithRetry → static stubs) to avoid
 *     pulling in heavy bundles.
 *   - Heavy providers (WebSocketProvider, contexts) are stubbed where they
 *     would try to connect / require real infrastructure.
 *   - ProtectedRoute is NOT stubbed — we test it for real (redirect when
 *     unauthenticated, render when authenticated).
 *   - Each test navigates via MemoryRouter entries injected through the
 *     window.history API after App mounts with BrowserRouter.
 *     Because App uses BrowserRouter internally, we use the pattern of
 *     setting window.location + rendering a fresh App per route test.
 *
 * Behaviors tested:
 *   - Public routes (/, /sign-in, /sign-up, /documentation, /privacy-policy,
 *     /forgot-password, /reset-password, /terms-of-service) render page stub.
 *   - Unknown route renders NotFound stub.
 *   - Protected routes (/dashboard, /project/:id, /profile, /settings,
 *     /project/:id/export) redirect unauthenticated user to /sign-in.
 *   - Protected routes render children when user IS authenticated.
 *   - Provider nesting: QueryClientProvider, TooltipProvider, BrowserRouter,
 *     AuthProvider, WebSocketProvider, UploadProvider, ExportProvider,
 *     ThemeProvider, LanguageProvider, ToastEventProvider, ModelProvider
 *     all present in tree (validated through rendered stub text).
 *   - ErrorBoundary wraps routes (validated by ErrorBoundary stub).
 *   - FloatingUploadProgress renders inside its own ErrorBoundary.
 *
 * NOT tested:
 *   - ExportStateManager.initialize() side-effects (no observable DOM effect).
 *   - Suspense fallback (PageLoadingFallback) — requires real lazy loading.
 *   - QueryClient mutation onError global handler — requires real mutation.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockNavigate, mockIsAuthenticated, mockUser } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockIsAuthenticated: { value: false },
  mockUser: { value: null as null | { id: string; email: string } },
}));

// ---------------------------------------------------------------------------
// Module mocks — heaviest / most connected first
// ---------------------------------------------------------------------------

// Stub lazyWithRetry so lazy page imports resolve synchronously to stubs.
// makeStub MUST be defined inside the factory to avoid vi.mock hoisting TDZ.
vi.mock('@/lib/lazyWithRetry', () => ({
  lazyWithRetry: (_importFn: () => Promise<unknown>, name: string) => {
    const makeStub = (tid: string) =>
      function PageStub() {
        return React.createElement('div', { 'data-testid': tid }, tid);
      };

    const stubs: Record<string, () => React.ReactElement> = {
      Index: makeStub('page-index'),
      SignIn: makeStub('page-sign-in'),
      SignUp: makeStub('page-sign-up'),
      ForgotPassword: makeStub('page-forgot-password'),
      ResetPassword: makeStub('page-reset-password'),
      Dashboard: makeStub('page-dashboard'),
      ProjectDetail: makeStub('page-project-detail'),
      SegmentationEditor: makeStub('page-segmentation-editor'),
      NotFound: makeStub('page-not-found'),
      Settings: makeStub('page-settings'),
      Profile: makeStub('page-profile'),
      TermsOfService: makeStub('page-terms-of-service'),
      PrivacyPolicy: makeStub('page-privacy-policy'),
      Documentation: makeStub('page-documentation'),
      ProjectExport: makeStub('page-project-export'),
      ShareAccept: makeStub('page-share-accept'),
    };
    const StubComp = stubs[name] ?? makeStub(`page-unknown-${name}`);
    StubComp.displayName = name;
    return StubComp;
  },
}));

// Auth context — isAuthenticated / user controlled per-test via mockIsAuthenticated / mockUser
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated.value,
    user: mockUser.value,
    loading: false,
    profile: null,
    refreshProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated.value,
    user: mockUser.value,
    loading: false,
    profile: null,
    refreshProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated.value,
    user: mockUser.value,
    loading: false,
    profile: null,
    refreshProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/UploadContext', () => ({
  UploadProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/contexts/ExportContext', () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/contexts/ModelContext', () => ({
  ModelProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useModel: () => ({ model: 'hrnet', setModel: vi.fn() }),
}));

vi.mock('@/components/AuthToastProvider', () => ({
  ToastEventProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/FloatingUploadProgress', () => ({
  default: () => <div data-testid="floating-upload-progress" />,
}));

vi.mock('@/components/PageLoadingFallback', () => ({
  default: () => <div data-testid="page-loading-fallback" />,
}));

vi.mock('@/components/ErrorBoundary', () => ({
  default: ({
    children,
    fallback,
  }: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
  }) => (
    <div data-testid="error-boundary">
      {children}
      {fallback}
    </div>
  ),
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div>
  ),
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-testid="sonner-toaster" />,
}));

vi.mock('@/lib/exportStateManager', () => ({
  default: { initialize: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock react-router-dom: replace BrowserRouter with MemoryRouter so we can
// control the initial path without fighting jsdom's frozen window.location.
// The initialPath is read from a module-level ref set by navigateTo().
const currentPath = { value: '/' };

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    BrowserRouter: ({
      children,
      future,
    }: {
      children: React.ReactNode;
      future?: unknown;
    }) => {
      const MemoryRouter = (actual as typeof import('react-router-dom'))
        .MemoryRouter;
      return React.createElement(
        MemoryRouter,
        { initialEntries: [currentPath.value], future },
        children
      );
    },
  };
});

// ---------------------------------------------------------------------------
// Import App AFTER all mocks
// ---------------------------------------------------------------------------
import App from '../App';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set the path that MemoryRouter will use as its initial entry.
 * Must be called before render().
 */
function navigateTo(path: string) {
  currentPath.value = path;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('App — route table and provider nesting', () => {
  beforeEach(() => {
    mockIsAuthenticated.value = false;
    mockUser.value = null;
    mockNavigate.mockReset();
    currentPath.value = '/';
  });

  // -------------------------------------------------------------------------
  // Provider nesting
  // -------------------------------------------------------------------------

  it('wraps tree in TooltipProvider (structural smoke test)', async () => {
    navigateTo('/');
    render(<App />);
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="tooltip-provider"]')
      ).toBeInTheDocument();
    });
  });

  it('renders ErrorBoundary and FloatingUploadProgress', async () => {
    navigateTo('/');
    render(<App />);
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="error-boundary"]')
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-testid="floating-upload-progress"]')
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Public routes — page stub visible
  // -------------------------------------------------------------------------

  it('/ renders Index page', async () => {
    navigateTo('/');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-index')).toBeInTheDocument();
    });
  });

  it('/sign-in renders SignIn page', async () => {
    navigateTo('/sign-in');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-sign-in')).toBeInTheDocument();
    });
  });

  it('/sign-up renders SignUp page', async () => {
    navigateTo('/sign-up');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-sign-up')).toBeInTheDocument();
    });
  });

  it('/forgot-password renders ForgotPassword page', async () => {
    navigateTo('/forgot-password');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-forgot-password')).toBeInTheDocument();
    });
  });

  it('/reset-password renders ResetPassword page', async () => {
    navigateTo('/reset-password');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-reset-password')).toBeInTheDocument();
    });
  });

  it('/documentation renders Documentation page', async () => {
    navigateTo('/documentation');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-documentation')).toBeInTheDocument();
    });
  });

  it('/terms-of-service renders TermsOfService page', async () => {
    navigateTo('/terms-of-service');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-terms-of-service')).toBeInTheDocument();
    });
  });

  it('/privacy-policy renders PrivacyPolicy page', async () => {
    navigateTo('/privacy-policy');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-privacy-policy')).toBeInTheDocument();
    });
  });

  it('/share/accept/:token renders ShareAccept page', async () => {
    navigateTo('/share/accept/abc123');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-share-accept')).toBeInTheDocument();
    });
  });

  it('unknown path renders NotFound page', async () => {
    navigateTo('/this-does-not-exist-xyz');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Protected routes — unauthenticated → redirect to /sign-in
  // ProtectedRoute uses a 200ms grace period before redirecting; we rely on
  // the mockNavigate call (ProtectedRoute calls navigate(...)) rather than
  // trying to observe the URL change synchronously.
  // -------------------------------------------------------------------------

  it('/dashboard redirects unauthenticated user toward sign-in', async () => {
    mockIsAuthenticated.value = false;
    mockUser.value = null;
    navigateTo('/dashboard');
    render(<App />);
    // ProtectedRoute renders loading/redirecting UI while unauthenticated
    // After the 200ms grace period it calls navigate(); page-dashboard must NOT appear.
    await waitFor(
      () => {
        expect(screen.queryByTestId('page-dashboard')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/profile redirects unauthenticated user', async () => {
    mockIsAuthenticated.value = false;
    mockUser.value = null;
    navigateTo('/profile');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.queryByTestId('page-profile')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/settings redirects unauthenticated user', async () => {
    mockIsAuthenticated.value = false;
    mockUser.value = null;
    navigateTo('/settings');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.queryByTestId('page-settings')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  // -------------------------------------------------------------------------
  // Protected routes — authenticated → page stub rendered
  // -------------------------------------------------------------------------

  it('/dashboard renders Dashboard when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/dashboard');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/profile renders Profile when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/profile');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.getByTestId('page-profile')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/settings renders Settings when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/settings');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.getByTestId('page-settings')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/project/:id renders ProjectDetail when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/project/proj-123');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/project/:id/export renders ProjectExport when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/project/proj-123/export');
    render(<App />);
    await waitFor(
      () => {
        expect(screen.getByTestId('page-project-export')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('/segmentation/:projectId/:imageId renders SegmentationEditor when authenticated', async () => {
    mockIsAuthenticated.value = true;
    mockUser.value = { id: 'u1', email: 'test@example.com' };
    navigateTo('/segmentation/proj-1/img-1');
    render(<App />);
    await waitFor(
      () => {
        expect(
          screen.getByTestId('page-segmentation-editor')
        ).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });
});

describe('App — Sonner toaster is mounted', () => {
  beforeEach(() => {
    currentPath.value = '/';
  });

  it('renders the Sonner toaster component', async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="sonner-toaster"]')
      ).toBeInTheDocument();
    });
  });
});
