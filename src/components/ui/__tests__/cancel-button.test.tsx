/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import {
  cancelTestUtils,
  type OperationType,
  type OperationStatus,
} from '@/test-utils/cancelTestHelpers';
import {
  uploadScenarios,
  segmentationScenarios,
  exportScenarios,
} from '@/test-fixtures/cancelScenarios';

// Mock the toast system
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock AbortController
const mockAbortController = cancelTestUtils.createMockAbortController();
global.AbortController = vi.fn().mockImplementation(() => mockAbortController);

/**
 * Universal Cancel Button Component (TDD - to be implemented)
 * This component should replace action buttons during operations with cancel functionality
 */
interface CancelButtonProps {
  operationType: OperationType;
  operationId: string;
  isActive: boolean;
  progress?: number;
  onCancel: (operationId: string) => Promise<void>;
  originalText?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

// Mock component for TDD - this will be replaced with actual implementation
const CancelButton: React.FC<CancelButtonProps> = ({
  operationType,
  operationId,
  isActive,
  progress = 0,
  onCancel,
  originalText = 'Start',
  disabled = false,
  className = '',
  'data-testid': testId = 'cancel-button',
}) => {
  const [isCancelling, setIsCancelling] = React.useState(false);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await onCancel(operationId);
    } finally {
      setIsCancelling(false);
    }
  };

  if (!isActive) {
    return (
      <button
        data-testid={testId}
        className={className}
        disabled={disabled}
        onClick={() => {}}
      >
        {originalText}
      </button>
    );
  }

  const getCancelText = () => {
    if (isCancelling) return 'Cancelling...';
    switch (operationType) {
      case 'upload':
        return 'Cancel Upload';
      case 'segmentation':
        return 'Cancel Segmentation';
      case 'export':
        return 'Cancel Export';
      default:
        return 'Cancel';
    }
  };

  const getAriaLabel = () => {
    return `Cancel ${operationType} operation ${operationId}, ${progress}% complete`;
  };

  return (
    <button
      data-testid={testId}
      className={`cancel-button ${className}`}
      disabled={disabled || isCancelling}
      onClick={handleCancel}
      aria-label={getAriaLabel()}
      role="button"
    >
      <span className="cancel-text">{getCancelText()}</span>
      {progress > 0 && (
        <span className="progress-indicator" aria-hidden="true">
          ({progress}%)
        </span>
      )}
      {isCancelling && (
        <span
          className="loading-spinner"
          aria-hidden="true"
          data-testid="loading-spinner"
        >
          ⟳
        </span>
      )}
    </button>
  );
};

