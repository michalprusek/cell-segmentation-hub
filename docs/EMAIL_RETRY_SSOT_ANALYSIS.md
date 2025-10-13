# SSOT Analysis: Email Retry Patterns

**Date:** 2025-10-13
**Analyst:** Claude (SSOT Analyzer Agent)
**Scope:** Email retry logic analysis for password reset bug
**Bug Context:** Password reset emails being sent repeatedly every 5 minutes

---

## Executive Summary

The email retry system has **CRITICAL SSOT violations** causing the password reset email bug:

- ❌ **No centralized retry configuration constants** - hardcoded values in 5+ locations
- ❌ **Inconsistent retry intervals** - 60000ms (1 min), 300000ms (5 min), 600000ms (10 min) scattered
- ❌ **Two separate queue processing mechanisms** - `emailRetryService.ts` and `sharingService.ts`
- ❌ **No queue cleanup on success** - emails remain in queue after successful send
- ❌ **Fire-and-forget email pattern** - no await in `sharingService.ts` line 85-100
- ⚠️ **No shared retry utility usage** - `retryService.ts` exists but email code doesn't use it consistently

**Root Cause:** The bug is caused by emails being re-queued with `setTimeout` delays (line 418-432 in `emailRetryService.ts`) without proper cleanup of successful sends.

---

## 1. Email Retry Pattern Locations

### 1.1 Current Email Sending Code Paths

| Location                         | Pattern            | Queue Used              | Retry Logic           | Cleanup       | Status        |
| -------------------------------- | ------------------ | ----------------------- | --------------------- | ------------- | ------------- |
| **emailService.ts:207-361**      | Main send function | ✅ Queue on timeout     | ✅ Retry with backoff | ❌ No cleanup | Active        |
| **emailService.ts:366-444**      | Password reset     | ✅ Always queued (UTIA) | Delegated             | ❌ No cleanup | **BUG HERE**  |
| **emailRetryService.ts:254-299** | Queue function     | ✅ Creates queue entry  | ❌ No retry here      | ❌ No cleanup | Active        |
| **emailRetryService.ts:304-456** | Queue processor    | Processes queue         | ✅ Re-queues on fail  | ❌ No cleanup | **BUG HERE**  |
| **sharingService.ts:85-100**     | Fire-and-forget    | ❌ No queue             | ❌ No retry           | ❌ No cleanup | Pattern issue |
| **sharingService.ts:771-786**    | Inline async       | ❌ Fire-and-forget      | ❌ No retry           | ❌ No cleanup | Pattern issue |
| **reliableEmailService.ts**      | Sync send          | ❌ No queue             | ❌ No retry           | ✅ Clean      | Alternative   |

### 1.2 Email Queue Flow Analysis

```typescript
// Current flow (WITH BUG):
1. User requests password reset
   ↓
2. emailService.sendPasswordResetEmail() called
   │  (Line 409: checks SMTP_HOST === 'hermes.utia.cas.cz')
   │  (Line 420: calls queueEmailForRetry())
   ↓
3. queueEmailForRetry() creates queue entry
   │  (Line 256-262: creates QueuedEmail object)
   │  (Line 262: emailQueue.push(queuedEmail))
   │  (Line 272-296: starts processEmailQueue() if not running)
   ↓
4. processEmailQueue() processes entry
   │  (Line 319: emailQueue.shift() - REMOVES from queue)
   │  (Line 373: calls sendEmail(options, false) - allowQueue=false)
   ↓
5. Email sends successfully
   │  ✅ Email delivered
   │  ❌ BUT: No record kept that it succeeded
   ↓
6. On failure, re-queues with setTimeout
   │  (Line 418-432: calculates delay)
   │  (Line 420: emailQueue.push(queuedEmail) - RE-ADDS to queue) ← BUG!
   │  (Line 418: delay = attempts * 60000 = 5 minutes)
   ↓
7. Repeat step 4-6 forever if queue still has entries
```

**Critical Issue:** There's no way to tell if an email was already successfully sent because:

1. Queue entries are removed with `shift()` before sending (line 319)
2. No persistent storage of sent emails
3. Re-queueing happens with `setTimeout` that may trigger even after success
4. No correlation between queue entry and actual send result

---

## 2. SSOT Violations in Retry Configuration

### 2.1 Hardcoded Timeout Values

