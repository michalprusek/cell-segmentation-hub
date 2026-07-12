/**
 * Shared test kit for the `src/lib/api.ts` axios-client test cluster.
 *
 * The per-file axios mock (`vi.hoisted` mockAxiosInstance + `vi.mock('axios')`)
 * and the `@/lib/config` / `@/lib/logger` module mocks MUST stay inline in each
 * test file because Vitest hoists `vi.mock` factories above imports. What CAN be
 * shared lives here: the localStorage / sessionStorage stubs and the response
 * envelope helper.
 */
import { vi } from 'vitest';

export const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

export const sessionStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

/** Wrap a payload in the backend's `{ data: { success, data } }` envelope. */
export function wrap<T>(data: T) {
  return { data: { success: true, data } };
}

/** Alias for {@link wrap} — reads better at some call sites. */
export const ok = wrap;
