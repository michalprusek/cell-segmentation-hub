import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketService } from '../websocketService';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock Socket.IO
const mockSocket = {
  id: 'mock-socket-id',
  userId: null,
  user: null,
  emit: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  data: {}
};

const mockIO = {
  on: vi.fn(),
  emit: vi.fn(),
  to: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  sockets: {
    sockets: new Map([['mock-socket-id', mockSocket]])
  },
  use: vi.fn(),
  close: vi.fn()
};

vi.mock('socket.io', () => ({
  Server: vi.fn(() => mockIO)
}));

describe('WebSocket Queue Cancellation Events', () => {
  let websocketService: WebSocketService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singleton
    (WebSocketService as any).instance = null;

    websocketService = WebSocketService.getInstance();
    (websocketService as any).io = mockIO;
    (websocketService as any).userSockets = new Map();
    (websocketService as any).userSockets.set('user-123', mockSocket);
  });

  afterEach(() => {
    vi.resetAllMocks();
    (WebSocketService as any).instance = null;
  });

  describe('emitToUser for Cancel Events', () => {
    it('should emit queue:cancelled event to correct user', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:cancelled', eventData);
    });

    it('should emit batch:cancelled event correctly', () => {
      const userId = 'user-123';
      const eventData = {
        batchId: 'batch-456',
        cancelledCount: 10,
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      websocketService.emitToUser(userId, 'batch:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('batch:cancelled', eventData);
    });

    it('should handle non-existent user gracefully', () => {
      const nonExistentUserId = 'non-existent-user';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 0,
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      expect(() => {
        websocketService.emitToUser(nonExistentUserId, 'queue:cancelled', eventData);
      }).not.toThrow();

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should emit to multiple users for concurrent cancellations', () => {
      const user1Socket = { ...mockSocket, emit: vi.fn() };
      const user2Socket = { ...mockSocket, emit: vi.fn() };

      (websocketService as any).userSockets.set('user-123', user1Socket);
      (websocketService as any).userSockets.set('user-456', user2Socket);

      const event1Data = {
        projectId: 'project-123',
        cancelledCount: 3,
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      const event2Data = {
        projectId: 'project-456',
        cancelledCount: 7,
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      websocketService.emitToUser('user-123', 'queue:cancelled', event1Data);
      websocketService.emitToUser('user-456', 'queue:cancelled', event2Data);

      expect(user1Socket.emit).toHaveBeenCalledWith('queue:cancelled', event1Data);
      expect(user2Socket.emit).toHaveBeenCalledWith('queue:cancelled', event2Data);
    });
  });

  describe('Event Data Validation', () => {
    it('should handle queue cancellation with correct data structure', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:cancelled', eventData);

      const emittedData = mockSocket.emit.mock.calls[0][1];
      expect(emittedData).toHaveProperty('projectId');
      expect(emittedData).toHaveProperty('cancelledCount');
      expect(emittedData).toHaveProperty('timestamp');
      expect(typeof emittedData.projectId).toBe('string');
      expect(typeof emittedData.cancelledCount).toBe('number');
      expect(typeof emittedData.timestamp).toBe('string');
    });

    it('should handle batch cancellation with correct data structure', () => {
      const userId = 'user-123';
      const eventData = {
        batchId: 'batch-456',
        cancelledCount: 15,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'batch:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('batch:cancelled', eventData);

      const emittedData = mockSocket.emit.mock.calls[0][1];
      expect(emittedData).toHaveProperty('batchId');
      expect(emittedData).toHaveProperty('cancelledCount');
      expect(emittedData).toHaveProperty('timestamp');
      expect(typeof emittedData.batchId).toBe('string');
      expect(typeof emittedData.cancelledCount).toBe('number');
      expect(typeof emittedData.timestamp).toBe('string');
    });

    it('should handle zero cancellations', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 0,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:cancelled', eventData);

      const emittedData = mockSocket.emit.mock.calls[0][1];
      expect(emittedData.cancelledCount).toBe(0);
    });

    it('should handle large cancellation counts', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 1000,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:cancelled', eventData);

      const emittedData = mockSocket.emit.mock.calls[0][1];
      expect(emittedData.cancelledCount).toBe(1000);
    });
  });

  describe('Timing and Concurrency', () => {
    it('should handle rapid successive cancel events', () => {
      const userId = 'user-123';

      // Emit 10 rapid cancel events
      for (let i = 0; i < 10; i++) {
        const eventData = {
          projectId: 'project-123',
          cancelledCount: i + 1,
          timestamp: new Date().toISOString()
        };

        websocketService.emitToUser(userId, 'queue:cancelled', eventData);
      }

      expect(mockSocket.emit).toHaveBeenCalledTimes(10);

      // Verify all events were emitted with correct data
      for (let i = 0; i < 10; i++) {
        const call = mockSocket.emit.mock.calls[i];
        expect(call[0]).toBe('queue:cancelled');
        expect(call[1].cancelledCount).toBe(i + 1);
      }
    });

    it('should handle mixed queue and batch events', () => {
      const userId = 'user-123';

      const queueEvent = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      const batchEvent = {
        batchId: 'batch-456',
        cancelledCount: 3,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', queueEvent);
      websocketService.emitToUser(userId, 'batch:cancelled', batchEvent);

      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
      expect(mockSocket.emit).toHaveBeenNthCalledWith(1, 'queue:cancelled', queueEvent);
      expect(mockSocket.emit).toHaveBeenNthCalledWith(2, 'batch:cancelled', batchEvent);
    });

    it('should handle concurrent events to different users', () => {
      const user1Socket = { ...mockSocket, emit: vi.fn() };
      const user2Socket = { ...mockSocket, emit: vi.fn() };
      const user3Socket = { ...mockSocket, emit: vi.fn() };

      (websocketService as any).userSockets.clear();
      (websocketService as any).userSockets.set('user-1', user1Socket);
      (websocketService as any).userSockets.set('user-2', user2Socket);
      (websocketService as any).userSockets.set('user-3', user3Socket);

      // Emit events to all users simultaneously
      const events = [
        { userId: 'user-1', projectId: 'project-1', count: 1 },
        { userId: 'user-2', projectId: 'project-2', count: 2 },
        { userId: 'user-3', projectId: 'project-3', count: 3 }
      ];

      events.forEach(event => {
        websocketService.emitToUser(event.userId, 'queue:cancelled', {
          projectId: event.projectId,
          cancelledCount: event.count,
          timestamp: new Date().toISOString()
        });
      });

      expect(user1Socket.emit).toHaveBeenCalledWith('queue:cancelled', expect.objectContaining({
        projectId: 'project-1',
        cancelledCount: 1
      }));

      expect(user2Socket.emit).toHaveBeenCalledWith('queue:cancelled', expect.objectContaining({
        projectId: 'project-2',
        cancelledCount: 2
      }));

      expect(user3Socket.emit).toHaveBeenCalledWith('queue:cancelled', expect.objectContaining({
        projectId: 'project-3',
        cancelledCount: 3
      }));
    });
  });

  describe('Error Handling', () => {
    it('should handle socket emit errors gracefully', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      // Mock socket emit to throw error
      mockSocket.emit.mockImplementation(() => {
        throw new Error('Socket error');
      });

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', eventData);
      }).not.toThrow();
    });

    it('should handle invalid event data', () => {
      const userId = 'user-123';
      const invalidEventData = {
        invalidField: 'invalid',
        cancelledCount: 'not a number',
        timestamp: null
      } as any;

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', invalidEventData);
      }).not.toThrow();

      expect(mockSocket.emit).toHaveBeenCalledWith('queue:cancelled', invalidEventData);
    });

    it('should handle null or undefined event data', () => {
      const userId = 'user-123';

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', null as any);
      }).not.toThrow();

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', undefined as any);
      }).not.toThrow();

      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    });

    it('should handle disconnected socket', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      // Mock disconnected socket
      const disconnectedSocket = {
        ...mockSocket,
        connected: false,
        emit: vi.fn()
      };

      (websocketService as any).userSockets.set(userId, disconnectedSocket);

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', eventData);
      }).not.toThrow();

      // Should still attempt to emit (client might reconnect)
      expect(disconnectedSocket.emit).toHaveBeenCalled();
    });
  });

  describe('User Session Management', () => {
    it('should handle user socket reconnection', () => {
      const userId = 'user-123';
      const oldSocket = { ...mockSocket, emit: vi.fn() };
      const newSocket = { ...mockSocket, emit: vi.fn() };

      // Set old socket
      (websocketService as any).userSockets.set(userId, oldSocket);

      // Reconnect with new socket
      (websocketService as any).userSockets.set(userId, newSocket);

      const eventData = {
        projectId: 'project-123',
        cancelledCount: 3,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      // Should emit to new socket, not old one
      expect(newSocket.emit).toHaveBeenCalledWith('queue:cancelled', eventData);
      expect(oldSocket.emit).not.toHaveBeenCalled();
    });

    it('should handle user socket cleanup', () => {
      const userId = 'user-123';
      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      // Remove user socket
      (websocketService as any).userSockets.delete(userId);

      expect(() => {
        websocketService.emitToUser(userId, 'queue:cancelled', eventData);
      }).not.toThrow();

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should handle multiple sockets per user', () => {
      const userId = 'user-123';
      const socket1 = { ...mockSocket, id: 'socket-1', emit: vi.fn() };
      const socket2 = { ...mockSocket, id: 'socket-2', emit: vi.fn() };

      // In a real implementation, might handle multiple sockets per user
      // For now, just test last socket wins
      (websocketService as any).userSockets.set(userId, socket1);
      (websocketService as any).userSockets.set(userId, socket2);

      const eventData = {
        projectId: 'project-123',
        cancelledCount: 5,
        timestamp: new Date().toISOString()
      };

      websocketService.emitToUser(userId, 'queue:cancelled', eventData);

      expect(socket2.emit).toHaveBeenCalledWith('queue:cancelled', eventData);
      expect(socket1.emit).not.toHaveBeenCalled();
    });
  });

  describe('Event Ordering and Consistency', () => {
    it('should maintain event order for sequential cancellations', () => {
      const userId = 'user-123';
      const events = [];

      // Override emit to capture event order
      mockSocket.emit.mockImplementation((eventType, data) => {
        events.push({ type: eventType, data, timestamp: Date.now() });
      });

      // Emit events in sequence
      const eventSequence = [
        { type: 'queue:cancelled', data: { projectId: 'p1', cancelledCount: 1, timestamp: '2024-01-01T10:00:00.000Z' }},
        { type: 'batch:cancelled', data: { batchId: 'b1', cancelledCount: 2, timestamp: '2024-01-01T10:01:00.000Z' }},
        { type: 'queue:cancelled', data: { projectId: 'p2', cancelledCount: 3, timestamp: '2024-01-01T10:02:00.000Z' }}
      ];

      eventSequence.forEach(event => {
        websocketService.emitToUser(userId, event.type as any, event.data);
      });

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('queue:cancelled');
      expect(events[0].data.cancelledCount).toBe(1);
      expect(events[1].type).toBe('batch:cancelled');
      expect(events[1].data.cancelledCount).toBe(2);
      expect(events[2].type).toBe('queue:cancelled');
      expect(events[2].data.cancelledCount).toBe(3);
    });

    it('should handle timestamp consistency', () => {
      const userId = 'user-123';
      const beforeTime = new Date().toISOString();

      // Small delay to ensure timestamp difference
      setTimeout(() => {
        const eventData = {
          projectId: 'project-123',
          cancelledCount: 5,
          timestamp: new Date().toISOString()
        };

        websocketService.emitToUser(userId, 'queue:cancelled', eventData);

        const emittedData = mockSocket.emit.mock.calls[0][1];
        expect(emittedData.timestamp).toBeGreaterThan(beforeTime);
      }, 10);
    });
  });
});