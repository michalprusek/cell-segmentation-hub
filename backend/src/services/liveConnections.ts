import { logger } from '../utils/logger';
import { WebSocketService } from './websocketService';

/**
 * Close every WebSocket a user has open.
 *
 * The session cut-off is enforced when a socket CONNECTS and on every HTTP
 * request - but a socket that is already open is not asked again, so a
 * session ended by a password change would keep receiving live events until
 * its socket happened to drop. Closing them forces the question: the client
 * reconnects by itself, the browser that made the change succeeds with its
 * new cookie, and every other one fails the handshake.
 *
 * Never throws. A password change must not fail because the socket server
 * is not up (a test, a script, the first seconds of start-up).
 */
export function disconnectUserSockets(userId: string): void {
  try {
    WebSocketService.getInstance().disconnectUser(userId);
  } catch (error) {
    logger.debug(
      'No WebSocket server to disconnect sockets on',
      'LiveConnections',
      { userId, reason: (error as Error).message }
    );
  }
}
