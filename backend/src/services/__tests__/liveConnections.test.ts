import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getInstance, disconnectUser } = vi.hoisted(() => ({
  getInstance: vi.fn(),
  disconnectUser: vi.fn(),
}));

vi.mock('../websocketService', () => ({
  WebSocketService: { getInstance },
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { disconnectUserSockets } from '../liveConnections';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('disconnectUserSockets', () => {
  it('closes that user’s sockets', () => {
    getInstance.mockReturnValue({ disconnectUser });

    disconnectUserSockets('user-1');

    expect(disconnectUser).toHaveBeenCalledWith('user-1');
  });

  it('does not throw when the socket server is not running', () => {
    // `getInstance()` throws before the first initialisation. A password
    // change must not fail for that.
    getInstance.mockImplementation(() => {
      throw new Error('Server and Prisma are required for first initialization');
    });

    expect(() => disconnectUserSockets('user-1')).not.toThrow();
  });

  it('does not throw when closing them fails', () => {
    getInstance.mockReturnValue({
      disconnectUser: () => {
        throw new Error('adapter down');
      },
    });

    expect(() => disconnectUserSockets('user-1')).not.toThrow();
  });
});