```typescript
// VIOLATION 1: Timeout defaults scattered across codebase
// Location 1: emailRetryService.ts line 16
export function parseEmailTimeout(envVar: string, defaultValue = 15000): number

// Location 2: emailRetryService.ts line 78
const EMAIL_TIMEOUT = parseEmailTimeout('EMAIL_TIMEOUT', 60000);

// Location 3: emailRetryService.ts line 340-347
const timeoutConfig = isUTIA ? {
  timeout: 300000, // 5 minutes - HARDCODED
  socketTimeout: 300000,
} : {
  timeout: parseInt(process.env.EMAIL_TIMEOUT || '60000'), // HARDCODED DEFAULT
  socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '60000'),
};

// Location 4: emailRetryService.ts line 418
const delay = Math.min(queuedEmail.attempts * 60000, 600000); // HARDCODED 1-10 min

// Location 5: emailRetryService.ts line 450
const delay = process.env.SMTP_HOST === 'hermes.utia.cas.cz' ? 5000 : 1000; // HARDCODED

// Location 6: emailRetryService.ts line 406
const maxRetries = process.env.SMTP_HOST === 'hermes.utia.cas.cz' ? 5 : 3; // HARDCODED

// Location 7: emailRetryService.ts line 122
if (elapsedTime >= globalTimeout - 5000) { // HARDCODED 5s buffer

// Location 8: reliableEmailService.ts line 45-47
connectionTimeout: 30000, // HARDCODED 30 seconds
greetingTimeout: 30000, // HARDCODED
socketTimeout: 120000, // HARDCODED 2 minutes
```

### 2.2 Retry Interval Violations

```typescript
// VIOLATION 2: Multiple retry interval definitions

// emailRetryService.ts line 33-36 (DEFAULT_EMAIL_RETRY_CONFIG)
initialDelay: getNumericEnvVar('EMAIL_RETRY_INITIAL_DELAY', 1000),  // 1 second
maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', 10000),         // 10 seconds
backoffFactor: parseFloat(process.env.EMAIL_RETRY_BACKOFF_FACTOR || '2'),

// emailRetryService.ts line 418 (Queue re-try delay)
const delay = Math.min(queuedEmail.attempts * 60000, 600000);      // 1-10 MINUTES

// emailRetryService.ts line 450 (Inter-queue delay)
const delay = process.env.SMTP_HOST === 'hermes.utia.cas.cz' ? 5000 : 1000;  // 1-5 seconds

// retryService.ts line 41-43 (Generic retry)
const delay = Math.min(
  config.initialDelay * Math.pow(config.backoffFactor, attempt - 1),
  config.maxDelay
);
```

**Issue:** Three different retry calculation methods! None of them consistent!

### 2.3 Environment Variable Usage

```bash
# .env.common - Configuration
EMAIL_TIMEOUT=300000                  # 5 minutes
EMAIL_GLOBAL_TIMEOUT=600000           # 10 minutes
EMAIL_RETRY_INITIAL_DELAY=1000        # 1 second
EMAIL_RETRY_MAX_DELAY=10000           # 10 seconds
EMAIL_RETRY_BACKOFF_FACTOR=2
EMAIL_MAX_RETRIES=2

# Issues:
# 1. EMAIL_RETRY_* values (1s-10s) don't match queue retry (1-10 min)
# 2. EMAIL_TIMEOUT (5 min) matches queue retry interval (5 min) - coincidence or design?
# 3. No EMAIL_QUEUE_RETRY_DELAY configuration
# 4. No EMAIL_QUEUE_CLEANUP_ENABLED flag
```

---

## 3. Retry Utility Usage Analysis

### 3.1 Existing Retry Service

**Location:** `/backend/src/utils/retryService.ts`

```typescript
// GOOD: Generic retry service exists
export class RetryService {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    isRetriableError?: (error: unknown) => boolean
  ): Promise<T>;
}

// GOOD: Used by emailRetryService.sendEmailWithRetry
// emailRetryService.ts line 164-174
return retryService.executeWithRetry(
  emailOperation,
  {
    maxRetries: retryConfig.maxRetries,
    initialDelay: retryConfig.initialDelay,
    maxDelay: retryConfig.maxDelay,
    backoffFactor: retryConfig.backoffFactor,
    operationName: `Email to ${options.to}`,
  },
  isRetriableEmailError
);
```

**Status:** ✅ **USED CORRECTLY** in `sendEmailWithRetry()` but **NOT USED** for queue processing

### 3.2 Queue Processing Doesn't Use Retry Service

```typescript
// BAD: Queue processing has its own retry logic
// emailRetryService.ts line 402-432
catch (error) {
  queuedEmail.lastError = (error as Error).message;
  const maxRetries = process.env.SMTP_HOST === 'hermes.utia.cas.cz' ? 5 : 3;

  if (queuedEmail.attempts < maxRetries) {
    // Custom retry logic instead of using retryService
    const delay = Math.min(queuedEmail.attempts * 60000, 600000);
    setTimeout(() => {
      emailQueue.push(queuedEmail);  // ← VIOLATION: Manual re-queueing
      if (!queueProcessing) {
        processEmailQueue().catch(err => { ... });
      }
    }, delay);
  }
}
```

**Issue:** Should use `retryService.executeWithRetry()` instead of manual `setTimeout` + `push`

---

## 4. Queue Management SSOT Violations

