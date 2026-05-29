import { describe, it, expect } from 'vitest';
import {
  isSegmentationStatusMessage,
  isQueueStatsMessage,
  isSegmentationCompletedMessage,
  isSegmentationFailedMessage,
  isSegmentationProgressMessage,
  isConnectionStatusMessage,
  isParallelProcessingStatusMessage,
  isConcurrentUserMessage,
  isProcessingStreamUpdateMessage,
  isQueuePositionUpdateMessage,
  type WebSocketMessage,
} from '@/types/websocket';

// ---------------------------------------------------------------------------
// Minimal valid message fixtures for every discriminated variant
// ---------------------------------------------------------------------------

const statusMsg: WebSocketMessage = {
  type: 'segmentationStatus',
  imageId: 'img-1',
  status: 'processing',
  timestamp: 1000,
};

const queueStatsMsg: WebSocketMessage = {
  type: 'queueStats',
  queued: 3,
  processing: 1,
  total: 4,
  timestamp: 1000,
};

const completedMsg: WebSocketMessage = {
  type: 'segmentationCompleted',
  imageId: 'img-1',
  polygonCount: 5,
  processingTime: 300,
  timestamp: 1000,
};

const failedMsg: WebSocketMessage = {
  type: 'segmentationFailed',
  imageId: 'img-1',
  error: 'out of memory',
  timestamp: 1000,
};

const progressMsg: WebSocketMessage = {
  type: 'segmentationProgress',
  imageId: 'img-1',
  progress: 42,
  timestamp: 1000,
};

const connectionMsg: WebSocketMessage = {
  type: 'connectionStatus',
  status: 'connected',
  timestamp: 1000,
};

const parallelMsg: WebSocketMessage = {
  type: 'parallelProcessingStatus',
  totalSlots: 4,
  activeSlots: [],
  waitingUsers: 2,
  timestamp: 1000,
};

const concurrentMsg: WebSocketMessage = {
  type: 'concurrentUsers',
  count: 3,
  activeUsers: [],
  timestamp: 1000,
};

const streamUpdateMsg: WebSocketMessage = {
  type: 'processingStreamUpdate',
  slotId: 1,
  status: 'progress',
  timestamp: 1000,
};

const queuePositionMsg: WebSocketMessage = {
  type: 'queuePositionUpdate',
  userPosition: 2,
  estimatedWaitTime: 30,
  queueLength: 5,
  activeSlots: 2,
  timestamp: 1000,
};

// All messages in an array for cross-guard checks
const allMessages: WebSocketMessage[] = [
  statusMsg,
  queueStatsMsg,
  completedMsg,
  failedMsg,
  progressMsg,
  connectionMsg,
  parallelMsg,
  concurrentMsg,
  streamUpdateMsg,
  queuePositionMsg,
];

// ---------------------------------------------------------------------------
// isSegmentationStatusMessage
// ---------------------------------------------------------------------------

describe('isSegmentationStatusMessage', () => {
  it('returns true for a segmentationStatus message', () => {
    expect(isSegmentationStatusMessage(statusMsg)).toBe(true);
  });

  it('returns false for every other message type', () => {
    const others = allMessages.filter(m => m !== statusMsg);
    for (const msg of others) {
      expect(isSegmentationStatusMessage(msg)).toBe(false);
    }
  });

  it('narrows type: id and status accessible after guard', () => {
    if (isSegmentationStatusMessage(statusMsg)) {
      // TypeScript narrows to SegmentationStatusMessage inside this block
      expect(statusMsg.imageId).toBe('img-1');
      expect(statusMsg.status).toBe('processing');
    }
  });
});

// ---------------------------------------------------------------------------
// isQueueStatsMessage
// ---------------------------------------------------------------------------

