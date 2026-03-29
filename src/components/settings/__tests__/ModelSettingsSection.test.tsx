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
    selectedModel: 'hrnet',
    confidenceThreshold: 0.5,
    detectHoles: true,
    setSelectedModel: vi.fn(),
    setConfidenceThreshold: vi.fn(),
    setDetectHoles: vi.fn(),
    availableModels: [
      {
        id: 'hrnet',
        displayName: 'HRNet',
        size: 'medium',
        description: 'High-resolution network',
      },
      {
        id: 'unet',
        displayName: 'U-Net',
        size: 'small',
        description: 'Classic U-Net',
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

  it('renders confidence threshold slider', () => {
    render(<ModelSettingsSection />);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('shows current threshold percentage', () => {
    render(<ModelSettingsSection />);
    // 0.5 * 100 = 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
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
      selectedModel: 'hrnet',
      confidenceThreshold: 0.5,
      detectHoles: true,
      setSelectedModel,
      setConfidenceThreshold: vi.fn(),
      setDetectHoles: vi.fn(),
      availableModels: [
        { id: 'hrnet', displayName: 'HRNet', size: 'medium', description: '' },
        { id: 'unet', displayName: 'U-Net', size: 'small', description: '' },
      ],
      getLocalizedModel: vi.fn(),
      getAllModels: vi.fn(),
      getSelectedModelInfo: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ModelSettingsSection />);
    const unetRadio = screen.getByRole('radio', { name: /u-net/i });
    await user.click(unetRadio);
    expect(setSelectedModel).toHaveBeenCalledWith('unet');
  });
});
