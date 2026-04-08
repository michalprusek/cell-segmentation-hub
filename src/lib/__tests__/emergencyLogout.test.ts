import { describe, it, expect, beforeEach } from 'vitest';
import {
  emergencyLogout,
  isEmergencyLogout,
  clearEmergencyFlag,
} from '@/lib/emergencyLogout';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('emergencyLogout', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset localStorage and sessionStorage mocks
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(localStorage.clear).mockClear();
    vi.mocked(sessionStorage.clear).mockClear();

    // Reset window.location to a clean state
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/dashboard',
        href: 'http://localhost/dashboard',
        search: '',
        replace: vi.fn(),
        reload: vi.fn(),
        assign: vi.fn(),
      },
      writable: true,
    });
  });

  describe('storage cleanup', () => {
    it('removes known auth tokens from localStorage', () => {
      emergencyLogout('test reason');

      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('user');
      expect(localStorage.removeItem).toHaveBeenCalledWith('userProfile');
    });

    it('removes known auth tokens from sessionStorage', () => {
      emergencyLogout('test reason');

      expect(sessionStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('user');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('userProfile');
    });
  });

  describe('redirect behavior', () => {
    it('calls window.location.replace when not already on the target path', () => {
      emergencyLogout('Auth failure');

      expect(window.location.replace).toHaveBeenCalledTimes(1);
      const replacedUrl = vi.mocked(window.location.replace).mock
        .calls[0][0] as string;
      expect(replacedUrl).toContain('/sign-in');
      expect(replacedUrl).toContain('emergency=true');
    });

    it('appends a timestamp query parameter to the redirect URL', () => {
      const before = Date.now();
      emergencyLogout('Auth failure');
      const after = Date.now();

      const replacedUrl = vi.mocked(window.location.replace).mock
        .calls[0][0] as string;
      const match = replacedUrl.match(/[?&]t=(\d+)/);
      expect(match).not.toBeNull();
      const timestamp = parseInt(match![1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('uses a custom redirect path when provided', () => {
      emergencyLogout('reason', '/custom-path');

      const replacedUrl = vi.mocked(window.location.replace).mock
        .calls[0][0] as string;
      expect(replacedUrl).toContain('/custom-path');
    });

    it('calls reload instead of replace when already on the sign-in page', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/sign-in',
          href: 'http://localhost/sign-in',
          search: '',
          replace: vi.fn(),
          reload: vi.fn(),
          assign: vi.fn(),
        },
        writable: true,
      });

      emergencyLogout('reason', '/sign-in');

      expect(window.location.reload).toHaveBeenCalledTimes(1);
      expect(window.location.replace).not.toHaveBeenCalled();
    });
  });

  describe('isEmergencyLogout', () => {
    it('returns true when the URL contains emergency=true', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/sign-in',
          href: 'http://localhost/sign-in?emergency=true&t=12345',
          search: '?emergency=true&t=12345',
          replace: vi.fn(),
          reload: vi.fn(),
          assign: vi.fn(),
        },
        writable: true,
      });

      expect(isEmergencyLogout()).toBe(true);
    });

    it('returns false when the URL does not contain the emergency flag', () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/sign-in',
          href: 'http://localhost/sign-in',
          search: '',
          replace: vi.fn(),
          reload: vi.fn(),
          assign: vi.fn(),
        },
        writable: true,
      });

      expect(isEmergencyLogout()).toBe(false);
    });
  });

  describe('clearEmergencyFlag', () => {
    it('removes emergency and t params from the URL via history.replaceState', () => {
      const replaceState = vi.fn();
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/sign-in',
          href: 'http://localhost/sign-in?emergency=true&t=12345',
          search: '?emergency=true&t=12345',
          replace: vi.fn(),
          reload: vi.fn(),
          assign: vi.fn(),
        },
        writable: true,
      });
      Object.defineProperty(window, 'history', {
        value: { replaceState },
        writable: true,
      });

      clearEmergencyFlag();

      expect(replaceState).toHaveBeenCalledTimes(1);
      const newUrl = replaceState.mock.calls[0][2] as string;
      expect(newUrl).not.toContain('emergency');
      expect(newUrl).not.toContain('&t=');
    });

    it('does nothing when emergency flag is not present', () => {
      const replaceState = vi.fn();
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/dashboard',
          href: 'http://localhost/dashboard',
          search: '',
          replace: vi.fn(),
          reload: vi.fn(),
          assign: vi.fn(),
        },
        writable: true,
      });
      Object.defineProperty(window, 'history', {
        value: { replaceState },
        writable: true,
      });

      clearEmergencyFlag();

      expect(replaceState).not.toHaveBeenCalled();
    });
  });
});