describe('isQueueStatsMessage', () => {
  it('returns true for a queueStats message', () => {
    expect(isQueueStatsMessage(queueStatsMsg)).toBe(true);
  });

  it('returns false for every other message type', () => {
    const others = allMessages.filter(m => m !== queueStatsMsg);
    for (const msg of others) {
      expect(isQueueStatsMessage(msg)).toBe(false);
    }
  });

  it('allows access to queued/processing/total after guard', () => {
    if (isQueueStatsMessage(queueStatsMsg)) {
      expect(queueStatsMsg.queued).toBe(3);
      expect(queueStatsMsg.processing).toBe(1);
      expect(queueStatsMsg.total).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------------
// isSegmentationCompletedMessage
// ---------------------------------------------------------------------------

describe('isSegmentationCompletedMessage', () => {
  it('returns true for a segmentationCompleted message', () => {
    expect(isSegmentationCompletedMessage(completedMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== completedMsg);
    for (const msg of others) {
      expect(isSegmentationCompletedMessage(msg)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isSegmentationFailedMessage
// ---------------------------------------------------------------------------

describe('isSegmentationFailedMessage', () => {
  it('returns true for a segmentationFailed message', () => {
    expect(isSegmentationFailedMessage(failedMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== failedMsg);
    for (const msg of others) {
      expect(isSegmentationFailedMessage(msg)).toBe(false);
    }
  });

  it('allows access to error string after guard', () => {
    if (isSegmentationFailedMessage(failedMsg)) {
      expect(failedMsg.error).toBe('out of memory');
    }
  });
});

// ---------------------------------------------------------------------------
// isSegmentationProgressMessage
// ---------------------------------------------------------------------------

describe('isSegmentationProgressMessage', () => {
  it('returns true for a segmentationProgress message', () => {
    expect(isSegmentationProgressMessage(progressMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== progressMsg);
    for (const msg of others) {
      expect(isSegmentationProgressMessage(msg)).toBe(false);
    }
  });

  it('allows access to progress value (0-100) after guard', () => {
    if (isSegmentationProgressMessage(progressMsg)) {
      expect(progressMsg.progress).toBe(42);
    }
  });
});

// ---------------------------------------------------------------------------
// isConnectionStatusMessage
// ---------------------------------------------------------------------------

describe('isConnectionStatusMessage', () => {
  it('returns true for a connectionStatus message', () => {
    expect(isConnectionStatusMessage(connectionMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== connectionMsg);
    for (const msg of others) {
      expect(isConnectionStatusMessage(msg)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isParallelProcessingStatusMessage
// ---------------------------------------------------------------------------

describe('isParallelProcessingStatusMessage', () => {
  it('returns true for a parallelProcessingStatus message', () => {
    expect(isParallelProcessingStatusMessage(parallelMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== parallelMsg);
    for (const msg of others) {
      expect(isParallelProcessingStatusMessage(msg)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isConcurrentUserMessage
// ---------------------------------------------------------------------------

describe('isConcurrentUserMessage', () => {
  it('returns true for a concurrentUsers message', () => {
    expect(isConcurrentUserMessage(concurrentMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== concurrentMsg);
    for (const msg of others) {
      expect(isConcurrentUserMessage(msg)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isProcessingStreamUpdateMessage
// ---------------------------------------------------------------------------

describe('isProcessingStreamUpdateMessage', () => {
  it('returns true for a processingStreamUpdate message', () => {
    expect(isProcessingStreamUpdateMessage(streamUpdateMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== streamUpdateMsg);
    for (const msg of others) {
      expect(isProcessingStreamUpdateMessage(msg)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isQueuePositionUpdateMessage
// ---------------------------------------------------------------------------

describe('isQueuePositionUpdateMessage', () => {
  it('returns true for a queuePositionUpdate message', () => {
    expect(isQueuePositionUpdateMessage(queuePositionMsg)).toBe(true);
  });

  it('returns false for all other types', () => {
    const others = allMessages.filter(m => m !== queuePositionMsg);
    for (const msg of others) {
      expect(isQueuePositionUpdateMessage(msg)).toBe(false);
    }
  });

  it('allows access to position fields after guard', () => {
    if (isQueuePositionUpdateMessage(queuePositionMsg)) {
      expect(queuePositionMsg.userPosition).toBe(2);
      expect(queuePositionMsg.estimatedWaitTime).toBe(30);
      expect(queuePositionMsg.queueLength).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-guard exclusivity: each guard is true for exactly one message
// ---------------------------------------------------------------------------

describe('guard exclusivity', () => {
  const guards = [
    isSegmentationStatusMessage,
    isQueueStatsMessage,
    isSegmentationCompletedMessage,
    isSegmentationFailedMessage,
    isSegmentationProgressMessage,
    isConnectionStatusMessage,
    isParallelProcessingStatusMessage,
    isConcurrentUserMessage,
    isProcessingStreamUpdateMessage,
    isQueuePositionUpdateMessage,
  ];

  it('exactly one guard returns true per message', () => {
    for (const msg of allMessages) {
      const trueCount = guards.filter(g => g(msg)).length;
      expect(trueCount).toBe(1);
    }
  });
});
