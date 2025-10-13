/**
 * Email service configuration constants
 * Single Source of Truth (SSOT) for email-related configuration
 */

/**
 * Email timeouts in milliseconds
 */
export const EMAIL_TIMEOUTS = {
  /** Standard email send timeout */
  SEND: 30000, // 30 seconds

  /** Extended timeout for UTIA SMTP server (very slow) */
  UTIA_SEND: 300000, // 5 minutes

  /** Socket timeout for UTIA SMTP */
  UTIA_SOCKET: 600000, // 10 minutes

  /** Delay between processing queued emails */
  QUEUE_PROCESSING_DELAY: 1000, // 1 second

  /** Delay for UTIA to avoid rate limiting */
  UTIA_QUEUE_DELAY: 5000, // 5 seconds
} as const;

/**
 * Email retry configuration
 */
export const EMAIL_RETRY = {
  /** Maximum retry attempts for standard SMTP */
  MAX_ATTEMPTS: 3,

  /** Maximum retry attempts for UTIA SMTP (slower, needs more retries) */
  UTIA_MAX_ATTEMPTS: 5,

  /** Maximum global attempts across all queue cycles */
  MAX_GLOBAL_ATTEMPTS: 10,

  /** Initial retry delay */
  INITIAL_DELAY: 60000, // 1 minute

  /** Maximum retry delay (exponential backoff cap) */
  MAX_DELAY: 600000, // 10 minutes

  /** Queue TTL - discard emails older than this */
  QUEUE_TTL: 3600000, // 1 hour

  /** How long to remember sent emails (deduplication) */
  SENT_EMAIL_TTL: 86400000, // 24 hours

  /** Cleanup interval for sent email records */
  CLEANUP_INTERVAL: 3600000, // 1 hour
} as const;

/**
 * SMTP server hostnames
 */
export const SMTP_HOSTS = {
  UTIA: 'mail.utia.cas.cz',
  UTIA_BACKUP: 'hermes.utia.cas.cz',
} as const;

/**
 * Helper function to check if using UTIA SMTP server
 */
export function isUTIASmtpServer(): boolean {
  const host = process.env.SMTP_HOST;
  return host === SMTP_HOSTS.UTIA || host === SMTP_HOSTS.UTIA_BACKUP;
}

/**
 * Get appropriate timeout for current SMTP server
 */
export function getEmailTimeout(): number {
  return isUTIASmtpServer() ? EMAIL_TIMEOUTS.UTIA_SEND : EMAIL_TIMEOUTS.SEND;
}

/**
 * Get max retry attempts for current SMTP server
 */
export function getMaxRetryAttempts(): number {
  return isUTIASmtpServer() ? EMAIL_RETRY.UTIA_MAX_ATTEMPTS : EMAIL_RETRY.MAX_ATTEMPTS;
}

/**
 * Get queue processing delay for current SMTP server
 */
export function getQueueProcessingDelay(): number {
  return isUTIASmtpServer() ? EMAIL_TIMEOUTS.UTIA_QUEUE_DELAY : EMAIL_TIMEOUTS.QUEUE_PROCESSING_DELAY;
}
