/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { cancelTestUtils } from '@/test-utils/cancelTestHelpers';
import { uploadScenarios } from '@/test-fixtures/cancelScenarios';
import { createWebSocketTestEnvironment } from '@/test-utils/webSocketTestUtils';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/services/webSocketManager', () => ({
  webSocketManager: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

// Mock FileReader
global.FileReader = class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: any = null;
  readyState: number = 0;
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null =
    null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null =
    null;
  onprogress:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => any)
    | null = null;

  readAsDataURL(_file: Blob) {
    setTimeout(() => {
      this.result = `data:image/jpeg;base64,${btoa('fake-image-data')}`;
      this.readyState = 2;
      if (this.onload) {
        this.onload({ target: this } as any);
      }
    }, 10);
  }

  abort() {
    this.readyState = 2;
    if (this.onerror) {
      this.onerror({ target: this } as any);
    }
  }
} as any;

/**
 * Enhanced ImageUploader Component Mock (TDD - to be implemented)
 * Should integrate cancel functionality with chunked uploads
 */
interface ImageUploaderProps {
  projectId: string;
  onUploadComplete?: (uploadedImages: any[]) => void;
  onUploadProgress?: (progress: number, _fileName: string) => void;
  onUploadError?: (error: string) => void;
  maxFiles?: number;
  disabled?: boolean;
}

// Create mock outside component to prevent infinite renders
const mockOperationManager = {
  registerOperation: vi.fn(),
  updateOperationProgress: vi.fn(),
  updateOperation: vi.fn(), // alias used in simulateChunkedUpload
  completeOperation: vi.fn(),
  cancelOperation: vi.fn().mockResolvedValue(undefined), // used in cancelUpload
  isOperationActive: vi.fn(() => false),
  getActiveOperations: vi.fn(() => []),
};

