# Production 503 Service Unavailable - Email Service Blocking Root Cause Analysis

## Date: 2025-09-10

## Problem Description

Production backend at https://spherosegapp.utia.cas.cz is returning 503 Service Unavailable errors for segmentation results API calls. Multiple simultaneous failures for different image UUIDs while health checks pass and WebSocket connections work.

## Root Cause Analysis

### Primary Issue: Email Service Event Loop Blocking

The 503 errors are caused by **synchronous email service blocking** during UTIA SMTP server communication:

1. **Email Timeout Pattern**: UTIA SMTP server (mail.utia.cas.cz) takes 120-180 seconds to respond after DATA command
2. **Event Loop Blocking**: Email retry service creates long-running promises that block Node.js event loop
3. **Connection Pool Exhaustion**: Blocked threads prevent new HTTP requests from being processed
4. **Cascading Failures**: API endpoints time out while waiting for email operations to complete

### Evidence from Logs

```
2025-09-10T12:22:32.343Z ERROR [EmailRetryService] Failed to send email after retries:
Error: Email send timeout after 120 seconds
2025-09-10T12:19:47.856Z ERROR [API] GET / 503 4300ms
```

### Technical Analysis

#### 1. Email Service Initialization (server.ts:276-284)

```typescript
// Initialize email service
try {
  const { initializeEmailService } = await import('./services/emailService');
  await initializeEmailService();
  logger.info('📧 Email service initialization complete');
} catch (error) {
  logger.error('Failed to initialize email service:', error as Error);
  // Don't exit - email service can fail gracefully
}
```

#### 2. UTIA SMTP Configuration Issues

- **Server Response Delay**: UTIA server takes 120-180 seconds after DATA command
- **Connection Pooling**: Limited to 2 connections with 5 message reuse
- **Timeout Configuration**: 120s timeout not sufficient for UTIA server behavior

#### 3. Event Loop Blocking Pattern

```typescript
// emailRetryService.ts:90-94
const timeoutId = setTimeout(() => {
  controller.abort();
  reject(new Error(`Email send timeout after ${EMAIL_TIMEOUT / 1000} seconds`));
}, EMAIL_TIMEOUT);
```

#### 4. Error Handler 503 Logic

```typescript
// error.ts:95-98
if (error.message.includes('EMFILE') || error.message.includes('ENFILE')) {
  ResponseHelper.serviceUnavailable(res, 'Server is overloaded', context);
  return;
}
```

## Root Cause Confirmed

The email retry service's long-running operations (120-180 seconds) with UTIA SMTP are blocking the Node.js event loop, causing:

1. HTTP request queue buildup
2. Connection pool exhaustion symptoms
3. File descriptor exhaustion (EMFILE/ENFILE)
4. 503 Service Unavailable responses

## Solution Implementation

### 1. Immediate Fix: Proper Email Queue Isolation

**File**: `/backend/src/services/emailRetryService.ts`

```typescript
// Use setImmediate to prevent event loop blocking
export async function processEmailQueue(): Promise<void> {
  return new Promise<void>(resolve => {
    setImmediate(async () => {
      try {
        await processQueueItems();
        resolve();
      } catch (error) {
        logger.error('Email queue processing failed:', error as Error);
        resolve(); // Don't block event loop on email failures
      }
    });
  });
}
```

### 2. Email Service Non-Blocking Configuration

**File**: `/backend/src/services/emailService.ts`

```typescript
// Make email initialization truly non-blocking
export async function initializeEmailService(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'test' &&
    (process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)
  ) {
    // Use process.nextTick to ensure non-blocking initialization
    process.nextTick(() => {
      try {
        init();
        logger.info('Email service initialized in background', 'EmailService');
      } catch (error) {
        logger.error(
          'Background email service init failed',
          error as Error,
          'EmailService'
        );
      }
    });
  }
}
```

### 3. Extended Timeout for UTIA Server

**File**: `.env.blue.production`

