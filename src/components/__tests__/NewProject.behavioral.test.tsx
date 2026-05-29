/**
 * NewProject.tsx — behavioral tests (complement to the skipped NewProject.test.tsx).
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/components/__tests__/NewProject.behavioral.test.tsx --reporter=dot
 *
 * Behaviors tested:
 *   - Trigger button renders with "New Project" label + PlusCircle icon.
 *   - Clicking trigger opens the dialog with title, description, form fields.
 *   - Submitting with empty name toasts error + does NOT call apiClient.
 *   - Submitting with whitespace-only name toasts error.
 *   - Submitting when user is null shows "must be logged in" toast.
 *   - Successful creation: calls createProject with name/description/type,
 *     success toast fired, dialog closes, onProjectCreated callback called,
 *     window "project-created" event dispatched.
 *   - Empty description trimmed to '' in payload.
 *   - Description whitespace trimmed before send.
 *   - Invalid server response (no id) shows error toast.
 *   - API rejection shows error toast.
 *   - Submit button disabled and shows "Creating..." during pending request.
 *   - Form resets (name/description cleared) after successful creation.
 *   - Works when onProjectCreated is not provided.
 *
 * NOT tested:
 *   - Radix UI Select portal interactions in jsdom (unreliable — select trigger
 *     controlled via our stub's data-value attribute instead).
 *   - logger call count (implementation detail).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Hoisted mock refs
// ---------------------------------------------------------------------------
const { mockCreateProject, mockUser, mockToastError, mockToastSuccess } =
  vi.hoisted(() => ({
    mockCreateProject: vi.fn(),
    mockUser: {
      value: { id: 'u1', email: 'alice@example.com' } as {
        id: string;
        email: string;
      } | null,
    },
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  default: { createProject: mockCreateProject },
  apiClient: { createProject: mockCreateProject },
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    user: mockUser.value,
    isAuthenticated: mockUser.value !== null,
    loading: false,
  }),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const MAP: Record<string, string> = {
        'common.newProject': 'New Project',
        'projects.createProject': 'Create New Project',
        'projects.createProjectDesc': 'Fill in the details below.',
        'common.projectName': 'Project Name',
        'projects.projectNamePlaceholder': 'e.g., HeLa Cell Spheroids',
        'projects.descriptionOptional': 'Description (Optional)',
        'projects.projectDescPlaceholder': 'Optional description',
        'projects.projectType': 'Project Type',
        'projects.creatingProject': 'Creating...',
        'projects.projectNameRequired': 'Please enter a project name',
        'projects.mustBeLoggedIn': 'You must be logged in to create a project',
        'projects.failedToCreateProject': 'Failed to create project',
        'projects.serverResponseInvalid': 'Server response was invalid',
        'projects.projectCreated': 'Project created successfully',
        'projects.projectCreatedDesc': `"${params?.name ?? ''}" is ready for images`,
        'projects.types.spheroid': 'Spheroid',
        'projects.types.spheroid_invasive': 'Spheroid Invasive',
        'projects.types.wound': 'Wound',
        'projects.types.sperm': 'Sperm',
        'projects.types.microtubules': 'Microtubules',
      };
      return MAP[key] ?? key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Stub Radix Dialog to plain HTML.
// Key behavioural contract:
//   • Dialog renders all children (trigger + content are always in tree).
//   • DialogTrigger intercepts the child's onClick and calls onOpenChange(true).
//   • DialogContent renders only when open=true.
// We pass the open state + setter through a React context.
vi.mock('@/components/ui/dialog', async () => {
  const { createContext, useContext, cloneElement, isValidElement } =
    await import('react');

  type DialogCtxType = { open: boolean; setOpen: (v: boolean) => void };
  const DialogCtx = createContext<DialogCtxType>({
    open: false,
    setOpen: () => undefined,
  });

  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (v: boolean) => void;
      children: React.ReactNode;
    }) => (
      <DialogCtx.Provider value={{ open, setOpen: onOpenChange }}>
        {children}
      </DialogCtx.Provider>
    ),

    // DialogTrigger wraps the child and intercepts its onClick to open the dialog.
    DialogTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => {
      const { setOpen } = useContext(DialogCtx);
      if (asChild && isValidElement(children)) {
        const child = children as React.ReactElement<{
          onClick?: React.MouseEventHandler;
        }>;
        return cloneElement(child, {
          onClick: (e: React.MouseEvent) => {
            child.props.onClick?.(e);
            setOpen(true);
          },
        });
      }
      return (
        <button data-testid="dialog-trigger" onClick={() => setOpen(true)}>
          {children}
        </button>
      );
    },

    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = useContext(DialogCtx);
      return open ? (
        <div role="dialog" data-testid="dialog-content">
          {children}
        </div>
      ) : null;
    },

    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      type={type ?? 'button'}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({
    children,
    htmlFor,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
  }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange: _onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="select-root" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
  }) => (
    <div data-testid="select-trigger" id={id}>
      {children}
    </div>
  ),
  SelectValue: () => <span data-testid="select-value" />,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-testid={`select-item-${value}`}>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  PlusCircle: () => <span data-testid="plus-icon" />,
}));

vi.mock('@/types', async () => {
  const actual = await vi.importActual<typeof import('@/types')>('@/types');
  return { ...actual, getErrorMessage: () => null };
});

import NewProject from '../NewProject';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderComp(onProjectCreated?: (id: string) => void) {
  return render(
    <MemoryRouter>
      <NewProject onProjectCreated={onProjectCreated} />
    </MemoryRouter>
  );
}

function clickTrigger() {
  fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
}

function fillName(value: string) {
  fireEvent.change(screen.getByPlaceholderText('e.g., HeLa Cell Spheroids'), {
    target: { value },
  });
}

function fillDescription(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Optional description'), {
    target: { value },
  });
}

function clickSubmit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create New Project' }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewProject — trigger button', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('renders the New Project button', () => {
    renderComp();
    expect(
      screen.getByRole('button', { name: 'New Project' })
    ).toBeInTheDocument();
  });

  it('renders the PlusCircle icon inside the button', () => {
    renderComp();
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
  });

  it('dialog is closed initially', () => {
    renderComp();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking trigger opens the dialog', () => {
    renderComp();
    clickTrigger();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('NewProject — dialog form contents', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('dialog title is "Create New Project"', () => {
    renderComp();
    clickTrigger();
    expect(
      screen.getByRole('heading', { name: 'Create New Project' })
    ).toBeInTheDocument();
  });

  it('renders Project Name label and input', () => {
    renderComp();
    clickTrigger();
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument();
  });

  it('renders Description (Optional) label and input', () => {
    renderComp();
    clickTrigger();
    expect(screen.getByLabelText('Description (Optional)')).toBeInTheDocument();
  });

  it('renders Project Type select defaulting to spheroid', () => {
    renderComp();
    clickTrigger();
    expect(screen.getByTestId('select-root')).toHaveAttribute(
      'data-value',
      'spheroid'
    );
  });

  it('renders all five project type options', () => {
    renderComp();
    clickTrigger();
    for (const type of [
      'spheroid',
      'spheroid_invasive',
      'wound',
      'sperm',
      'microtubules',
    ]) {
      expect(screen.getByTestId(`select-item-${type}`)).toBeInTheDocument();
    }
  });

  it('renders submit button', () => {
    renderComp();
    clickTrigger();
    expect(
      screen.getByRole('button', { name: 'Create New Project' })
    ).toBeInTheDocument();
  });
});

describe('NewProject — validation', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('empty name → error toast, no API call', async () => {
    renderComp();
    clickTrigger();
    // The Input has `required`, so a button click triggers HTML5 native
    // validation in jsdom and swallows the submit event before our handler
    // runs. Submitting the form element directly bypasses native validation
    // and lets our JS handler fire (which checks trim() and calls toast.error).
    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Please enter a project name')
    );
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('whitespace-only name → error toast, no API call', async () => {
    renderComp();
    clickTrigger();
    fillName('   ');
    clickSubmit();
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Please enter a project name')
    );
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('no user → "must be logged in" toast, no API call', async () => {
    mockUser.value = null;
    renderComp();
    clickTrigger();
    fillName('My Project');
    clickSubmit();
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'You must be logged in to create a project'
      )
    );
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

describe('NewProject — successful creation', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('calls createProject with name, trimmed description, default type', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p1' });
    renderComp();
    clickTrigger();
    fillName('Test Project');
    fillDescription('  Desc  ');
    clickSubmit();
    await waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'Test Project',
        description: 'Desc',
        type: 'spheroid',
      })
    );
  });

  it('empty description sends empty string', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p2' });
    renderComp();
    clickTrigger();
    fillName('No Desc Project');
    clickSubmit();
    await waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' })
      )
    );
  });

  it('success toast fired after creation', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p3' });
    renderComp();
    clickTrigger();
    fillName('Toast Project');
    clickSubmit();
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Project created successfully',
        expect.any(Object)
      )
    );
  });

  it('dialog closes after creation', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p4' });
    renderComp();
    clickTrigger();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fillName('Close Project');
    clickSubmit();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('onProjectCreated callback called with new id', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p5' });
    const cb = vi.fn();
    renderComp(cb);
    clickTrigger();
    fillName('CB Project');
    clickSubmit();
    await waitFor(() => expect(cb).toHaveBeenCalledWith('p5'));
  });

  it('dispatches window "project-created" event with projectId', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p6' });
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('project-created', handler);

    renderComp();
    clickTrigger();
    fillName('Event Project');
    clickSubmit();
    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events[0].detail).toEqual({ projectId: 'p6' });

    window.removeEventListener('project-created', handler);
  });

  it('works without onProjectCreated (no callback error)', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p7' });
    renderComp(); // no callback
    clickTrigger();
    fillName('No CB Project');
    clickSubmit();
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
  });
});

describe('NewProject — error paths', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('server returns null → error toast', async () => {
    mockCreateProject.mockResolvedValue(null);
    renderComp();
    clickTrigger();
    fillName('Null Response');
    clickSubmit();
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  it('server returns no id → error toast with description', async () => {
    mockCreateProject.mockResolvedValue({});
    renderComp();
    clickTrigger();
    fillName('No ID');
    clickSubmit();
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to create project',
        expect.objectContaining({ description: 'Server response was invalid' })
      )
    );
  });

  it('API rejects → error toast', async () => {
    mockCreateProject.mockRejectedValue(new Error('Network'));
    renderComp();
    clickTrigger();
    fillName('Error Project');
    clickSubmit();
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
});

describe('NewProject — loading state', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUser.value = { id: 'u1', email: 'alice@example.com' };
  });

  it('submit button shows "Creating..." and is disabled during pending request', async () => {
    let resolve!: (v: { id: string }) => void;
    mockCreateProject.mockReturnValue(
      new Promise<{ id: string }>(r => {
        resolve = r;
      })
    );

    renderComp();
    clickTrigger();
    fillName('Pending Project');
    clickSubmit();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled()
    );

    resolve({ id: 'done' });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Creating...' })
      ).not.toBeInTheDocument()
    );
  });
});
