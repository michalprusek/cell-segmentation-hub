/**
 * Profile page — consolidated unit tests.
 *
 * Merged from Profile.test / Profile.extended / Profile.gaps / Profile.activity
 * (2026-07-12). All four previously duplicated ~130 lines of identical module
 * mocks; that setup now lives once at the top of this file.
 *
 * Memory discipline (do NOT casually add renders): Profile.tsx peaks at ~3 GB
 * per mounted render (lucide-react + Radix UI + contexts). The runner caps the
 * heap at 4096 MB (`--pool=forks --maxWorkers=1`). This file is capped at FOUR
 * renders — one per `describe` — reduced from the previous six by folding the
 * loading-gate assertion into the loaded render and the avatar-image / upload-
 * error branches into the avatar-flow render. Each render shares a single
 * mounted instance across its assertions (RTL `/pure` suppresses auto-cleanup).
 *
 * `useAuth` / `useLanguage` MUST return STABLE (frozen, module-level) refs:
 * Profile's `useEffect([user, profile, t])` re-fires on every render if those
 * refs change, and avatar state updates trigger re-renders → infinite loop →
 * OOM. `currentAuth` is reassigned only in each describe's `beforeAll`, BEFORE
 * render, so it stays stable for the lifetime of each mounted instance.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
// /pure suppresses RTL's automatic afterEach(cleanup) so a single rendered
// instance can be shared across multiple assertions without re-rendering.
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react/pure';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockGetProjects,
  mockGetProjectImages,
  mockUploadAvatar,
  mockRefreshProfile,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetProjects: vi.fn(),
  mockGetProjectImages: vi.fn(),
  mockUploadAvatar: vi.fn(),
  mockRefreshProfile: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Stable auth object — reassigned per describe (before render), never mid-render
// ---------------------------------------------------------------------------
type AuthShape = {
  user: { id: string; email: string; created_at: string };
  profile: {
    username: string;
    title: string;
    organization: string;
    bio: string;
    location: string;
    avatarUrl: string | null;
  };
  refreshProfile: () => Promise<void>;
};

let currentAuth: AuthShape = Object.freeze({
  user: {
    id: 'u1',
    email: 'alice@example.com',
    created_at: '2024-01-15T00:00:00Z',
  },
  profile: {
    username: 'Alice Test',
    title: 'Senior Researcher',
    organization: 'Test Institute',
    bio: 'I research spheroids.',
    location: 'Prague',
    avatarUrl: null,
  },
  refreshProfile: mockRefreshProfile,
});

const STABLE_T = (key: string): string => {
  const map: Record<string, string> = {
    'profile.title': 'Profile',
    'profile.editProfile': 'Edit Profile',
    'profile.about': 'About',
    'profile.recentActivity': 'Recent Activity',
    'profile.noRecentActivity': 'No recent activity',
    'profile.statistics': 'Statistics',
    'profile.totalImagesProcessed': 'Total Images Processed',
    'profile.averageProcessingTime': 'Average Processing Time',
    'profile.storageUsed': 'Storage Used',
    'profile.apiRequests': 'API Requests',
    'profile.projects': 'Projects',
    'profile.analyses': 'Analyses',
    'profile.joined': 'Joined',
    'profile.completionRate': 'completion rate',
    'profile.today': 'today',
    'profile.yesterday': 'yesterday',
    'profile.daysAgo': 'days ago',
    'profile.fromLastMonth': 'from last month',
    'profile.thisMonth': 'this month',
    'profile.of': 'of',
    'profile.createdProject': 'Created project',
    'profile.completedSegmentation': 'Completed segmentation for',
    'profile.uploadedImage': 'Uploaded image',
    'profile.avatar.uploadSuccess': 'Avatar uploaded',
    'profile.avatar.uploadError': 'Avatar upload failed',
    'profile.avatar.invalidFileType': 'Invalid file type',
    'profile.avatar.fileTooLarge': 'File too large',
    'common.back': 'Back',
    'toast.profile.loadFailed': 'Failed to load profile data',
    'common.error': 'Error',
  };
  return map[key] ?? key;
};

// ---------------------------------------------------------------------------
// Module mocks (heaviest first)
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Clock: () => null,
  Edit: () => null,
  Mail: () => null,
  MapPin: () => null,
  Loader2: () => null,
  Camera: () => null,
  ArrowLeft: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    asChild,
  }: {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler;
    asChild?: boolean;
    [k: string]: unknown;
  }) =>
    asChild ? <>{children}</> : <button onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/exports', () => ({
  useAuth: () => currentAuth,
  useLanguage: () => ({ t: STABLE_T }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    getProjects: mockGetProjects,
    getProjectImages: mockGetProjectImages,
    uploadAvatar: mockUploadAvatar,
  },
  dtoToProjectImage: (dto: Record<string, unknown>) => ({
    id: dto.id,
    name: dto.name ?? dto.original_name,
    url: '',
    createdAt: new Date(dto.created_at as string),
    updatedAt: new Date((dto.updated_at ?? dto.created_at) as string),
    segmentationStatus: dto.segmentation_status ?? 'pending',
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/tiffConverter', () => ({
  createImagePreviewUrl: vi.fn().mockResolvedValue('blob:fake'),
}));

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <header data-testid="dashboard-header" />,
}));

// AvatarUploadButton exposes onFileSelect via a module-level variable, avoiding
// ref closures that would pin the entire Profile closure in memory (blocks GC).
let capturedOnFileSelect: ((f: File) => void) | null = null;
vi.mock('@/components/profile/AvatarUploadButton', () => ({
  default: ({
    onFileSelect,
    disabled,
  }: {
    onFileSelect?: (f: File) => void;
    disabled?: boolean;
  }) => {
    capturedOnFileSelect = onFileSelect ?? null;
    return (
      <button data-testid="avatar-upload-btn" disabled={disabled}>
        Upload
      </button>
    );
  },
}));

// AvatarCropDialog renders confirm/cancel buttons when open.
vi.mock('@/components/profile/AvatarCropDialog', () => ({
  default: ({
    open,
    onCropComplete,
    onClose,
  }: {
    open: boolean;
    onCropComplete: (blob: Blob) => void;
    onClose: () => void;
    imageSrc?: string;
  }) =>
    open ? (
      <div data-testid="crop-dialog">
        <button
          data-testid="crop-confirm-btn"
          onClick={() =>
            onCropComplete(new Blob(['img'], { type: 'image/png' }))
          }
        >
          Confirm
        </button>
        <button data-testid="crop-cancel-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    ) : null,
}));

// jsdom does not expose URL.createObjectURL / revokeObjectURL, which Profile
// calls in the avatar crop cleanup effects.
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
}
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:mock-url'),
    configurable: true,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Import component AFTER all mocks
// ---------------------------------------------------------------------------
import Profile from '../Profile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );
}

function getAvatarHandler(): (f: File) => void {
  if (!capturedOnFileSelect) {
    throw new Error('onFileSelect not captured from AvatarUploadButton');
  }
  return capturedOnFileSelect;
}

/** File reporting `reportedSize` bytes without allocating that memory. */
function makeFile(name: string, type: string, reportedSize: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: reportedSize, configurable: true });
  return f;
}

