/**
 * Test fixtures and scenarios for cancel functionality testing
 * Provides realistic test data for upload, segmentation, and export operations
 */

import type {
  CancelOperation,
  OperationType,
} from '@/test-utils/cancelTestHelpers';

/**
 * Upload operation test scenarios
 */
export const uploadScenarios = {
  singleFileUpload: {
    operation: {
      id: 'upload-single-001',
      type: 'upload' as OperationType,
      status: 'active' as const,
      progress: 35,
      startTime: Date.now() - 5000,
      metadata: {
        fileName: 'cell_image_001.jpg',
        fileSize: 2048576, // 2MB
        fileType: 'image/jpeg',
        chunkSize: 1024 * 256, // 256KB chunks
        chunksTotal: 8,
        chunksUploaded: 3,
      },
    },
    webSocketEvents: [
      {
        type: 'uploadProgress',
        data: { uploadId: 'upload-single-001', progress: 35, chunkIndex: 3 },
      },
      {
        type: 'uploadCancelled',
        data: { uploadId: 'upload-single-001', reason: 'User cancelled' },
      },
    ],
    apiResponses: {
      cancel: {
        status: 200,
        data: {
          success: true,
          message: 'Upload cancelled successfully',
          cleanedFiles: [
            'temp/chunk_0.tmp',
            'temp/chunk_1.tmp',
            'temp/chunk_2.tmp',
          ],
        },
      },
    },
  },

  multipleFileUpload: {
    operations: [
      {
        id: 'upload-multi-001',
        type: 'upload' as OperationType,
        status: 'active' as const,
        progress: 45,
        startTime: Date.now() - 8000,
        metadata: {
          fileName: 'batch_001.jpg',
          fileSize: 1536000,
          batchId: 'batch-upload-123',
          fileIndex: 1,
          totalFiles: 5,
        },
      },
      {
        id: 'upload-multi-002',
        type: 'upload' as OperationType,
        status: 'active' as const,
        progress: 20,
        startTime: Date.now() - 6000,
        metadata: {
          fileName: 'batch_002.jpg',
          fileSize: 2048576,
          batchId: 'batch-upload-123',
          fileIndex: 2,
          totalFiles: 5,
        },
      },
      {
        id: 'upload-multi-003',
        type: 'upload' as OperationType,
        status: 'completed' as const,
        progress: 100,
        startTime: Date.now() - 10000,
        endTime: Date.now() - 2000,
        metadata: {
          fileName: 'batch_003.jpg',
          fileSize: 1789000,
          batchId: 'batch-upload-123',
          fileIndex: 3,
          totalFiles: 5,
        },
      },
    ],
    expectedBehavior: {
      cancelActiveOnly: true,
      preserveCompleted: true,
      cleanupPartialUploads: true,
    },
  },

  largeFileUpload: {
    operation: {
      id: 'upload-large-001',
      type: 'upload' as OperationType,
      status: 'active' as const,
      progress: 15,
      startTime: Date.now() - 45000, // 45 seconds ago
      metadata: {
        fileName: 'high_res_microscopy.tiff',
        fileSize: 104857600, // 100MB
        fileType: 'image/tiff',
        chunkSize: 1024 * 1024, // 1MB chunks
        chunksTotal: 100,
        chunksUploaded: 15,
        estimatedTimeRemaining: 180000, // 3 minutes
      },
    },
    performance: {
      expectedCancelTime: 500, // 500ms max to cancel
      memoryCleanupTime: 1000, // 1s for memory cleanup
      networkCleanupTime: 2000, // 2s for network cleanup
    },
  },

  networkErrorScenario: {
    operation: {
      id: 'upload-error-001',
      type: 'upload' as OperationType,
      status: 'active' as const,
      progress: 60,
      startTime: Date.now() - 15000,
      metadata: {
        fileName: 'network_test.png',
        fileSize: 5242880, // 5MB
        retryAttempts: 2,
        lastError: 'Connection timeout',
      },
    },
    errorSimulation: {
      type: 'network',
      timing: 'during_cancel',
      recovery: 'retry_cancel',
    },
  },
};

/**
 * Segmentation operation test scenarios
 */
