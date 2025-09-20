/**
 * Frontend utilities for generating safe and consistent filenames
 */

/**
 * Sanitizes a project name for use as a filename
 * Removes or replaces characters that are invalid in filenames
 * @param name - The project name to sanitize
 * @returns A safe filename string
 */
export function sanitizeForFilename(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'export';
  }

  return (
    name
      .trim()
      // Replace invalid filesystem characters with underscores
      .replace(/[<>:"/\\|?*]/g, '_')
      // Replace multiple spaces with single underscore
      .replace(/\s+/g, '_')
      // Remove multiple consecutive underscores
      .replace(/_{2,}/g, '_')
      // Remove leading/trailing underscores
      .replace(/^_+|_+$/g, '')
      // Limit length to prevent filesystem issues (leave room for .zip extension)
      .substring(0, 200) ||
    // Fallback if name becomes empty after sanitization
    'export'
  );
}

/**
 * Creates a standardized export filename using only the project name
 * @param projectName - The name of the project
 * @returns A clean filename in format "projectName.zip"
 */
export function createExportFilename(projectName: string): string {
  const sanitizedName = sanitizeForFilename(projectName);
  return `${sanitizedName}.zip`;
}
