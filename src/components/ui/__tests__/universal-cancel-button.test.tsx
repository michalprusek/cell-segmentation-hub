/**
 * @file Universal Cancel Button tests
 * Tests for the universal cancel button component used across upload, segmentation, and export operations
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniversalCancelButton } from '../universal-cancel-button';

// Mock the language context
const mockT = vi.fn((key: string, params?: Record<string, unknown>) => {
  const translations: Record<string, string> = {
    'toast.upload.cancelUpload': 'Cancel Upload',
    'queue.cancelSegmentation': 'Cancel Segmentation',
    'export.cancelExport': 'Cancel Export',
    'common.cancelling': 'Cancelling...',
    'common.upload': 'Upload',
    'queue.segmentAll': 'Segment All',
    'export.startExport': 'Start Export',
  };

  if (params) {
    return (
      translations[key]?.replace(/\{\{(\w+)\}\}/g, (_, param) =>
        String(params[param] || '')
      ) || key
    );
  }

  return translations[key] || key;
});

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: mockT }),
}));

describe('UniversalCancelButton', () => {
  const defaultProps = {
    operationType: 'upload' as const,
    isOperationActive: false,
    isCancelling: false,
    onCancel: vi.fn(),
    onPrimaryAction: vi.fn(),
    primaryText: 'Upload Files',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Primary Action State', () => {
    it('renders primary action button when operation is not active', () => {
      render(<UniversalCancelButton {...defaultProps} />);

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Upload Files');
      expect(button).not.toBeDisabled();
    });

    it('calls onPrimaryAction when primary button is clicked', () => {
      const onPrimaryAction = vi.fn();
      render(
        <UniversalCancelButton
          {...defaultProps}
          onPrimaryAction={onPrimaryAction}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onPrimaryAction).toHaveBeenCalledOnce();
    });

    it('shows correct icon for each operation type', () => {
      // Upload
      const { rerender } = render(
        <UniversalCancelButton {...defaultProps} operationType="upload" />
      );
      expect(screen.getByTestId('upload-icon')).toBeInTheDocument();

      // Segmentation
      rerender(
        <UniversalCancelButton {...defaultProps} operationType="segmentation" />
      );
      expect(screen.getByTestId('play-icon')).toBeInTheDocument();

      // Export
      rerender(
        <UniversalCancelButton {...defaultProps} operationType="export" />
      );
      expect(screen.getByTestId('download-icon')).toBeInTheDocument();
    });

    it('respects disabled state for primary action', () => {
      render(<UniversalCancelButton {...defaultProps} disabled={true} />);

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });
  });

  describe('Cancel State', () => {
    it('renders cancel button when operation is active', () => {
      render(
        <UniversalCancelButton {...defaultProps} isOperationActive={true} />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Cancel Upload');
      expect(button).toHaveClass('bg-red-600');
    });

    it('shows cancelling state with loading spinner', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          isCancelling={true}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Cancelling...');
      expect(button).toBeDisabled();
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          onCancel={onCancel}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('prevents cancel action when already cancelling', () => {
      const onCancel = vi.fn();
      render(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          isCancelling={true}
          onCancel={onCancel}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('Operation-Specific Behavior', () => {
    it('uses correct cancel text for upload operations', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          operationType="upload"
          isOperationActive={true}
        />
      );

      expect(screen.getByText('Cancel Upload')).toBeInTheDocument();
    });

    it('uses correct cancel text for segmentation operations', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          operationType="segmentation"
          isOperationActive={true}
        />
      );

      expect(screen.getByText('Cancel Segmentation')).toBeInTheDocument();
    });

    it('uses correct cancel text for export operations', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          operationType="export"
          isOperationActive={true}
        />
      );

      expect(screen.getByText('Cancel Export')).toBeInTheDocument();
    });

    it('allows custom cancel text override', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          cancelText="Stop Process"
        />
      );

      expect(screen.getByText('Stop Process')).toBeInTheDocument();
    });
  });

  describe('Styling and Variants', () => {
    it('applies correct primary button styling for each operation type', () => {
      // Upload - green
      const { rerender } = render(
        <UniversalCancelButton {...defaultProps} operationType="upload" />
      );
      let button = screen.getByRole('button');
      expect(button).toHaveClass('bg-green-600');

      // Segmentation - blue
      rerender(
        <UniversalCancelButton {...defaultProps} operationType="segmentation" />
      );
      button = screen.getByRole('button');
      expect(button).toHaveClass('bg-blue-600');

      // Export - purple
      rerender(
        <UniversalCancelButton {...defaultProps} operationType="export" />
      );
      button = screen.getByRole('button');
      expect(button).toHaveClass('bg-purple-600');
    });

    it('applies destructive styling for cancel button', () => {
      render(
        <UniversalCancelButton {...defaultProps} isOperationActive={true} />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-red-600');
    });

    it('respects custom className', () => {
      render(
        <UniversalCancelButton {...defaultProps} className="custom-class" />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('supports different button sizes', () => {
      const { rerender } = render(
        <UniversalCancelButton {...defaultProps} size="sm" />
      );

      // Size prop is passed to Button component
      // We can't directly test the class, but we can verify the prop is accepted
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<UniversalCancelButton {...defaultProps} size="lg" />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has accessible button role', () => {
      render(<UniversalCancelButton {...defaultProps} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('shows loading state accessibility correctly', () => {
      render(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          isCancelling={true}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('disabled');
      expect(button).toHaveTextContent('Cancelling...');
    });

    it('maintains focus management during state transitions', async () => {
      const { rerender } = render(<UniversalCancelButton {...defaultProps} />);

      const button = screen.getByRole('button');
      button.focus();
      expect(button).toHaveFocus();

      // Transition to active state
      rerender(
        <UniversalCancelButton {...defaultProps} isOperationActive={true} />
      );

      // Button should still be focusable in cancel state
      const cancelButton = screen.getByRole('button');
      expect(cancelButton).not.toBeDisabled();
    });
  });

  describe('Error Handling', () => {
    it('handles missing translation gracefully', () => {
      mockT.mockReturnValue('missing.key');

      render(
        <UniversalCancelButton {...defaultProps} isOperationActive={true} />
      );

      // Should fall back to the key name
      expect(screen.getByText('missing.key')).toBeInTheDocument();
    });

    it('handles undefined callbacks gracefully', () => {
      const { rerender } = render(
        <UniversalCancelButton
          {...defaultProps}
          onCancel={undefined as any}
          onPrimaryAction={undefined as any}
        />
      );

      const button = screen.getByRole('button');

      // Should not throw when clicking with undefined callbacks
      expect(() => fireEvent.click(button)).not.toThrow();

      // Test cancel state too
      rerender(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          onCancel={undefined as any}
          onPrimaryAction={undefined as any}
        />
      );

      const cancelButton = screen.getByRole('button');
      expect(() => fireEvent.click(cancelButton)).not.toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('handles rapid state changes correctly', async () => {
      const onCancel = vi.fn();
      const { rerender } = render(
        <UniversalCancelButton {...defaultProps} onCancel={onCancel} />
      );

      // Start operation
      rerender(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          onCancel={onCancel}
        />
      );

      const cancelButton = screen.getByRole('button');
      fireEvent.click(cancelButton);
      expect(onCancel).toHaveBeenCalledOnce();

      // Start cancelling
      rerender(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={true}
          isCancelling={true}
          onCancel={onCancel}
        />
      );

      // Should show cancelling state
      expect(screen.getByText('Cancelling...')).toBeInTheDocument();

      // Complete cancellation
      rerender(
        <UniversalCancelButton
          {...defaultProps}
          isOperationActive={false}
          isCancelling={false}
          onCancel={onCancel}
        />
      );

      // Should return to primary action
      expect(screen.getByText('Upload Files')).toBeInTheDocument();
    });
  });
});
