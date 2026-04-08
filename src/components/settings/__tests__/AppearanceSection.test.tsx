import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import AppearanceSection from '../AppearanceSection';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('AppearanceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a card with appearance settings', () => {
    render(<AppearanceSection />);
    // The component renders theme and language controls
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
  });

  it('renders language select trigger', () => {
    render(<AppearanceSection />);
    // Select component renders a combobox role
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders light theme button', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
  });

  it('renders dark theme button', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument();
  });

  it('renders system theme button', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('button', { name: /system/i })).toBeInTheDocument();
  });

  it('all three theme buttons are rendered', () => {
    render(<AppearanceSection />);
    const themeButtons = ['light', 'dark', 'system'];
    themeButtons.forEach(name => {
      expect(
        screen.getByRole('button', { name: new RegExp(name, 'i') })
      ).toBeInTheDocument();
    });
  });

  it('calls toast.success when light theme button is clicked', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('button', { name: /light/i }));
    expect(toast.success).toHaveBeenCalled();
  });

  it('calls toast.success when dark theme button is clicked', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('button', { name: /dark/i }));
    expect(toast.success).toHaveBeenCalled();
  });
});