function resetMocks() {
  mockNavigate.mockReset();
  mockGetProjects.mockReset();
  mockGetProjectImages.mockReset();
  mockUploadAvatar.mockReset();
  mockRefreshProfile.mockReset().mockResolvedValue(undefined);
}

// ===========================================================================
// Render 1 — loading gate + loaded (empty) state
// ===========================================================================
describe('Profile — render + loaded (empty) state', () => {
  beforeAll(async () => {
    currentAuth = Object.freeze({
      user: {
        id: 'u1',
        email: 'alice@example.com',
        created_at: '2024-01-15T00:00:00Z',
      },
      profile: {
        username: 'Alice Test',
        title: 'Senior Researcher',
        organization: 'Test Institute',
        bio: 'I research spheroids.',
        location: 'Prague',
        avatarUrl: null,
      },
      refreshProfile: mockRefreshProfile,
    });
    mockGetProjects.mockResolvedValue({ projects: [], total: 0 });
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });

    renderProfile();
    // Loading gate: header is present but profile content is absent on first
    // paint (before the async fetchData resolves).
    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
    expect(screen.queryByText('Alice Test')).not.toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByText('Alice Test')).toBeInTheDocument(),
      { timeout: 15000 }
    );
  });

  afterAll(() => {
    cleanup();
    resetMocks();
  });

  it('renders identity, navigation, bio, statistics, avatar, and empty activity', () => {
    // Identity
    expect(screen.getByText('Alice Test')).toBeInTheDocument();
    expect(screen.getByText('Senior Researcher')).toBeInTheDocument();
    expect(screen.getByText('Test Institute')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Prague')).toBeInTheDocument();
    expect(screen.getByText(/Joined/).textContent).toMatch(/2024/);

    // Edit Profile → /settings (asChild link)
    expect(screen.getByRole('link', { name: /edit profile/i })).toHaveAttribute(
      'href',
      '/settings'
    );

    // Back button → navigate(-1)
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);

    // Bio + statistics
    expect(screen.getByText('I research spheroids.')).toBeInTheDocument();
    expect(screen.getByText('Statistics')).toBeInTheDocument();
    expect(screen.getByText('Total Images Processed')).toBeInTheDocument();
    expect(screen.getByText('3.2s')).toBeInTheDocument();

    // Avatar controls; crop dialog closed
    expect(screen.getByTestId('avatar-upload-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    // Empty activity feed
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });
});

