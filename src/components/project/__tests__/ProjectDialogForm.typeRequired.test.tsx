/**
 * The create dialog must not pick a project type on the user's behalf.
 *
 * It used to open with "Spheroids (standard)" already selected, so a user who
 * never touched the picker created a spheroid project — and the type decides
 * the model, the editor mode and the export format.
 *
 * REAL `ProjectDialogForm` + REAL `useProjectForm`; only the HTTP client is a
 * double. `ProjectDialogForm.test.tsx` mocks the hook, so it can check what the
 * form renders for a given hook state but not that the two are wired: a form
 * that ignored `projectTypeError`, or a hook that never set it, would pass
 * there and fail here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { toast } from 'sonner';
import apiClient from '@/lib/api';
import ProjectDialogForm from '../ProjectDialogForm';
import { chooseProjectType } from './chooseProjectType';

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    createProject: vi.fn(),
    moveProjectsToFolder: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Needs Dialog context otherwise; the claims here are about the form.
vi.mock('@/components/ui/dialog', () => ({
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AuthProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </AuthProvider>
  </MemoryRouter>
);

const typeError = 'Choose a project type';

describe('ProjectDialogForm — the project type is a required choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = 'authenticated=1';
    vi.mocked(apiClient.getUserProfile).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      preferred_theme: 'system',
      preferredLang: 'en',
    } as never);
    vi.mocked(apiClient.createProject).mockResolvedValue({
      id: 'proj-1',
      name: 'Typed',
    } as never);
  });

  const renderForm = async () => {
    const onSuccess = vi.fn();
    render(<ProjectDialogForm onSuccess={onSuccess} onClose={vi.fn()} />, {
      wrapper,
    });
    // Signed in before submitting, so a missing type is the ONLY reason a
    // submit can be refused.
    await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());
    return { onSuccess };
  };

  it('opens with no type selected — the picker shows its placeholder', async () => {
    await renderForm();

    const picker = screen.getByRole('combobox', { name: 'Project Type' });
    expect(picker).toHaveTextContent('Select a project type…');
    expect(picker).not.toHaveTextContent('Spheroids (standard)');
    expect(screen.queryByText(typeError)).not.toBeInTheDocument();
  });

  it('refuses a submit without a type: error under the field, field focused, nothing sent', async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.type(screen.getByLabelText('Project Name'), 'Untyped');
    await user.click(
      screen.getByRole('button', { name: 'Create New Project' })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(typeError);

    const picker = screen.getByRole('combobox', { name: 'Project Type' });
    expect(picker).toHaveAttribute('aria-invalid', 'true');
    expect(picker).toHaveAttribute('aria-describedby', alert.id);
    expect(picker).toHaveFocus();
    // The red must survive the pointer: the trigger's base class carries
    // `hover:border-ring/60`, and tailwind-merge keeps only one hover border.
    expect(picker.className).toContain('hover:border-destructive');
    expect(picker.className).not.toContain('hover:border-ring/60');

    expect(apiClient.createProject).not.toHaveBeenCalled();
  });

  it('reports a blank name and a missing type on the SAME submit', async () => {
    const user = userEvent.setup();
    await renderForm();

    // Spaces pass the input's native `required`; the hook trims.
    await user.type(screen.getByLabelText('Project Name'), '   ');
    await user.click(
      screen.getByRole('button', { name: 'Create New Project' })
    );

    expect(toast.error).toHaveBeenCalledWith('Please enter a project name');
    expect(await screen.findByRole('alert')).toHaveTextContent(typeError);
    expect(apiClient.createProject).not.toHaveBeenCalled();
  });

  it('choosing a type clears the error, and the chosen type is what is sent', async () => {
    const user = userEvent.setup();
    const { onSuccess } = await renderForm();

    await user.type(screen.getByLabelText('Project Name'), 'Typed');
    await user.click(
      screen.getByRole('button', { name: 'Create New Project' })
    );
    await screen.findByRole('alert');

    await chooseProjectType(user, 'Neurites & somas');
    // The helper fills jsdom's gaps only for its own clicks.
    for (const api of [
      'hasPointerCapture',
      'releasePointerCapture',
      'scrollIntoView',
    ]) {
      expect(api in Element.prototype, api).toBe(false);
    }

    expect(screen.queryByText(typeError)).not.toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Project Type' })
    ).not.toHaveAttribute('aria-invalid');

    await user.click(
      screen.getByRole('button', { name: 'Create New Project' })
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('proj-1'));
    expect(apiClient.createProject).toHaveBeenCalledTimes(1);
    expect(apiClient.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Typed', type: 'neurite' })
    );

    // The form stays mounted here (onClose is a spy), so this is the reset
    // path: the picker must be back at its placeholder, not still showing the
    // previous project's type — a stale choice would be a silent default again.
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Project Type' })
      ).toHaveTextContent('Select a project type…')
    );
  });
});
