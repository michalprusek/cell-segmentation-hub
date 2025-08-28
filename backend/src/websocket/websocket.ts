import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { corsOptions } from '../middleware/cors';

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  });

  // Connection handling
  io.on('connection', (socket) => {
    console.log(`WebSocket client connected: ${socket.id}`);

    // Join project room
    socket.on('joinProject', (projectId: string, callback?: (response: any) => void) => {
      if (typeof projectId === 'string' && projectId) {
        socket.join(`project:${projectId}`);
        console.log(`Socket ${socket.id} joined project room: ${projectId}`);
        if (callback) {
          callback({ success: true });
        }
      } else {
        if (callback) {
          callback({ success: false, error: 'Invalid project ID' });
        }
      }
    });

    // Leave project room
    socket.on('leaveProject', (projectId: string, callback?: (response: any) => void) => {
      if (typeof projectId === 'string' && projectId) {
        socket.leave(`project:${projectId}`);
        console.log(`Socket ${socket.id} left project room: ${projectId}`);
        if (callback) {
          callback({ success: true });
        }
      }
    });

    // Check room membership (for testing)
    socket.on('checkProjectMembership', (projectId: string, callback?: (response: any) => void) => {
      if (callback) {
        const rooms = Array.from(socket.rooms);
        const isMember = rooms.includes(`project:${projectId}`);
        callback({ isMember });
      }
    });

    // Disconnection handling
    socket.on('disconnect', (reason) => {
      console.log(`WebSocket client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`WebSocket error for socket ${socket.id}:`, error);
    });
  });

  return io;
}