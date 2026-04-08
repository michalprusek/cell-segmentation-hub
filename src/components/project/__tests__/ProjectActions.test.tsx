import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectActions from '../ProjectActions';

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    login: vi.fn(),
    logout: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    revokeProjectShare: vi.fn().mockResolvedValue(undefined),
    getProjects: vi
      .fn()
      .mockResolvedValue({ projects: [], total: 0, page: 1, totalPages: 1 }),
  },
  apiClient: {
    isAuthenticated: vi.fn(() => false),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    revokeProjectShare: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/project/ShareDialog', () => ({
  ShareDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) =>
    open ? (
      <div data-testid="share-dialog">
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

describe('ProjectActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the actions trigger button', () => {
    render(<ProjectActions projectId="proj-1" projectTitle="Test Project" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opens dropdown menu when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<ProjectActions projectId="proj-1" projectTitle="Test Project" />);
    await user.click(screen.getByRole('button'));
    expect(
      screen.getByRole('menuitem', { name: /share/i })
    ).toBeInTheDocument();
  });

  it('shows share and delete options for owned project', async () => {
    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-1"
        projectTitle="Test Project"
        isShared={false}
      />
    );
    await user.click(screen.getByRole('button'));
    expect(
      screen.getByRole('menuitem', { name: /share/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /delete/i })
    ).toBeInTheDocument();
  });

  it('shows remove from shared option for shared project instead of delete', async () => {
    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-1"
        projectTitle="Test Project"
        isShared={true}
        shareId="share-1"
      />
    );
    await user.click(screen.getByRole('button'));
    expect(
      screen.queryByRole('menuitem', { name: /^delete$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /remove/i })
    ).toBeInTheDocument();
  });

  it('calls deleteProject when delete is clicked', async () => {
    const apiClient = (await import('@/lib/api')).default;
    const onProjectUpdate = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-1"
        projectTitle="Test Project"
        isShared={false}
        onProjectUpdate={onProjectUpdate}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    await waitFor(() => {
      expect(apiClient.deleteProject).toHaveBeenCalledWith('proj-1');
    });
  });

  it('opens share dialog when share is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-1"
        projectTitle="Test Project"
        isShared={false}
      />
    );
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByTestId('share-dialog')).toBeInTheDocument();
    });
  });

  it('calls onProjectUpdate optimistically before API call', async () => {
    const onProjectUpdate = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-1"
        isShared={false}
        onProjectUpdate={onProjectUpdate}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(onProjectUpdate).toHaveBeenCalledWith('proj-1', 'delete');
  });
});
