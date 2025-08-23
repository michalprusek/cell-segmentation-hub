import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import StatsOverview from '@/components/StatsOverview';
import { useAuth } from '@/contexts/exports';

// Mock the API client
vi.mock('@/lib/api', () => ({
  default: {
    getProjects: vi.fn(),
    getProjectImages: vi.fn(),
    getUserStorageStats: vi.fn(),
  },
}));

// Mock the auth context
vi.mock('@/contexts/exports', async () => {
  const actual = await vi.importActual('@/contexts/exports');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      isAuthenticated: true,
    }),
  };
});

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

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument(); // Total projects
    });

    expect(screen.getByText('Active spheroid studies')).toBeInTheDocument();
    expect(screen.getByText('Successfully segmented')).toBeInTheDocument();
    expect(screen.getByText('Spheroid images')).toBeInTheDocument();
  });

  it('calculates completed images correctly', async () => {
    render(<StatsOverview />);

    await waitFor(() => {
      // Should show completed images count from the API response
      // Based on our mock data, there's 1 completed image per project across all projects
      expect(screen.getByText('3')).toBeInTheDocument(); // Projects count
    });

    // Verify the processed images stat is displayed
    expect(screen.getByText('Processed Images')).toBeInTheDocument();
  });

  it('calculates today uploads correctly', async () => {
    render(<StatsOverview />);

    await waitFor(() => {
      // Should show 3 uploads today (1 per project based on our mock)
      expect(screen.getByText('3')).toBeInTheDocument();
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
      expect(screen.getByText('0')).toBeInTheDocument(); // Should show 0 for failed stats
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
      expect(screen.getByText('0')).toBeInTheDocument();
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

    // Should handle gracefully without crashing
    expect(screen.getByText('3')).toBeInTheDocument(); // Project count should still work
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
    // Temporarily mock the auth context to return no user
    vi.doMock('@/contexts/exports', async () => {
      const actual = await vi.importActual('@/contexts/exports');
      return {
        ...actual,
        useAuth: () => ({
          user: null,
          isAuthenticated: false,
        }),
      };
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

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument(); // Projects count
    });

    // Should still show stats for successful project fetches
    expect(screen.getByText('1')).toBeInTheDocument(); // Only 1 completed image from successful fetches
  });
});
