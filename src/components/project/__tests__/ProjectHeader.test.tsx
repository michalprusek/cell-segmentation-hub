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

  it.each([
    undefined,
    'spheroid',
    'wound',
    'sperm',
    'microtubules',
    'microcapsule',
    'neurite',
  ] as const)('offers no pixel size on a project of type %s', projectType => {
    // Only a type whose model READS the value gets the box. It arrived with
    // the neurite work (#501) rendered for every project type, so a spheroid
    // or wound project showed a µm/px box that nothing on its path read, and
    // it was removed on 2026-09-13 for exactly that. The export dialog has
    // its own scale field for everything else. The handler is passed, so
    // the type alone is what keeps the box away.
    render(
      <ProjectHeader
        projectTitle="Project"
        imagesCount={3}
        loading={false}
        projectType={projectType}
        pixelSizeUm={1.6}
        onPixelSizeChange={vi.fn()}
      />
    );
    expect(
      screen.queryByRole('textbox', { name: /pixel size/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-pixel-size')).not.toBeInTheDocument();
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

// ─── the model picker's seam ────────────────────────────────────────────────
//
// The picker has its own suite (ProjectModelSelector.test.tsx) that renders it
// directly. That leaves the WIRING untested: dropping `storedModel=` or
// `projectType=` here turns the feature into a picker that always shows the
// default, and every one of those tests still passes. These assert the props
// actually arrive — the same class of gap CLAUDE.md records for
// `SegmentationEditorLayout`'s `projectType`.
describe('ProjectHeader → ProjectModelSelector wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no model pill before the project type is known', () => {
    render(<ProjectHeader projectTitle="P" imagesCount={0} loading={false} />);
    expect(
      screen.queryByTestId('project-model-trigger')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('project-model-readonly')
    ).not.toBeInTheDocument();
  });

  it('hands the project type down, so the pill shows that type’s default', () => {
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="wound"
        onTypeChange={vi.fn()}
        onModelChange={vi.fn()}
        detectHoles
        onDetectHolesChange={vi.fn()}
      />
    );
    // Real copy, not a key: this suite renders through the real
    // LanguageProvider, which makes the assertion also prove the model's
    // translation key resolves.
    expect(screen.getByTestId('project-model-trigger')).toHaveTextContent(
      'Wound Healing'
    );
  });

  it('hands the STORED model down, not just the type', () => {
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="spheroid"
        onTypeChange={vi.fn()}
        segmentationModel="cbam_resunet"
        onModelChange={vi.fn()}
        detectHoles
        onDetectHolesChange={vi.fn()}
      />
    );
    // Not the spheroid default (segformer) — so a dropped `storedModel=` prop
    // fails here rather than passing by resolving to the default.
    expect(screen.getByTestId('project-model-trigger')).toHaveTextContent(
      'CBAM-ResUNet'
    );
  });

  it('places the model pill immediately after the project-type control', () => {
    // The requested layout: type on the left, model to its right. A DOM-order
    // assertion, because the two must stay in one flex row — split apart they
    // can wrap independently and stop reading as one decision.
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="spheroid"
        onTypeChange={vi.fn()}
        onModelChange={vi.fn()}
        detectHoles
        onDetectHolesChange={vi.fn()}
      />
    );
    const typePill = screen.getByLabelText('Change project type');
    const modelPill = screen.getByTestId('project-model-trigger');

    expect(typePill.parentElement).toBe(modelPill.parentElement);
    expect(
      typePill.compareDocumentPosition(modelPill) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('degrades to a static pill when the viewer may not change the model', () => {
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="spheroid"
        detectHoles
        onDetectHolesChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('project-model-readonly')).toBeInTheDocument();
    expect(
      screen.queryByTestId('project-model-trigger')
    ).not.toBeInTheDocument();
  });

  it('forwards the detect-holes toggle to its handler', async () => {
    const onDetectHolesChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="spheroid"
        onTypeChange={vi.fn()}
        onModelChange={vi.fn()}
        detectHoles
        onDetectHolesChange={onDetectHolesChange}
      />
    );

    await user.click(screen.getByTestId('project-model-trigger'));
    await user.click(screen.getByTestId('project-model-detect-holes'));

    expect(onDetectHolesChange).toHaveBeenCalledWith(false);
  });
});

// The spheroid-disintegration model resamples each frame to the 1.28 µm/px it
// was validated at when the image's pixel size is known; this is where a
// `spheroid_invasive` project's value is set.
describe('ProjectHeader — pixel size (spheroid_invasive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderScale = (
    props: Partial<React.ComponentProps<typeof ProjectHeader>> = {}
  ) => {
    const onPixelSizeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectHeader
        projectTitle="P"
        imagesCount={0}
        loading={false}
        projectType="spheroid_invasive"
        onPixelSizeChange={onPixelSizeChange}
        {...props}
      />
    );
    return {
      user,
      onPixelSizeChange,
      input: () => screen.getByRole('textbox', { name: /pixel size/i }),
    };
  };

  it('shows the stored value, labelled, with the resampling hint and its range', () => {
    const { input } = renderScale({ pixelSizeUm: 1.6 });
    expect(input()).toHaveValue('1.6');
    // The hint states the range the module resamples (factors 0.5-2x of
    // 1.28 µm/px); outside it a frame is segmented as uploaded.
    const hint = screen.getByText(/between 0\.64 and 2\.56 µm\/px/i);
    expect(hint).toHaveTextContent(/resampled to the 1\.28 µm\/px/i);
    expect(hint).toHaveTextContent(/others are segmented as uploaded/i);
    expect(hint).toHaveTextContent(/applies to new segmentations/i);
    expect(input()).toHaveAttribute('aria-describedby', hint.id);
  });

  it('shows an unset value as an empty box, not as zero', () => {
    const { input } = renderScale({ pixelSizeUm: null });
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('placeholder', 'not set');
  });

  it.each(['1e', '1.6.6', 'abc', '--1', '0x10', 'Infinity', '1,6,6'])(
    'keeps the stored value when %s is typed and the box is left',
    async text => {
      // A number input reported '' for such text, so leaving the box cleared
      // the stored pixel size and the toast said it was saved.
      const { user, input, onPixelSizeChange } = renderScale({
        pixelSizeUm: 1.6,
      });
      await user.clear(input());
      await user.type(input(), text);
      await user.tab();
      expect(onPixelSizeChange).not.toHaveBeenCalled();
      // the typo stays visible, marked, with the reason
      expect(input()).toHaveValue(text);
      expect(input()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(
        /between 0\.001 and 1000/
      );
    }
  );

  it('reads a decimal comma, which is all a comma-locale keypad offers', async () => {
    const { user, input, onPixelSizeChange } = renderScale({
      pixelSizeUm: null,
    });
    await user.type(input(), '1,6');
    await user.tab();
    expect(onPixelSizeChange).toHaveBeenCalledWith(1.6);
  });

  it('commits a new value on Enter and on blur', async () => {
    const { user, input, onPixelSizeChange } = renderScale({
      pixelSizeUm: null,
    });
    await user.type(input(), '2.56{Enter}');
    expect(onPixelSizeChange).toHaveBeenLastCalledWith(2.56);
    await user.clear(input());
    await user.type(input(), '0.9');
    await user.tab();
    expect(onPixelSizeChange).toHaveBeenLastCalledWith(0.9);
  });

  it('keeps six decimals, as the export dialog does', async () => {
    const { user, input, onPixelSizeChange } = renderScale({
      pixelSizeUm: null,
    });
    await user.type(input(), '0.07222224{Enter}');
    expect(onPixelSizeChange).toHaveBeenCalledWith(0.072222);
  });

  it('clears the value when the box is emptied', async () => {
    const { user, input, onPixelSizeChange } = renderScale({
      pixelSizeUm: 1.6,
    });
    await user.clear(input());
    await user.tab();
    expect(onPixelSizeChange).toHaveBeenCalledWith(null);
  });

  it('does not save the value it already has', async () => {
    const { user, input, onPixelSizeChange } = renderScale({
      pixelSizeUm: 1.6,
    });
    await user.clear(input());
    await user.type(input(), '1.60{Enter}');
    expect(onPixelSizeChange).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1000.5'])(
    'refuses %s, says why, and Escape restores the stored value',
    async text => {
      const { user, input, onPixelSizeChange } = renderScale({
        pixelSizeUm: 1.6,
      });
      await user.clear(input());
      await user.type(input(), `${text}{Enter}`);
      expect(onPixelSizeChange).not.toHaveBeenCalled();
      expect(input()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(
        /between 0\.001 and 1000/
      );
      await user.type(input(), '{Escape}');
      expect(input()).toHaveValue('1.6');
      expect(input()).not.toHaveAttribute('aria-invalid');
      expect(onPixelSizeChange).not.toHaveBeenCalled();
    }
  );

  it('is a static pill for a viewer who may not change it', () => {
    renderScale({ pixelSizeUm: 1.6, onPixelSizeChange: undefined });
    expect(
      screen.queryByRole('textbox', { name: /pixel size/i })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('project-pixel-size-readonly')).toHaveTextContent(
      '1.6 µm/px'
    );
  });

  it('is absent for such a viewer when no value is set', () => {
    renderScale({ pixelSizeUm: null, onPixelSizeChange: undefined });
    expect(screen.queryByTestId('project-pixel-size')).not.toBeInTheDocument();
  });
});
