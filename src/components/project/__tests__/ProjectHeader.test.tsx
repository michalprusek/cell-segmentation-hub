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

  it('does not offer a project-level pixel scale', () => {
    // The scale belongs to the EXPORT, not to the project. It arrived here with
    // the neurite work (#501) but was rendered for every project type, so a
    // spheroid or wound project showed a µm/px box that nothing on its path
    // reads. The export dialog has its own field and prefills it from the
    // IMAGE's own calibration first, so nothing is lost by not having one here.
    render(
      <ProjectHeader projectTitle="Project" imagesCount={3} loading={false} />
    );
    // A number box is the only thing this header ever rendered one for, so its
    // absence is the assertion. The props are gone from the interface too, so
    // re-adding the control means re-adding them — which is the visible step.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
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

  // Requested 2026-09-09: "When I am in a project and press the back button
  // ... it always transfers me to the home page, and not back into the folder
  // that I was just in (where my project is)."
  describe('back button destination', () => {
    const clickBack = async (
      props: Partial<React.ComponentProps<typeof ProjectHeader>> = {}
    ) => {
      const user = userEvent.setup();
      render(
        <ProjectHeader
          projectTitle="Project"
          imagesCount={0}
          loading={false}
          {...props}
        />
      );
      await user.click(screen.getByRole('button'));
    };

    it('returns to the folder the project is filed in', async () => {
      await clickBack({ folderId: 'folder-7' });
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard?folder=folder-7');
    });

    it('returns to the root for a project that is not in a folder', async () => {
      // `null` is a measurement, not an absence: the project IS at the root.
      await clickBack({ folderId: null });
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('returns to the root while the project is still loading', async () => {
      // `undefined` means "not known yet". Guessing a folder here would send
      // the user somewhere they never were; the root is where they used to
      // land anyway, so an early click is no worse than before.
      await clickBack({ folderId: undefined });
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('escapes the folder id it puts in the query string', async () => {
      // Folder ids are uuids today, so this cannot bite yet — which is exactly
      // when it is cheap to get right. An unescaped `&` would silently drop
      // the rest of the parameter and land the user at the root.
      await clickBack({ folderId: 'a&b c' });
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard?folder=a%26b%20c');
    });
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
