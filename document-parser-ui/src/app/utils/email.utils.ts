/**
 * Email Sanitization Utility
 * Converts email to valid document ID format
 */

export function sanitizeEmail(email: string): string {
  if (!email) return '';
  
  // Remove special characters and convert to lowercase
  // Keep only alphanumeric, dots, and hyphens
  return email
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, ''); // Remove leading/trailing dots
}

export function desanitizeEmail(sanitized: string): string {
  // Note: This is lossy - we can't recover the original email perfectly
  // This is mainly for display purposes
  return sanitized.replace(/_/g, '.');
}