### 4.1 No Queue State Persistence

```typescript
// emailRetryService.ts line 248
const emailQueue: QueuedEmail[] = []; // ← IN-MEMORY ONLY

// Issues:
// 1. No database persistence
// 2. Lost on server restart
// 3. No way to query historical sends
// 4. No way to prevent duplicates across restarts
```

### 4.2 No Success Tracking

```typescript
// emailRetryService.ts line 304-456 - processEmailQueue()

// Current flow:
while (emailQueue.length > 0) {
  const queuedEmail = emailQueue.shift();  // ← Removes from queue

  try {
    await sendEmail(queuedEmail.options, false);  // ← Sends email

    logger.info('Queued email processed successfully', ...);  // ← Logs success

    // ❌ MISSING: No record kept that this email was sent!
    // ❌ MISSING: No check if email was already sent
    // ❌ MISSING: No cleanup of successful sends

  } catch (error) {
    // Re-queues on failure
    setTimeout(() => { emailQueue.push(queuedEmail); }, delay);
  }
}
```

**Critical Gap:** Once an email is `shift()`-ed from queue, there's no record it ever existed!

### 4.3 Race Condition in Queue Processing

```typescript
// emailRetryService.ts line 305-312
async function processEmailQueue(): Promise<void> {
  if (queueProcessing) {  // ← Check flag
    logger.info('Email queue processing already running, skipping', ...);
    return;
  }
  queueProcessing = true;  // ← Set flag

  // ❌ RACE CONDITION: Multiple callers can get past line 305 before line 312 executes
  // ❌ No mutex/lock mechanism
  // ❌ Flag is reset in catch block but not in all error paths
}
```

### 4.4 Fire-and-Forget Anti-Pattern

```typescript
// sharingService.ts line 85-100
sendShareInvitationEmail(share, data.message)
  .then(() => {
    logger.info('Share invitation email sent successfully', ...);
  })
  .catch(emailError => {
    logger.error('Failed to send share invitation email:', ...);
    // ❌ Email failed but user already got response - share link is still valid
  });

// Issues:
// 1. No await - function returns before email sends
// 2. No retry on failure
// 3. No queue on failure
// 4. Silent failure with just a log
```

---

## 5. Constants That Should Exist But Don't

### 5.1 Missing Email Constants File

**Should exist:** `/backend/src/lib/constants.ts` or `/backend/src/constants/email.ts`

```typescript
// ❌ DOES NOT EXIST - Should be created:

// Email Timeout Constants
export const EMAIL_TIMEOUT_DEFAULT = 60000; // 60 seconds
export const EMAIL_TIMEOUT_UTIA = 300000; // 5 minutes for UTIA
export const EMAIL_GLOBAL_TIMEOUT = 600000; // 10 minutes max
export const EMAIL_TIMEOUT_BUFFER = 5000; // 5 second safety buffer

// Email Retry Constants
export const EMAIL_RETRY_INITIAL_DELAY = 1000; // 1 second
export const EMAIL_RETRY_MAX_DELAY = 10000; // 10 seconds
export const EMAIL_RETRY_BACKOFF_FACTOR = 2;
export const EMAIL_MAX_RETRIES_DEFAULT = 2;
export const EMAIL_MAX_RETRIES_UTIA = 5;

// Email Queue Constants
export const EMAIL_QUEUE_RETRY_BASE_DELAY = 60000; // 1 minute base
export const EMAIL_QUEUE_RETRY_MAX_DELAY = 600000; // 10 minutes max
export const EMAIL_QUEUE_PROCESSING_DELAY = 1000; // 1 second between items
export const EMAIL_QUEUE_PROCESSING_DELAY_UTIA = 5000; // 5 seconds for UTIA
export const EMAIL_QUEUE_MAX_SIZE = 1000; // Prevent memory overflow

// SMTP Connection Constants
export const SMTP_CONNECTION_TIMEOUT = 15000; // 15 seconds
export const SMTP_GREETING_TIMEOUT = 15000; // 15 seconds
export const SMTP_SOCKET_TIMEOUT = 120000; // 2 minutes
export const SMTP_SOCKET_TIMEOUT_UTIA = 600000; // 10 minutes for UTIA

// Email Queue Cleanup
export const EMAIL_QUEUE_SUCCESS_RETENTION = 3600000; // Keep success records 1 hour
export const EMAIL_QUEUE_CLEANUP_INTERVAL = 3600000; // Run cleanup every hour
```

### 5.2 Constants Currently Hardcoded

