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
    render(
      <ProjectHeader
        projectTitle="My Test Project"
        imagesCount={5}
        loading={false}
      />
    );
    expect(screen.getByText('My Test Project')).toBeInTheDocument();
  });

  it('renders image count when not loading', () => {
    render(
      <ProjectHeader projectTitle="Project" imagesCount={12} loading={false} />
    );
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('renders loading text when loading is true', () => {
    render(
      <ProjectHeader projectTitle="Project" imagesCount={0} loading={true} />
    );
    // t('common.loading') defaults to "Loading" in English
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders DashboardHeader', () => {
    render(
      <ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />
    );
    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
  });

  it('renders a back button', () => {
    render(
      <ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />
    );
    const backButton = screen.getByRole('button');
    expect(backButton).toBeInTheDocument();
  });

  it('navigates to /dashboard when back button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProjectHeader projectTitle="Project" imagesCount={0} loading={false} />
    );
    const backButton = screen.getByRole('button');
    await user.click(backButton);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});

describe('ProjectHeader — renaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const openEditor = async (onTitleChange = vi.fn()) => {
    const user = userEvent.setup();
    render(
      <ProjectHeader
        projectTitle="Old name"
        imagesCount={3}
        loading={false}
        onTitleChange={onTitleChange}
      />
    );
    await user.click(screen.getByTestId('project-title-edit'));
    return {
      user,
      onTitleChange,
      input: screen.getByTestId('project-title-input'),
    };
  };

  it('offers no rename control when renaming is not allowed', () => {
    // A shared project is read-only for the annotator, so the affordance must
    // not be there at all rather than failing on click.
    render(
      <ProjectHeader projectTitle="Read only" imagesCount={1} loading={false} />
    );
    expect(screen.queryByTestId('project-title-edit')).not.toBeInTheDocument();
  });

  it('commits the new name on Enter', async () => {
    const { user, onTitleChange, input } = await openEditor();
    await user.clear(input);
    await user.type(input, 'New name{Enter}');
    expect(onTitleChange).toHaveBeenCalledWith('New name');
  });

  it('commits on blur, so clicking away is not a silent loss', async () => {
    const { user, onTitleChange, input } = await openEditor();
    await user.clear(input);
    await user.type(input, 'Blurred name');
    await user.tab();
    expect(onTitleChange).toHaveBeenCalledWith('Blurred name');
  });

  it('discards the edit on Escape', async () => {
    const { user, onTitleChange, input } = await openEditor();
    await user.clear(input);
    await user.type(input, 'Abandoned{Escape}');
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.getByText('Old name')).toBeInTheDocument();
  });

  it('trims, and refuses a name that is only whitespace', async () => {
    // An empty title is rejected by the backend schema anyway; sending it
    // would be a round-trip that can only fail, plus a misleading toast.
    const { user, onTitleChange, input } = await openEditor();
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('does not fire when the name is unchanged', async () => {
    const { user, onTitleChange, input } = await openEditor();
    await user.type(input, '{Enter}');
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('follows the title when it changes while the editor is closed', async () => {
    // The title arrives empty on first paint and again after a refetch. If the
    // draft did not follow it, opening the editor later would show a stale or
    // blank name.
    const onTitleChange = vi.fn();
    const { rerender } = render(
      <ProjectHeader
        projectTitle=""
        imagesCount={0}
        loading
        onTitleChange={onTitleChange}
      />
    );
    rerender(
      <ProjectHeader
        projectTitle="Loaded name"
        imagesCount={2}
        loading={false}
        onTitleChange={onTitleChange}
      />
    );
    await userEvent.setup().click(screen.getByTestId('project-title-edit'));
    expect(screen.getByTestId('project-title-input')).toHaveValue(
      'Loaded name'
    );
  });
});
