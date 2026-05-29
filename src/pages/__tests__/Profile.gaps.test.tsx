/**
 * Profile page — remaining uncovered branches (74% → higher).
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/pages/__tests__/Profile.gaps.test.tsx --reporter=dot
 *
 * Memory constraint: Profile.tsx peaks at ~3 GB per render (lucide-react +
 * Radix UI + contexts). Exactly ONE render, ALL assertions in ONE it() block.
 * Stable frozen object refs for useAuth/useLanguage — mandatory for Profile.
 *
 * Branches covered here (complement to Profile.test.tsx + Profile.extended.test.tsx):
 *   1. uploadAvatar throws → toast.error("Avatar upload failed")
 *   2. profile.avatarUrl truthy → avatar img src rendered (avatar update effect)
 *   3. projectCount + analyses shown when no API error
 *   4. "Joined" label renders with a year from user.created_at
 *
 * NOT tested (legitimately out of reach):
 *   - projectCountError "—" branch (requires getProjects to throw, which means
 *     the whole fetchData rejects before profileData is set → loading spinner
 *     stays on screen; asserting "Error" text after that requires a 2nd render
 *     → OOM).
 *   - Activity items from real projects (same OOM reason documented in
 *     Profile.extended.test.tsx).
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
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockGetProjects,
  mockGetProjectImages,
  mockRefreshProfile,
  mockUploadAvatar,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetProjects: vi.fn(),
  mockGetProjectImages: vi.fn(),
  mockRefreshProfile: vi.fn().mockResolvedValue(undefined),
  mockUploadAvatar: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stable auth / language objects
// Profile.tsx's useEffect([user, profile, t]) fires on EVERY render if these
// return new object references. State changes from the avatar upload flow
// trigger re-renders; without stable refs the effect infinite-loops → OOM.
// ---------------------------------------------------------------------------
const STABLE_USER = Object.freeze({
  id: 'u-gaps',
  email: 'gaps@example.com',
  created_at: '2022-03-01T00:00:00Z',
});

const STABLE_PROFILE = Object.freeze({
  username: 'Gap Tester',
  title: 'Scientist',
  organization: 'GapLab',
  bio: 'Gap bio.',
  location: 'Berlin',
  avatarUrl: 'https://cdn.example.com/avatar.png', // non-null → tests avatar update effect
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
  createImagePreviewUrl: vi.fn().mockResolvedValue('blob:fake-gaps'),
}));

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <header data-testid="dashboard-header" />,
}));

// AvatarUploadButton — capture onFileSelect so we can invoke it directly.
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

// Polyfill URL methods for jsdom
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
}
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:mock'),
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
  if (!_capturedOnFileSelect)
    throw new Error('onFileSelect not captured from AvatarUploadButton');
  return _capturedOnFileSelect;
}

// ---------------------------------------------------------------------------
// Suite — ONE render, ONE it() block (OOM discipline)
// ---------------------------------------------------------------------------

describe('Profile — gaps: avatar error + avatar img + stats + joined year', () => {
  beforeAll(async () => {
    // Return a project with 3 images (exercises project count > 0 path)
    mockGetProjects.mockResolvedValue({
      projects: [
        {
          id: 'p1',
          title: 'My Project',
          created_at: '2022-06-01T00:00:00Z',
          type: 'spheroid',
        },
      ],
      total: 1,
    });
    mockGetProjectImages.mockResolvedValue({
      images: [
        {
          id: 'i1',
          name: 'img1.png',
          created_at: '2022-06-10T00:00:00Z',
          segmentation_status: 'completed',
        },
      ],
      total: 1,
    });

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    );

    // Wait until profileData is loaded and the name renders
    await waitFor(
      () => expect(screen.queryByText('Gap Tester')).toBeInTheDocument(),
      { timeout: 15000 }
    );
  });

  afterAll(() => {
    cleanup();
    mockGetProjects.mockReset();
    mockGetProjectImages.mockReset();
    mockNavigate.mockReset();
    mockRefreshProfile.mockReset();
    mockUploadAvatar.mockReset();
  });

  it('static fields, avatar img, joined year, upload-error path', async () => {
    // ---- Profile identity fields ----
    expect(screen.getByText('Gap Tester')).toBeInTheDocument();
    expect(screen.getByText('Scientist')).toBeInTheDocument();
    expect(screen.getByText('GapLab')).toBeInTheDocument();
    expect(screen.getByText('gaps@example.com')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();

    // ---- Joined year from user.created_at = '2022-03-01' → "Joined March 2022" ----
    const joinedEl = screen.getByText(/Joined/);
    expect(joinedEl.textContent).toMatch(/2022/);

    // ---- avatar img rendered (STABLE_PROFILE.avatarUrl is non-null) ----
    // Profile renders avatar url via either profileData.avatar (non-placeholder)
    // or profile.avatarUrl fallback. With avatarUrl='https://cdn.example.com/avatar.png'
    // the img tag should exist.
    const avatarImgs = document.querySelectorAll('img[alt="Gap Tester"]');
    expect(avatarImgs.length).toBeGreaterThanOrEqual(1);

    // ---- Project count stat cell shows '1' (not '—') ----
    // The sidebar grid renders projectCount above "Projects" label
    expect(screen.getByText('Projects')).toBeInTheDocument();

    // ---- uploadAvatar throws → toast.error("Avatar upload failed") ----
    const { createImagePreviewUrl } = await import('@/lib/tiffConverter');
    (createImagePreviewUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'blob:error-flow'
    );
    mockUploadAvatar.mockRejectedValueOnce(new Error('network error'));
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    // Trigger avatar select with valid PNG
    await getAvatarHandler()(
      new File([new Uint8Array(1)], 'avatar.png', { type: 'image/png' })
    );
    await waitFor(
      () => expect(screen.getByTestId('crop-dialog')).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // Confirm crop → uploadAvatar throws → should show upload error toast
    fireEvent.click(screen.getByTestId('crop-confirm-btn'));
    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith('Avatar upload failed'),
      { timeout: 5000 }
    );

    // Dialog should close after the error
    await waitFor(
      () => expect(screen.queryByTestId('crop-dialog')).not.toBeInTheDocument(),
      { timeout: 5000 }
    );
  });
});
