import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ModelSettingsSection from '../ModelSettingsSection';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useLocalizedModels', () => ({
  useLocalizedModels: vi.fn(() => ({
    // Use 'segformer' as selected model (maps to 'fast' preset tier, shown in main section)
    selectedModel: 'segformer',
    confidenceThreshold: 0.5,
    detectHoles: true,
    setSelectedModel: vi.fn(),
    setDetectHoles: vi.fn(),
    availableModels: [
      {
        // 'segformer' maps to the 'fast' preset tier so it appears in the
        // primary (non-collapsed) section of the component.
        id: 'segformer',
        displayName: 'HRNet',
        size: 'medium',
        description: 'High-resolution network',
        category: 'spheroid',
      },
      {
        // 'cbam_resunet' maps to the 'accurate' preset tier.
        id: 'cbam_resunet',
        displayName: 'U-Net',
        size: 'small',
        description: 'Classic U-Net',
        category: 'spheroid',
      },
    ],
  })),
}));

describe('ModelSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders model selection section heading', () => {
    render(<ModelSettingsSection />);
    // Use role heading to target the section title specifically
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders available model options', () => {
    render(<ModelSettingsSection />);
    expect(screen.getByText('HRNet')).toBeInTheDocument();
    expect(screen.getByText('U-Net')).toBeInTheDocument();
  });

  it('renders radio group for model selection', () => {
    render(<ModelSettingsSection />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(2);
  });

  it('has the current model pre-selected', () => {
    render(<ModelSettingsSection />);
    const hrnetRadio = screen.getByRole('radio', { name: /hrnet/i });
    expect(hrnetRadio).toBeChecked();
  });

  it('does not render any confidence threshold slider', () => {
    // The threshold is now a per-model constant (calibrated in
    // modelUtils.ts), not a user-tunable setting — no slider in the UI.
    render(<ModelSettingsSection />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    // Also no rendered "50%" or similar threshold indicator from the
    // removed slider block.
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('renders detect holes toggle switch', () => {
    render(<ModelSettingsSection />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows detect holes as checked when detectHoles is true', () => {
    render(<ModelSettingsSection />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('calls setSelectedModel when a different model is selected', async () => {
    const { useLocalizedModels } = await import('@/hooks/useLocalizedModels');
    const setSelectedModel = vi.fn();
    vi.mocked(useLocalizedModels).mockReturnValueOnce({
      // Use preset-tier IDs so models appear in primary (non-collapsed) sections.
      selectedModel: 'segformer',
      confidenceThreshold: 0.5,
      detectHoles: true,
      setSelectedModel,
      setDetectHoles: vi.fn(),
      availableModels: [
        {
          id: 'segformer', // maps to 'fast' tier
          displayName: 'HRNet',
          size: 'medium',
          description: '',
          category: 'spheroid',
        },
        {
          id: 'cbam_resunet', // maps to 'accurate' tier
          displayName: 'U-Net',
          size: 'small',
          description: '',
          category: 'spheroid',
        },
      ],
      getLocalizedModel: vi.fn(),
      getAllModels: vi.fn(),
      getSelectedModelInfo: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ModelSettingsSection />);
    const unetRadio = screen.getByRole('radio', { name: /u-net/i });
    await user.click(unetRadio);
    expect(setSelectedModel).toHaveBeenCalledWith('cbam_resunet');
  });
});