export const segmentationScenarios = {
  singleImageSegmentation: {
    operation: {
      id: 'seg-single-001',
      type: 'segmentation' as OperationType,
      status: 'active' as const,
      progress: 70,
      startTime: Date.now() - 25000,
      metadata: {
        imageId: 'img-001',
        projectId: 'proj-123',
        modelName: 'HRNet',
        queueId: 'queue-seg-001',
        gpuId: 'gpu-0',
        estimatedDuration: 30000, // 30 seconds
      },
    },
    mlServiceData: {
      jobId: 'ml-job-001',
      status: 'processing',
      progress: 70,
      gpuMemoryUsage: '2.1GB',
      processingTime: 25000,
    },
  },

  batchSegmentation: {
    operations: [
      {
        id: 'seg-batch-001',
        type: 'segmentation' as OperationType,
        status: 'completed' as const,
        progress: 100,
        startTime: Date.now() - 60000,
        endTime: Date.now() - 30000,
        metadata: {
          imageId: 'img-001',
          projectId: 'proj-456',
          batchId: 'batch-seg-789',
          imageIndex: 1,
          totalImages: 10,
          polygonsFound: 23,
        },
      },
      {
        id: 'seg-batch-002',
        type: 'segmentation' as OperationType,
        status: 'active' as const,
        progress: 40,
        startTime: Date.now() - 15000,
        metadata: {
          imageId: 'img-002',
          projectId: 'proj-456',
          batchId: 'batch-seg-789',
          imageIndex: 2,
          totalImages: 10,
          queuePosition: 0,
        },
      },
      {
        id: 'seg-batch-003',
        type: 'segmentation' as OperationType,
        status: 'active' as const,
        progress: 10,
        startTime: Date.now() - 5000,
        metadata: {
          imageId: 'img-003',
          projectId: 'proj-456',
          batchId: 'batch-seg-789',
          imageIndex: 3,
          totalImages: 10,
          queuePosition: 1,
        },
      },
    ],
    queueStats: {
      projectId: 'proj-456',
      queued: 7,
      processing: 2,
      completed: 1,
      total: 10,
      estimatedTimeRemaining: 120000, // 2 minutes
    },
    expectedCancelBehavior: {
      cancelQueued: true,
      cancelProcessing: true,
      preserveCompleted: true,
      notifyMLService: true,
    },
  },

  highVolumeSegmentation: {
    batchId: 'batch-high-volume-001',
    totalImages: 10000,
    operations: Array.from({ length: 50 }, (_, index) => ({
      id: `seg-volume-${String(index + 1).padStart(3, '0')}`,
      type: 'segmentation' as OperationType,
      status: (index < 10
        ? 'completed'
        : index < 15
          ? 'active'
          : 'queued') as const,
      progress:
        index < 10 ? 100 : index < 15 ? Math.floor(Math.random() * 80) + 20 : 0,
      startTime: Date.now() - (50 - index) * 2000,
      endTime: index < 10 ? Date.now() - (50 - index) * 1000 : undefined,
      metadata: {
        imageId: `img-${String(index + 1).padStart(4, '0')}`,
        projectId: 'proj-high-volume',
        batchId: 'batch-high-volume-001',
        imageIndex: index + 1,
        totalImages: 10000,
      },
    })),
    performance: {
      expectedCancelTime: 2000, // 2s max for batch cancel
      cleanupTime: 5000, // 5s for complete cleanup
      memoryImpact: 'high',
    },
  },

  mlServiceErrorScenario: {
    operation: {
      id: 'seg-ml-error-001',
      type: 'segmentation' as OperationType,
      status: 'active' as const,
      progress: 85,
      startTime: Date.now() - 40000,
      metadata: {
        imageId: 'img-error-001',
        projectId: 'proj-error',
        modelName: 'CBAM-ResUNet',
        queueId: 'queue-error-001',
        gpuId: 'gpu-1',
        retryAttempts: 1,
      },
    },
    mlServiceError: {
      type: 'gpu_memory_error',
      message: 'CUDA out of memory',
      recoverable: false,
    },
  },
};

/**
 * Export operation test scenarios
 */