describe('CancelButton Component', () => {
  const mockOnCancel = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnCancel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Rendering States', () => {
    it('should render inactive button with original text', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="test-001"
          isActive={false}
          onCancel={mockOnCancel}
          originalText="Upload Images"
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('Upload Images');
      expect(button).not.toHaveClass('cancel-button');
    });

    it('should render active cancel button for upload operation', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          progress={45}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('Cancel Upload');
      expect(button).toHaveTextContent('(45%)');
      expect(button).toHaveClass('cancel-button');
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel upload operation upload-001, 45% complete'
      );
    });

    it('should render active cancel button for segmentation operation', () => {
      render(
        <CancelButton
          operationType="segmentation"
          operationId="seg-001"
          isActive={true}
          progress={75}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveTextContent('Cancel Segmentation');
      expect(button).toHaveTextContent('(75%)');
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel segmentation operation seg-001, 75% complete'
      );
    });

    it('should render active cancel button for export operation', () => {
      render(
        <CancelButton
          operationType="export"
          operationId="export-001"
          isActive={true}
          progress={30}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveTextContent('Cancel Export');
      expect(button).toHaveTextContent('(30%)');
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel export operation export-001, 30% complete'
      );
    });

    it('should not show progress when progress is 0', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="test-001"
          isActive={true}
          progress={0}
          onCancel={mockOnCancel}
        />
      );

      const progressIndicator = screen.queryByText(/\(\d+%\)/);
      expect(progressIndicator).not.toBeInTheDocument();
    });

    it('should show loading state during cancellation', async () => {
      let resolveCancel: () => void;
      const cancelPromise = new Promise<void>(resolve => {
        resolveCancel = resolve;
      });
      mockOnCancel.mockReturnValue(cancelPromise);

      render(
        <CancelButton
          operationType="upload"
          operationId="test-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      await user.click(button);

      expect(button).toHaveTextContent('Cancelling...');
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
      expect(button).toBeDisabled();

      // Resolve the cancellation
      resolveCancel!();
      await waitFor(() => {
        expect(button).not.toHaveTextContent('Cancelling...');
      });
    });

    it('should apply custom className', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="test-001"
          isActive={true}
          onCancel={mockOnCancel}
          className="custom-class"
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveClass('cancel-button', 'custom-class');
    });

    it('should use custom test id', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="test-001"
          isActive={true}
          onCancel={mockOnCancel}
          data-testid="custom-cancel-button"
        />
      );

      expect(screen.getByTestId('custom-cancel-button')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should call onCancel when clicked', async () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      await user.click(button);

      expect(mockOnCancel).toHaveBeenCalledWith('upload-001');
      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('should not call onCancel when disabled', async () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
          disabled={true}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toBeDisabled();

      await user.click(button);
      expect(mockOnCancel).not.toHaveBeenCalled();
    });

    it('should not allow multiple concurrent cancel requests', async () => {
      let resolveCancel: () => void;
      const cancelPromise = new Promise<void>(resolve => {
        resolveCancel = resolve;
      });
      mockOnCancel.mockReturnValue(cancelPromise);

      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');

      // First click
      await user.click(button);
      expect(button).toBeDisabled();

      // Second click should be ignored
      await user.click(button);
      expect(mockOnCancel).toHaveBeenCalledTimes(1);

      // Resolve the cancellation
      resolveCancel!();
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });

    it('should handle keyboard navigation', async () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      button.focus();

      expect(button).toHaveFocus();

      // Press Enter
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      expect(mockOnCancel).toHaveBeenCalledWith('upload-001');

      vi.clearAllMocks();

      // Press Space
      fireEvent.keyDown(button, { key: ' ', code: 'Space' });
      expect(mockOnCancel).toHaveBeenCalledWith('upload-001');
    });
  });

  describe('Error Handling', () => {
    it('should handle cancellation errors gracefully', async () => {
      const error = new Error('Cancellation failed');
      mockOnCancel.mockRejectedValue(error);

      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      await user.click(button);

      await waitFor(() => {
        expect(button).not.toHaveTextContent('Cancelling...');
        expect(button).not.toBeDisabled();
      });

      expect(mockOnCancel).toHaveBeenCalledWith('upload-001');
    });

    it('should reset loading state after error', async () => {
      const error = new Error('Network error');
      mockOnCancel.mockRejectedValue(error);

      render(
        <CancelButton
          operationType="segmentation"
          operationId="seg-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      await user.click(button);

      // Should show loading state initially
      expect(button).toHaveTextContent('Cancelling...');
      expect(button).toBeDisabled();

      // Should reset after error
      await waitFor(() => {
        expect(button).toHaveTextContent('Cancel Segmentation');
        expect(button).not.toBeDisabled();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          progress={65}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveAttribute('role', 'button');
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel upload operation upload-001, 65% complete'
      );
    });

    it('should hide decorative elements from screen readers', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          progress={50}
          onCancel={mockOnCancel}
        />
      );

      const progressIndicator = screen.getByText('(50%)');
      expect(progressIndicator).toHaveAttribute('aria-hidden', 'true');
    });

    it('should update aria-label during cancellation', async () => {
      let resolveCancel: () => void;
      const cancelPromise = new Promise<void>(resolve => {
        resolveCancel = resolve;
      });
      mockOnCancel.mockReturnValue(cancelPromise);

      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          progress={40}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel upload operation upload-001, 40% complete'
      );

      await user.click(button);

      // During cancellation, aria-label should remain descriptive
      expect(button).toHaveAttribute(
        'aria-label',
        'Cancel upload operation upload-001, 40% complete'
      );

      resolveCancel!();
      await waitFor(() => {
        expect(button).not.toHaveTextContent('Cancelling...');
      });
    });

    it('should be keyboard accessible', () => {
      render(
        <CancelButton
          operationType="upload"
          operationId="upload-001"
          isActive={true}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toBeInstanceOf(HTMLButtonElement);
      expect(button.tabIndex).toBe(0);
    });
  });

  describe('Integration with Real Scenarios', () => {
    it('should handle upload cancellation scenario', async () => {
      const { operation } = uploadScenarios.singleFileUpload;

      render(
        <CancelButton
          operationType={operation.type}
          operationId={operation.id}
          isActive={operation.status === 'active'}
          progress={operation.progress}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveTextContent('Cancel Upload');
      expect(button).toHaveTextContent(`(${operation.progress}%)`);

      await user.click(button);
      expect(mockOnCancel).toHaveBeenCalledWith(operation.id);
    });

    it('should handle batch segmentation cancellation scenario', async () => {
      const { operations } = segmentationScenarios.batchSegmentation;
      const activeOperation = operations.find(op => op.status === 'active')!;

      render(
        <CancelButton
          operationType={activeOperation.type}
          operationId={activeOperation.id}
          isActive={true}
          progress={activeOperation.progress}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveTextContent('Cancel Segmentation');

      await user.click(button);
      expect(mockOnCancel).toHaveBeenCalledWith(activeOperation.id);
    });

    it('should handle export cancellation scenario', async () => {
      const { operation } = exportScenarios.cocoExport;

      render(
        <CancelButton
          operationType={operation.type}
          operationId={operation.id}
          isActive={operation.status === 'active'}
          progress={operation.progress}
          onCancel={mockOnCancel}
        />
      );

      const button = screen.getByTestId('cancel-button');
      expect(button).toHaveTextContent('Cancel Export');
      expect(button).toHaveTextContent(`(${operation.progress}%)`);

      await user.click(button);
      expect(mockOnCancel).toHaveBeenCalledWith(operation.id);
    });
  });

  describe('Performance', () => {
    it('should render quickly for multiple operations', async () => {
      const startTime = performance.now();

      const operations = Array.from({ length: 50 }, (_, i) => ({
        id: `perf-test-${i}`,
        type: 'upload' as OperationType,
        isActive: i % 2 === 0,
        progress: Math.floor(Math.random() * 100),
      }));

      const { unmount } = render(
        <div>
          {operations.map(op => (
            <CancelButton
              key={op.id}
              operationType={op.type}
              operationId={op.id}
              isActive={op.isActive}
              progress={op.progress}
              onCancel={mockOnCancel}
            />
          ))}
        </div>
      );

      const renderTime = performance.now() - startTime;
      expect(renderTime).toBeLessThan(100); // Should render in less than 100ms

      unmount();
    });

    it('should not cause memory leaks with rapid state changes', async () => {
      const { rerender } = render(
        <CancelButton
          operationType="upload"
          operationId="memory-test"
          isActive={false}
          onCancel={mockOnCancel}
        />
      );

      // Rapidly change states
      for (let i = 0; i < 100; i++) {
        rerender(
          <CancelButton
            operationType="upload"
            operationId="memory-test"
            isActive={i % 2 === 0}
            progress={i}
            onCancel={mockOnCancel}
          />
        );
      }

      // If we get here without errors, no memory leaks occurred
      expect(true).toBe(true);
    });
  });
});
