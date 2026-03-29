import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectToolbar from '../ProjectToolbar';

vi.mock('@/pages/export/AdvancedExportDialog', () => ({
  AdvancedExportDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="export-dialog" /> : null,
}));

vi.mock('@/lib/exportStateManager', () => ({
  default: {
    getExportState: vi.fn(() => null),
    subscribeToChanges: vi.fn(() => () => {}),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: 'proj-123' }),
  };
});

const defaultProps = {
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
  onSort: vi.fn(),
  viewMode: 'grid' as const,
  setViewMode: vi.fn(),
};

describe('ProjectToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sort button', () => {
    render(<ProjectToolbar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /sort/i })).toBeInTheDocument();
  });

  it('renders grid and list view toggle buttons', () => {
    render(<ProjectToolbar {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('calls setViewMode with list when list button is clicked', async () => {
    const user = userEvent.setup();
    const setViewMode = vi.fn();
    render(<ProjectToolbar {...defaultProps} setViewMode={setViewMode} viewMode="grid" />);
    const buttons = screen.getAllByRole('button');
    // The list button is the last view toggle button
    const listButton = buttons[buttons.length - 1];
    await user.click(listButton);
    expect(setViewMode).toHaveBeenCalledWith('list');
  });

  it('calls setViewMode with grid when grid button is clicked', async () => {
    const user = userEvent.setup();
    const setViewMode = vi.fn();
    render(<ProjectToolbar {...defaultProps} setViewMode={setViewMode} viewMode="list" />);
    const buttons = screen.getAllByRole('button');
    // The grid button is second to last
    const gridButton = buttons[buttons.length - 2];
    await user.click(gridButton);
    expect(setViewMode).toHaveBeenCalledWith('grid');
  });

  it('renders search bar when showSearchBar is true', () => {
    render(
      <ProjectToolbar
        {...defaultProps}
        showSearchBar={true}
        searchTerm=""
        onSearchChange={vi.fn()}
      />
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders upload button when showUploadButton is true', () => {
    render(
      <ProjectToolbar
        {...defaultProps}
        showUploadButton={true}
        onToggleUploader={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('calls onToggleUploader when upload button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleUploader = vi.fn();
    render(
      <ProjectToolbar
        {...defaultProps}
        showUploadButton={true}
        onToggleUploader={onToggleUploader}
      />
    );
    await user.click(screen.getByRole('button', { name: /upload/i }));
    expect(onToggleUploader).toHaveBeenCalled();
  });

  it('renders batch delete button when selectedCount > 0', () => {
    render(
      <ProjectToolbar
        {...defaultProps}
        selectedCount={3}
        onBatchDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('calls onBatchDelete when batch delete button is clicked', async () => {
    const user = userEvent.setup();
    const onBatchDelete = vi.fn();
    render(
      <ProjectToolbar
        {...defaultProps}
        selectedCount={2}
        onBatchDelete={onBatchDelete}
      />
    );
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onBatchDelete).toHaveBeenCalled();
  });
});