| Constant               | Current Value | Locations   | Should Be                      |
| ---------------------- | ------------- | ----------- | ------------------------------ |
| Default timeout        | 60000         | 2 locations | `EMAIL_TIMEOUT_DEFAULT`        |
| UTIA timeout           | 300000        | 3 locations | `EMAIL_TIMEOUT_UTIA`           |
| Queue retry base       | 60000         | 1 location  | `EMAIL_QUEUE_RETRY_BASE_DELAY` |
| Queue retry max        | 600000        | 1 location  | `EMAIL_QUEUE_RETRY_MAX_DELAY`  |
| Queue processing delay | 1000 / 5000   | 1 location  | `EMAIL_QUEUE_PROCESSING_DELAY` |
| Max retries            | 2 / 3 / 5     | 3 locations | `EMAIL_MAX_RETRIES_*`          |
| Timeout buffer         | 5000          | 1 location  | `EMAIL_TIMEOUT_BUFFER`         |
| Cleanup interval       | 3600000       | 1 location  | `EMAIL_QUEUE_CLEANUP_INTERVAL` |

---

## 6. Root Cause Analysis: Password Reset Bug

### 6.1 Bug Reproduction Flow

```typescript
// STEP 1: User requests password reset
POST /api/auth/forgot-password
↓
// STEP 2: authService calls emailService.sendPasswordResetEmail()
// emailService.ts line 409-430
if (process.env.SMTP_HOST === 'hermes.utia.cas.cz') {
  const queueId = queueEmailForRetry(emailOptions);  // ← Queues immediately
  return;  // ← Returns to user immediately (no wait)
}
↓
// STEP 3: emailRetryService.queueEmailForRetry() adds to queue
// emailRetryService.ts line 262
emailQueue.push(queuedEmail);
↓
// STEP 4: processEmailQueue() starts processing
// emailRetryService.ts line 319
const queuedEmail = emailQueue.shift();  // ← Removes from queue
↓
// STEP 5: Sends email successfully
await sendEmail(queuedEmail.options, false);  // ← SUCCESS
↓
// STEP 6: Logs success but no cleanup
logger.info('Queued email processed successfully', ...);
// ❌ BUG: No record kept that email was sent
// ❌ BUG: No check to prevent re-sending
↓
// STEP 7: On failure (or timeout), re-queues
catch (error) {
  const delay = Math.min(queuedEmail.attempts * 60000, 600000);  // 5 minutes
  setTimeout(() => {
    emailQueue.push(queuedEmail);  // ← RE-ADDS to queue
  }, delay);
}
↓
// STEP 8: If setTimeout fires after success, email re-sends
// ❌ BUG: No way to know email already succeeded
// ❌ BUG: Email sends again after 5 minutes
// ❌ BUG: Repeats forever if queue never empties
```

### 6.2 Why the Bug Happens

**Primary Causes:**

1. **No Success Tracking**
   - Queue entries removed with `shift()` before sending (line 319)
   - No database/memory record of successful sends
   - No way to check "was this email already sent?"

2. **setTimeout Cleanup Issue**
   - `setTimeout()` callbacks scheduled before knowing success/failure
   - Callbacks fire even after email succeeds
   - No way to cancel scheduled callbacks

3. **In-Memory Queue**
   - Queue is just an array: `const emailQueue: QueuedEmail[] = [];`
   - No persistent storage
   - No deduplication mechanism

4. **Race Condition**
   - `queueProcessing` flag can be bypassed
   - Multiple queue processors can run simultaneously
   - Same email can be processed multiple times

### 6.3 Specific Code Bugs

**Bug 1: No cleanup after success**

```typescript
// emailRetryService.ts line 373-385
await sendEmail(queuedEmail.options, false);  // ← Sends successfully

logger.info('Queued email processed successfully', ...);  // ← Just logs

// ❌ MISSING: Mark email as sent in persistent storage
// ❌ MISSING: Remove from any scheduled re-tries
// ❌ MISSING: Cancel any pending setTimeout callbacks
```

**Bug 2: Re-queueing with setTimeout**

```typescript
// emailRetryService.ts line 418-432
const delay = Math.min(queuedEmail.attempts * 60000, 600000);
setTimeout(() => {
  emailQueue.push(queuedEmail);  // ← This fires even if email already succeeded!

  if (!queueProcessing) {
    processEmailQueue().catch(err => { ... });  // ← Starts processing again
  }
}, delay);
```

**Bug 3: No deduplication**

```typescript
// emailRetryService.ts line 254-262
export function queueEmailForRetry(options: EmailServiceOptions): string {
  const queuedEmail: QueuedEmail = {
    id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    // ❌ No check if same email already in queue
    // ❌ No check if email was already sent
  };

  emailQueue.push(queuedEmail); // ← Always adds, no dedup
}
```

---

## 7. Recommended SSOT Consolidation

### 7.1 Create Email Constants File

**Location:** `/backend/src/constants/email.ts`

