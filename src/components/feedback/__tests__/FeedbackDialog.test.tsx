import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/utils/test-utils';
import FeedbackDialog from '../FeedbackDialog';
// The FeedbackDialog component uses `import apiClient from '@/lib/api'`
// (default export). The global setup.ts mock exposes both `apiClient`
// (named) and `default` shapes — so to spy on the function the dialog
// actually calls, we must grab the default export here too.
import apiClient from '@/lib/api';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';

const mockSubmitFeedback = apiClient.submitFeedback as unknown as ReturnType<
  typeof vi.fn
>;

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitFeedback.mockResolvedValue({ id: 'fb-ok', emailQueued: true });
  });

  it('renders the type picker, title, body, and dropzone', () => {
    render(<FeedbackDialog open={true} onOpenChange={vi.fn()} />);

    // Two type tiles — bug + feature — rendered as buttons with the
    // label text. We assert by accessible name to match the rendered
    // text content from the i18n fallback strings.
    expect(
      screen.getByRole('button', { name: /Bug report/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Feature request/i })
    ).toBeInTheDocument();

    // Form inputs
    expect(screen.getByPlaceholderText(/Short summary/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Steps to reproduce/i)
    ).toBeInTheDocument();

    // Dropzone prompt text (now accepts a file — screenshot or video/ND2)
    expect(screen.getByText(/Drag a file here/i)).toBeInTheDocument();
  });

  it('disables submit until both title and body have content', () => {
    render(<FeedbackDialog open={true} onOpenChange={vi.fn()} />);

    const submit = screen.getByRole('button', { name: /^Submit$/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Short summary/i), {
      target: { value: 'Bug in editor' },
    });
    // Still missing body
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Steps to reproduce/i), {
      target: { value: 'When I click X, Y happens' },
    });
    expect(submit).not.toBeDisabled();
  });

  it('calls apiClient.submitFeedback with the form payload and closes on success', async () => {
    const onOpenChange = vi.fn();
    render(<FeedbackDialog open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText(/Short summary/i), {
      target: { value: '  Bug in editor  ' }, // padding to verify trim()
    });
    fireEvent.change(screen.getByPlaceholderText(/Steps to reproduce/i), {
      target: { value: '  When I click X, Y happens  ' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
    });

    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      {
        type: 'bug',
        title: 'Bug in editor',
        body: 'When I click X, Y happens',
      },
      undefined, // no attachment
      undefined // no progress callback (only passed when a file is attached)
    );

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('switches type to feature when the Feature tile is clicked', async () => {
    render(<FeedbackDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Feature request/i }));

    fireEvent.change(screen.getByPlaceholderText(/Short summary/i), {
      target: { value: 'Add dark mode' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Steps to reproduce/i), {
      target: { value: 'Please add a dark theme toggle' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
    });
    expect(mockSubmitFeedback.mock.calls[0][0].type).toBe('feature');
  });

  it('keeps the dialog open and toasts error when the API call fails', async () => {
    mockSubmitFeedback.mockRejectedValueOnce(new Error('Network down'));
    const onOpenChange = vi.fn();
    render(<FeedbackDialog open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText(/Short summary/i), {
      target: { value: 'Bug' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Steps to reproduce/i), {
      target: { value: 'Reproduces always' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    // Dialog should not have been auto-closed on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
