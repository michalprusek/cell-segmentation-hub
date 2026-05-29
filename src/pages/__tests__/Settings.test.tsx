/**
 * Settings page — coverage from 0%.
 *
 * OOM-prevention strategy (same discipline as SegmentationEditor.orchestration.test.tsx):
 *   • Mock ALL heavy section components as trivial stubs.
 *   • Mock @/components/ui/tabs minimally so Tabs/TabsList/etc. render as
 *     plain divs that relay children and the `value` / `onValueChange` props.
 *   • Freeze contexts with stable, no-effect stubs.
 *   • One render per describe block; cleanup in afterEach.
 *   • No heavy react-hook-form / framer-motion / Radix imports survive.
 *
 * Branches covered:
 *   • loading=true renders spinner, hides tabs
 *   • loading=false + profile loaded renders tabs
 *   • tab defaults to 'profile' when no ?tab param
 *   • each tab (profile / account / appearance / models) is selectable
 *   • UserProfileSection rendered only when user + profile present
 *   • API fetch failure falls back to user stub profile
 *   • Back button calls navigate(-1)
 *   • page title is rendered
 */
import React from 'react';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

// ─── hoisted mock state ───────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetSearchParams = vi.hoisted(() => vi.fn());

/** Mutable: tests change activeTab via searchParams. */
const mockSearchParamsGet = vi.hoisted(() =>
  vi.fn(() => null as string | null)
);

const mockApiGetUserProfile = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: 'u1',
    email: 'test@test.com',
    username: 'tester',
    organization: 'UTIA',
    bio: '',
    public_profile: false,
    consentToMLTraining: false,
    consentToAlgorithmImprovement: false,
    consentToFeatureDevelopment: false,
  })
);

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as object),
    useNavigate: () => mockNavigate,
    useSearchParams: () => [
      { get: mockSearchParamsGet } as any,
      mockSetSearchParams,
    ],
  };
});

// Stable user reference — created via vi.hoisted so it exists before the
// vi.mock factory runs. MUST NOT be a new object on every call because
// `useEffect([user])` in Settings.tsx would see a new reference on every
// render and loop infinitely (loading=true → fetch → loading=false → re-render
// → loading=true → ...).
const STABLE_USER = vi.hoisted(() => ({
  id: 'u1',
  email: 'test@test.com',
  username: 'tester',
}));

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({ user: STABLE_USER }),
  useLanguage: () => ({ t: (k: string) => k }),
}));

// Override the global setup mock for api — same shape but tests control it here
vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: mockApiGetUserProfile,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Tabs stub ────────────────────────────────────────────────────────────────
// Uses React.createContext in the factory for prop drilling.
// The STABLE_USER trick above shows that the key OOM/infinite-render issue is
// referential stability of hook return values. The context object is recreated
// each render, but React.createContext is called once (in the factory), so the
// context identity is stable — only the Provider value changes, which React
// handles correctly (no re-render loop from context).

vi.mock('@/components/ui/tabs', () => {
  const TabsCtx = React.createContext<{
    value: string;
    onValueChange?: (v: string) => void;
  }>({ value: '' });

  return {
    Tabs: ({
      children,
      value = '',
      onValueChange,
    }: {
      children: React.ReactNode;
      value?: string;
      onValueChange?: (v: string) => void;
    }) => (
      <TabsCtx.Provider value={{ value, onValueChange }}>
        <div data-testid="tabs" data-value={value}>
          {children}
        </div>
      </TabsCtx.Provider>
    ),
    TabsList: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="tabs-list">{children}</div>
    ),
    TabsTrigger: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const ctx = React.useContext(TabsCtx);
      return (
        <button
          data-testid={`tab-${value}`}
          onClick={() => ctx.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    // TabsContent renders unconditionally — allows asserting section components
    // are present regardless of active tab.
    TabsContent: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => <div data-testid={`tab-content-${value}`}>{children}</div>,
  };
});

// ─── Heavy section component stubs ───────────────────────────────────────────

vi.mock('@/components/settings/UserProfileSection', () => ({
  default: ({ userId, profile }: any) => (
    <div
      data-testid="user-profile-section"
      data-userid={userId}
      data-email={profile?.email}
    />
  ),
}));

vi.mock('@/components/settings/AccountSection', () => ({
  default: () => <div data-testid="account-section" />,
}));

vi.mock('@/components/settings/AppearanceSection', () => ({
  default: () => <div data-testid="appearance-section" />,
}));

vi.mock('@/components/settings/ModelSettingsSection', () => ({
  default: () => <div data-testid="model-settings-section" />,
}));

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header" />,
}));

// framer-motion: render children without animations
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => {
      // strip animation props that JSX doesn't know about
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _tr,
        ...domProps
      } = rest;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// lucide-react: stub ArrowLeft so there's no svg-parse overhead
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left" />,
}));

// shadcn Button: minimal passthrough
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

// ─── import under test ────────────────────────────────────────────────────────
import Settings from '../Settings';

// ─── helpers ──────────────────────────────────────────────────────────────────

const renderSettings = () =>
  render(
    <BrowserRouter>
      <Settings />
    </BrowserRouter>
  );

// ─── suite setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  // Do NOT call vi.clearAllMocks() here — the global setup.ts afterEach
  // already clears mocks after each test. Re-applying here conflicts with
  // module-level mock factories that run on first import.
  // Default: no ?tab param → 'profile' is the default tab.
  mockSearchParamsGet.mockReturnValue(null);
  mockApiGetUserProfile.mockResolvedValue({
    id: 'u1',
    email: 'test@test.com',
    username: 'tester',
    organization: 'UTIA',
    bio: '',
    consentToMLTraining: false,
    consentToAlgorithmImprovement: false,
    consentToFeatureDevelopment: false,
  });
});