```typescript
/**
 * Email System Constants - Single Source of Truth
 */

// ===== TIMEOUT CONSTANTS =====
export const EMAIL_TIMEOUTS = {
  // Per-email send timeout
  DEFAULT: 60000, // 60 seconds for standard SMTP
  UTIA: 300000, // 5 minutes for slow UTIA SMTP

  // Global operation timeout
  GLOBAL: 600000, // 10 minutes absolute max
  BUFFER: 5000, // 5 second safety buffer

  // SMTP connection timeouts
  CONNECTION: 15000, // 15 seconds to connect
  GREETING: 15000, // 15 seconds for greeting
  SOCKET: 120000, // 2 minutes for socket operations
  SOCKET_UTIA: 600000, // 10 minutes for UTIA socket
} as const;

// ===== RETRY CONSTANTS =====
export const EMAIL_RETRY = {
  // Immediate retry (within same request)
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 10000, // 10 seconds
  BACKOFF_FACTOR: 2, // Exponential backoff
  MAX_ATTEMPTS: 2, // 2 retries for standard
  MAX_ATTEMPTS_UTIA: 5, // 5 retries for UTIA

  // Queue retry (background processing)
  QUEUE_BASE_DELAY: 60000, // 1 minute base delay
  QUEUE_MAX_DELAY: 600000, // 10 minutes max delay
  QUEUE_MULTIPLIER: 60000, // 1 minute per attempt
} as const;

// ===== QUEUE CONSTANTS =====
export const EMAIL_QUEUE = {
  // Processing
  PROCESSING_DELAY: 1000, // 1 second between queue items
  PROCESSING_DELAY_UTIA: 5000, // 5 seconds between UTIA items
  MAX_SIZE: 1000, // Prevent memory overflow

  // Cleanup
  SUCCESS_RETENTION: 3600000, // Keep success records 1 hour
  FAILURE_RETENTION: 86400000, // Keep failure records 24 hours
  CLEANUP_INTERVAL: 3600000, // Run cleanup every hour

  // State
  MAX_PROCESSING_TIME: 1800000, // 30 minutes max per queue run
} as const;

// ===== UTIA SMTP CONFIG =====
export const UTIA_SMTP = {
  HOST: 'hermes.utia.cas.cz',
  PORT: 25,
  TIMEOUT: EMAIL_TIMEOUTS.UTIA,
  RETRY_ATTEMPTS: EMAIL_RETRY.MAX_ATTEMPTS_UTIA,
  PROCESSING_DELAY: EMAIL_QUEUE.PROCESSING_DELAY_UTIA,
} as const;

// ===== HELPER FUNCTIONS =====
export const isUTIASmtp = (): boolean => {
  return process.env.SMTP_HOST === UTIA_SMTP.HOST;
};

export const getEmailTimeout = (): number => {
  return isUTIASmtp() ? EMAIL_TIMEOUTS.UTIA : EMAIL_TIMEOUTS.DEFAULT;
};

export const getMaxRetries = (): number => {
  return isUTIASmtp()
    ? EMAIL_RETRY.MAX_ATTEMPTS_UTIA
    : EMAIL_RETRY.MAX_ATTEMPTS;
};

export const getQueueProcessingDelay = (): number => {
  return isUTIASmtp()
    ? EMAIL_QUEUE.PROCESSING_DELAY_UTIA
    : EMAIL_QUEUE.PROCESSING_DELAY;
};
```

### 7.2 Update emailRetryService to Use Constants

```typescript
// emailRetryService.ts - REFACTORED

import {
  EMAIL_TIMEOUTS,
  EMAIL_RETRY,
  EMAIL_QUEUE,
  getEmailTimeout,
  getMaxRetries,
  getQueueProcessingDelay,
  isUTIASmtp,
} from '../constants/email';

// Replace line 78
const EMAIL_TIMEOUT = getEmailTimeout();

// Replace line 33-36
export const DEFAULT_EMAIL_RETRY_CONFIG: EmailRetryConfig = {
  maxRetries: getNumericEnvVar('EMAIL_MAX_RETRIES', EMAIL_RETRY.MAX_ATTEMPTS),
  initialDelay: getNumericEnvVar(
    'EMAIL_RETRY_INITIAL_DELAY',
    EMAIL_RETRY.INITIAL_DELAY
  ),
  maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', EMAIL_RETRY.MAX_DELAY),
  backoffFactor: parseFloat(
    process.env.EMAIL_RETRY_BACKOFF_FACTOR || String(EMAIL_RETRY.BACKOFF_FACTOR)
  ),
  globalTimeout: getNumericEnvVar(
    'EMAIL_GLOBAL_TIMEOUT',
    EMAIL_TIMEOUTS.GLOBAL
  ),
};

// Replace line 418
const delay = Math.min(
  queuedEmail.attempts * EMAIL_QUEUE.QUEUE_MULTIPLIER,
  EMAIL_QUEUE.QUEUE_MAX_DELAY
);

// Replace line 450
const delay = getQueueProcessingDelay();

// Replace line 406
const maxRetries = getMaxRetries();
```

