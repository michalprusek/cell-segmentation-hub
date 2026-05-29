/**
 * Behavioral tests for src/lib/toast.ts
 *
 * Strategy: vi.mock('sonner') replaces the sonner module with vi.fn() stubs
 * before any import runs. We then import our toast wrapper and assert that
 * each helper delegates to the correct sonner method with the expected
 * arguments — including options pass-through.
 *
 * createLocalizedToast and useLocalizedToast are also covered:
 *  - translation-function result is used as the message
 *  - empty-string translation falls back to the fallback string or the key
 *  - options objects are forwarded unchanged
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sonner BEFORE importing the module under test
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id-123'),
    dismiss: vi.fn(),
    promise: vi.fn(),
  },
}));

// Import AFTER the mock is in place
import { toast, createLocalizedToast, useLocalizedToast } from '../toast';
import { toast as sonnerToast } from 'sonner';

const mocked = {
  success: vi.mocked(sonnerToast.success),
  error: vi.mocked(sonnerToast.error),
  info: vi.mocked(sonnerToast.info),
  warning: vi.mocked(sonnerToast.warning),
  loading: vi.mocked(sonnerToast.loading),
  dismiss: vi.mocked(sonnerToast.dismiss),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// toast.* — thin delegates to sonner
// ------------------------------------------------------------------
describe('toast', () => {
  describe('toast.success', () => {
    it('calls sonnerToast.success with the message', () => {
      toast.success('All good');
      expect(mocked.success).toHaveBeenCalledOnce();
      expect(mocked.success).toHaveBeenCalledWith('All good', undefined);
    });

    it('forwards options to sonnerToast.success', () => {
      const opts = { duration: 5000 };
      toast.success('OK', opts);
      expect(mocked.success).toHaveBeenCalledWith('OK', opts);
    });
  });

  describe('toast.error', () => {
    it('calls sonnerToast.error with the message', () => {
      toast.error('Something broke');
      expect(mocked.error).toHaveBeenCalledOnce();
      expect(mocked.error).toHaveBeenCalledWith('Something broke', undefined);
    });

    it('forwards options to sonnerToast.error', () => {
      const opts = { description: 'details' };
      toast.error('Oops', opts);
      expect(mocked.error).toHaveBeenCalledWith('Oops', opts);
    });
  });

  describe('toast.info', () => {
    it('calls sonnerToast.info with the message', () => {
      toast.info('FYI');
      expect(mocked.info).toHaveBeenCalledOnce();
      expect(mocked.info).toHaveBeenCalledWith('FYI', undefined);
    });
  });

  describe('toast.warning', () => {
    it('calls sonnerToast.warning with the message', () => {
      toast.warning('Watch out');
      expect(mocked.warning).toHaveBeenCalledOnce();
      expect(mocked.warning).toHaveBeenCalledWith('Watch out', undefined);
    });
  });

  describe('toast.loading', () => {
    it('calls sonnerToast.loading and returns the toast id', () => {
      const id = toast.loading('Working…');
      expect(mocked.loading).toHaveBeenCalledWith('Working…', undefined);
      expect(id).toBe('toast-id-123');
    });
  });

  describe('toast.dismiss', () => {
    it('calls sonnerToast.dismiss with no id', () => {
      toast.dismiss();
      expect(mocked.dismiss).toHaveBeenCalledWith(undefined);
    });

    it('calls sonnerToast.dismiss with a numeric id', () => {
      toast.dismiss(42);
      expect(mocked.dismiss).toHaveBeenCalledWith(42);
    });

    it('calls sonnerToast.dismiss with a string id', () => {
      toast.dismiss('abc');
      expect(mocked.dismiss).toHaveBeenCalledWith('abc');
    });
  });

  describe('toast.promise', () => {
    it('is the sonner promise reference (not wrapped)', () => {
      // promise is exposed directly — it IS sonnerToast.promise
      expect(toast.promise).toBe(sonnerToast.promise);
    });
  });
});

// ------------------------------------------------------------------
// createLocalizedToast — translation → message pipeline
// ------------------------------------------------------------------
describe('createLocalizedToast', () => {
  const tHit = (key: string) => `translated:${key}`;
  const tMiss = (_key: string) => ''; // simulates missing translation

  describe('when translation returns a value', () => {
    it('success uses the translated message', () => {
      const local = createLocalizedToast(tHit);
      local.success('errors.save');
      expect(mocked.success).toHaveBeenCalledWith(
        'translated:errors.save',
        undefined
      );
    });

    it('error uses the translated message', () => {
      const local = createLocalizedToast(tHit);
      local.error('errors.load');
      expect(mocked.error).toHaveBeenCalledWith(
        'translated:errors.load',
        undefined
      );
    });

    it('info uses the translated message', () => {
      const local = createLocalizedToast(tHit);
      local.info('info.ready');
      expect(mocked.info).toHaveBeenCalledWith(
        'translated:info.ready',
        undefined
      );
    });

    it('warning uses the translated message', () => {
      const local = createLocalizedToast(tHit);
      local.warning('warn.slow');
      expect(mocked.warning).toHaveBeenCalledWith(
        'translated:warn.slow',
        undefined
      );
    });

    it('loading uses the translated message and returns the id', () => {
      const local = createLocalizedToast(tHit);
      const id = local.loading('loading.upload');
      expect(mocked.loading).toHaveBeenCalledWith(
        'translated:loading.upload',
        undefined
      );
      expect(id).toBe('toast-id-123');
    });
  });

  describe('when translation returns empty string', () => {
    it('error falls back to fallback.error when provided', () => {
      const local = createLocalizedToast(tMiss, { error: 'Fallback error' });
      local.error('some.key');
      expect(mocked.error).toHaveBeenCalledWith('Fallback error', undefined);
    });

    it('success falls back to fallback.success when provided', () => {
      const local = createLocalizedToast(tMiss, {
        success: 'Fallback success',
      });
      local.success('some.key');
      expect(mocked.success).toHaveBeenCalledWith(
        'Fallback success',
        undefined
      );
    });

    it('falls back to the raw key when no fallback provided', () => {
      const local = createLocalizedToast(tMiss);
      local.error('raw.key');
      expect(mocked.error).toHaveBeenCalledWith('raw.key', undefined);
    });

    it('loading falls back to fallback.info (not fallback.loading)', () => {
      // The implementation uses fallback?.info for loading when translation misses
      const local = createLocalizedToast(tMiss, { info: 'Loading fallback' });
      local.loading('some.key');
      expect(mocked.loading).toHaveBeenCalledWith(
        'Loading fallback',
        undefined
      );
    });
  });

  describe('options forwarding', () => {
    it('passes options to sonner when translation hits', () => {
      const local = createLocalizedToast(tHit);
      const opts = { duration: 3000 };
      local.success('ok.key', opts);
      expect(mocked.success).toHaveBeenCalledWith('translated:ok.key', opts);
    });

    it('passes options to sonner when falling back to key', () => {
      const local = createLocalizedToast(tMiss);
      const opts = { description: 'see console' };
      local.error('err.key', opts);
      expect(mocked.error).toHaveBeenCalledWith('err.key', opts);
    });
  });
});

// ------------------------------------------------------------------
// useLocalizedToast — wraps createLocalizedToast with hard-coded fallbacks
// ------------------------------------------------------------------
describe('useLocalizedToast', () => {
  it('error uses t() result when present', () => {
    const useLanguage = () => ({ t: (key: string) => `L:${key}` });
    const localToast = useLocalizedToast(useLanguage);
    localToast.error('errors.network');
    expect(mocked.error).toHaveBeenCalledWith('L:errors.network', undefined);
  });

  it('error falls back to "An error occurred" when t() returns empty', () => {
    const useLanguage = () => ({ t: () => '' });
    const localToast = useLocalizedToast(useLanguage);
    localToast.error('missing.key');
    expect(mocked.error).toHaveBeenCalledWith('An error occurred', undefined);
  });

  it('success falls back to "Operation successful" when t() returns empty', () => {
    const useLanguage = () => ({ t: () => '' });
    const localToast = useLocalizedToast(useLanguage);
    localToast.success('missing.key');
    expect(mocked.success).toHaveBeenCalledWith(
      'Operation successful',
      undefined
    );
  });

  it('info falls back to "Information" when t() returns empty', () => {
    const useLanguage = () => ({ t: () => '' });
    const localToast = useLocalizedToast(useLanguage);
    localToast.info('missing.key');
    expect(mocked.info).toHaveBeenCalledWith('Information', undefined);
  });

  it('warning falls back to "Warning" when t() returns empty', () => {
    const useLanguage = () => ({ t: () => '' });
    const localToast = useLocalizedToast(useLanguage);
    localToast.warning('missing.key');
    expect(mocked.warning).toHaveBeenCalledWith('Warning', undefined);
  });
});
