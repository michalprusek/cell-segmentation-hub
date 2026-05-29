/**
 * Behavioral tests for UploaderOptions.tsx
 *
 * Covered behaviours:
 *  - showProjectSelector=false renders nothing visible (no selector, no info bar)
 *  - showProjectSelector=true + projectId=null: info bar is shown
 *  - showProjectSelector=true + projectId set: info bar is hidden
 *  - Info bar disappears when projectId transitions from null to a value
 *  - ProjectSelector is rendered when showProjectSelector=true
 *  - onProjectChange callback is wired through to ProjectSelector's onChange
 *
 * ProjectSelector itself is mocked to avoid nested API/auth dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
        'projects.selectProject': 'Select a project',
        'projects.projectSelection': 'Project Selection',
        'images.projectRequired':
          'You must select a project before you can upload images',
      };
      return map[key] ?? key;
    },
  })),
}));

// Mock ProjectSelector so we control its output and capture onChange calls
let capturedOnChange: ((value: string) => void) | null = null;
vi.mock('@/components/ProjectSelector', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (v: string) => void;
  }) => {
    capturedOnChange = onChange;
    return <div data-testid="project-selector" data-value={value ?? ''} />;
  },
}));

import UploaderOptions from '../UploaderOptions';

// ---------------------------------------------------------------------------

describe('UploaderOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnChange = null;
  });

  describe('showProjectSelector=false', () => {
    it('renders nothing visible — no project selector, no info bar', () => {
      render(
        <UploaderOptions
          showProjectSelector={false}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(screen.queryByTestId('project-selector')).not.toBeInTheDocument();
      expect(screen.queryByText('Select a project')).not.toBeInTheDocument();
    });
  });

  describe('showProjectSelector=true', () => {
    it('renders the ProjectSelector component', () => {
      render(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(screen.getByTestId('project-selector')).toBeInTheDocument();
    });

    it('shows info bar when projectId is null', () => {
      render(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.getByText(
          'You must select a project before you can upload images'
        )
      ).toBeInTheDocument();
    });

    it('hides info bar when projectId is provided', () => {
      render(
        <UploaderOptions
          showProjectSelector={true}
          projectId="proj-1"
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.queryByText(
          'You must select a project before you can upload images'
        )
      ).not.toBeInTheDocument();
    });

    it('info bar disappears when projectId transitions from null to a value', () => {
      const { rerender } = render(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.getByText(
          'You must select a project before you can upload images'
        )
      ).toBeInTheDocument();

      rerender(
        <UploaderOptions
          showProjectSelector={true}
          projectId="proj-99"
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.queryByText(
          'You must select a project before you can upload images'
        )
      ).not.toBeInTheDocument();
    });

    it('re-shows info bar when projectId transitions back to null', () => {
      const { rerender } = render(
        <UploaderOptions
          showProjectSelector={true}
          projectId="proj-1"
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.queryByText(
          'You must select a project before you can upload images'
        )
      ).not.toBeInTheDocument();

      rerender(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(
        screen.getByText(
          'You must select a project before you can upload images'
        )
      ).toBeInTheDocument();
    });

    it('wires onProjectChange through to ProjectSelector onChange', async () => {
      const handleChange = vi.fn();
      render(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={handleChange}
        />
      );

      // capturedOnChange was set when ProjectSelector rendered
      expect(capturedOnChange).not.toBeNull();
      capturedOnChange!('proj-42');

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith('proj-42');
      });
    });

    it('renders "Project Selection" heading', () => {
      render(
        <UploaderOptions
          showProjectSelector={true}
          projectId={null}
          onProjectChange={vi.fn()}
        />
      );
      expect(screen.getByText('Project Selection')).toBeInTheDocument();
    });
  });
});