### 7.3 Add Queue State Management

```typescript
// emailRetryService.ts - ADD THIS

interface EmailSendRecord {
  id: string;
  to: string;
  subject: string;
  sentAt: Date;
  status: 'success' | 'failed';
  attempts: number;
  lastError?: string;
}

// Persistent send history (in-memory for now, could be DB)
const emailSendHistory = new Map<string, EmailSendRecord>();

/**
 * Check if email was already sent successfully
 */
function wasEmailAlreadySent(to: string, subject: string): boolean {
  const key = `${to}:${subject}`;
  const record = emailSendHistory.get(key);

  if (!record) return false;

  // Check if sent recently (within last hour)
  const oneHourAgo = Date.now() - EMAIL_QUEUE.SUCCESS_RETENTION;
  if (record.sentAt.getTime() < oneHourAgo) {
    emailSendHistory.delete(key); // Cleanup old record
    return false;
  }

  return record.status === 'success';
}

/**
 * Record successful email send
 */
function recordEmailSent(to: string, subject: string, attempts: number): void {
  const key = `${to}:${subject}`;
  emailSendHistory.set(key, {
    id: `sent_${Date.now()}`,
    to,
    subject,
    sentAt: new Date(),
    status: 'success',
    attempts,
  });

  logger.info('Recorded successful email send', 'EmailRetryService', {
    to,
    subject,
    attempts,
  });
}

/**
 * Process background email queue with proper cleanup
 */
async function processEmailQueue(): Promise<void> {
  if (queueProcessing) {
    logger.info(
      'Email queue processing already running, skipping',
      'EmailRetryService'
    );
    return;
  }
  queueProcessing = true;

  logger.info('Starting email queue processing', 'EmailRetryService', {
    queueLength: emailQueue.length,
  });

  while (emailQueue.length > 0) {
    const queuedEmail = emailQueue.shift();
    if (!queuedEmail) continue;

    try {
      queuedEmail.attempts++;

      // ✅ CHECK: Skip if already sent successfully
      if (
        wasEmailAlreadySent(queuedEmail.options.to, queuedEmail.options.subject)
      ) {
        logger.info(
          'Email already sent successfully, skipping',
          'EmailRetryService',
          {
            id: queuedEmail.id,
            to: queuedEmail.options.to,
          }
        );
        continue; // Skip this email
      }

      logger.info('Processing queued email', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
        subject: queuedEmail.options.subject,
        attempt: queuedEmail.attempts,
      });

      // Send email without queuing (prevent infinite loop)
      const { sendEmail } = await import('./emailService');
      await sendEmail(queuedEmail.options, false);

      // ✅ RECORD: Email sent successfully
      recordEmailSent(
        queuedEmail.options.to,
        queuedEmail.options.subject,
        queuedEmail.attempts
      );

      logger.info('Queued email processed successfully', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
        attempts: queuedEmail.attempts,
      });
    } catch (error) {
      queuedEmail.lastError = (error as Error).message;
      const maxRetries = getMaxRetries();

      if (queuedEmail.attempts < maxRetries) {
        logger.warn('Queued email failed, will retry', 'EmailRetryService', {
          id: queuedEmail.id,
          attempt: queuedEmail.attempts,
          maxRetries,
          error: queuedEmail.lastError,
        });

        // Re-queue with exponential backoff delay
        const delay = Math.min(
          queuedEmail.attempts * EMAIL_QUEUE.QUEUE_MULTIPLIER,
          EMAIL_QUEUE.QUEUE_MAX_DELAY
        );

        setTimeout(() => {
          // ✅ CHECK: Only re-queue if not already sent
          if (
            !wasEmailAlreadySent(
              queuedEmail.options.to,
              queuedEmail.options.subject
            )
          ) {
            emailQueue.push(queuedEmail);

            if (!queueProcessing) {
              processEmailQueue().catch(err => {
                logger.error(
                  'Error restarting email queue processing:',
                  err as Error,
                  'EmailRetryService'
                );
              });
            }
          } else {
            logger.info(
              'Email already sent, canceling scheduled retry',
              'EmailRetryService',
              {
                id: queuedEmail.id,
              }
            );
          }
        }, delay);
      } else {
        logger.error(
          'Queued email permanently failed after all retries:',
          new Error(queuedEmail.lastError || 'Unknown error'),
          'EmailRetryService',
          {
            id: queuedEmail.id,
            to: queuedEmail.options.to,
            attempts: queuedEmail.attempts,
            maxRetries,
          }
        );
      }
    }

    // Delay between processing items
    const delay = getQueueProcessingDelay();
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  queueProcessing = false;
  logger.info('Email queue processing completed', 'EmailRetryService');
}

/**
 * Periodic cleanup of old send records
 */
setInterval(() => {
  const now = Date.now();
  const cutoff = now - EMAIL_QUEUE.SUCCESS_RETENTION;

  let cleaned = 0;
  for (const [key, record] of emailSendHistory.entries()) {
    if (record.sentAt.getTime() < cutoff) {
      emailSendHistory.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(
      `Cleaned up ${cleaned} old email send records`,
      'EmailRetryService'
    );
  }
}, EMAIL_QUEUE.CLEANUP_INTERVAL);
```