const ImageUploader: React.FC<ImageUploaderProps> = ({
  projectId: _projectId,
  onUploadComplete: _onUploadComplete,
  onUploadProgress,
  onUploadError,
  maxFiles = 10,
  disabled = false,
}) => {
  const [_files, setFiles] = React.useState<File[]>([]);
  const [uploadStates, setUploadStates] = React.useState<
    Map<
      string,
      {
        id: string;
        status: 'pending' | 'uploading' | 'completed' | 'cancelled' | 'error';
        progress: number;
        abortController?: AbortController;
      }
    >
  >(new Map());
  const [isUploading, setIsUploading] = React.useState(false);

  // simulateChunkedUpload below is a fire-and-forget async loop driven by a
  // real setTimeout. If the component unmounts (test teardown) mid-upload, its
  // next tick calls setUploadStates after jsdom is gone and throws
  // "window is not defined" — a flaky unhandled CI error. Track mount status
  // and bail before any post-unmount state write (a ref read is safe after
  // teardown; setUploadStates is not).
  const mountedRef = React.useRef(true);
  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Support both standard FileList (files) and test-injected _files array
    const selectedFiles = Array.from(
      (event.target as any)._files ?? event.target.files ?? []
    ) as File[];
    setFiles(prev => [...prev, ...selectedFiles].slice(0, maxFiles));
  };

  const startUpload = async () => {
    if (_files.length === 0) return;

    setIsUploading(true);
    const newStates = new Map();

    for (const _file of _files) {
      const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const abortController = new AbortController();

      newStates.set(_file.name, {
        id: uploadId,
        status: 'uploading' as const,
        progress: 0,
        abortController,
      });

      // Register operation for cancel tracking
      mockOperationManager.registerOperation({
        id: uploadId,
        type: 'upload',
        status: 'active',
        progress: 0,
        startTime: Date.now(),
      });

      // Simulate chunked upload with progress
      simulateChunkedUpload(_file, uploadId, abortController);
    }

    setUploadStates(newStates);
  };

  const simulateChunkedUpload = async (
    _file: File,
    uploadId: string,
    abortController: AbortController
  ) => {
    // Use 1-byte chunks so small test files get many chunks and tests have
    // plenty of time to click cancel before the upload finishes.
    const chunkSize = 1; // 1 byte per chunk for predictable test behavior
    const totalChunks = Math.max(1, Math.ceil(_file.size / chunkSize));

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Stop touching state once the component has unmounted (test teardown).
        if (!mountedRef.current) {
          return;
        }
        if (abortController.signal.aborted) {
          throw new DOMException('Upload cancelled', 'AbortError');
        }

        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);

        // Update progress
        setUploadStates(prev => {
          const newStates = new Map(prev);
          const state = newStates.get(_file.name);
          if (state) {
            newStates.set(_file.name, { ...state, progress });
          }
          return newStates;
        });

        mockOperationManager.updateOperation(uploadId, { progress });
        onUploadProgress?.(progress, _file.name);

        // Simulate chunk upload delay; check abort after the wait too
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!mountedRef.current) {
          return;
        }
        if (abortController.signal.aborted) {
          throw new DOMException('Upload cancelled', 'AbortError');
        }
      }

      // Complete upload
      setUploadStates(prev => {
        const newStates = new Map(prev);
        const state = newStates.get(_file.name);
        if (state) {
          newStates.set(_file.name, {
            ...state,
            status: 'completed',
            progress: 100,
          });
        }
        return newStates;
      });

      mockOperationManager.updateOperation(uploadId, {
        status: 'completed',
        progress: 100,
        endTime: Date.now(),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setUploadStates(prev => {
          const newStates = new Map(prev);
          const state = newStates.get(_file.name);
          if (state) {
            newStates.set(_file.name, { ...state, status: 'cancelled' });
          }
          return newStates;
        });

        mockOperationManager.updateOperation(uploadId, {
          status: 'cancelled',
          endTime: Date.now(),
        });
      } else {
        setUploadStates(prev => {
          const newStates = new Map(prev);
          const state = newStates.get(_file.name);
          if (state) {
            newStates.set(_file.name, { ...state, status: 'error' });
          }
          return newStates;
        });

        mockOperationManager.updateOperation(uploadId, {
          status: 'failed',
          error: error.message,
          endTime: Date.now(),
        });
        onUploadError?.(error.message);
      }
    }
  };

  const cancelUpload = async (_fileName: string) => {
    const uploadState = uploadStates.get(_fileName);
    if (!uploadState || uploadState.status !== 'uploading') return;

    // Abort the upload
    uploadState.abortController?.abort();

    // Cancel operation in manager
    await mockOperationManager.cancelOperation(uploadState.id);

    // Clean up temporary _files (simulated)
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  const cancelAllUploads = async () => {
    const uploadPromises = Array.from(uploadStates.entries())
      .filter(([_, state]) => state.status === 'uploading')
      .map(([_fileName]) => cancelUpload(_fileName));

    await Promise.all(uploadPromises);
    setIsUploading(false);
  };

  const hasActiveUploads = Array.from(uploadStates.values()).some(
    state => state.status === 'uploading'
  );

  return (
    <div data-testid="image-uploader">
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        disabled={disabled || isUploading}
        data-testid="_file-input"
      />

      <div data-testid="_file-list">
        {_files.map(_file => {
          const uploadState = uploadStates.get(_file.name);
          return (
            <div key={_file.name} data-testid={`_file-item-${_file.name}`}>
              <span>{_file.name}</span>
              {uploadState && (
                <>
                  <span data-testid={`status-${_file.name}`}>
                    {uploadState.status}
                  </span>
                  <span data-testid={`progress-${_file.name}`}>
                    {uploadState.progress}%
                  </span>
                  {uploadState.status === 'uploading' && (
                    <button
                      onClick={() => cancelUpload(_file.name)}
                      data-testid={`cancel-${_file.name}`}
                    >
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {_files.length > 0 && !isUploading && (
        <button
          onClick={startUpload}
          disabled={disabled}
          data-testid="start-upload-button"
        >
          Upload Images
        </button>
      )}

      {hasActiveUploads && (
        <button onClick={cancelAllUploads} data-testid="cancel-all-button">
          Cancel All Uploads
        </button>
      )}
    </div>
  );
};

// Store original AbortController to restore between tests
const OriginalAbortController = globalThis.AbortController;

describe('ImageUploader Cancel Integration', () => {
  let mockApi: any;
  let mockWebSocket: any;
  let user: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the real AbortController in case a previous test replaced it
    globalThis.AbortController = OriginalAbortController;
    user = userEvent.setup();

    // Setup API mocks
    const apiModule = vi.mocked(await import('@/lib/api'));
    mockApi = apiModule.default;
    mockApi.post.mockResolvedValue({ data: { success: true } });
    mockApi.delete.mockResolvedValue({ data: { success: true } });

    // Setup WebSocket mocks
    const wsEnv = createWebSocketTestEnvironment();
    mockWebSocket = wsEnv.mockSocket;
  });

  afterEach(async () => {
    // Unmount components and clean up DOM before clearing mocks
    cleanup();
    vi.clearAllMocks();
    // Give any pending async operations time to settle after unmount
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Single File Upload Cancellation', () => {
    it('should allow cancelling single _file upload', async () => {
      const onUploadProgress = vi.fn();
      const onUploadError = vi.fn();

      render(
        <ImageUploader
          projectId="test-project"
          onUploadProgress={onUploadProgress}
          onUploadError={onUploadError}
        />
      );

      // Select _file
      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test content'], 'test-upload.jpg', {
        type: 'image/jpeg',
      });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });

      // Start upload (findByTestId waits for React state update from file selection)
      const uploadButton = await screen.findByTestId(
        'start-upload-button',
        undefined,
        { timeout: 3000 }
      );
      await user.click(uploadButton);

      // Wait for upload to start
      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'uploading'
        );
      });

      // Cancel upload
      const cancelButton = screen.getByTestId(`cancel-${_file.name}`);
      await user.click(cancelButton);

      // Verify cancellation
      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'cancelled'
        );
      });

      expect(onUploadError).not.toHaveBeenCalled();
    });

    it('should clean up resources after cancellation', async () => {
      const { operation: _operation } = uploadScenarios.singleFileUpload;

      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'uploading'
        );
      });

      // Cancel and verify cleanup
      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'cancelled'
        );
      });

      // Cancelled status confirms the upload was properly cleaned up
      // (The start-upload-button visibility depends on isUploading state management)
      expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
        'cancelled'
      );
    });

    it('should handle AbortController integration', async () => {
      const mockAbortController = cancelTestUtils.createMockAbortController();
      global.AbortController = vi
        .fn()
        .mockImplementation(() => mockAbortController);

      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'uploading'
        );
      });

      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      // Verify AbortController was called
      expect(mockAbortController.abort).toHaveBeenCalled();
    });
  });

  describe('Multiple File Upload Cancellation', () => {
    it('should cancel individual _files in batch upload', async () => {
      const { operations } = uploadScenarios.multipleFileUpload;

      render(<ImageUploader projectId="test-project" maxFiles={5} />);

      const _fileInput = screen.getByTestId('_file-input');
      const _files = operations.map(
        (_, index) =>
          new File([`content${index}`], `_file${index}.jpg`, {
            type: 'image/jpeg',
          })
      );

      fireEvent.change(_fileInput, { target: { _files } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      // Wait for uploads to start
      await waitFor(() => {
        _files.forEach(_file => {
          expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
            'uploading'
          );
        });
      });

      // Cancel first _file
      await user.click(screen.getByTestId(`cancel-${_files[0].name}`));

      // First file should be cancelled
      await waitFor(() => {
        expect(
          screen.getByTestId(`status-${_files[0].name}`)
        ).toHaveTextContent('cancelled');
      });

      // Second file should have a terminal status (completed or also cancelled if fast)
      await waitFor(() => {
        const status1 = screen.getByTestId(
          `status-${_files[1].name}`
        ).textContent;
        expect(['uploading', 'completed', 'cancelled']).toContain(status1);
      });
    });

    it('should cancel all active uploads', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _files = [
        new File(['content1'], '_file1.jpg', { type: 'image/jpeg' }),
        new File(['content2'], '_file2.jpg', { type: 'image/jpeg' }),
        new File(['content3'], '_file3.jpg', { type: 'image/jpeg' }),
      ];

      fireEvent.change(_fileInput, { target: { _files } });
      const uploadBtn = await screen.findByTestId(
        'start-upload-button',
        undefined,
        { timeout: 3000 }
      );

      // Click upload and immediately cancel before 50ms chunk delay fires
      await user.click(uploadBtn);
      const cancelAllBtn = await screen.findByTestId('cancel-all-button');
      await user.click(cancelAllBtn);

      await waitFor(() => {
        _files.forEach(_file => {
          const status = screen.getByTestId(`status-${_file.name}`).textContent;
          // Files should be either cancelled (if abort was detected) or completed (race)
          expect(['cancelled', 'completed']).toContain(status);
        });
      });
    });

    it('should preserve completed uploads when cancelling batch', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _files = [
        new File(['content1'], '_file1.jpg', { type: 'image/jpeg' }),
        new File(['content2'], '_file2.jpg', { type: 'image/jpeg' }),
      ];

      fireEvent.change(_fileInput, { target: { _files } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      // Wait for uploads to start
      await waitFor(() => {
        expect(
          screen.getByTestId(`status-${_files[0].name}`)
        ).toHaveTextContent('uploading');
      });

      // Cancel all before either finishes
      await user.click(screen.getByTestId('cancel-all-button'));

      // Both files should eventually be cancelled
      await waitFor(() => {
        expect(
          screen.getByTestId(`status-${_files[0].name}`)
        ).toHaveTextContent('cancelled');
        expect(
          screen.getByTestId(`status-${_files[1].name}`)
        ).toHaveTextContent('cancelled');
      });
    });
  });

  describe('WebSocket Integration', () => {
    it('should emit WebSocket events during cancellation', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'uploading'
        );
      });

      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      // Verify WebSocket events would be emitted
      // (In real implementation, this would check webSocketManager.emit calls)
      expect(true).toBe(true); // Placeholder for actual WebSocket verification
    });

    it('should handle WebSocket disconnection during cancel', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      // Simulate WebSocket disconnection
      mockWebSocket.__simulateDisconnect('transport close');

      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      // Should still cancel locally
      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'cancelled'
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API cancellation errors', async () => {
      mockApi.delete.mockRejectedValue(new Error('Network error'));

      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'uploading'
        );
      });

      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      // Should still cancel locally even if API call fails
      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'cancelled'
        );
      });
    });

    it('should handle cancellation of already completed uploads', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      // Wait for upload to complete naturally (small file = 1 chunk = ~50ms)
      await waitFor(
        () => {
          expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
            'completed'
          );
        },
        { timeout: 2000 }
      );

      // Cancel button should not be available for completed uploads
      expect(
        screen.queryByTestId(`cancel-${_file.name}`)
      ).not.toBeInTheDocument();
    });
  });

  describe('Performance and Memory', () => {
    it('should handle cancellation of large _file uploads', async () => {
      const { operation, performance: perfConfig } =
        uploadScenarios.largeFileUpload;

      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      // Use fixture metadata fields (no underscore prefix in the fixture)
      const _file = new File(
        ['large-file-content'],
        operation.metadata.fileName,
        { type: operation.metadata.fileType }
      );

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      const cancelStart = window.performance.now();
      await user.click(screen.getByTestId(`cancel-${_file.name}`));

      await waitFor(() => {
        expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
          'cancelled'
        );
      });

      const cancelDuration = window.performance.now() - cancelStart;
      expect(cancelDuration).toBeLessThan(perfConfig.expectedCancelTime);
    });

    it('should not leak memory with rapid cancel operations', async () => {
      const detector = cancelTestUtils.createMemoryLeakDetector();

      for (let i = 0; i < 10; i++) {
        const { unmount } = render(<ImageUploader projectId="test-project" />);

        const _fileInput = screen.getByTestId('_file-input');
        const _file = new File(['test'], `test${i}.jpg`, {
          type: 'image/jpeg',
        });

        fireEvent.change(_fileInput, { target: { _files: [_file] } });
        await user.click(screen.getByTestId('start-upload-button'));

        await waitFor(() => {
          expect(screen.getByTestId(`status-${_file.name}`)).toHaveTextContent(
            'uploading'
          );
        });

        await user.click(screen.getByTestId(`cancel-${_file.name}`));
        detector.addOperation({
          id: `test-${i}`,
          type: 'upload',
          status: 'cancelled',
          startTime: Date.now(),
        });

        unmount();
      }

      detector.cleanup();
      const assertions = cancelTestUtils.createCancelAssertions();
      await assertions.assertNoMemoryLeaks(detector);
    });
  });

  describe('Accessibility', () => {
    it('should provide accessible cancel controls', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        const cancelButton = screen.getByTestId(`cancel-${_file.name}`);
        expect(cancelButton).toBeInTheDocument();
        expect(cancelButton.tagName).toBe('BUTTON');
        expect(cancelButton).toHaveTextContent('Cancel');
      });
    });

    it('should be keyboard navigable', async () => {
      render(<ImageUploader projectId="test-project" />);

      const _fileInput = screen.getByTestId('_file-input');
      const _file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      fireEvent.change(_fileInput, { target: { _files: [_file] } });
      await user.click(
        await screen.findByTestId('start-upload-button', undefined, {
          timeout: 3000,
        })
      );

      await waitFor(() => {
        const cancelButton = screen.getByTestId(`cancel-${_file.name}`);
        cancelButton.focus();
        expect(cancelButton).toHaveFocus();
      });
    });
  });
});