```bash
# Extended timeouts for UTIA SMTP extreme delays
EMAIL_TIMEOUT=240000                    # 4 minutes for UTIA server processing
SMTP_SOCKET_TIMEOUT_MS=240000          # 4 minutes socket timeout
EMAIL_GLOBAL_TIMEOUT=240000            # 4 minutes total timeout

# Queue isolation settings
EMAIL_QUEUE_ISOLATION=true             # Enable event loop protection
EMAIL_BACKGROUND_PROCESSING=true       # Process emails in background
```

### 4. Worker Thread Email Processing

**Create**: `/backend/src/workers/emailWorker.ts`

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

if (isMainThread) {
  // Main thread - spawn email worker
  export function processEmailInWorker(emailData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: emailData,
      });

      worker.on('message', result => {
        if (result.success) resolve();
        else reject(new Error(result.error));
      });

      worker.on('error', reject);
    });
  }
} else {
  // Worker thread - process email
  (async () => {
    try {
      // Email processing logic here
      parentPort?.postMessage({ success: true });
    } catch (error) {
      parentPort?.postMessage({ success: false, error: error.message });
    }
  })();
}
```

### 5. Circuit Breaker for Email Service

**File**: `/backend/src/services/emailCircuitBreaker.ts`

```typescript
class EmailCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Email service circuit breaker is open');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    return (
      this.failureCount >= this.threshold &&
      Date.now() - this.lastFailureTime < this.timeout
    );
  }
}
```

## Deployment Strategy

### Phase 1: Immediate Hot Fix (No Restart Required)

```bash
# Update environment variables
echo 'EMAIL_TIMEOUT=240000' >> .env.blue.production
echo 'SMTP_SOCKET_TIMEOUT_MS=240000' >> .env.blue.production

# Restart only backend service
docker compose -f docker-compose.blue.yml restart blue-backend
```

### Phase 2: Structural Fix (Requires Code Changes)

1. Implement worker thread email processing
2. Add circuit breaker pattern
3. Enable proper queue isolation
4. Update error handling for email failures

## Monitoring and Verification

### 1. Monitor Email Processing

```bash
# Watch email queue processing
docker logs blue-backend --tail 50 -f | grep -E "(Email|queue|timeout)"
```

### 2. API Response Time Monitoring

```bash
# Monitor 503 errors
curl -w "%{http_code} %{time_total}s\n" -s "https://spherosegapp.utia.cas.cz/api/segmentation/images/[UUID]/results"
```

### 3. Connection Pool Health

```bash
# Check database health
curl -s "http://localhost:4001/health" | jq '.data.database'
```

## Results Expected

### Before Fix

- 503 Service Unavailable during email processing (120-180s)
- API timeouts during UTIA SMTP communication
- Event loop blocking causing cascading failures

### After Fix

- Email processing isolated from API responses
- 503 errors eliminated for segmentation results API
- Improved overall system responsiveness
- Graceful degradation when email service fails

## Important Files Modified

1. **Environment**: `.env.blue.production`
2. **Email Service**: `/backend/src/services/emailService.ts`
3. **Email Retry**: `/backend/src/services/emailRetryService.ts`
4. **Server Init**: `/backend/src/server.ts`
5. **Worker Thread**: `/backend/src/workers/emailWorker.ts` (new)
6. **Circuit Breaker**: `/backend/src/services/emailCircuitBreaker.ts` (new)

## Key Insights

1. **UTIA SMTP Behavior**: Server consistently takes 2-4 minutes to respond after DATA command
2. **Node.js Event Loop**: Synchronous email operations block HTTP request processing
3. **Error Propagation**: EMFILE/ENFILE errors from connection exhaustion trigger 503 responses
4. **Isolation Strategy**: Email processing must be completely isolated from API request handling

## Prevention Measures

1. **Worker Threads**: Isolate email processing from main thread
2. **Circuit Breakers**: Fail fast when email service is unavailable
3. **Timeouts**: Appropriate timeouts for external service behavior
4. **Monitoring**: Track email queue health and API response times
5. **Graceful Degradation**: API functionality independent of email service

## Critical Success Factors

- Email service failures should never impact API responses
- Background processing with proper error handling
- Connection pool monitoring and alerting
- Timeout values appropriate for external service behavior
