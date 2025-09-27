import { Response } from 'express';
import { AuthRequest } from '../../types/auth';
import { logger } from '../../utils/logger';
import { WebSocketService } from '../../services/websocketService';

export class UploadCancelController {
  constructor() {
    // Bind all methods
    this.cancelUpload = this.cancelUpload.bind(this);
    this.cancelAllUploads = this.cancelAllUploads.bind(this);
  }

  /**
   * Cancel a specific upload operation
   * POST /api/uploads/:uploadId/cancel
   */
  async cancelUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { uploadId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!uploadId) {
        res.status(400).json({ error: 'Upload ID is required' });
        return;
      }

      logger.info(
        'Upload cancellation requested',
        `Upload: ${uploadId}, User: ${userId}`
      );

      // TODO: Implement actual upload cancellation logic
      // For now, we'll just emit the cancel event

      // Emit WebSocket cancel event to all clients for this user
      WebSocketService.getInstance().emitToUser(userId, 'operation:cancelled', {
        operationId: uploadId,
        operationType: 'upload',
        message: 'Upload cancelled by user',
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: 'Upload cancellation signal sent',
        uploadId,
      });
    } catch (error) {
      logger.error(
        'Failed to cancel upload',
        error instanceof Error ? error : new Error(String(error)),
        'UploadCancelController'
      );
      res.status(500).json({ error: 'Failed to cancel upload' });
    }
  }

  /**
   * Cancel all active uploads for a project
   * POST /api/projects/:projectId/uploads/cancel-all
   */
  async cancelAllUploads(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      logger.info(
        'All uploads cancellation requested',
        `Project: ${projectId}, User: ${userId}`
      );

      // Emit WebSocket cancel event to all clients for this user
      WebSocketService.getInstance().emitToUser(userId, 'operation:cancelled', {
        operationId: `project_${projectId}_uploads`,
        operationType: 'upload',
        projectId,
        message: 'All uploads cancelled by user',
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: 'All uploads cancellation signal sent',
        projectId,
      });
    } catch (error) {
      logger.error(
        'Failed to cancel all uploads',
        error instanceof Error ? error : new Error(String(error)),
        'UploadCancelController'
      );
      res.status(500).json({ error: 'Failed to cancel all uploads' });
    }
  }
}

export default UploadCancelController;
