import { config } from '../utils/config';
import { LocalStorageProvider } from './localStorage';
import { StorageProvider } from './interface';

/**
 * Storage factory - creates appropriate storage provider based on configuration
 */
export function createStorageProvider(): StorageProvider {
  switch (config.STORAGE_TYPE) {
    case 'local':
      return new LocalStorageProvider();
    case 's3':
      // TODO: Implement S3StorageProvider when needed
      throw new Error('S3 storage provider not yet implemented');
    default:
      throw new Error(`Unsupported storage type: ${config.STORAGE_TYPE}`);
  }
}

// Create singleton instance
let storageProviderInstance: StorageProvider | null = null;

/**
 * Get storage provider singleton instance
 */
export function getStorageProvider(): StorageProvider {
  if (!storageProviderInstance) {
    storageProviderInstance = createStorageProvider();
  }
  return storageProviderInstance;
}

// Re-export types and interfaces
export * from './interface';
export { LocalStorageProvider } from './localStorage';