### 7.4 Fix sharingService Fire-and-Forget

```typescript
// sharingService.ts - BEFORE (line 85-100)
sendShareInvitationEmail(share, data.message)
  .then(() => {
    logger.info('Share invitation email sent successfully', ...);
  })
  .catch(emailError => {
    logger.error('Failed to send share invitation email:', ...);
  });

// sharingService.ts - AFTER (with proper await)
try {
  await sendShareInvitationEmail(share, data.message);
  logger.info('Share invitation email sent successfully', 'SharingService', {
    shareId: share.id,
    email: share.email,
  });
} catch (emailError) {
  logger.error('Failed to send share invitation email:', emailError as Error, 'SharingService', {
    shareId: share.id,
    email: share.email,
  });
  // Email failed - queue for retry
  queueEmailForRetry({
    to: share.email,
    subject: getShareInvitationSimpleSubject(share.project.title, locale),
    html: generateShareInvitationSimpleHTML(templateData),
    text: generateShareInvitationSimpleText(templateData),
  });
}
```

---

## 8. Proper Pattern to Follow

### 8.1 Recommended Email Send Pattern

```typescript
/**
 * CORRECT PATTERN: Email sending with proper retry and cleanup
 */
export async function sendEmailWithProperRetry(
  options: EmailServiceOptions,
  config: EmailRetryConfig = DEFAULT_EMAIL_RETRY_CONFIG
): Promise<void> {
  // Step 1: Check if already sent (deduplication)
  if (wasEmailAlreadySent(options.to, options.subject)) {
    logger.info('Email already sent, skipping', 'EmailService', {
      to: options.to,
      subject: options.subject,
    });
    return;
  }

  // Step 2: Use shared retry utility (SSOT compliance)
  try {
    const result = await retryService.executeWithRetry(
      async () => {
        return await sendMailWithTimeout(transporter, mailOptions);
      },
      {
        maxRetries: config.maxRetries,
        initialDelay: config.initialDelay,
        maxDelay: config.maxDelay,
        backoffFactor: config.backoffFactor,
        operationName: `Email to ${options.to}`,
      },
      isRetriableEmailError
    );

    // Step 3: Record success (prevents re-sending)
    recordEmailSent(options.to, options.subject, config.maxRetries);

    logger.info('Email sent successfully', 'EmailService', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
    });
  } catch (error) {
    // Step 4: On final failure, queue for background retry
    if (config.queueEnabled) {
      const queueId = queueEmailForRetry(options);
      logger.warn(
        'Email send failed, queued for background retry',
        'EmailService',
        {
          to: options.to,
          queueId,
          error: (error as Error).message,
        }
      );
    } else {
      throw error; // Re-throw if queueing disabled
    }
  }
}
```

### 8.2 Anti-Patterns to Avoid

#### ❌ Anti-Pattern 1: Fire-and-Forget

```typescript
// BAD: No await, no error handling
sendEmail(options).catch(err => logger.error('Failed', err));
```

#### ❌ Anti-Pattern 2: Manual setTimeout Retry

```typescript
// BAD: Custom retry logic instead of using retryService
setTimeout(() => {
  emailQueue.push(email);
}, delay);
```

#### ❌ Anti-Pattern 3: No Deduplication

```typescript
// BAD: Always sends without checking if already sent
export function queueEmail(options) {
  emailQueue.push({ ...options }); // No dedup check
}
```

#### ❌ Anti-Pattern 4: Hardcoded Values

```typescript
// BAD: Magic numbers
const timeout = 300000; // What does this mean?
const delay = Math.min(attempts * 60000, 600000); // Why these numbers?
```

#### ✅ Good Pattern: Use Constants

```typescript
// GOOD: Named constants from SSOT
const timeout = EMAIL_TIMEOUTS.UTIA;
const delay = Math.min(
  attempts * EMAIL_QUEUE.QUEUE_MULTIPLIER,
  EMAIL_QUEUE.QUEUE_MAX_DELAY
);
```

---

## 9. Implementation Checklist

### Priority 0: Immediate Bug Fix (Today)

- [ ] Add `wasEmailAlreadySent()` deduplication check
- [ ] Add `recordEmailSent()` success tracking
- [ ] Update `processEmailQueue()` to check before re-queueing
- [ ] Add check in `setTimeout` callback before re-adding to queue
- [ ] Test password reset email only sends once

### Priority 1: Constants Consolidation (This Week)

