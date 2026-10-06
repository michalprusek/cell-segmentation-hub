import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ApiKeysSection from '../ApiKeysSection';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    getApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  },
}));

const api = apiClient as unknown as Record<
  'getApiKeys' | 'createApiKey' | 'deleteApiKey',
  ReturnType<typeof vi.fn>
>;

const SECRET = `sseg_${'A'.repeat(43)}chksum`;

const EXISTING = {
  id: 'key-old',
  name: 'Old pipeline',
  prefix: 'sseg_Zz99',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
};

const rejection = (code: string) =>
  Object.assign(new Error('refused'), { response: { data: { code } } });

beforeEach(() => {
  vi.clearAllMocks();
  api.getApiKeys.mockResolvedValue([EXISTING]);
});

const typeNameAndSubmit = async (name: string) => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Name'), name);
  await user.click(screen.getByRole('button', { name: 'Create key' }));
  return user;
};

describe('ApiKeysSection', () => {
  it('lists existing keys by prefix and never shows a secret', async () => {
    render(<ApiKeysSection />);

    const row = (await screen.findByText('Old pipeline')).closest('tr')!;
    expect(within(row).getByText('sseg_Zz99…')).toBeInTheDocument();
    // "Last used" and "Expires" both read Never for this key.
    expect(within(row).getAllByText('Never')).toHaveLength(2);
    expect(screen.queryByText('Your new API key')).not.toBeInTheDocument();
  });

  it('says so when there are no keys', async () => {
    api.getApiKeys.mockResolvedValue([]);
    render(<ApiKeysSection />);
    expect(
      await screen.findByText('You have no API keys yet.')
    ).toBeInTheDocument();
  });

  it('marks a key whose expiry has passed', async () => {
    api.getApiKeys.mockResolvedValue([
      { ...EXISTING, expiresAt: '2020-01-01T00:00:00.000Z' },
    ]);
    render(<ApiKeysSection />);
    expect(await screen.findByText('Expired')).toBeInTheDocument();
  });

  it('will not submit an empty or whitespace-only name', async () => {
    render(<ApiKeysSection />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Create key' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), '   ');
    expect(button).toBeDisabled();
    expect(api.createApiKey).not.toHaveBeenCalled();
  });

  it('creates a key, reveals it once, and forgets it on dismissal', async () => {
    api.createApiKey.mockResolvedValue({
      id: 'key-new',
      name: 'New pipeline',
      prefix: 'sseg_AAAA',
      createdAt: '2026-10-06T12:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
      key: SECRET,
    });
    render(<ApiKeysSection />);

    const user = await typeNameAndSubmit('  New pipeline ');

    expect(api.createApiKey).toHaveBeenCalledWith({
      name: 'New pipeline',
      expiresInDays: null,
    });
    expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();
    // The new key joins the list by prefix; the old one is still there.
    expect(screen.getByText('sseg_AAAA…')).toBeInTheDocument();
    expect(screen.getByText('Old pipeline')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'I have saved it' }));

    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByText('sseg_AAAA…')).toBeInTheDocument();
  });

  it('copies the revealed key to the clipboard', async () => {
    api.createApiKey.mockResolvedValue({ ...EXISTING, id: 'k2', key: SECRET });
    render(<ApiKeysSection />);
    const user = await typeNameAndSubmit('x');
    // userEvent.setup() installs its own clipboard stub; spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(SECRET);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Copied to clipboard')
    );
  });

  it.each([
    [
      'API_KEY_LIMIT_REACHED',
      'You have reached the limit of 10 keys. Revoke one you no longer use.',
    ],
    [
      'API_KEY_IMPERSONATION_FORBIDDEN',
      'API keys cannot be created or revoked while impersonating a user.',
    ],
    ['SOMETHING_ELSE', 'Could not create the API key'],
  ])('explains a refused creation (%s)', async (code, message) => {
    api.createApiKey.mockRejectedValue(rejection(code));
    render(<ApiKeysSection />);

    await typeNameAndSubmit('x');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(screen.queryByText('Your new API key')).not.toBeInTheDocument();
  });

  it('revokes only after confirmation, naming the key', async () => {
    api.deleteApiKey.mockResolvedValue(undefined);
    render(<ApiKeysSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      'Anything using the key "Old pipeline" will stop working immediately.'
    );
    expect(api.deleteApiKey).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(api.deleteApiKey).toHaveBeenCalledWith('key-old')
    );
    await waitFor(() =>
      expect(screen.queryByText('Old pipeline')).not.toBeInTheDocument()
    );
    expect(toast.success).toHaveBeenCalledWith('API key revoked');
  });

  it('keeps the key when the confirmation is cancelled', async () => {
    render(<ApiKeysSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      })
    );

    expect(api.deleteApiKey).not.toHaveBeenCalled();
    expect(screen.getByText('Old pipeline')).toBeInTheDocument();
  });

  it('keeps the key in the list when revoking fails', async () => {
    api.deleteApiKey.mockRejectedValue(rejection('NOPE'));
    render(<ApiKeysSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Revoke',
      })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not revoke the API key')
    );
    expect(screen.getByText('Old pipeline')).toBeInTheDocument();
  });
});
