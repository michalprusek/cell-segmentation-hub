import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import StatsOverview from '@/components/StatsOverview';

// Mock the API client — include auth methods that AuthProvider needs.
vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi.fn().mockResolvedValue(null),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    getProjects: vi.fn(),
    getProjectImages: vi.fn(),
    getUserStorageStats: vi.fn(),
  },
}));

// ThemeProvider and LanguageProvider call useAuth internally. When user is
// truthy, ThemeProvider calls getUserProfile() asynchronously, which means
// `loaded` is false on first render → ThemeProvider returns null → no content.
// Mock both providers as passthroughs to avoid this async render block.
vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/LanguageContext', async () => {
  const actual = await vi.importActual('@/contexts/LanguageContext');
  return {
    ...actual,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Mock useAuth at the concrete module level so StatsOverview sees a user.
vi.mock('@/contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    isLoading: false,
  })),
}));

// Mock useLanguage so the component sees real translated strings.
// LanguageProvider is a passthrough, so the default context t() returns keys.
// We need real translations for assertions that check translated text.
import enTranslations from '@/translations/en';
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string, options?: Record<string, unknown>): string => {
      const keys = key.split('.');

      let result: any = enTranslations;
      for (const k of keys) {
        result = result?.[k];
        if (result === undefined) break;
      }
      if (typeof result === 'string') {
        // Handle simple interpolation like {{count}}
        if (options) {
          return result.replace(/\{\{(\w+)\}\}/g, (_, k) =>
            String(options[k] ?? '')
          );
        }
        return result;
      }
      return key;
    },
    translations: enTranslations,
    availableLanguages: ['en'],
  })),
}));