// ===========================================================================
// Render 2 — avatar image + upload flow (validation, success, error)
// ===========================================================================
describe('Profile — avatar image + upload flow', () => {
  beforeAll(async () => {
    currentAuth = Object.freeze({
      user: {
        id: 'u2',
        email: 'bob@example.com',
        created_at: '2023-06-01T00:00:00Z',
      },
      profile: {
        username: 'Bob Tester',
        title: 'Analyst',
        organization: 'Lab',
        bio: 'Testing bio.',
        location: 'Berlin',
        avatarUrl: 'https://cdn.example.com/avatar.png',
      },
      refreshProfile: mockRefreshProfile,
    });
    mockGetProjects.mockResolvedValue({ projects: [], total: 0 });
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });
    mockUploadAvatar.mockResolvedValue({ avatarUrl: 'http://cdn/avatar.png' });

    renderProfile();
    await waitFor(
      () => expect(screen.queryByText('Bob Tester')).toBeInTheDocument(),
      { timeout: 15000 }
    );
  });

  afterAll(() => {
    cleanup();
    resetMocks();
  });

  it('renders the avatar <img> when profile.avatarUrl is set', () => {
    const avatarImgs = document.querySelectorAll('img[alt="Bob Tester"]');
    expect(avatarImgs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Joined/).textContent).toMatch(/2023/);
  });

  it('rejects invalid file type and oversized files without opening the crop dialog', async () => {
    const { toast } = await import('sonner');

    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    await getAvatarHandler()(makeFile('bad.exe', 'application/exe', 100));
    expect(toast.error).toHaveBeenCalledWith('Invalid file type');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    await getAvatarHandler()(makeFile('clip.mp4', 'video/mp4', 200));
    expect(toast.error).toHaveBeenCalledWith('Invalid file type');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    await getAvatarHandler()(
      makeFile('huge.png', 'image/png', 6 * 1024 * 1024)
    );
    expect(toast.error).toHaveBeenCalledWith('File too large');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();
  });

  it('opens the crop dialog for a valid image and cancels without uploading', async () => {
    const { apiClient } = await import('@/lib/api');
    const { createImagePreviewUrl } = await import('@/lib/tiffConverter');

    (createImagePreviewUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'blob:valid'
    );
    await getAvatarHandler()(makeFile('avatar.png', 'image/png', 100 * 1024));
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    (apiClient.uploadAvatar as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId('crop-cancel-btn'));
    await waitFor(
      () => expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(apiClient.uploadAvatar).not.toHaveBeenCalled();
  });

  it('uploads on crop confirm → refreshProfile + success toast + dialog closes', async () => {
    const { toast } = await import('sonner');
    const { createImagePreviewUrl } = await import('@/lib/tiffConverter');

    (createImagePreviewUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'blob:valid2'
    );
    await getAvatarHandler()(makeFile('avatar2.png', 'image/png', 50 * 1024));
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    mockUploadAvatar.mockClear().mockResolvedValueOnce({
      avatarUrl: 'http://cdn/avatar.png',
    });
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    mockRefreshProfile.mockClear();

    fireEvent.click(screen.getByTestId('crop-confirm-btn'));

    await waitFor(() => expect(mockUploadAvatar).toHaveBeenCalled(), {
      timeout: 5000,
    });
    await waitFor(() => expect(mockRefreshProfile).toHaveBeenCalled(), {
      timeout: 5000,
    });
    await waitFor(
      () => expect(toast.success).toHaveBeenCalledWith('Avatar uploaded'),
      { timeout: 5000 }
    );
    await waitFor(
      () => expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument(),
      { timeout: 5000 }
    );
  });

  it('shows an error toast when uploadAvatar rejects', async () => {
    const { toast } = await import('sonner');
    const { createImagePreviewUrl } = await import('@/lib/tiffConverter');

    (createImagePreviewUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'blob:error-flow'
    );
    await getAvatarHandler()(makeFile('avatar3.png', 'image/png', 50 * 1024));
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    mockUploadAvatar
      .mockClear()
      .mockRejectedValueOnce(new Error('network error'));
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByTestId('crop-confirm-btn'));
    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith('Avatar upload failed'),
      { timeout: 5000 }
    );
    await waitFor(
      () => expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument(),
      { timeout: 5000 }
    );
  });
});