export const exportScenarios = {
  cocoExport: {
    operation: {
      id: 'export-coco-001',
      type: 'export' as OperationType,
      status: 'active' as const,
      progress: 55,
      startTime: Date.now() - 20000,
      metadata: {
        projectId: 'proj-export-001',
        format: 'coco',
        imageCount: 150,
        polygonCount: 3420,
        exportSize: '45MB (estimated)',
        includeImages: true,
        includeAnnotations: true,
      },
    },
    jobDetails: {
      jobId: 'export-job-001',
      queuePosition: 0,
      estimatedDuration: 35000,
      currentStep: 'generating_annotations',
      steps: [
        'validating_data',
        'preparing_images',
        'generating_annotations',
        'creating_archive',
        'finalizing',
      ],
    },
  },

  excelExport: {
    operation: {
      id: 'export-excel-001',
      type: 'export' as OperationType,
      status: 'active' as const,
      progress: 25,
      startTime: Date.now() - 8000,
      metadata: {
        projectId: 'proj-metrics-001',
        format: 'excel',
        imageCount: 50,
        polygonCount: 1250,
        metricsIncluded: [
          'area',
          'perimeter',
          'circularity',
          'feret_diameter',
          'aspect_ratio',
        ],
        groupBy: 'image',
      },
    },
    performance: {
      expectedDuration: 15000,
      memoryUsage: 'medium',
      cpuIntensive: true,
    },
  },

  largeExport: {
    operation: {
      id: 'export-large-001',
      type: 'export' as OperationType,
      status: 'active' as const,
      progress: 10,
      startTime: Date.now() - 120000, // 2 minutes ago
      metadata: {
        projectId: 'proj-large-dataset',
        format: 'coco',
        imageCount: 5000,
        polygonCount: 125000,
        exportSize: '2.5GB (estimated)',
        includeImages: true,
        includeAnnotations: true,
        compression: 'zip',
      },
    },
    resourceUsage: {
      diskSpace: '2.5GB',
      memoryPeak: '1.2GB',
      processingTime: '8-12 minutes',
      networkBandwidth: 'high',
    },
  },

  parallelExports: {
    operations: [
      {
        id: 'export-parallel-001',
        type: 'export' as OperationType,
        status: 'active' as const,
        progress: 60,
        startTime: Date.now() - 25000,
        metadata: {
          projectId: 'proj-a',
          format: 'coco',
          priority: 'high',
        },
      },
      {
        id: 'export-parallel-002',
        type: 'export' as OperationType,
        status: 'active' as const,
        progress: 30,
        startTime: Date.now() - 15000,
        metadata: {
          projectId: 'proj-b',
          format: 'excel',
          priority: 'normal',
        },
      },
      {
        id: 'export-parallel-003',
        type: 'export' as OperationType,
        status: 'queued' as const,
        progress: 0,
        startTime: Date.now() - 5000,
        metadata: {
          projectId: 'proj-c',
          format: 'coco',
          priority: 'low',
        },
      },
    ],
    resourceLimits: {
      maxConcurrentExports: 2,
      queueLimit: 10,
      resourceThrottling: true,
    },
  },
};

/**
 * Error and edge case scenarios
 */
export const errorScenarios = {
  networkDisconnection: {
    description: 'Network disconnection during cancel operation',
    initialState: 'active',
    trigger: 'network_disconnect',
    expectedBehavior: 'retry_with_backoff',
    maxRetries: 3,
    backoffMultiplier: 2,
  },

  serverError: {
    description: 'Server returns 500 error during cancel',
    initialState: 'active',
    errorResponse: {
      status: 500,
      data: { error: 'Internal server error' },
    },
    expectedBehavior: 'show_error_retry_option',
  },

  concurrentCancellations: {
    description: 'Multiple users cancelling same operation',
    operations: [{ id: 'concurrent-001', status: 'active' as const }],
    users: ['user-a', 'user-b'],
    expectedBehavior: 'first_wins_others_notify',
  },

  rapidCancelRestart: {
    description: 'Rapid cancel and restart cycles',
    cycleCount: 10,
    cycleDelay: 100, // 100ms between cycles
    expectedBehavior: 'handle_gracefully',
    memoryLeakTest: true,
  },

  malformedResponses: {
    description: 'Server returns malformed responses',
    responses: [
      null,
      undefined,
      '',
      '{"invalid": json}',
      '<html>Not JSON</html>',
      { success: 'not_boolean' },
    ],
    expectedBehavior: 'graceful_error_handling',
  },
};

