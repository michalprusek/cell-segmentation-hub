/**
 * Behavioral unit tests for ProjectExport page wrapper.
 *
 * Strategy: mock useProjectData and useExportFunctions so the test controls
 * the data layer; verify the orchestrated render and the wiring between
 * hooks and child components.
 *
 * Tested behaviours:
 *  1.  Back-to-project button renders and navigates to /project/:id.
 *  2.  Export button is disabled when getSelectedCount()=0.
 *  3.  Export button is enabled when getSelectedCount() > 0 and not exporting.
 *  4.  Export button is disabled while isExporting=true.
 *  5.  Export button shows spinner emoji while exporting.
 *  6.  Clicking the export button calls handleExport.
 *  7.  Export button label includes the selected count.
 *  8.  ProjectHeader receives the project title from useProjectData.
 *  9.  ImageSelectionCard renders (presence of card content proxy).
 *  10. ExportOptionsCard renders (presence of Export Options heading).
 *
 * Skipped / not testable here:
 *  - Deep export flow (belongs to useExportFunctions tests).
 *  - Hard-coded Czech text "Zpět na projekt" / "Exportovat … obrázků" is
 *    tested via role/text assertions; internationalisation of these strings
 *    is a known i18n gap in the file (not a test omission).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectExport from '../ProjectExport';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'proj-123' }),
  };
});

// Replace the real AuthProvider (async, returns null while loading) with a
// passthrough so the component receives a valid auth context immediately.
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  AuthContext: { _currentValue: null },
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'a@b.com' } }),
}));

// ThemeProvider and LanguageProvider also depend on auth; replace them so
// AllProviders renders without needing a live auth context.
vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

// Stub heavyweight child components so we can test ProjectExport in isolation.
vi.mock('@/components/project/ProjectHeader', () => ({
  default: ({ projectTitle }: { projectTitle: string }) => (
    <div data-testid="project-header">{projectTitle}</div>
  ),
}));

vi.mock('../components/ExportOptionsCard', () => ({
  default: () => <div data-testid="export-options-card">Export Options</div>,
}));

vi.mock('../components/ImageSelectionCard', () => ({
  default: () => <div data-testid="image-selection-card">Image list</div>,
}));

// useProjectData — controlled via module-level variable
const mockProjectData = {
  projectTitle: 'My Research Project',
  images: [],
  loading: false,
};
vi.mock('@/hooks/useProjectData', () => ({
  useProjectData: () => mockProjectData,
}));

// useExportFunctions — controlled per-test via mockExport
const mockExport = {
  selectedImages: {} as Record<string, boolean>,
  includeMetadata: false,
  includeObjectMetrics: false,
  includeSegmentation: false,
  isExporting: false,
  handleSelectAll: vi.fn(),
  handleSelectImage: vi.fn(),
  getSelectedCount: vi.fn().mockReturnValue(0),
  handleExport: vi.fn(),
  handleExportMetricsAsXlsx: vi.fn(),
  setIncludeMetadata: vi.fn(),
  setIncludeObjectMetrics: vi.fn(),
  setIncludeSegmentation: vi.fn(),
};
vi.mock('../hooks/useExportFunctions', () => ({
  useExportFunctions: () => mockExport,
}));

// ── tests ────────────────────────────────────────────────────────────────────

describe('ProjectExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExport.getSelectedCount.mockReturnValue(0);
    mockExport.isExporting = false;
  });

  // 1
  it('back button navigates to /project/:id', async () => {
    render(<ProjectExport />);
    await userEvent.click(screen.getByText('Zpět na projekt'));
    expect(mockNavigate).toHaveBeenCalledWith('/project/proj-123');
  });

  // 2
  it('export button is disabled when selected count is 0', () => {
    mockExport.getSelectedCount.mockReturnValue(0);
    render(<ProjectExport />);
    const btn = screen.getByText(/Exportovat/i).closest('button');
    expect(btn).toBeDisabled();
  });

  // 3
  it('export button is enabled when count > 0 and not exporting', () => {
    mockExport.getSelectedCount.mockReturnValue(2);
    mockExport.isExporting = false;
    render(<ProjectExport />);
    const btn = screen.getByText(/Exportovat/i).closest('button');
    expect(btn).not.toBeDisabled();
  });

  // 4
  it('export button is disabled while isExporting=true', () => {
    mockExport.getSelectedCount.mockReturnValue(3);
    mockExport.isExporting = true;
    render(<ProjectExport />);
    const btn = screen.getByText(/Exportovat/i).closest('button');
    expect(btn).toBeDisabled();
  });

  // 5
  it('shows spinner emoji while exporting', () => {
    mockExport.isExporting = true;
    mockExport.getSelectedCount.mockReturnValue(1);
    render(<ProjectExport />);
    expect(screen.getByText('⏳')).toBeInTheDocument();
  });

  // 6
  it('clicking export button calls handleExport', async () => {
    mockExport.getSelectedCount.mockReturnValue(4);
    mockExport.isExporting = false;
    render(<ProjectExport />);
    await userEvent.click(screen.getByText(/Exportovat/i).closest('button')!);
    expect(mockExport.handleExport).toHaveBeenCalledTimes(1);
  });

  // 7
  it('export button label includes the selected count', () => {
    mockExport.getSelectedCount.mockReturnValue(7);
    render(<ProjectExport />);
    expect(screen.getByText(/Exportovat 7 obrázků/i)).toBeInTheDocument();
  });

  // 8
  it('renders ProjectHeader with the project title', () => {
    render(<ProjectExport />);
    expect(screen.getByTestId('project-header')).toHaveTextContent(
      'My Research Project'
    );
  });

  // 9
  it('renders ImageSelectionCard', () => {
    render(<ProjectExport />);
    expect(screen.getByTestId('image-selection-card')).toBeInTheDocument();
  });

  // 10
  it('renders ExportOptionsCard', () => {
    render(<ProjectExport />);
    expect(screen.getByTestId('export-options-card')).toBeInTheDocument();
  });
});
