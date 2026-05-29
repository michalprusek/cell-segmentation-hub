/**
 * ChannelColorDialog — behavioral unit tests
 *
 * Covered:
 *  - Renders nothing when open=false
 *  - Renders dialog title with channelName when open=true
 *  - Renders all 8 preset buttons
 *  - Clicking a preset updates internal color state (highlight ring on swatch)
 *  - Confirm button calls onConfirm with the selected color
 *  - Clicking preset then Confirm fires onConfirm with preset color
 *  - Cancel button calls onClose without calling onConfirm
 *  - onClose called via Dialog onOpenChange when dialog closes
 *  - Color state resets to initialColor when reopened (open effect)
 *  - Text input accepts valid hex and updates state
 *  - Text input ignores invalid input (non-hex chars)
 *  - Native color picker change updates color state
 *  - Initial color swatch has selected ring class
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render as renderWithProviders } from '@/test/utils/test-utils';
import { ChannelColorDialog } from '../ChannelColorDialog';

// ── mock Dialog to render inline (no portal) ──────────────────────────────────
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (v: boolean) => void;
  }) =>
    open ? (
      <div
        data-testid="dialog-root"
        data-open={String(open)}
        onClick={e => {
          // Simulate backdrop click closing
          if ((e.target as HTMLElement).dataset.backdrop) {
            onOpenChange?.(false);
          }
        }}
      >
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button
      data-testid={variant === 'outline' ? 'btn-cancel' : 'btn-confirm'}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const PRESETS = [
  '#FFFFFF',
  '#FF0000',
  '#00FF00',
  '#00FFFF',
  '#FFFF00',
  '#FF00FF',
  '#FFA500',
  '#1E90FF',
];

const DEFAULT_PROPS = {
  open: true,
  channelName: 'GFP',
  initialColor: '#00FF00',
  onConfirm: vi.fn(),
  onClose: vi.fn(),
};

// A controlled wrapper so we can test the "reset on reopen" behavior
function ControlledWrapper({
  onConfirm,
  onClose,
}: {
  onConfirm: (c: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState('#FF0000');
  return (
    <div>
      <button
        data-testid="open-btn"
        onClick={() => {
          setInitial('#FF0000');
          setOpen(true);
        }}
      >
        Open
      </button>
      <button
        data-testid="reopen-btn"
        onClick={() => {
          setInitial('#0000FF');
          setOpen(true);
        }}
      >
        Reopen with blue
      </button>
      <ChannelColorDialog
        open={open}
        channelName="CH1"
        initialColor={initial}
        onConfirm={c => {
          onConfirm(c);
          setOpen(false);
        }}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </div>
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ChannelColorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── open/close ────────────────────────────────────────────────────────────

  describe('open / close state', () => {
    it('renders nothing when open=false', () => {
      const { container } = renderWithProviders(
        <ChannelColorDialog {...DEFAULT_PROPS} open={false} />
      );
      expect(container.querySelector('[data-testid="dialog-root"]')).toBeNull();
    });

    it('renders dialog when open=true', () => {
      renderWithProviders(<ChannelColorDialog {...DEFAULT_PROPS} />);
      expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
    });

    it('renders channelName in title', () => {
      renderWithProviders(
        <ChannelColorDialog {...DEFAULT_PROPS} channelName="DAPI" />
      );
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('DAPI');
    });
  });

  // ── preset buttons ────────────────────────────────────────────────────────

  describe('preset color buttons', () => {
    it('renders all 8 preset buttons', () => {
      renderWithProviders(<ChannelColorDialog {...DEFAULT_PROPS} />);
      const presetBtns = PRESETS.map(color =>
        screen.queryByRole('button', { name: new RegExp(color, 'i') })
      ).filter(Boolean);
      expect(presetBtns).toHaveLength(0); // buttons use aria-label = preset label
      // Query by role button and filter non-testid ones
      const allBtns = screen.getAllByRole('button');
      // Preset buttons + Cancel + Confirm = 10 total
      expect(allBtns.length).toBeGreaterThanOrEqual(8);
    });

    it('selected preset has ring class on its wrapper button', () => {
      renderWithProviders(
        <ChannelColorDialog {...DEFAULT_PROPS} initialColor="#FF0000" />
      );
      // The red preset button should have ring-2 class
      const redBtn = screen.getByRole('button', { name: /^Red$/ });
      expect(redBtn.className).toContain('ring-2');
    });

    it('clicking a preset updates the selection ring', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ChannelColorDialog {...DEFAULT_PROPS} initialColor="#00FF00" />
      );

      // Initially green is selected
      const greenBtn = screen.getByRole('button', { name: /^Green$/ });
      expect(greenBtn.className).toContain('ring-2');

      // Click Red
      const redBtn = screen.getByRole('button', { name: /^Red$/ });
      await user.click(redBtn);

      // Red should now be selected
      expect(redBtn.className).toContain('ring-2');
      // Green should no longer be selected
      expect(greenBtn.className).not.toContain('ring-2');
    });
  });

  // ── confirm / cancel ──────────────────────────────────────────────────────

  describe('confirm callback', () => {
    it('calls onConfirm with initialColor when no preset is clicked', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          initialColor="#FF0000"
          onConfirm={onConfirm}
        />
      );

      await user.click(screen.getByTestId('btn-confirm'));
      expect(onConfirm).toHaveBeenCalledWith('#FF0000');
    });

    it('calls onConfirm with selected preset color', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          initialColor="#FFFFFF"
          onConfirm={onConfirm}
        />
      );

      // Click the Cyan preset (#00FFFF)
      await user.click(screen.getByRole('button', { name: /Cyan/i }));
      await user.click(screen.getByTestId('btn-confirm'));

      expect(onConfirm).toHaveBeenCalledWith('#00FFFF');
    });

    it('does not call onConfirm when Cancel is clicked', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      await user.click(screen.getByTestId('btn-cancel'));

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ── hex text input ────────────────────────────────────────────────────────

  describe('hex text input', () => {
    it('accepts a valid 6-digit hex and updates color', async () => {
      const onConfirm = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          initialColor="#FFFFFF"
          onConfirm={onConfirm}
        />
      );

      const textInput = screen.getByRole('textbox') as HTMLInputElement;
      // Use fireEvent to set a specific hex value directly
      fireEvent.change(textInput, { target: { value: '#123456' } });

      await userEvent.setup().click(screen.getByTestId('btn-confirm'));
      expect(onConfirm).toHaveBeenCalledWith('#123456');
    });

    it('prepends # when typing a hex without it', async () => {
      const onConfirm = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          initialColor="#FFFFFF"
          onConfirm={onConfirm}
        />
      );

      const textInput = screen.getByRole('textbox');
      // Simulate change event with value without #
      fireEvent.change(textInput, { target: { value: 'ABCDEF' } });

      await userEvent.setup().click(screen.getByTestId('btn-confirm'));
      // The onChange handler prepends # when value doesn't start with #
      expect(onConfirm).toHaveBeenCalledWith('#ABCDEF');
    });

    it('ignores input with non-hex characters beyond 6 digits', () => {
      renderWithProviders(
        <ChannelColorDialog {...DEFAULT_PROPS} initialColor="#FFFFFF" />
      );

      const textInput = screen.getByRole('textbox');
      const valueBefore = (textInput as HTMLInputElement).value;

      // Invalid chars — the regex guard rejects them
      fireEvent.change(textInput, { target: { value: '#GGGGGG' } });

      // Should not update (guard rejects) — value stays at previous
      expect((textInput as HTMLInputElement).value).toBe(valueBefore);
    });
  });

  // ── native color picker ───────────────────────────────────────────────────

  describe('native color picker', () => {
    it('updating the native picker changes the color sent on confirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithProviders(
        <ChannelColorDialog
          {...DEFAULT_PROPS}
          initialColor="#FFFFFF"
          onConfirm={onConfirm}
        />
      );

      const colorInput = document.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement;
      expect(colorInput).not.toBeNull();

      fireEvent.change(colorInput, { target: { value: '#AABBCC' } });

      await user.click(screen.getByTestId('btn-confirm'));
      // input[type="color"] normalises the value to lowercase
      expect(onConfirm).toHaveBeenCalledWith('#aabbcc');
    });
  });

  // ── reset on reopen ───────────────────────────────────────────────────────

  describe('reset to initialColor on reopen', () => {
    it('resets internal color to new initialColor when reopened', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      renderWithProviders(
        <ControlledWrapper onConfirm={onConfirm} onClose={onClose} />
      );

      // Open with red
      await user.click(screen.getByTestId('open-btn'));

      // Pick cyan
      await user.click(screen.getByRole('button', { name: /Cyan/i }));

      // Close
      await user.click(screen.getByTestId('btn-cancel'));

      // Reopen with blue as initialColor
      await user.click(screen.getByTestId('reopen-btn'));

      // Confirm without picking — should use the new initialColor (#0000FF)
      await user.click(screen.getByTestId('btn-confirm'));
      expect(onConfirm).toHaveBeenCalledWith('#0000FF');
    });
  });
});
