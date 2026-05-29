/**
 * Behavioral tests for DashboardTabs.tsx
 *
 * Covered behaviours:
 *  - Renders the "Projects" and "Upload Images" tab triggers
 *  - activeTab prop controls which tab trigger is selected
 *  - Clicking a tab calls onTabChange with the correct tab value
 *  - ProjectToolbar is rendered only when activeTab="projects"
 *  - ProjectToolbar is hidden when activeTab="upload"
 *  - children content is rendered inside the Tabs container
 *  - onSort/viewMode props are forwarded to ProjectToolbar
 *
 * ProjectToolbar is mocked to isolate this component's behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.projects': 'Projects',
        'common.uploadImages': 'Upload Images',
      };
      return map[key] ?? key;
    },
  })),
}));

// Capture props passed to ProjectToolbar for assertion
let toolbarProps: Record<string, unknown> | null = null;
vi.mock('@/components/project/ProjectToolbar', () => ({
  default: (props: Record<string, unknown>) => {
    toolbarProps = props;
    return <div data-testid="project-toolbar" />;
  },
}));

import DashboardTabs from '../DashboardTabs';

// ---------------------------------------------------------------------------

const defaultProps = {
  activeTab: 'projects' as const,
  onTabChange: vi.fn(),
  viewMode: 'grid' as const,
  setViewMode: vi.fn(),
  onSort: vi.fn(),
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
};

describe('DashboardTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolbarProps = null;
  });

  describe('Tab rendering', () => {
    it('renders the "Projects" tab trigger', () => {
      render(
        <DashboardTabs {...defaultProps}>
          <div />
        </DashboardTabs>
      );
      expect(
        screen.getByRole('tab', { name: /projects/i })
      ).toBeInTheDocument();
    });

    it('renders the "Upload Images" tab trigger', () => {
      render(
        <DashboardTabs {...defaultProps}>
          <div />
        </DashboardTabs>
      );
      expect(
        screen.getByRole('tab', { name: /upload images/i })
      ).toBeInTheDocument();
    });

    it('activeTab="projects" makes the Projects tab selected', () => {
      render(
        <DashboardTabs {...defaultProps} activeTab="projects">
          <div />
        </DashboardTabs>
      );
      const projectsTab = screen.getByRole('tab', { name: /projects/i });
      expect(projectsTab).toHaveAttribute('data-state', 'active');
    });

    it('activeTab="upload" makes the Upload tab selected', () => {
      render(
        <DashboardTabs {...defaultProps} activeTab="upload">
          <div />
        </DashboardTabs>
      );
      const uploadTab = screen.getByRole('tab', { name: /upload images/i });
      expect(uploadTab).toHaveAttribute('data-state', 'active');
    });
  });

  describe('Tab click interaction', () => {
    it('clicking "Upload Images" tab calls onTabChange("upload")', async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      render(
        <DashboardTabs
          {...defaultProps}
          onTabChange={onTabChange}
          activeTab="projects"
        >
          <div />
        </DashboardTabs>
      );
      await user.click(screen.getByRole('tab', { name: /upload images/i }));
      await waitFor(() => {
        expect(onTabChange).toHaveBeenCalledWith('upload');
      });
    });

    it('clicking "Projects" tab calls onTabChange("projects")', async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      render(
        <DashboardTabs
          {...defaultProps}
          onTabChange={onTabChange}
          activeTab="upload"
        >
          <div />
        </DashboardTabs>
      );
      await user.click(screen.getByRole('tab', { name: /projects/i }));
      await waitFor(() => {
        expect(onTabChange).toHaveBeenCalledWith('projects');
      });
    });
  });

  describe('ProjectToolbar visibility', () => {
    it('shows ProjectToolbar when activeTab="projects"', () => {
      render(
        <DashboardTabs {...defaultProps} activeTab="projects">
          <div />
        </DashboardTabs>
      );
      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
    });

    it('hides ProjectToolbar when activeTab="upload"', () => {
      render(
        <DashboardTabs {...defaultProps} activeTab="upload">
          <div />
        </DashboardTabs>
      );
      expect(screen.queryByTestId('project-toolbar')).not.toBeInTheDocument();
    });
  });

  describe('ProjectToolbar prop forwarding', () => {
    it('forwards sortField to ProjectToolbar', () => {
      render(
        <DashboardTabs {...defaultProps} sortField="updatedAt">
          <div />
        </DashboardTabs>
      );
      expect(toolbarProps?.sortField).toBe('updatedAt');
    });

    it('forwards sortDirection to ProjectToolbar', () => {
      render(
        <DashboardTabs {...defaultProps} sortDirection="desc">
          <div />
        </DashboardTabs>
      );
      expect(toolbarProps?.sortDirection).toBe('desc');
    });

    it('forwards viewMode to ProjectToolbar', () => {
      render(
        <DashboardTabs {...defaultProps} viewMode="list">
          <div />
        </DashboardTabs>
      );
      expect(toolbarProps?.viewMode).toBe('list');
    });

    it('passes showSearchBar=false to ProjectToolbar', () => {
      render(
        <DashboardTabs {...defaultProps}>
          <div />
        </DashboardTabs>
      );
      expect(toolbarProps?.showSearchBar).toBe(false);
    });

    it('passes showUploadButton=false to ProjectToolbar', () => {
      render(
        <DashboardTabs {...defaultProps}>
          <div />
        </DashboardTabs>
      );
      expect(toolbarProps?.showUploadButton).toBe(false);
    });
  });

  describe('Children rendering', () => {
    it('renders children inside the tabs container', () => {
      render(
        <DashboardTabs {...defaultProps}>
          <div data-testid="tab-content">Tab Content</div>
        </DashboardTabs>
      );
      expect(screen.getByTestId('tab-content')).toBeInTheDocument();
    });
  });
});
