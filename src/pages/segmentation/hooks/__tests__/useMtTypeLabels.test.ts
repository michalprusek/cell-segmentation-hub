import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: {
    getMtTypeLabels: vi.fn(),
    putMtTypeLabels: vi.fn(),
    deleteMtTypeLabel: vi.fn(),
  },
  toastMock: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ default: apiMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useMtTypeLabels } from '../useMtTypeLabels';

const A = { id: 'a', name: 'alpha', color: '#ff0000' };
const B = { id: 'b', name: 'beta', color: '#00ff00' };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getMtTypeLabels.mockResolvedValue([A]);
  apiMock.putMtTypeLabels.mockImplementation(async (_p, labels) => labels);
  apiMock.deleteMtTypeLabel.mockResolvedValue([]);
});

const load = async () => {
  const hook = renderHook(() => useMtTypeLabels('p1', true));
  await waitFor(() => expect(hook.result.current.labels).toEqual([A]));
  return hook;
};

describe('useMtTypeLabels', () => {
  it('loads the palette on mount when enabled', async () => {
    const { result } = await load();
    expect(apiMock.getMtTypeLabels).toHaveBeenCalledWith('p1');
    expect(result.current.colorById.get('a')).toBe('#ff0000');
  });

  it('does not fetch when disabled', async () => {
    renderHook(() => useMtTypeLabels('p1', false));
    await Promise.resolve();
    expect(apiMock.getMtTypeLabels).not.toHaveBeenCalled();
  });

  it('toasts on a failed palette load', async () => {
    apiMock.getMtTypeLabels.mockRejectedValueOnce(new Error('boom'));
    renderHook(() => useMtTypeLabels('p1', true));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'microtubule.type.loadFailed'
      )
    );
  });

  it('createLabel persists a new label and returns it', async () => {
    const { result } = await load();
    let created: unknown;
    await act(async () => {
      created = await result.current.createLabel('EB3', '#123456');
    });
    expect(apiMock.putMtTypeLabels).toHaveBeenCalledTimes(1);
    expect((created as { name: string }).name).toBe('EB3');
  });

  it('createLabel reuses an existing label with the same (case-insensitive) name', async () => {
    const { result } = await load();
    let created: unknown;
    await act(async () => {
      created = await result.current.createLabel('ALPHA', '#000000');
    });
    expect(created).toEqual(A); // reused, not a new id
    expect(apiMock.putMtTypeLabels).not.toHaveBeenCalled();
  });

  it('createLabel returns null for a blank name without persisting', async () => {
    const { result } = await load();
    let created: unknown = 'x';
    await act(async () => {
      created = await result.current.createLabel('   ', '#000000');
    });
    expect(created).toBeNull();
    expect(apiMock.putMtTypeLabels).not.toHaveBeenCalled();
  });

  it('createLabel toasts and returns null when the PUT fails', async () => {
    apiMock.putMtTypeLabels.mockRejectedValueOnce(new Error('500'));
    const { result } = await load();
    let created: unknown = 'x';
    await act(async () => {
      created = await result.current.createLabel('EB3', '#123456');
    });
    expect(created).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith(
      'microtubule.type.createFailed'
    );
  });

  it('renameLabel blocks a rename onto another label’s name', async () => {
    apiMock.getMtTypeLabels.mockResolvedValue([A, B]);
    const hook = renderHook(() => useMtTypeLabels('p1', true));
    await waitFor(() => expect(hook.result.current.labels).toHaveLength(2));
    await act(async () => {
      await hook.result.current.renameLabel('b', 'Alpha', '#00ff00');
    });
    expect(toastMock.error).toHaveBeenCalledWith(
      'microtubule.type.duplicateName'
    );
    expect(apiMock.putMtTypeLabels).not.toHaveBeenCalled();
  });

  it('deleteLabel toasts on failure and leaves labels unchanged', async () => {
    apiMock.deleteMtTypeLabel.mockRejectedValueOnce(new Error('nope'));
    const { result } = await load();
    await act(async () => {
      await result.current.deleteLabel('a');
    });
    expect(toastMock.error).toHaveBeenCalledWith(
      'microtubule.type.deleteFailed'
    );
    expect(result.current.labels).toEqual([A]); // unchanged
  });
});
