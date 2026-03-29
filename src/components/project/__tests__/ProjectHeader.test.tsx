import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectHeader from '../ProjectHeader';

// Mock DashboardHeader — it likely fetches data we don't need
vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header" />,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Capture navigation calls
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('ProjectHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the project title', () => {
    render(<ProjectHeader projectTitle="My Test Project" imagesCount={5} loading={false} />);
    expect(screen.getByText('My Test Project')).toBeInTheDocument();
  });

  it('renders image count when not loading', () => {
    render(<ProjectHeader projectTitle="Project" imagesCount={12} loading={false} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('renders loading text when loading is true', () => {
    render(<ProjectHeader projectTitle="Project" imagesCount={0} loading={true} />);
    // t('common.loading') defaults to "Loading" in English
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders DashboardHeader', () => {
    render(<ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />);
    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
  });

  it('renders a back button', () => {
    render(<ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />);
    const backButton = screen.getByRole('button');
    expect(backButton).toBeInTheDocument();
  });

  it('navigates to /dashboard when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />);
    const backButton = screen.getByRole('button');
    await user.click(backButton);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