/**
 * Performance benchmarks for cancel operations
 */
export const performanceBenchmarks = {
  cancelResponseTime: {
    upload: { max: 200, target: 100 }, // milliseconds
    segmentation: { max: 500, target: 300 },
    export: { max: 1000, target: 500 },
  },

  memoryUsage: {
    operationOverhead: { max: 1024 * 1024, target: 512 * 1024 }, // 1MB max, 512KB target
    cleanupEfficiency: { min: 95 }, // 95% memory should be cleaned up
  },

  concurrency: {
    maxConcurrentCancellations: 50,
    expectedThroughput: 100, // operations per second
    resourceUtilization: { cpu: 80, memory: 85 }, // percentage
  },

  stress: {
    operationsPerSecond: 10,
    testDuration: 30000, // 30 seconds
    expectedSuccessRate: 99.5, // 99.5%
  },
};

/**
 * WebSocket event sequences for testing
 */
export const webSocketEventSequences = {
  successfulUploadCancel: [
    { event: 'uploadProgress', data: { uploadId: 'test-001', progress: 50 } },
    { event: 'uploadCancelRequested', data: { uploadId: 'test-001' } },
    { event: 'uploadCancelling', data: { uploadId: 'test-001' } },
    { event: 'uploadCancelled', data: { uploadId: 'test-001' } },
  ],

  batchSegmentationCancel: [
    {
      event: 'batchProgress',
      data: { batchId: 'batch-001', completed: 3, total: 10 },
    },
    { event: 'batchCancelRequested', data: { batchId: 'batch-001' } },
    {
      event: 'segmentationCancelling',
      data: { batchId: 'batch-001', jobIds: ['job-4', 'job-5'] },
    },
    {
      event: 'batchCancelled',
      data: { batchId: 'batch-001', cancelledJobs: 7, completedJobs: 3 },
    },
  ],

  exportCancelWithCleanup: [
    { event: 'exportProgress', data: { exportId: 'export-001', progress: 75 } },
    { event: 'exportCancelRequested', data: { exportId: 'export-001' } },
    { event: 'exportCancelling', data: { exportId: 'export-001' } },
    { event: 'exportCleanupStarted', data: { exportId: 'export-001' } },
    { event: 'exportCancelled', data: { exportId: 'export-001' } },
  ],

  connectionLossDuringCancel: [
    { event: 'disconnect', data: { reason: 'transport close' } },
    { event: 'reconnecting', data: { attempt: 1 } },
    { event: 'connect', data: {} },
    {
      event: 'operationStatusSync',
      data: { operations: [{ id: 'test-001', status: 'cancelled' }] },
    },
  ],
};

/**
 * Accessibility test scenarios
 */
export const accessibilityScenarios = {
  keyboardNavigation: {
    description: 'Cancel operations using only keyboard',
    keySequences: [
      ['Tab', 'Tab', 'Enter'], // Navigate to cancel button and activate
      ['Escape'], // Cancel with escape key
      ['Alt+C'], // Cancel with keyboard shortcut
    ],
    expectedBehavior: 'full_keyboard_accessibility',
  },

  screenReader: {
    description: 'Screen reader compatibility',
    expectations: [
      'announce_cancel_button_availability',
      'announce_cancellation_progress',
      'announce_cancellation_completion',
      'provide_operation_context',
    ],
  },

  highContrast: {
    description: 'High contrast mode compatibility',
    expectations: [
      'visible_cancel_button',
      'clear_state_indicators',
      'readable_progress_text',
    ],
  },
};

export default {
  uploadScenarios,
  segmentationScenarios,
  exportScenarios,
  errorScenarios,
  performanceBenchmarks,
  webSocketEventSequences,
  accessibilityScenarios,
};
