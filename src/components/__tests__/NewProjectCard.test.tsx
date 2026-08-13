import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import NewProjectCard from '@/components/NewProjectCard';

// Mock child components: NewProjectCardUI (the clickable card) and
// ProjectDialogForm (the dialog body). We only care about NewProjectCard's
// own open/close + controlled/uncontrolled orchestration.
vi.mock('@/components/project/NewProjectCardUI', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <div data-testid="new-project-card-ui" onClick={onClick}>
      Create New Project
    </div>
  ),
}));

vi.mock('@/components/project/ProjectDialogForm', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="project-dialog-form">
      <h2>Project Dialog Form</h2>
      <button onClick={onClose} data-testid="close-form">
        Close
      </button>
    </div>
  ),
}));

describe('NewProjectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uncontrolled (internal state)', () => {
    it('opens the dialog when the card is clicked', async () => {
      const user = userEvent.setup();
      render(<NewProjectCard />);

      expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('new-project-card-ui'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('project-dialog-form')).toBeInTheDocument();
    });

    it('closes the dialog when ProjectDialogForm calls onClose', async () => {
      const user = userEvent.setup();
      render(<NewProjectCard />);

      await user.click(screen.getByTestId('new-project-card-ui'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('close-form'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the dialog on Escape', async () => {
      const user = userEvent.setup();
      render(<NewProjectCard />);

      await user.click(screen.getByTestId('new-project-card-ui'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('controlled (isOpen + onOpenChange)', () => {
    it('renders only the dialog content, not the card UI, when isOpen', () => {
      render(<NewProjectCard isOpen={true} onOpenChange={vi.fn()} />);

      expect(
        screen.queryByTestId('new-project-card-ui')
      ).not.toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('project-dialog-form')).toBeInTheDocument();
    });

    it('hides both card UI and dialog when isOpen is false', () => {
      render(<NewProjectCard isOpen={false} onOpenChange={vi.fn()} />);

      expect(
        screen.queryByTestId('new-project-card-ui')
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('calls onOpenChange(false) when the dialog is closed', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(<NewProjectCard isOpen={true} onOpenChange={onOpenChange} />);

      await user.click(screen.getByTestId('close-form'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('controlled/uncontrolled fallback', () => {
    it('renders the card UI branch when onOpenChange is undefined', () => {
      // With onOpenChange undefined the component ignores external control and
      // falls back to the card+dialog branch; isOpen=false keeps it closed.
      render(<NewProjectCard isOpen={false} />);

      expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('switches from controlled to uncontrolled on prop change', () => {
      const { rerender } = render(
        <NewProjectCard isOpen={false} onOpenChange={vi.fn()} />
      );
      expect(
        screen.queryByTestId('new-project-card-ui')
      ).not.toBeInTheDocument();

      rerender(<NewProjectCard />);

      expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