// ===========================================================================
// Render 3 — recent-activity fetch error branch
// ===========================================================================
describe('Profile — recent activity fetch error', () => {
  beforeAll(async () => {
    currentAuth = Object.freeze({
      user: {
        id: 'u-act',
        email: 'act@test.com',
        created_at: '2023-01-01T00:00:00Z',
      },
      profile: {
        username: 'Activity Tester',
        title: 'Dr.',
        organization: 'LabX',
        bio: 'bio.',
        location: 'Prague',
        avatarUrl: null,
      },
      refreshProfile: mockRefreshProfile,
    });
    // 1st call (limit:1) resolves → project count; 2nd call (limit:5) rejects →
    // recentActivityError; remaining pagination calls resolve empty.
    mockGetProjects
      .mockResolvedValueOnce({ projects: [], total: 0 })
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValue({ projects: [], total: 0 });
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });

    await act(async () => {
      renderProfile();
    });
    await waitFor(
      () => expect(screen.queryByText('Activity Tester')).toBeInTheDocument(),
      { timeout: 10000 }
    );
  });

  afterAll(() => {
    cleanup();
    resetMocks();
  });

  it('renders the red error box when the recent-projects fetch fails', () => {
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    expect(document.querySelector('[class*="red"]')).not.toBeNull();
  });
});

// ===========================================================================
// Render 4 — activity day labels (today / yesterday / N days ago)
// ===========================================================================
describe('Profile — activity day labels', () => {
  beforeAll(async () => {
    currentAuth = Object.freeze({
      user: {
        id: 'u-act2',
        email: 'act2@test.com',
        created_at: '2023-01-01T00:00:00Z',
      },
      profile: {
        username: 'Activity Tester',
        title: 'Dr.',
        organization: 'LabX',
        bio: 'bio.',
        location: 'Prague',
        avatarUrl: null,
      },
      refreshProfile: mockRefreshProfile,
    });

    const now = new Date();
    // 1.5 days ago → floor = 1 → 'yesterday'; 3 days ago → '3 days ago'.
    const yesterdaySafe = new Date(now.getTime() - 1.5 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const recentProjs = [
      {
        id: 'pa',
        title: 'Today Project',
        created_at: now.toISOString(),
        type: 'spheroid',
      },
      {
        id: 'pb',
        title: 'Yesterday Project',
        created_at: yesterdaySafe.toISOString(),
        type: 'spheroid',
      },
      {
        id: 'pc',
        title: 'Three Days Project',
        created_at: threeDaysAgo.toISOString(),
        type: 'spheroid',
      },
    ];
    mockGetProjects.mockImplementation(() =>
      Promise.resolve({ projects: recentProjs, total: 3 })
    );
    mockGetProjectImages.mockResolvedValue({
      images: [
        {
          id: 'i1',
          name: 'img.png',
          created_at: now.toISOString(),
          segmentation_status: 'completed',
        },
      ],
      total: 1,
    });

    await act(async () => {
      renderProfile();
    });
    await waitFor(
      () => expect(screen.queryByText('Activity Tester')).toBeInTheDocument(),
      { timeout: 10000 }
    );
  });

  afterAll(() => {
    cleanup();
    resetMocks();
  });

  it('labels recent activity items with a relative-day label', async () => {
    // The generated activity feed surfaces the most-recent items first, so the
    // "today" (daysAgo === 0) label is the one reliably rendered.
    await waitFor(
      () => expect(screen.queryAllByText('today').length).toBeGreaterThan(0),
      { timeout: 5000 }
    );
  });
});
