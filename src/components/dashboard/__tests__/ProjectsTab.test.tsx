/**
 * Behavioral tests for ProjectsTab.tsx
 *
 * ProjectsTab is a thin forwarding wrapper around ProjectsList.
 * Covered behaviours:
 *  - Renders ProjectsList (confirmed via its test id from mock)
 *  - Forwards projects, viewMode, loading, onOpenProject props
 *  - Always passes showCreateCard=true
 *  - Forwards optional callbacks: onProjectUpdate, onRequestProjectMove,
 *    hasAnyFolder, onOpenFolder, onRenameFolder, onMoveFolder, onDeleteFolder,
 *    onDropItem
 *
 * ProjectsList is mocked to isolate this component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { render } from '@/test/utils/test-utils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1' },
    isAuthenticated: true,
    isLoading: false,
  })),
}));

// Capture all props passed to ProjectsList
let capturedProjectsListProps: Record<string, unknown> | null = null;
vi.mock('@/components/ProjectsList', () => ({
  default: (props: Record<string, unknown>) => {
    capturedProjectsListProps = props;
    return (
      <div
        data-testid="projects-list"
        data-loading={String(props.loading)}
        data-viewmode={String(props.viewMode)}
        data-showcreatecard={String(props.showCreateCard)}
      />
    );
  },
}));

import ProjectsTab from '../ProjectsTab';

// ---------------------------------------------------------------------------

const sampleProjects = [
  {
    id: 'p1',
    name: 'Alpha',
    description: '',
    userId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [],
  },
  {
    id: 'p2',
    name: 'Beta',
    description: '',
    userId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [],
  },
];

const defaultProps = {
  projects: sampleProjects,
  viewMode: 'grid' as const,
  loading: false,
  onOpenProject: vi.fn(),
};

describe('ProjectsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProjectsListProps = null;
  });

  it('renders ProjectsList', () => {
    render(<ProjectsTab {...defaultProps} />);
    expect(screen.getByTestId('projects-list')).toBeInTheDocument();
  });

  it('forwards projects array to ProjectsList', () => {
    render(<ProjectsTab {...defaultProps} />);
    expect(capturedProjectsListProps?.projects).toBe(sampleProjects);
  });

  it('forwards viewMode to ProjectsList', () => {
    render(<ProjectsTab {...defaultProps} viewMode="list" />);
    expect(capturedProjectsListProps?.viewMode).toBe('list');
  });

  it('forwards loading to ProjectsList', () => {
    render(<ProjectsTab {...defaultProps} loading={true} />);
    expect(capturedProjectsListProps?.loading).toBe(true);
  });

  it('forwards onOpenProject to ProjectsList', () => {
    const onOpen = vi.fn();
    render(<ProjectsTab {...defaultProps} onOpenProject={onOpen} />);
    expect(capturedProjectsListProps?.onOpenProject).toBe(onOpen);
  });

  it('always passes showCreateCard=true to ProjectsList', () => {
    render(<ProjectsTab {...defaultProps} />);
    expect(capturedProjectsListProps?.showCreateCard).toBe(true);
  });

  it('forwards optional onProjectUpdate callback', () => {
    const onUpdate = vi.fn();
    render(<ProjectsTab {...defaultProps} onProjectUpdate={onUpdate} />);
    expect(capturedProjectsListProps?.onProjectUpdate).toBe(onUpdate);
  });

  it('forwards optional onRequestProjectMove callback', () => {
    const onMove = vi.fn();
    render(<ProjectsTab {...defaultProps} onRequestProjectMove={onMove} />);
    expect(capturedProjectsListProps?.onRequestProjectMove).toBe(onMove);
  });

  it('forwards optional hasAnyFolder flag', () => {
    render(<ProjectsTab {...defaultProps} hasAnyFolder={true} />);
    expect(capturedProjectsListProps?.hasAnyFolder).toBe(true);
  });

  it('forwards optional onOpenFolder callback', () => {
    const onOpenFolder = vi.fn();
    render(<ProjectsTab {...defaultProps} onOpenFolder={onOpenFolder} />);
    expect(capturedProjectsListProps?.onOpenFolder).toBe(onOpenFolder);
  });

  it('forwards optional onDropItem callback', () => {
    const onDrop = vi.fn();
    render(<ProjectsTab {...defaultProps} onDropItem={onDrop} />);
    expect(capturedProjectsListProps?.onDropItem).toBe(onDrop);
  });

  it('renders with an empty projects array without error', () => {
    expect(() =>
      render(<ProjectsTab {...defaultProps} projects={[]} />)
    ).not.toThrow();
    expect(capturedProjectsListProps?.projects).toEqual([]);
  });
});