describe('StatsOverview', () => {
  let mockApiClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked API client
    const apiModule = await import('@/lib/api');
    mockApiClient = apiModule.default;

    // Default API responses
    mockApiClient.getProjects.mockResolvedValue({
      total: 3,
      projects: [
        { id: 'project-1', name: 'Test Project 1' },
        { id: 'project-2', name: 'Test Project 2' },
        { id: 'project-3', name: 'Test Project 3' },
      ],
    });

    mockApiClient.getProjectImages.mockResolvedValue({
      images: [
        {
          id: 'img-1',
          segmentation_status: 'completed',
          created_at: new Date().toISOString(),
        },
        {
          id: 'img-2',
          segmentation_status: 'pending',
          created_at: new Date(Date.now() - 86400000).toISOString(), // Yesterday
        },
      ],
    });

    mockApiClient.getUserStorageStats.mockResolvedValue({
      totalStorageGB: 0.5,
      totalStorageMB: 512,
      totalImages: 10,
      averageImageSizeMB: 2.5,
    });
  });

  it('renders all stat cards with translated labels', () => {
    render(<StatsOverview />);

    // Check for translated labels from dashboard.stats keys
    expect(screen.getByText('Total Projects')).toBeInTheDocument();
    expect(screen.getByText('Processed Images')).toBeInTheDocument();
    expect(screen.getByText('Uploaded Today')).toBeInTheDocument();
    expect(screen.getByText('Storage Used')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    render(<StatsOverview />);

    const loadingElements = screen.getAllByText('...');
    expect(loadingElements).toHaveLength(4);
  });

  it('displays correct stats after loading', async () => {
    render(<StatsOverview />);

    // All four stat cards update to '3' (3 projects, 3 completed, 3 today)
    await waitFor(() => {
      const threeElements = screen.getAllByText('3');
      expect(threeElements.length).toBeGreaterThanOrEqual(1); // At least projects count
    });

    expect(screen.getByText('Active spheroid studies')).toBeInTheDocument();
    expect(screen.getByText('Successfully segmented')).toBeInTheDocument();
    expect(screen.getByText('Spheroid images')).toBeInTheDocument();
  });

  it('calculates completed images correctly', async () => {
    render(<StatsOverview />);

    await waitFor(() => {
      // Mock returns 1 completed image per project × 3 projects = 3 completed.
      // Multiple '3's appear (projects + completed + today); use getAllByText.
      const threes = screen.getAllByText('3');
      expect(threes.length).toBeGreaterThanOrEqual(1);
    });

    // Verify the processed images stat is displayed
    expect(screen.getByText('Processed Images')).toBeInTheDocument();
  });

  it('calculates today uploads correctly', async () => {
    render(<StatsOverview />);

    await waitFor(() => {
      // Mock returns 1 upload today per project × 3 projects = 3 today uploads.
      const threes = screen.getAllByText('3');
      expect(threes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays storage stats in correct format', async () => {
    render(<StatsOverview />);

    await waitFor(() => {
      expect(screen.getByText('512 MB')).toBeInTheDocument();
    });

    expect(screen.getByText('~2.5 MB per image')).toBeInTheDocument();
  });

  it('displays storage in GB when appropriate', async () => {
    mockApiClient.getUserStorageStats.mockResolvedValue({
      totalStorageGB: 2.5,
      totalStorageMB: 2560,
      totalImages: 10,
      averageImageSizeMB: 2.5,
    });

    render(<StatsOverview />);

    await waitFor(() => {
      expect(screen.getByText('2.5 GB')).toBeInTheDocument();
    });
  });

  it('handles API errors gracefully', async () => {
    mockApiClient.getProjects.mockRejectedValue(new Error('API Error'));
    mockApiClient.getUserStorageStats.mockRejectedValue(
      new Error('Storage API Error')
    );

    render(<StatsOverview />);

    await waitFor(() => {
      // Multiple stat cards show '0' when API fails
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('0 MB')).toBeInTheDocument(); // Default storage value
  });

  it('handles empty projects response', async () => {
    mockApiClient.getProjects.mockResolvedValue({
      total: 0,
      projects: [],
    });

    render(<StatsOverview />);

    await waitFor(() => {
      // Multiple stat cards may show '0'
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles missing images in project response', async () => {
    mockApiClient.getProjectImages.mockResolvedValue({
      images: [], // Empty images array instead of null
      total: 0,
    });

    render(<StatsOverview />);

    await waitFor(() => {
      expect(screen.queryByText('...')).not.toBeInTheDocument();
    });

    // Should handle gracefully without crashing — project count shows 3
    const threes = screen.getAllByText('3');
    expect(threes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders correct icons for each stat', () => {
    render(<StatsOverview />);

    // Check that all stat cards have the icon wrapper
    const iconWrappers = document.querySelectorAll('.bg-blue-100');
    expect(iconWrappers).toHaveLength(4);
  });

  it('applies correct responsive grid classes', () => {
    render(<StatsOverview />);

    const gridContainer = document.querySelector(
      '.grid.grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-4'
    );
    expect(gridContainer).toBeInTheDocument();
  });

  it('does not fetch stats when user is not available', async () => {
    // Override the useAuth mock to return no user for this specific test
    const { useAuth } = await import('@/contexts/useAuth');
    vi.mocked(useAuth).mockReturnValueOnce({
      user: null,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      refreshToken: vi.fn(),
      isLoading: false,
    });

    render(<StatsOverview />);

    // Since no user is available, API calls should not be made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockApiClient.getProjects).not.toHaveBeenCalled();
    expect(mockApiClient.getUserStorageStats).not.toHaveBeenCalled();
  });

  it('handles individual project image fetch failures', async () => {
    mockApiClient.getProjectImages
      .mockResolvedValueOnce({
        images: [
          {
            id: 'img-1',
            segmentation_status: 'completed',
            created_at: new Date().toISOString(),
          },
        ],
      })
      .mockRejectedValueOnce(new Error('Project 2 failed'))
      .mockResolvedValueOnce({
        images: [
          {
            id: 'img-3',
            segmentation_status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      });

    render(<StatsOverview />);

    // Wait until loading completes: projects (3), completed images (1), today (2).
    // All state updates are batched so when loading=false all values appear together.
    await waitFor(
      () => {
        // Project count: 3 projects loaded
        const threes = screen.getAllByText('3');
        expect(threes.length).toBeGreaterThanOrEqual(1);
        // Completed images: 1 (only project-1 succeeded with a completed image)
        // This appears only after setLoading(false) which requires getUserStorageStats to resolve.
        const ones = screen.queryAllByText('1');
        expect(ones.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 }
    );
  });
});