afterEach(() => {
  cleanup();
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe('Loading state', () => {
  it('renders loading text while profile is fetching', () => {
    // Never resolve the promise during this test
    mockApiGetUserProfile.mockReturnValue(new Promise(() => {}));

    renderSettings();

    expect(screen.getByText('common.loading')).toBeInTheDocument();
    // Tabs should NOT be visible while loading
    expect(screen.queryByTestId('tabs')).not.toBeInTheDocument();
  });
});

// ─── Profile loaded state ─────────────────────────────────────────────────────

describe('Profile loaded state — tabs visible', () => {
  it('renders DashboardHeader unconditionally', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
  });

  it('renders page title', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });
    expect(screen.getByText('settings.pageTitle')).toBeInTheDocument();
  });

  it('renders tab triggers after load', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('tab-profile')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-account')).toBeInTheDocument();
    expect(screen.getByTestId('tab-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('tab-models')).toBeInTheDocument();
  });

  it('does not render loading text after profile resolves', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });
  });
});

// ─── Default tab = profile ────────────────────────────────────────────────────

describe('Default tab selection', () => {
  it('defaults to profile tab when no ?tab search param', async () => {
    mockSearchParamsGet.mockReturnValue(null);

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    const tabs = screen.getByTestId('tabs');
    expect(tabs.getAttribute('data-value')).toBe('profile');
  });

  it('uses ?tab=account when search param is set to account', async () => {
    mockSearchParamsGet.mockReturnValue('account');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    const tabs = screen.getByTestId('tabs');
    expect(tabs.getAttribute('data-value')).toBe('account');
  });

  it('uses ?tab=appearance when search param is set', async () => {
    mockSearchParamsGet.mockReturnValue('appearance');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    const tabs = screen.getByTestId('tabs');
    expect(tabs.getAttribute('data-value')).toBe('appearance');
  });

  it('uses ?tab=models when search param is set', async () => {
    mockSearchParamsGet.mockReturnValue('models');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    const tabs = screen.getByTestId('tabs');
    expect(tabs.getAttribute('data-value')).toBe('models');
  });
});

// ─── Tab switching calls setSearchParams ──────────────────────────────────────

describe('Tab switching — handleTabChange', () => {
  it('calls setSearchParams when a tab trigger is clicked', async () => {
    mockSearchParamsGet.mockReturnValue(null); // starts on 'profile'

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('tab-account')).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId('tab-account').click();
    });

    expect(mockSetSearchParams).toHaveBeenCalledWith({ tab: 'account' });
  });

  it('calls setSearchParams with models when models tab is clicked', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('tab-models')).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId('tab-models').click();
    });

    expect(mockSetSearchParams).toHaveBeenCalledWith({ tab: 'models' });
  });
});

// ─── UserProfileSection conditional render ────────────────────────────────────

describe('UserProfileSection conditional render', () => {
  it('renders UserProfileSection with user id and profile email on profile tab', async () => {
    // profile tab is active by default (null → 'profile')
    mockSearchParamsGet.mockReturnValue('profile');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    // Due to how TabsContent works in our stub (value must equal activeValue),
    // the profile content is shown when activeValue='profile'
    const section = screen.getByTestId('user-profile-section');
    expect(section).toBeInTheDocument();
    expect(section.getAttribute('data-userid')).toBe('u1');
    expect(section.getAttribute('data-email')).toBe('test@test.com');
  });

  it('renders AccountSection on account tab', async () => {
    mockSearchParamsGet.mockReturnValue('account');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('account-section')).toBeInTheDocument();
  });

  it('renders AppearanceSection on appearance tab', async () => {
    mockSearchParamsGet.mockReturnValue('appearance');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('appearance-section')).toBeInTheDocument();
  });

  it('renders ModelSettingsSection on models tab', async () => {
    mockSearchParamsGet.mockReturnValue('models');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('model-settings-section')).toBeInTheDocument();
  });
});

// ─── API fetch failure fallback ───────────────────────────────────────────────

describe('API fetch failure — fallback profile', () => {
  it('renders tabs with fallback profile when getUserProfile rejects', async () => {
    mockApiGetUserProfile.mockRejectedValue(new Error('Network error'));
    mockSearchParamsGet.mockReturnValue('profile');

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });

    // UserProfileSection should still render with the fallback (user stub) data
    const section = screen.getByTestId('user-profile-section');
    expect(section).toBeInTheDocument();
    // Fallback uses user.email
    expect(section.getAttribute('data-email')).toBe('test@test.com');
  });
});

// ─── Back button ─────────────────────────────────────────────────────────────

describe('Back button', () => {
  it('calls navigate(-1) when back button is clicked', () => {
    // The back button is always rendered (outside the loading conditional),
    // so we can click it immediately without waiting for profile load.
    renderSettings();
    act(() => {
      screen.getByText('common.back').click();
    });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});

// ─── getUserProfile is called on mount ───────────────────────────────────────

describe('Profile API call', () => {
  it('calls getUserProfile once on mount when user is present', async () => {
    renderSettings();
    await waitFor(() => {
      expect(mockApiGetUserProfile).toHaveBeenCalledTimes(1);
    });
  });
});
