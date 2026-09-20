import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import FeedbackButton from '@/components/feedback/FeedbackButton';

// The dialog is mounted only on open and pulls in react-dropzone plus form
// state; stub it so these tests stay about the trigger.
vi.mock('@/components/feedback/FeedbackDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="feedback-dialog" /> : null,
}));

describe('FeedbackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says in words what it is for', () => {
    // An icon-only speech bubble says "there is a conversation here" but not
    // that this is where a bug or a feature request goes, which is the only
    // thing the dialog does. Rendered through the real LanguageProvider, so
    // this also proves the key resolves rather than falling back.
    render(<FeedbackButton />);

    expect(screen.getByTestId('feedback-button')).toHaveTextContent(
      /report a bug or idea/i
    );
  });

  it('keeps an accessible name for the icon-only width', () => {
    // The label is `hidden lg:inline`, so below 1024px the aria-label is the
    // only thing naming the control.
    render(<FeedbackButton />);

    expect(
      screen.getByRole('button', { name: /open feedback form/i })
    ).toBeInTheDocument();
  });

  it('mounts the dialog only once clicked', async () => {
    const user = userEvent.setup();
    render(<FeedbackButton />);

    expect(screen.queryByTestId('feedback-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('feedback-button'));

    expect(screen.getByTestId('feedback-dialog')).toBeInTheDocument();
  });
});
