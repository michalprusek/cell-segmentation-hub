import fs from 'fs/promises';
import path from 'path';

/**
 * Initialize storage directories for the application
 */
export async function initializeStorageDirectories(): Promise<void> {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const dirs = [
    uploadsDir,
    path.join(uploadsDir, 'images'),
    path.join(uploadsDir, 'thumbnails'),
    path.join(uploadsDir, 'temp'),
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
    }
  }
}