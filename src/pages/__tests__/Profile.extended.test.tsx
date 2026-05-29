/**
 * Profile page — extended behavioral tests.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/pages/__tests__/Profile.extended.test.tsx --reporter=dot
 *
 * Memory constraint: Profile.tsx peaks at ~3 GB per render (lucide-react
 * + Radix UI + contexts). Exactly ONE render, ONE it() block.
 *
 * Critical stability requirement: `useAuth` and `useLanguage` mocks MUST
 * return STABLE object references (module-level constants). If they return
 * new objects on every render, Profile.tsx's `useEffect([user, profile, t])`
 * fires on every render cycle triggered by avatar state updates, causing an
 * infinite loop that exhausts heap memory. Profile.test.tsx avoids this by
 * never calling `handleAvatarFileSelect`, so no state-update re-renders occur;
 * this file triggers avatar state updates deliberately, so stable refs are
 * required.
 *
 * Behaviors covered (complement to Profile.test.tsx):
 *   - application/exe → toast.error("Invalid file type"), no crop dialog
 *   - video/mp4 → toast.error("Invalid file type"), no crop dialog
 *   - 6 MB PNG → toast.error("File too large"), no crop dialog
 *   - valid PNG → createImagePreviewUrl called + crop dialog opens
 *   - crop cancel → dialog closes, uploadAvatar NOT called
 *   - crop confirm → uploadAvatar + refreshProfile + success toast + dialog closes
 *
 * NOT tested (genuinely out of reach):
 *   - Activity items with real project data: the "loaded with data" render path
 *     generates activity items which exhausts the 4096 MB heap; same constraint
 *     as documented in Profile.test.tsx.
 *   - API error path (getProjects throws): requires a 2nd render → OOM.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react/pure';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockGetProjects,
  mockGetProjectImages,
  mockRefreshProfile,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetProjects: vi.fn(),
  mockGetProjectImages: vi.fn(),
  mockRefreshProfile: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Stable auth/language objects
// Profile.tsx's useEffect([user, profile, t]) fires on every render if these
// return new object references (as happens with inline `useAuth: () => ({...})`).
// State changes from the avatar upload flow cause re-renders; with unstable
// refs, the effect runs again → infinite loop → OOM.
// ---------------------------------------------------------------------------
const STABLE_USER = Object.freeze({
  id: 'u2',
  email: 'bob@example.com',
  created_at: '2023-06-01T00:00:00Z',
});

const STABLE_PROFILE = Object.freeze({
  username: 'Bob Tester',
  title: 'Analyst',
  organization: 'Lab',
  bio: 'Testing bio.',
  location: 'Berlin',
  avatarUrl: null,
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
// Module mocks
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
  useAuth: () => ({
    user: STABLE_USER,
    profile: STABLE_PROFILE,
    refreshProfile: mockRefreshProfile,
  }),
  useLanguage: () => ({ t: STABLE_T }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    getProjects: mockGetProjects,
    getProjectImages: mockGetProjectImages,
    uploadAvatar: vi
      .fn()
      .mockResolvedValue({ avatarUrl: 'http://cdn/avatar.png' }),
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

// AvatarUploadButton: expose onFileSelect via module-level variable.
// Avoids ref closures that capture Profile's handler — those closures hold
// the entire component closure in memory, preventing GC.
let _capturedOnFileSelect: ((f: File) => void) | null = null;
vi.mock('@/components/profile/AvatarUploadButton', () => ({
  default: ({
    onFileSelect,
    disabled,
  }: {
    onFileSelect: (f: File) => void;
    disabled?: boolean;
  }) => {
    _capturedOnFileSelect = onFileSelect;
    return (
      <button data-testid="avatar-upload-btn" disabled={disabled}>
        Upload
      </button>
    );
  },
}));

// AvatarCropDialog: renders confirm/cancel buttons when open.
vi.mock('@/components/profile/AvatarCropDialog', () => ({
  default: ({
    open,
    onCropComplete,
    onClose,
  }: {
    open: boolean;
    onCropComplete: (blob: Blob) => void;
    onClose: () => void;
    imageSrc: string;
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

// jsdom does not expose URL.revokeObjectURL / createObjectURL.
// Profile.tsx calls revokeObjectURL in cleanup effects after the crop flow.
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

function getAvatarHandler(): (f: File) => void {
  if (!_capturedOnFileSelect) {
    throw new Error('onFileSelect not captured from AvatarUploadButton');
  }
  return _capturedOnFileSelect;
}

/** Create a File reporting `reportedSize` bytes without allocating that memory */
function makeFile(name: string, type: string, reportedSize: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: reportedSize, configurable: true });
  return f;
}

// ---------------------------------------------------------------------------
// Suite — single render, single it() block (same discipline as Profile.test.tsx)
// ---------------------------------------------------------------------------

describe('Profile — extended: avatar upload flow', () => {
  beforeAll(async () => {
    mockGetProjects.mockResolvedValue({ projects: [], total: 0 });
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    );

    await waitFor(
      () => expect(screen.queryByText('Bob Tester')).toBeInTheDocument(),
      { timeout: 15000 }
    );
  });

  afterAll(() => {
    cleanup();
    mockGetProjects.mockReset();
    mockGetProjectImages.mockReset();
    mockNavigate.mockReset();
    mockRefreshProfile.mockReset();
  });

  it('file-type rejection, size rejection, valid open, upload success, cancel', async () => {
    const { toast } = await import('sonner');
    const { apiClient } = await import('@/lib/api');
    const { createImagePreviewUrl } = await import('@/lib/tiffConverter');

    // ---- application/exe rejected ----
    (toast.error as any).mockClear();
    await getAvatarHandler()(makeFile('bad.exe', 'application/exe', 100));
    expect(toast.error).toHaveBeenCalledWith('Invalid file type');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    // ---- video/mp4 rejected ----
    (toast.error as any).mockClear();
    await getAvatarHandler()(makeFile('clip.mp4', 'video/mp4', 200));
    expect(toast.error).toHaveBeenCalledWith('Invalid file type');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    // ---- 6 MB PNG rejected ----
    (toast.error as any).mockClear();
    await getAvatarHandler()(
      makeFile('huge.png', 'image/png', 6 * 1024 * 1024)
    );
    expect(toast.error).toHaveBeenCalledWith('File too large');
    expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument();

    // ---- valid PNG → crop dialog opens ----
    (createImagePreviewUrl as any).mockResolvedValueOnce('blob:valid');
    await getAvatarHandler()(makeFile('avatar.png', 'image/png', 100 * 1024));
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // ---- crop cancel → no upload ----
    (apiClient.uploadAvatar as any).mockClear();
    fireEvent.click(screen.getByTestId('crop-cancel-btn'));
    await waitFor(
      () => expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(apiClient.uploadAvatar).not.toHaveBeenCalled();

    // ---- valid PNG again → crop dialog ----
    (createImagePreviewUrl as any).mockResolvedValueOnce('blob:valid2');
    await getAvatarHandler()(makeFile('avatar2.png', 'image/png', 50 * 1024));
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // ---- crop confirm → upload + refresh + toast + dialog closes ----
    (apiClient.uploadAvatar as any).mockClear();
    (toast.success as any).mockClear();
    mockRefreshProfile.mockClear();

    fireEvent.click(screen.getByTestId('crop-confirm-btn'));

    await waitFor(() => expect(apiClient.uploadAvatar).toHaveBeenCalled(), {
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
});