- [ ] Create `/backend/src/constants/email.ts`
- [ ] Define all email constants in one place
- [ ] Update `emailRetryService.ts` to use constants
- [ ] Update `emailService.ts` to use constants
- [ ] Update `reliableEmailService.ts` to use constants
- [ ] Remove all hardcoded timeout/delay values

### Priority 2: Pattern Fixes (Next Week)

- [ ] Fix `sharingService.ts` fire-and-forget (add await)
- [ ] Replace manual `setTimeout` retry with `retryService`
- [ ] Add mutex/lock to `processEmailQueue()`
- [ ] Implement proper queue cleanup on success
- [ ] Add periodic cleanup of old send records

### Priority 3: Architecture Improvements (Next Month)

- [ ] Move send history to database (persistent storage)
- [ ] Add email send deduplication table
- [ ] Implement distributed lock for queue processing
- [ ] Add monitoring/metrics for queue health
- [ ] Create admin API to view/clear queue

---

## 10. Success Criteria

### Immediate Success (Bug Fixed)

✅ Password reset emails send only once
✅ No duplicate emails every 5 minutes
✅ Queue properly cleaned up after success
✅ Deduplication prevents re-sending

### SSOT Compliance

✅ All timeout values use constants from `/constants/email.ts`
✅ All retry logic uses `retryService.executeWithRetry()`
✅ No hardcoded magic numbers (60000, 300000, etc.)
✅ Single source of truth for all email configuration

### Pattern Quality

✅ No fire-and-forget email sends
✅ All email sends properly awaited
✅ Proper error handling and retry
✅ Queue cleanup on success

---

## 11. Testing Strategy

### Test 1: Single Email Send

```typescript
it('should send password reset email only once', async () => {
  // Given: User requests password reset
  await authService.requestPasswordReset('user@example.com');

  // When: Email is processed
  await processEmailQueue();

  // Then: Email sent exactly once
  expect(mockMailer.sendMail).toHaveBeenCalledTimes(1);

  // And: Recorded in send history
  expect(wasEmailAlreadySent('user@example.com', 'Password Reset')).toBe(true);
});
```

### Test 2: Deduplication

```typescript
it('should not re-send if already sent', async () => {
  // Given: Email already sent
  recordEmailSent('user@example.com', 'Password Reset', 1);

  // When: Same email queued again
  queueEmailForRetry({
    to: 'user@example.com',
    subject: 'Password Reset',
    html: '<html>...</html>',
  });
  await processEmailQueue();

  // Then: No email sent
  expect(mockMailer.sendMail).not.toHaveBeenCalled();
});
```

### Test 3: Retry on Failure

```typescript
it('should retry failed emails with backoff', async () => {
  // Given: Email send fails twice then succeeds
  mockMailer.sendMail
    .mockRejectedValueOnce(new Error('Timeout'))
    .mockRejectedValueOnce(new Error('Timeout'))
    .mockResolvedValueOnce({ messageId: 'abc123' });

  // When: Email queued
  queueEmailForRetry({
    to: 'user@example.com',
    subject: 'Test',
    html: '<html>...</html>',
  });
  await processEmailQueue();

  // Then: Retried 3 times total
  expect(mockMailer.sendMail).toHaveBeenCalledTimes(3);

  // And: Recorded as success
  expect(wasEmailAlreadySent('user@example.com', 'Test')).toBe(true);
});
```

### Test 4: No Duplicate After Success

```typescript
it('should not re-send after successful send', async () => {
  // Given: Email queued and sent successfully
  const queueId = queueEmailForRetry({
    to: 'user@example.com',
    subject: 'Test',
    html: '<html>...</html>',
  });
  await processEmailQueue();

  // When: Scheduled retry fires (setTimeout callback)
  await jest.runAllTimersAsync();

  // Then: Email NOT sent again
  expect(mockMailer.sendMail).toHaveBeenCalledTimes(1);
});
```

---

## 12. Conclusion

The password reset email bug is caused by **critical SSOT violations** in the email retry system:

1. **No success tracking** - emails send but system doesn't remember
2. **No deduplication** - same email can be queued multiple times
3. **setTimeout cleanup issue** - scheduled retries fire even after success
4. **Hardcoded constants** - magic numbers scattered across 5+ files
5. **Inconsistent retry patterns** - 3 different retry implementations

**Immediate Fix Required:**

- Add `wasEmailAlreadySent()` and `recordEmailSent()` to track successful sends
- Check deduplication before re-queueing in `setTimeout` callbacks
- Create `/constants/email.ts` for all hardcoded values

**Long-term SSOT Compliance:**

- Use shared `retryService` for all retry logic
- Replace fire-and-forget with proper `await`
- Move send history to persistent storage (database)
- Consolidate email services (reduce from 3 to 1)

This analysis provides a complete roadmap to fix the bug and establish proper SSOT principles for the email system.

---

_End of Email Retry SSOT Analysis Report_
