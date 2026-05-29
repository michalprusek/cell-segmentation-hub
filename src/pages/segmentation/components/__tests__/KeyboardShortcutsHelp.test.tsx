import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import KeyboardShortcutsHelp from '@/pages/segmentation/components/KeyboardShortcutsHelp';

// framer-motion works in JSDOM but AnimatePresence needs time;
// mock to passthrough to avoid timeout issues with exit animations
vi.mock('framer-motion', async () => {
  const actual =
    await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      ...actual.motion,
      div: ({
        children,
        ...props
      }: React.HTMLAttributes<HTMLDivElement> & {
        children: React.ReactNode;
      }) => <div {...props}>{children}</div>,
    },
  };
});

describe('KeyboardShortcutsHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Trigger button ────────────────────────────────────────────────────────

  it('renders the Shortcuts trigger button', () => {
    render(<KeyboardShortcutsHelp />);
    // i18n key: segmentation.shortcuts.buttonText → "Shortcuts"
    expect(
      screen.getByRole('button', { name: /shortcuts/i })
    ).toBeInTheDocument();
  });

  it('does NOT show the modal initially (uncontrolled)', () => {
    render(<KeyboardShortcutsHelp />);
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  // ── Opening (uncontrolled mode) ───────────────────────────────────────────

  it('opens the modal when the trigger button is clicked', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);

    await user.click(screen.getByRole('button', { name: /shortcuts/i }));

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  // ── Modal content ─────────────────────────────────────────────────────────

  describe('Modal content (open=true, controlled)', () => {
    it('renders the modal title', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    });

    it('renders all four category headings', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      // i18n keys: segmentation.shortcuts.categories.*
      expect(screen.getByText('Edit Modes')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByText('View Controls')).toBeInTheDocument();
      expect(screen.getByText('Navigation')).toBeInTheDocument();
    });

    it('renders shortcut keys V, E, A, N, S, D in Modes category', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      for (const key of ['V', 'E', 'A', 'N', 'S', 'D']) {
        expect(screen.getByText(key)).toBeInTheDocument();
      }
    });

    it('renders Ctrl+S shortcut in Actions category', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
    });

    it('renders Escape shortcut in Navigation category', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      expect(screen.getByText('Escape')).toBeInTheDocument();
    });

    it('renders the footer note', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      // i18n: segmentation.shortcuts.footerNote
      expect(
        screen.getByText(/shortcuts work within the segmentation editor/i)
      ).toBeInTheDocument();
    });

    it('renders "Requires polygon selection" conditions', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      const conditions = screen.getAllByText(/requires polygon selection/i);
      expect(conditions.length).toBeGreaterThan(0);
    });

    it('renders a close button (X)', () => {
      render(<KeyboardShortcutsHelp isOpen={true} />);
      // There are two close-like buttons: trigger + X inside modal
      const modal = screen
        .getByText('Keyboard Shortcuts')
        .closest('div')!.parentElement!;
      const closeButton = within(modal).getByRole('button');
      expect(closeButton).toBeInTheDocument();
    });
  });

  // ── Closing (uncontrolled mode) ───────────────────────────────────────────

  it('closes the modal when the X button is clicked', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);

    // Open
    await user.click(screen.getByRole('button', { name: /shortcuts/i }));
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();

    // Close via X button (ghost size-icon button inside the modal header)
    const allButtons = screen.getAllByRole('button');
    // The X button is the last button in the modal header
    const xButton = allButtons.find(
      btn =>
        btn.querySelector('svg') &&
        btn !== screen.getByRole('button', { name: /shortcuts/i })
    );
    expect(xButton).toBeTruthy();
    await user.click(xButton!);

    await waitFor(() => {
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
    });
  });

  it('closes the modal when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);

    await user.click(screen.getByRole('button', { name: /shortcuts/i }));
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();

    // The backdrop is the fixed-inset overlay div; click outside the panel
    // The panel content stops propagation; the backdrop handles the click
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
    });
  });

  // ── Controlled mode ───────────────────────────────────────────────────────

  it('delegates open state to onToggle in controlled mode', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp isOpen={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: /shortcuts/i }));

    expect(onToggle).toHaveBeenCalledWith(true);
    // Modal should NOT appear because parent controls isOpen
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('calls onToggle(false) when X is clicked in controlled open mode', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp isOpen={true} onToggle={onToggle} />);

    const allButtons = screen.getAllByRole('button');
    const xButton = allButtons.find(
      btn =>
        btn.querySelector('svg') &&
        btn !== screen.getByRole('button', { name: /shortcuts/i })
    );
    await user.click(xButton!);

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  // ── className prop ────────────────────────────────────────────────────────

  it('applies a custom className to the wrapper', () => {
    const { container } = render(
      <KeyboardShortcutsHelp className="my-custom-class" />
    );
    expect(container.firstChild).toHaveClass('my-custom-class');
  });
});
