import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectModelSelector from '@/components/project/ProjectModelSelector';

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// The hover card fetches preview geometry over the network on pointer-enter.
// Stub it to a passthrough: it is not what these tests are about, and its
// fetches would make them depend on the specimen index.
vi.mock('@/components/specimens/SpecimenHoverCard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ProjectModelSelector', () => {
  const onModelChange = vi.fn();
  const onDetectHolesChange = vi.fn();

  const renderSelector = (props: Record<string, unknown> = {}) =>
    render(
      <ProjectModelSelector
        projectType="spheroid"
        storedModel={null}
        onModelChange={onModelChange}
        detectHoles
        onDetectHolesChange={onDetectHolesChange}
        {...props}
      />
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing until the project type is known', () => {
    const { container } = renderSelector({ projectType: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the trigger with the resolved model, not the stored value', async () => {
    renderSelector({ storedModel: null });

    // `null` means "never chosen"; the label must show what will actually run.
    await waitFor(() =>
      expect(screen.getByTestId('project-model-trigger')).toHaveTextContent(
        'settings.modelSelection.models.segformer.name'
      )
    );
  });

  it('shows the stored model when the project has one', async () => {
    renderSelector({ storedModel: 'mamba_unet' });

    await waitFor(() =>
      expect(screen.getByTestId('project-model-trigger')).toHaveTextContent(
        'settings.modelSelection.models.mamba_unet.name'
      )
    );
  });

  it('offers only the models this project type can run', async () => {
    const user = userEvent.setup();
    renderSelector({ projectType: 'spheroid' });

    await user.click(screen.getByTestId('project-model-trigger'));

    // The five spheroid models, and NOT the specialised ones. The negative
    // half is the point: an unfiltered list is what let a wound model be
    // selected for a spheroid project.
    for (const id of [
      'hrnet',
      'cbam_resunet',
      'unet_spherohq',
      'segformer',
      'mamba_unet',
    ]) {
      expect(
        screen.getByTestId(`project-model-option-${id}`)
      ).toBeInTheDocument();
    }
    for (const id of ['wound', 'sperm', 'microtubule', 'neurite_soma']) {
      expect(
        screen.queryByTestId(`project-model-option-${id}`)
      ).not.toBeInTheDocument();
    }
  });

  it('persists the picked model', async () => {
    const user = userEvent.setup();
    renderSelector({ projectType: 'spheroid', storedModel: null });

    await user.click(screen.getByTestId('project-model-trigger'));
    await user.click(screen.getByTestId('project-model-option-cbam_resunet'));

    expect(onModelChange).toHaveBeenCalledWith('cbam_resunet');
  });

  it('does not persist a click on the already-selected model', async () => {
    // Radix's MenuRadioItem fires `onValueChange` UNCONDITIONALLY on select —
    // unlike `Select`, it has no equality guard. Without our own check, a user
    // clicking the checked row to confirm it writes the RESOLVED DEFAULT into
    // a column that was NULL, freezing the project on today's default. That is
    // precisely the backfill the migration refuses to perform.
    const user = userEvent.setup();
    renderSelector({ projectType: 'spheroid', storedModel: null });

    await user.click(screen.getByTestId('project-model-trigger'));
    await user.click(screen.getByTestId('project-model-option-segformer'));

    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('persists a click on a model that is merely equal to the default', async () => {
    // The other half: with the model EXPLICITLY stored, re-picking it is still
    // a no-op, but picking a different one must go through — the guard must
    // compare against the resolved model, not suppress everything.
    const user = userEvent.setup();
    renderSelector({ projectType: 'spheroid', storedModel: 'segformer' });

    await user.click(screen.getByTestId('project-model-trigger'));
    await user.click(screen.getByTestId('project-model-option-hrnet'));

    expect(onModelChange).toHaveBeenCalledWith('hrnet');
  });

  it('shows a single-model type its one model, disabled', async () => {
    const user = userEvent.setup();
    renderSelector({ projectType: 'wound' });

    await user.click(screen.getByTestId('project-model-trigger'));

    const option = screen.getByTestId('project-model-option-wound');
    expect(option).toBeInTheDocument();
    // Visible so the user can see WHICH model runs, disabled because there is
    // nothing to choose.
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('project.modelOnlyOptionForType')
    ).toBeInTheDocument();
  });

  it.each(['spheroid', 'wound'])(
    'offers the detect-holes toggle on a %s project',
    async projectType => {
      const user = userEvent.setup();
      renderSelector({ projectType });

      await user.click(screen.getByTestId('project-model-trigger'));
      await user.click(screen.getByTestId('project-model-detect-holes'));

      expect(onDetectHolesChange).toHaveBeenCalledWith(false);
    }
  );

  it.each([
    'microtubules',
    'sperm',
    'microcapsule',
    'neurite',
    'spheroid_invasive',
  ])('hides the detect-holes toggle on a %s project', async projectType => {
    // `microtubules` produces polylines and never polygonises, so the flag
    // could not apply. The other four DO honour it in the ML service, but an
    // interior hole there is noise rather than structure — so the parameter is
    // pinned to its default and a control for it would misrepresent what the
    // user can influence.
    const user = userEvent.setup();
    renderSelector({ projectType });

    await user.click(screen.getByTestId('project-model-trigger'));

    expect(
      screen.queryByTestId('project-model-detect-holes')
    ).not.toBeInTheDocument();
    // …and the model list is still there, so this is a hidden TOGGLE, not a
    // broken menu.
    expect(
      screen.getAllByTestId(/^project-model-option-/).length
    ).toBeGreaterThan(0);
  });

  it('renders a static pill with no menu for a read-only viewer', async () => {
    const user = userEvent.setup();
    renderSelector({ onModelChange: undefined });

    expect(screen.getByTestId('project-model-readonly')).toBeInTheDocument();
    expect(
      screen.queryByTestId('project-model-trigger')
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('project-model-readonly'));
    expect(onModelChange).not.toHaveBeenCalled();
  });
});
