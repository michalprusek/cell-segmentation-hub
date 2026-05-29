/**
 * FloatingUploadProgress — behavioral unit tests
 *
 * Covered behaviours:
 *  - Returns null when there is no session
 *  - Renders status label for 'uploading' status with file counts
 *  - Renders status label for 'completed' status (all successful)
 *  - Renders status label for 'completed' status with failures
 *  - Renders status label for 'failed' status
 *  - Renders status label for 'cancelled' status
 *  - Progress bar rendered during uploading, not during other statuses
 *  - Progress percentage shown as integer
 *  - Expand/collapse chevron button shown only during uploading
 *  - Expand/collapse toggles expanded details
 *  - Expanded panel shows project name when present
 *  - Expanded panel shows Cancel Upload button; clicking fires cancelUpload with session id
 *  - Close (X) button: during uploading only calls setVisibleSessionId (no clearSession)
 *  - Close (X) button: after completion calls clearSession
 *  - View Project button rendered only for 'completed' status
 *  - Auto-select most-recent session from localStorage sessions on mount
 *  - Clicking the header row toggles expand during uploading
 *  - Clicking header row does nothing for non-uploading status
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import type { UploadSession } from '@/contexts/UploadContext';

// Stub framer-motion to avoid animation timers
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Stub react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// UploadContext mock — overridden per test
const mockCancelUpload = vi.fn();
const mockClearSession = vi.fn();
const mockUploadContext = {
  activeSession: null as UploadSession | null,
  sessions: {} as Record<string, UploadSession>,
  cancelUpload: mockCancelUpload,
  clearSession: mockClearSession,
  isUploading: false,
  startUpload: vi.fn(),
};

vi.mock('@/contexts/useUpload', () => ({
  useUpload: () => mockUploadContext,
}));

import FloatingUploadProgress from '../FloatingUploadProgress';

// ---------- helpers ----------

const baseSession = (
  overrides: Partial<UploadSession> = {}
): UploadSession => ({
  id: 'sess-1',
  projectId: 'proj-1',
  projectName: 'Test Project',
  status: 'uploading',
  totalFiles: 10,
  successCount: 3,
  failedCount: 0,
  overallProgress: 30,
  chunkProgress: null,
  currentOperation: '',
  startedAt: Date.now() - 10000,
  ...overrides,
});

function setActive(session: UploadSession) {
  mockUploadContext.activeSession = session;
  mockUploadContext.sessions = { [session.id]: session };
}

function setNoActive(sessions: Record<string, UploadSession> = {}) {
  mockUploadContext.activeSession = null;
  mockUploadContext.sessions = sessions;
}

// ---------- tests ----------

describe('FloatingUploadProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUploadContext.activeSession = null;
    mockUploadContext.sessions = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Visibility', () => {
    it('renders nothing when no session exists', () => {
      const { container } = render(<FloatingUploadProgress />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders card when there is an active uploading session', () => {
      setActive(baseSession());
      render(<FloatingUploadProgress />);
      // Status label contains file counts
      expect(screen.getByText(/Uploading 3\/10 files/i)).toBeInTheDocument();
    });
  });

  describe('Status labels', () => {
    it('shows uploading label with success/total counts', () => {
      setActive(
        baseSession({ status: 'uploading', successCount: 4, totalFiles: 10 })
      );
      render(<FloatingUploadProgress />);
      expect(screen.getByText('Uploading 4/10 files')).toBeInTheDocument();
    });

    it('shows completed label when all files succeed', () => {
      setActive(
        baseSession({
          status: 'completed',
          successCount: 10,
          failedCount: 0,
          totalFiles: 10,
        })
      );
      render(<FloatingUploadProgress />);
      expect(
        screen.getByText('10 files uploaded successfully')
      ).toBeInTheDocument();
    });

    it('shows completedWithFailures label when some files fail', () => {
      setActive(
        baseSession({
          status: 'completed',
          successCount: 7,
          failedCount: 3,
          totalFiles: 10,
        })
      );
      render(<FloatingUploadProgress />);
      expect(screen.getByText('7 uploaded, 3 failed')).toBeInTheDocument();
    });

    it('shows failed label', () => {
      setActive(baseSession({ status: 'failed' }));
      render(<FloatingUploadProgress />);
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });

    it('shows cancelled label', () => {
      setActive(baseSession({ status: 'cancelled' }));
      render(<FloatingUploadProgress />);
      expect(screen.getByText('Upload cancelled')).toBeInTheDocument();
    });
  });

  describe('Progress bar', () => {
    it('renders progress bar during uploading', () => {
      setActive(baseSession({ status: 'uploading', overallProgress: 45 }));
      render(<FloatingUploadProgress />);
      // The percentage display "45%" is present
      expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('does not render percentage text when not uploading', () => {
      setActive(baseSession({ status: 'completed', overallProgress: 100 }));
      render(<FloatingUploadProgress />);
      expect(screen.queryByText('100%')).not.toBeInTheDocument();
    });

    it('rounds fractional progress to integer', () => {
      setActive(baseSession({ status: 'uploading', overallProgress: 66.7 }));
      render(<FloatingUploadProgress />);
      expect(screen.getByText('67%')).toBeInTheDocument();
    });
  });

  describe('Expand / collapse', () => {
    it('chevron button is shown during uploading', () => {
      setActive(baseSession({ status: 'uploading' }));
      render(<FloatingUploadProgress />);
      // ChevronUp is the initial icon (collapsed state shows "expand" arrow)
      // Both chevron variants are Lucide SVGs; assert the toggle button exists
      const buttons = screen.getAllByRole('button');
      // There should be at least the chevron + close buttons
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it('chevron button is NOT shown for completed status', () => {
      setActive(
        baseSession({ status: 'completed', successCount: 5, totalFiles: 5 })
      );
      render(<FloatingUploadProgress />);
      // Only the close X button and "View" button should be present
      const buttons = screen.getAllByRole('button');
      // no expand chevron — so max 2 buttons (view + close)
      expect(buttons.length).toBeLessThanOrEqual(2);
    });

    it('clicking the expand button shows project details and Cancel button', () => {
      setActive(baseSession({ status: 'uploading' }));
      render(<FloatingUploadProgress />);

      // Project name not visible before expanding
      expect(screen.queryByText('Test Project')).not.toBeInTheDocument();

      // Find the chevron toggle button (not the X close button)
      const buttons = screen.getAllByRole('button');
      // The chevron button is the second-to-last button (before X)
      const chevronBtn = buttons[buttons.length - 2];
      fireEvent.click(chevronBtn);

      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Cancel Upload/i })
      ).toBeInTheDocument();
    });

    it('clicking Cancel Upload calls cancelUpload with session id', () => {
      setActive(baseSession({ status: 'uploading', id: 'sess-abc' }));
      render(<FloatingUploadProgress />);

      // Expand first
      const buttons = screen.getAllByRole('button');
      const chevronBtn = buttons[buttons.length - 2];
      fireEvent.click(chevronBtn);

      fireEvent.click(screen.getByRole('button', { name: /Cancel Upload/i }));
      expect(mockCancelUpload).toHaveBeenCalledWith('sess-abc');
    });
  });

  describe('Close button', () => {
    it('during uploading, close hides card but does NOT call clearSession', () => {
      setActive(baseSession({ status: 'uploading' }));
      render(<FloatingUploadProgress />);

      // X is the last button
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[buttons.length - 1]);

      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('after completion, close calls clearSession', () => {
      setActive(
        baseSession({ status: 'completed', successCount: 5, totalFiles: 5 })
      );
      render(<FloatingUploadProgress />);

      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[buttons.length - 1]);

      expect(mockClearSession).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('View Project button', () => {
    it('renders View button only for completed status', () => {
      setActive(
        baseSession({ status: 'completed', successCount: 5, totalFiles: 5 })
      );
      render(<FloatingUploadProgress />);
      expect(screen.getByRole('button', { name: /View/i })).toBeInTheDocument();
    });

    it('does not render View button during uploading', () => {
      setActive(baseSession({ status: 'uploading' }));
      render(<FloatingUploadProgress />);
      expect(
        screen.queryByRole('button', { name: /View/i })
      ).not.toBeInTheDocument();
    });

    it('View button navigates to project route and closes card', () => {
      setActive(
        baseSession({
          status: 'completed',
          projectId: 'proj-99',
          successCount: 1,
          totalFiles: 1,
        })
      );
      render(<FloatingUploadProgress />);

      fireEvent.click(screen.getByRole('button', { name: /View/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-99');
      expect(mockClearSession).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('Header row click', () => {
    it('clicking header row while uploading toggles expanded details', () => {
      setActive(baseSession({ status: 'uploading' }));
      render(<FloatingUploadProgress />);

      // Initially collapsed — project name not shown
      expect(screen.queryByText('Test Project')).not.toBeInTheDocument();

      // Click the header div (first flex row inside the card)
      const headerRow = screen
        .getByText(/Uploading/)
        .closest('div') as HTMLElement;
      fireEvent.click(headerRow);

      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });

    it('clicking header row for non-uploading status does NOT expand', () => {
      setActive(baseSession({ status: 'cancelled' }));
      render(<FloatingUploadProgress />);

      const headerRow = screen
        .getByText(/Upload cancelled/)
        .closest('div') as HTMLElement;
      fireEvent.click(headerRow);

      // No cancel button should appear (expanded panel not shown)
      expect(
        screen.queryByRole('button', { name: /Cancel Upload/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('Restored sessions on mount', () => {
    it('shows card when there is no active session but sessions exist in context', () => {
      const sess = baseSession({ status: 'cancelled', id: 'old-1' });
      setNoActive({ 'old-1': sess });
      render(<FloatingUploadProgress />);
      expect(screen.getByText('Upload cancelled')).toBeInTheDocument();
    });

    it('picks the most recent session when multiple completed sessions are present', () => {
      const older = baseSession({
        id: 'old-2',
        status: 'cancelled',
        startedAt: Date.now() - 5000,
      });
      const newer = baseSession({
        id: 'new-2',
        status: 'completed',
        successCount: 3,
        totalFiles: 3,
        startedAt: Date.now() - 1000,
      });
      setNoActive({ 'old-2': older, 'new-2': newer });
      render(<FloatingUploadProgress />);
      // Most recent session is completed
      expect(
        screen.getByText('3 files uploaded successfully')
      ).toBeInTheDocument();
    });
  });
});
