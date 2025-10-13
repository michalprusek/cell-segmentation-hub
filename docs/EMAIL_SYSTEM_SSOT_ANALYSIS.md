# Email System SSOT Analysis Report

## Cell Segmentation Hub - Email Templating Architecture

**Date:** 2025-10-13
**Analyst:** Claude (SSOT Analyzer Agent)
**Scope:** Complete email system architecture review

---

## Executive Summary

The email system has **significant SSOT violations** with:

- ✅ **3 separate email services** (emailService, emailRetryService, reliableEmailService)
- ❌ **7 different template files** with overlapping functionality
- ❌ **3+ versions of password reset templates** (full HTML, multilang, simple)
- ❌ **2 versions of share invitation templates** (complex, simple)
- ⚠️ **Duplicated translation logic** across multiple templates
- ⚠️ **Repeated HTML escaping functions** (3 implementations)
- ⚠️ **Inconsistent plain text support** - some templates have it, others don't

**Critical Finding:** Plain text email support is **inconsistent and incomplete**, making it risky to add more plain text templates without refactoring.

---

## 1. Current Template System Architecture

### 1.1 Email Services (3 Services)

| Service                  | Purpose                         | Location                                        | Usage                   |
| ------------------------ | ------------------------------- | ----------------------------------------------- | ----------------------- |
| **emailService**         | Main service with retry & queue | `/backend/src/services/emailService.ts`         | Primary - 730 lines     |
| **emailRetryService**    | Retry logic & queue management  | `/backend/src/services/emailRetryService.ts`    | Helper - 517 lines      |
| **reliableEmailService** | UTIA-specific simple sending    | `/backend/src/services/reliableEmailService.ts` | Alternative - 307 lines |

**SSOT Violation:** Three services do overlapping work. Only `emailService` should exist.

### 1.2 Email Templates (7 Templates)

#### Password Reset Templates (3 versions!)

| Template                         | Lines | HTML | Text | i18n         | Used By              | Notes                         |
| -------------------------------- | ----- | ---- | ---- | ------------ | -------------------- | ----------------------------- |
| `passwordResetEmail.ts`          | 124   | ✅   | ✅   | ❌ (CS only) | Unused?              | Complex HTML, single language |
| `passwordResetEmailMultilang.ts` | 195   | ✅   | ✅   | ✅ (6 langs) | **emailService**     | Currently active              |
| `passwordResetEmailSimple.ts`    | 87    | ✅   | ✅   | ❌ (CS only) | reliableEmailService | Ultra-simple for UTIA         |

**SSOT Violation:** Three implementations of the same email type with different capabilities.

#### Share Invitation Templates (2 versions)

| Template                        | Lines | HTML | Text | i18n         | Used By            | Notes                     |
| ------------------------------- | ----- | ---- | ---- | ------------ | ------------------ | ------------------------- |
| `shareInvitationEmail.ts`       | 595   | ✅   | ✅   | ✅ (6 langs) | **Unused!**        | Beautiful gradient design |
| `shareInvitationEmailSimple.ts` | 179   | ✅   | ✅   | ✅ (6 langs) | **sharingService** | Ultra-simple for UTIA     |

**SSOT Violation:** Beautiful template exists but isn't used. Simple template is active.

#### Verification Email (1 template)

| Template               | Lines | HTML | Text | i18n         | Used By      | Notes                      |
| ---------------------- | ----- | ---- | ---- | ------------ | ------------ | -------------------------- |
| `verificationEmail.ts` | 217   | ✅   | ❌   | ✅ (6 langs) | emailService | **No plain text version!** |

**Critical Gap:** No plain text alternative for verification emails.

### 1.3 Template Function Analysis

#### Common Pattern (Good)

```typescript
// Most templates follow this pattern:
export function generateXXXHTML(data: EmailData): string { ... }
export function generateXXXText(data: EmailData): string { ... }
export function getXXXSubject(locale?: string): string { ... }
```

#### Inconsistency Issues

- **verificationEmail.ts** returns `{ subject, html }` instead of separate functions
- **passwordResetEmail.ts** uses inline date formatting (no helper)
- Each template duplicates translation dictionaries

---

## 2. SSOT Violations Detected

### 2.1 Component Duplication

#### 🔴 Critical: Password Reset Templates

**Location:**

- `/backend/src/templates/passwordResetEmail.ts` (124 lines)
- `/backend/src/templates/passwordResetEmailMultilang.ts` (195 lines)
- `/backend/src/templates/passwordResetEmailSimple.ts` (87 lines)

**Evidence:**

```typescript
// All three files have the same interface:
export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
  locale?: string; // Only in multilang version
}
```

**Impact:** 406 total lines of nearly identical code.

**Action Required:** Consolidate into single template with complexity modes.

#### 🔴 Critical: Share Invitation Templates

**Location:**

- `/backend/src/templates/shareInvitationEmail.ts` (595 lines) - **UNUSED**
- `/backend/src/templates/shareInvitationEmailSimple.ts` (179 lines) - **ACTIVE**

**Evidence:**

```typescript
// sharingService.ts line 8-11
import {
  generateShareInvitationSimpleHTML,
  generateShareInvitationSimpleText,
  getShareInvitationSimpleSubject,
} from '../templates/shareInvitationEmailSimple';
// Beautiful template is never imported!
```

**Impact:** 595 lines of dead code. Beautiful design wasted.

**Action Required:** Either use the beautiful template or delete it.

#### 🟡 Medium: Email Services

**Evidence:**

```typescript
// emailService.ts - 730 lines - MAIN
export async function sendPasswordResetEmail(...)
export async function sendVerificationEmail(...)
export async function sendProjectShareEmail(...) // Inline template!

// reliableEmailService.ts - 307 lines - ALTERNATIVE
export async function sendPasswordResetEmailReliable(...)
export async function sendVerificationEmailReliable(...)
// No share email function
```

**Impact:** Duplicate service implementations, inconsistent API.

**Action Required:** Merge reliableEmailService into emailService with configuration flags.

### 2.2 Logic Duplication

#### 🔴 Critical: Translation Dictionaries

**Found in 5 files:**

- `passwordResetEmailMultilang.ts` (lines 23-94)
- `shareInvitationEmail.ts` (lines 40-149)
- `shareInvitationEmailSimple.ts` (lines 28-89)
- `verificationEmail.ts` (lines 20-93)
- `emailService.ts` (lines 520-564) - **Inline in function!**

**Pattern:**

```typescript
// Repeated in EVERY template file:
const translations: Record<string, EmailTranslations> = {
  en: { subject: '...', greeting: '...', ... },
  cs: { subject: '...', greeting: '...', ... },
  es: { subject: '...', greeting: '...', ... },
  de: { subject: '...', greeting: '...', ... },
  fr: { subject: '...', greeting: '...', ... },
  zh: { subject: '...', greeting: '...', ... },
};
```

**Impact:** 6 languages × 5 files = 30+ translation objects scattered across codebase.

**Action Required:** Create central translation system.

#### 🟡 Medium: HTML Escaping Functions

**Found in 3 locations:**

1. **utils/escapeHtml.ts** (lines 4-19) - ✅ Proper utility

```typescript
export function escapeHtml(str: string): string {
  const htmlEscapeMap: Record<string, string> = { ... };
  return String(str).replace(/[&<>"'/]/g, char => htmlEscapeMap[char] || char);
}
```

2. **templates/verificationEmail.ts** (lines 8-18) - ❌ Local duplicate

```typescript
function escapeHtml(text: string): string {
  const map: Record<string, string> = { ... };
  return text.replace(/[&<>"'/]/g, char => map[char] || char);
}
```

3. **templates/passwordResetEmail.ts** (lines 71-83) - ❌ Different implementation

```typescript
const escapePlainText = (text: string): string => {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
```

**Action Required:** Use only `utils/escapeHtml.ts` everywhere.

#### 🟡 Medium: Date Formatting

**Found in 4 different implementations:**

1. **passwordResetEmailMultilang.ts** (lines 96-118)

```typescript
function getLocaleString(date: Date, locale: string): string {
  const localeMap: Record<string, string> = { en: 'en-US', cs: 'cs-CZ', ... };
  // Custom logic with timezone handling
}
```

2. **shareInvitationEmail.ts** (lines 154-169)

```typescript
function formatDate(date: Date, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', ... };
  return new Intl.DateTimeFormat(locale, options).format(date);
}
```

3. **shareInvitationEmailSimple.ts** (lines 94-113)

```typescript
function formatDateShort(date: Date, locale: string): string {
  // Simplified version
}
```

4. **passwordResetEmail.ts** (lines 22-29, 96-103)

```typescript
// Inline date formatting, no function
const expirationTime = data.expiresAt.toLocaleString('cs-CZ', { ... });
```

**Action Required:** Create shared date formatting utility.

### 2.3 Type Duplication

#### 🔴 Critical: Email Data Interfaces

```typescript
// Defined in 3 different files:
export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
  locale?: string; // Not in all versions!
}
```

**Locations:**

- `passwordResetEmail.ts` (line 3-8)
- `passwordResetEmailMultilang.ts` (line 3-10)
- `passwordResetEmailSimple.ts` (line 3-8)

**Action Required:** Define once in `/backend/src/types/email.ts`

### 2.4 Repeated API Calls Pattern

**Pattern found in emailService.ts:**

```typescript
// Lines 366-444: sendPasswordResetEmail
// Lines 447-502: sendVerificationEmail
// Lines 505-624: sendProjectShareEmail (with inline template!)

// All three functions repeat:
1. Validate environment variables
2. Build URLs
3. Generate HTML/text content
4. Call sendEmail()
5. Error handling
```

**Action Required:** Create email template factory with shared logic.

---

## 3. Reusability Assessment

### 3.1 Existing Components That Can Be Shared

#### ✅ Well-Designed Reusable Components

| Component         | Location               | Usage                 | Quality    |
| ----------------- | ---------------------- | --------------------- | ---------- |
| `escapeHtml()`    | `utils/escapeHtml.ts`  | HTML sanitization     | ✅ Perfect |
| `sanitizeUrl()`   | `utils/escapeHtml.ts`  | URL validation        | ✅ Perfect |
| Email retry logic | `emailRetryService.ts` | Retry with backoff    | ✅ Good    |
| Queue system      | `emailRetryService.ts` | Background processing | ✅ Good    |

#### ⚠️ Components Needing Refactoring

| Component                | Current State               | Should Be               |
| ------------------------ | --------------------------- | ----------------------- |
| Translation dictionaries | In each template            | Central i18n service    |
| Date formatting          | 4 different implementations | Shared utility          |
| HTML escaping            | 3 implementations           | Use utils only          |
| Email data interfaces    | 3+ definitions              | Single source in types/ |
| Template rendering       | 7 separate files            | Template factory        |

### 3.2 Services That Can Be Consolidated

#### Email Service Consolidation

```
Current State (3 services):
├── emailService.ts (730 lines)
│   ├── init()
│   ├── sendEmail()
│   ├── sendPasswordResetEmail()
│   ├── sendVerificationEmail()
│   └── sendProjectShareEmail() ← Inline template!
├── emailRetryService.ts (517 lines)
│   ├── sendEmailWithRetry()
│   ├── queueEmailForRetry()
│   └── processEmailQueue()
└── reliableEmailService.ts (307 lines)
    ├── sendPasswordResetEmailReliable()
    └── sendVerificationEmailReliable()

Proposed State (1 service):
└── emailService.ts
    ├── Core Functions
    │   ├── init(config)
    │   ├── sendEmail(options, config)
    │   └── testConnection()
    ├── Template Functions (delegated)
    │   ├── sendPasswordReset(data) → uses templateFactory
    │   ├── sendVerification(data) → uses templateFactory
    │   └── sendShareInvitation(data) → uses templateFactory
    └── Retry/Queue (integrated)
        ├── retry logic from emailRetryService
        └── queue logic from emailRetryService
```

### 3.3 Templates That Can Be Unified

#### Template Consolidation Strategy

```
Current State (7 templates):
├── passwordResetEmail.ts (124 lines) ← DELETE
├── passwordResetEmailMultilang.ts (195 lines) ← KEEP & ENHANCE
├── passwordResetEmailSimple.ts (87 lines) ← MERGE INTO ABOVE
├── shareInvitationEmail.ts (595 lines) ← KEEP (beautiful!)
├── shareInvitationEmailSimple.ts (179 lines) ← MERGE INTO ABOVE
└── verificationEmail.ts (217 lines) ← FIX (add text version)

Proposed State (3 templates + 1 factory):
├── templates/
│   ├── passwordResetEmail.ts (unified with modes)
│   ├── shareInvitationEmail.ts (unified with modes)
│   ├── verificationEmail.ts (fixed with text version)
│   └── factory.ts (NEW - template selector & renderer)
├── translations/
│   └── emailTranslations.ts (NEW - all translations)
├── utils/
│   └── emailFormatters.ts (NEW - date, text utilities)
└── types/
    └── email.ts (NEW - all email interfaces)
```

---

## 4. Truth Source Map

### 4.1 Current Truth Sources (Scattered)

| Functionality            | Current Sources   | Authoritative                  | Status           |
| ------------------------ | ----------------- | ------------------------------ | ---------------- |
| **Password Reset Email** | 3 templates       | passwordResetEmailMultilang.ts | ⚠️ Multiple      |
| **Share Invitation**     | 2 templates       | shareInvitationEmailSimple.ts  | ⚠️ Wrong choice! |
| **Verification Email**   | 1 template        | verificationEmail.ts           | ✅ Single        |
| **Email Sending**        | 3 services        | emailService.ts                | ⚠️ Multiple      |
| **HTML Escaping**        | 3 functions       | utils/escapeHtml.ts            | ⚠️ Multiple      |
| **Translations**         | 5+ locations      | None!                          | ❌ Scattered     |
| **Date Formatting**      | 4 implementations | None!                          | ❌ Scattered     |

### 4.2 Proposed Truth Sources (Unified)

| Functionality            | Single Source                       | Dependencies       | Notes                 |
| ------------------------ | ----------------------------------- | ------------------ | --------------------- |
| **Password Reset Email** | `templates/passwordReset.ts`        | factory, i18n      | Modes: simple/complex |
| **Share Invitation**     | `templates/shareInvitation.ts`      | factory, i18n      | Modes: simple/complex |
| **Verification Email**   | `templates/verification.ts`         | factory, i18n      | Add text version      |
| **Email Sending**        | `services/emailService.ts`          | Absorb retry/queue | Single service        |
| **HTML Escaping**        | `utils/escapeHtml.ts`               | None               | Already good          |
| **Translations**         | `translations/emailTranslations.ts` | i18next?           | Central system        |
| **Date Formatting**      | `utils/emailFormatters.ts`          | Intl API           | Shared utilities      |
| **Email Types**          | `types/email.ts`                    | None               | All interfaces        |
| **Template Selection**   | `templates/factory.ts`              | All templates      | Smart selector        |

---

## 5. Plain Text Template Strategy

### 5.1 Current Plain Text Support

| Template                    | HTML | Plain Text | Quality       | Notes                        |
| --------------------------- | ---- | ---------- | ------------- | ---------------------------- |
| passwordResetEmail          | ✅   | ✅         | Good          | Both versions exist          |
| passwordResetEmailMultilang | ✅   | ✅         | **Excellent** | Both versions with i18n      |
| passwordResetEmailSimple    | ✅   | ✅         | Good          | Both versions                |
| shareInvitationEmail        | ✅   | ✅         | **Excellent** | Beautiful design             |
| shareInvitationEmailSimple  | ✅   | ✅         | Good          | Ultra-minimal                |
| verificationEmail           | ✅   | ❌         | **Missing!**  | **Critical gap**             |
| Inline project share        | ✅   | ✅         | Poor          | Hardcoded in emailService.ts |

### 5.2 Plain Text Template Patterns

#### Good Pattern (from passwordResetEmailMultilang.ts)

```typescript
export const generateSimplePasswordResetHTML = (data: EmailData): string => {
  // Generate HTML version
  return `<html>...</html>`;
};

export const generateSimplePasswordResetText = (data: EmailData): string => {
  // Generate plain text version
  return `Reset hesla - SpheroSeg\n\n...`;
};
```

**Benefits:**

- ✅ Same data structure for both formats
- ✅ Consistent API
- ✅ Easy to maintain
- ✅ Supports fallback for clients that can't render HTML

#### Anti-Pattern (from verificationEmail.ts)

```typescript
export function generateVerificationEmailHTML(data: VerificationEmailData): {
  subject: string;
  html: string;
} {
  // Returns object instead of string
  // NO TEXT VERSION PROVIDED
  return { subject: t.subject, html };
}
```

**Problems:**

- ❌ No plain text version
- ❌ Inconsistent API (returns object)
- ❌ Subject mixed with content

### 5.3 Recommended Plain Text Strategy

#### Strategy 1: Template Mode Selection (Recommended)

```typescript
// templates/factory.ts
export enum EmailFormat {
  HTML = 'html',
  TEXT = 'text',
  BOTH = 'both',
}

export enum EmailComplexity {
  SIMPLE = 'simple', // For UTIA SMTP (< 1000 chars)
  STANDARD = 'standard', // Normal emails
  RICH = 'rich', // Beautiful designs with gradients
}

export interface EmailTemplateOptions {
  format: EmailFormat;
  complexity: EmailComplexity;
  locale: string;
}

// Usage:
const email = emailFactory.render('passwordReset', data, {
  format: EmailFormat.BOTH,
  complexity: EmailComplexity.SIMPLE,
  locale: 'cs',
});
// Returns: { html: '...', text: '...', subject: '...' }
```

#### Strategy 2: Configuration-Based (Alternative)

```typescript
// config/emailConfig.ts
export const EMAIL_CONFIG = {
  defaultFormat: EmailFormat.BOTH,
  utiaMode: {
    enabled: process.env.SMTP_HOST === 'hermes.utia.cas.cz',
    complexity: EmailComplexity.SIMPLE,
    charLimit: 1000,
  },
  formatPreferences: {
    passwordReset: EmailFormat.BOTH,
    verification: EmailFormat.BOTH,
    shareInvitation: EmailFormat.BOTH,
  },
};
```

#### Strategy 3: Client Preference (Future)

```typescript
// Store in user profile
interface UserEmailPreferences {
  preferHtmlEmail: boolean;
  preferPlainText: boolean;
  emailComplexity: 'simple' | 'standard' | 'rich';
}

// Auto-select based on user preference
const userPrefs = await getUserEmailPreferences(userId);
const format = userPrefs.preferPlainText ? EmailFormat.TEXT : EmailFormat.BOTH;
```

### 5.4 Plain Text Template Location Strategy

#### Option A: Side-by-Side (Current Pattern)

```
templates/
├── passwordResetEmail.ts
│   ├── generatePasswordResetHTML()
│   └── generatePasswordResetText()
├── shareInvitationEmail.ts
│   ├── generateShareInvitationHTML()
│   └── generateShareInvitationText()
└── verificationEmail.ts
    ├── generateVerificationHTML()
    └── generateVerificationText() ← ADD THIS
```

**Pros:** ✅ Keep HTML and text together, easy to maintain consistency
**Cons:** ❌ Large files (595 lines already)

#### Option B: Separate Directories (Scalable)

```
templates/
├── html/
│   ├── passwordReset.html.ts
│   ├── shareInvitation.html.ts
│   └── verification.html.ts
├── text/
│   ├── passwordReset.text.ts
│   ├── shareInvitation.text.ts
│   └── verification.text.ts
└── factory.ts (selects appropriate renderer)
```

**Pros:** ✅ Clean separation, easy to find, better organization
**Cons:** ❌ Risk of HTML/text getting out of sync

#### Option C: Hybrid with Modes (Recommended)

```
templates/
├── passwordReset/
│   ├── index.ts (exports factory function)
│   ├── html.simple.ts
│   ├── html.rich.ts
│   ├── text.ts (single text version)
│   └── types.ts
├── shareInvitation/
│   ├── index.ts
│   ├── html.simple.ts
│   ├── html.rich.ts
│   ├── text.ts
│   └── types.ts
└── verification/
    ├── index.ts
    ├── html.ts
    ├── text.ts ← ADD THIS
    └── types.ts
```

**Pros:** ✅ Organized by feature, supports multiple modes, scalable
**Cons:** ❌ More files, requires factory function

---

## 6. Refactoring Recommendations

### 6.1 Priority Matrix

| Priority | Type                      | Impact | Effort | Action                    |
| -------- | ------------------------- | ------ | ------ | ------------------------- |
| **P0**   | Dead code removal         | High   | Low    | Delete unused templates   |
| **P0**   | verificationEmail text    | High   | Low    | Add text version          |
| **P0**   | Translation consolidation | High   | Medium | Create i18n system        |
| **P1**   | Template consolidation    | High   | High   | Merge duplicate templates |
| **P1**   | Service consolidation     | Medium | Medium | Merge email services      |
| **P2**   | Template factory          | Medium | Medium | Create smart factory      |
| **P2**   | Utility consolidation     | Low    | Low    | Remove duplicate utils    |
| **P3**   | Type definitions          | Low    | Low    | Central type file         |

### 6.2 Immediate Actions (P0)

#### Action 1: Delete Dead Code

```bash
# Delete unused password reset template
rm backend/src/templates/passwordResetEmail.ts

# Option: Keep beautiful share invitation OR delete it
# Decision needed: Use beautiful template or keep simple?
# Recommendation: Keep beautiful, delete simple
rm backend/src/templates/shareInvitationEmailSimple.ts
# Update sharingService.ts to use shareInvitationEmail.ts
```

**Estimated time:** 1 hour
**Risk:** Low (unused code)
**Benefit:** -406 lines of dead code

#### Action 2: Add Text Version to Verification Email

```typescript
// backend/src/templates/verificationEmail.ts
export function generateVerificationEmailText(
  data: VerificationEmailData
): string {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  return `${t.title}

${t.greeting}

${data.userEmail ? `Account: ${data.userEmail}` : ''}

${t.body}

${t.buttonText}:
${data.verificationUrl}

${t.footer}

${t.regards}
${t.team}`;
}
```

**Estimated time:** 30 minutes
**Risk:** Low
**Benefit:** Complete plain text support

#### Action 3: Consolidate Translations

```typescript
// backend/src/translations/emailTranslations.ts
export const EMAIL_TRANSLATIONS = {
  passwordReset: {
    en: { subject: '...', greeting: '...', ... },
    cs: { subject: '...', greeting: '...', ... },
    // ... all languages
  },
  shareInvitation: {
    en: { subject: '...', greeting: '...', ... },
    cs: { subject: '...', greeting: '...', ... },
    // ... all languages
  },
  verification: {
    en: { subject: '...', greeting: '...', ... },
    cs: { subject: '...', greeting: '...', ... },
    // ... all languages
  },
};

// Helper function
export function getTranslation(
  emailType: 'passwordReset' | 'shareInvitation' | 'verification',
  locale: string = 'en'
) {
  return EMAIL_TRANSLATIONS[emailType][locale] || EMAIL_TRANSLATIONS[emailType].en;
}
```

**Estimated time:** 2 hours
**Risk:** Medium (needs testing)
**Benefit:** Single source of truth for all translations

### 6.3 Strategic Refactoring (P1)

#### Refactoring Plan: Template Consolidation

**Step 1: Merge Password Reset Templates**

```typescript
// backend/src/templates/passwordResetEmail.ts
export enum PasswordResetComplexity {
  SIMPLE = 'simple', // For UTIA (< 1000 chars)
  STANDARD = 'standard', // Normal with styling
}

export interface PasswordResetOptions {
  complexity?: PasswordResetComplexity;
  locale?: string;
}

export function generatePasswordResetHTML(
  data: PasswordResetEmailData,
  options: PasswordResetOptions = {}
): string {
  const complexity = options.complexity || PasswordResetComplexity.STANDARD;

  if (complexity === PasswordResetComplexity.SIMPLE) {
    return generateSimpleHTML(data, options.locale);
  }
  return generateStandardHTML(data, options.locale);
}

// Similar for text version
export function generatePasswordResetText(
  data: PasswordResetEmailData,
  options: PasswordResetOptions = {}
): string {
  // Text version is always simple
  return generateSimpleText(data, options.locale);
}
```

**Estimated time:** 4 hours
**Result:** 3 templates → 1 template with modes

**Step 2: Merge Share Invitation Templates**

Similar approach as password reset, keeping the beautiful design as "standard" mode.

**Estimated time:** 4 hours
**Result:** 2 templates → 1 template with modes

#### Refactoring Plan: Service Consolidation

```typescript
// backend/src/services/emailService.ts
export interface EmailServiceConfig {
  mode: 'reliable' | 'queue';
  utiaCompatibility: boolean;
  retryEnabled: boolean;
  queueEnabled: boolean;
}

class EmailService {
  private config: EmailServiceConfig;
  private transporter: Transporter;
  private retryService: RetryService; // Absorbed
  private queueService: QueueService; // Absorbed

  async sendPasswordReset(data: PasswordResetData): Promise<void> {
    const options = this.buildEmailOptions(data);

    if (this.config.utiaCompatibility) {
      // Use simple templates
      options.complexity = EmailComplexity.SIMPLE;
    }

    if (this.config.queueEnabled) {
      await this.queueService.add(options);
    } else {
      await this.sendImmediate(options);
    }
  }
}
```

**Estimated time:** 8 hours
**Result:** 3 services → 1 unified service

### 6.4 Template Factory Architecture (P2)

```typescript
// backend/src/templates/factory.ts
import * as passwordReset from './passwordResetEmail';
import * as shareInvitation from './shareInvitationEmail';
import * as verification from './verificationEmail';

export enum EmailType {
  PASSWORD_RESET = 'passwordReset',
  SHARE_INVITATION = 'shareInvitation',
  VERIFICATION = 'verification',
}

export interface EmailRenderOptions {
  format: EmailFormat;
  complexity: EmailComplexity;
  locale: string;
}

export interface RenderedEmail {
  html?: string;
  text?: string;
  subject: string;
}

class EmailTemplateFactory {
  render(
    type: EmailType,
    data: unknown,
    options: EmailRenderOptions
  ): RenderedEmail {
    const result: RenderedEmail = {
      subject: this.getSubject(type, options.locale),
    };

    if (
      options.format === EmailFormat.HTML ||
      options.format === EmailFormat.BOTH
    ) {
      result.html = this.renderHTML(type, data, options);
    }

    if (
      options.format === EmailFormat.TEXT ||
      options.format === EmailFormat.BOTH
    ) {
      result.text = this.renderText(type, data, options);
    }

    return result;
  }

  private renderHTML(
    type: EmailType,
    data: unknown,
    options: EmailRenderOptions
  ): string {
    switch (type) {
      case EmailType.PASSWORD_RESET:
        return passwordReset.generateHTML(data, options);
      case EmailType.SHARE_INVITATION:
        return shareInvitation.generateHTML(data, options);
      case EmailType.VERIFICATION:
        return verification.generateHTML(data, options);
    }
  }

  private renderText(
    type: EmailType,
    data: unknown,
    options: EmailRenderOptions
  ): string {
    switch (type) {
      case EmailType.PASSWORD_RESET:
        return passwordReset.generateText(data, options);
      case EmailType.SHARE_INVITATION:
        return shareInvitation.generateText(data, options);
      case EmailType.VERIFICATION:
        return verification.generateText(data, options);
    }
  }

  private getSubject(type: EmailType, locale: string): string {
    const translations = getTranslation(type, locale);
    return translations.subject;
  }
}

export const emailFactory = new EmailTemplateFactory();
```

**Usage:**

```typescript
// In emailService.ts
const email = emailFactory.render(
  EmailType.PASSWORD_RESET,
  { resetToken, userEmail, resetUrl, expiresAt },
  {
    format: EmailFormat.BOTH,
    complexity: this.config.utiaCompatibility
      ? EmailComplexity.SIMPLE
      : EmailComplexity.STANDARD,
    locale: userLocale,
  }
);

await this.send({
  to: userEmail,
  subject: email.subject,
  html: email.html,
  text: email.text,
});
```

**Estimated time:** 6 hours
**Benefit:** Clean API, easy to add new templates, consistent rendering

---

## 7. Implementation Strategy

### 7.1 Phase 1: Quick Wins (1 week)

**Goals:** Remove duplication, fix critical gaps

```
Day 1-2: Cleanup
├── Delete unused templates (passwordResetEmail.ts)
├── Delete OR migrate shareInvitationEmailSimple.ts
└── Document decision

Day 3: Fix verification email
├── Add generateVerificationEmailText()
├── Update emailService.ts to use text version
└── Test both HTML and text rendering

Day 4-5: Consolidate translations
├── Create emailTranslations.ts
├── Migrate all translation dictionaries
├── Update all templates to use central translations
└── Test in all 6 languages
```

### 7.2 Phase 2: Template Unification (2 weeks)

**Goals:** Merge duplicate templates, implement modes

```
Week 1: Password Reset
├── Design unified API with complexity modes
├── Merge 3 templates into 1
├── Add mode selection logic
├── Update emailService.ts
├── Test UTIA compatibility
└── Test all languages

Week 2: Share Invitation
├── Design unified API with complexity modes
├── Merge 2 templates into 1 (keep beautiful design!)
├── Add mode selection logic
├── Update sharingService.ts
├── Test UTIA compatibility
└── Test all languages
```

### 7.3 Phase 3: Service Consolidation (2 weeks)

**Goals:** Single email service, integrated retry/queue

```
Week 1: Design & Preparation
├── Design unified EmailService API
├── Plan migration strategy
├── Create feature flags for gradual rollout
└── Write integration tests

Week 2: Implementation
├── Merge emailRetryService into emailService
├── Merge reliableEmailService into emailService
├── Add configuration system
├── Update all consumers
└── Remove old services
```

### 7.4 Phase 4: Template Factory (1 week)

**Goals:** Smart template selection, clean API

```
Day 1-2: Factory design
├── Design EmailTemplateFactory class
├── Define interfaces
└── Plan template registration

Day 3-4: Implementation
├── Implement factory
├── Register all templates
├── Add mode selection logic
└── Update emailService to use factory

Day 5: Testing & Documentation
├── Test all email types
├── Test all complexity modes
├── Document API
└── Update examples
```

### 7.5 Phase 5: Utilities & Polish (1 week)

**Goals:** Shared utilities, type safety

```
Day 1-2: Utilities
├── Create emailFormatters.ts (date formatting)
├── Remove duplicate escapeHtml functions
└── Create shared validation utilities

Day 3-4: Types
├── Create types/email.ts
├── Migrate all email interfaces
├── Add JSDoc documentation
└── Update imports

Day 5: Documentation
├── Update architecture docs
├── Create email template guide
├── Add examples
└── Update API documentation
```

---

## 8. Best Practices for Email Templates

### 8.1 Template Design Principles

#### ✅ DO

1. **Always provide both HTML and plain text versions**

   ```typescript
   export function generateXXXHTML(data): string { ... }
   export function generateXXXText(data): string { ... }
   ```

2. **Use consistent function signatures**

   ```typescript
   // Good - consistent pattern
   generatePasswordResetHTML(data, options);
   generatePasswordResetText(data, options);
   getPasswordResetSubject(locale);
   ```

3. **Sanitize all user inputs**

   ```typescript
   import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';
   const safeEmail = escapeHtml(data.userEmail);
   const safeUrl = sanitizeUrl(data.resetUrl);
   ```

4. **Support internationalization**

   ```typescript
   import { getTranslation } from '../translations/emailTranslations';
   const t = getTranslation('passwordReset', locale);
   ```

5. **Provide fallback for missing data**
   ```typescript
   const locale = data.locale || 'en';
   const userName = data.userName || data.email;
   ```

#### ❌ DON'T

1. **Don't inline translations in template functions**

   ```typescript
   // Bad - hardcoded in function
   const subject = locale === 'cs' ? 'Reset hesla' : 'Password Reset';
   ```

2. **Don't return mixed objects from generators**

   ```typescript
   // Bad - inconsistent API
   return { subject: '...', html: '...' };
   // Good - separate functions
   return html; // Or return text;
   ```

3. **Don't duplicate HTML escaping logic**

   ```typescript
   // Bad - local implementation
   function escapeHtml(str) { ... }
   // Good - use utility
   import { escapeHtml } from '../utils/escapeHtml';
   ```

4. **Don't skip plain text versions**

   ```typescript
   // Bad - HTML only
   export function generateXXXHTML(data): string { ... }
   // No text version!

   // Good - both versions
   export function generateXXXHTML(data): string { ... }
   export function generateXXXText(data): string { ... }
   ```

5. **Don't hardcode URLs or configuration**
   ```typescript
   // Bad - hardcoded
   const url = 'https://spherosegapp.utia.cas.cz/reset';
   // Good - from environment
   const url = `${process.env.FRONTEND_URL}/reset`;
   ```

### 8.2 Template Complexity Guidelines

#### Simple Mode (for UTIA SMTP)

**Requirements:**

- Total size < 1000 characters
- No inline CSS
- Minimal HTML structure
- No images or external resources

**Example:**

```html
<html>
  <body>
    <h2>Password Reset</h2>
    <p>Hello,</p>
    <p>Click here to reset: <a href="...">Reset</a></p>
    <p>Expires: 2025-10-14 12:00</p>
    <p>---<br />SpheroSeg</p>
  </body>
</html>
```

#### Standard Mode

**Features:**

- Inline CSS (no external stylesheets)
- Proper HTML structure
- Responsive design
- Professional appearance

**Example:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: Arial;
        max-width: 600px;
      }
      .button {
        background: #007bff;
        color: white;
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Password Reset</h1>
      ...
    </div>
  </body>
</html>
```

#### Rich Mode

**Features:**

- Beautiful gradients
- Custom fonts
- Advanced layout
- Brand colors
- Avatar/icons

**Example:** See `shareInvitationEmail.ts` (595 lines)

### 8.3 Testing Checklist

Before deploying new email templates:

- [ ] HTML version renders correctly in major email clients
- [ ] Plain text version is readable and complete
- [ ] All user inputs are properly escaped
- [ ] URLs are validated and sanitized
- [ ] All 6 languages render correctly
- [ ] Date formatting works in all locales
- [ ] Links are clickable and correct
- [ ] Expiry dates display properly
- [ ] Subject lines are appropriate length
- [ ] Mobile display is acceptable
- [ ] UTIA SMTP compatibility (if applicable)
- [ ] Both HTML and text are sent together
- [ ] Fallback to text works if HTML fails
- [ ] All required data fields are present
- [ ] Optional fields handle missing data gracefully

---

## 9. Decision Points for Plain Text Templates

### 9.1 Key Questions to Answer

#### Q1: Should we keep the beautiful share invitation template?

**Current State:**

- ❌ `shareInvitationEmail.ts` (595 lines, beautiful) - **UNUSED**
- ✅ `shareInvitationEmailSimple.ts` (179 lines, basic) - **ACTIVE**

**Options:**

A. **Keep Beautiful, Delete Simple** (Recommended)

- Pros: Professional appearance, better branding, already has full i18n
- Cons: Needs testing with UTIA SMTP, larger size
- Action: Add complexity mode to beautiful template, test with UTIA

B. **Keep Simple, Delete Beautiful**

- Pros: Proven UTIA compatibility, smaller size
- Cons: Lost 595 lines of design work, less professional
- Action: Enhance simple template with more features

C. **Keep Both with Mode Selection**

- Pros: Best of both worlds, flexibility
- Cons: More maintenance, some duplication remains
- Action: Merge into single template with modes

**Recommendation:** Option A - Keep beautiful, add simple mode for UTIA

#### Q2: How to handle template mode selection?

**Options:**

A. **Automatic Based on SMTP Configuration**

```typescript
const complexity =
  process.env.SMTP_HOST === 'hermes.utia.cas.cz'
    ? EmailComplexity.SIMPLE
    : EmailComplexity.STANDARD;
```

B. **Configuration File**

```typescript
// config/emailConfig.ts
export const EMAIL_CONFIG = {
  templates: {
    passwordReset: { complexity: 'standard', format: 'both' },
    shareInvitation: { complexity: 'simple', format: 'both' },
  },
};
```

C. **Per-Request Option**

```typescript
emailService.sendPasswordReset(data, {
  complexity: EmailComplexity.SIMPLE,
  format: EmailFormat.BOTH,
});
```

**Recommendation:** Combination of A and C - automatic default with override option

#### Q3: Where should plain text templates live?

**Recommendation:** Side-by-side with HTML (Option A from section 5.4)

- Same file, both functions available
- Easy to keep in sync
- Clear relationship between formats

#### Q4: Should we support text-only emails?

**Answer:** Yes, optionally

**Use cases:**

1. User preference (accessibility)
2. Email client compatibility
3. Security policies (some orgs block HTML)
4. Testing/debugging

**Implementation:**

```typescript
export enum EmailFormat {
  HTML = 'html', // HTML only (fallback to text if client needs)
  TEXT = 'text', // Plain text only
  BOTH = 'both', // Send both MIME parts (recommended)
}
```

---

## 10. Success Criteria

### 10.1 Quantitative Metrics

| Metric                      | Current      | Target     | Benefit            |
| --------------------------- | ------------ | ---------- | ------------------ |
| Email service files         | 3            | 1          | -2 services        |
| Password reset templates    | 3            | 1          | -282 lines         |
| Share invitation templates  | 2 (1 unused) | 1          | -595 or -179 lines |
| Translation dictionaries    | 5+ locations | 1          | Centralized        |
| HTML escape functions       | 3            | 1          | Single source      |
| Date format functions       | 4            | 1          | Single source      |
| Templates with text version | 6/7 (86%)    | 7/7 (100%) | Complete           |
| Dead code                   | ~600 lines   | 0          | Cleanup            |

### 10.2 Qualitative Goals

✅ **SSOT Compliance**

- One authoritative source for each email type
- One email service (not three)
- One translation system
- One utility function for each purpose

✅ **Complete Plain Text Support**

- All email templates have text versions
- Text versions are well-formatted and readable
- Both HTML and text sent together (MIME multipart)

✅ **Consistent API**

- All templates follow same pattern
- Predictable function signatures
- Easy to add new templates

✅ **Maintainability**

- Easy to find email templates
- Clear purpose of each file
- Minimal duplication
- Good documentation

✅ **Flexibility**

- Support multiple complexity modes
- Support multiple output formats
- Easy to configure per environment

✅ **UTIA SMTP Compatibility**

- Simple mode for UTIA server
- Character limits respected
- Tested and proven

---

## 11. Recommendations Summary

### Immediate Actions (This Week)

1. **Delete Dead Code** - Remove `passwordResetEmail.ts` (124 lines of unused code)
2. **Fix Verification Email** - Add `generateVerificationEmailText()` function
3. **Document Decision** - Beautiful vs simple share invitation template

### Short-term (Next 2 Weeks)

4. **Consolidate Translations** - Create central `emailTranslations.ts`
5. **Merge Password Reset Templates** - 3 templates → 1 with modes
6. **Merge Share Invitation Templates** - 2 templates → 1 with modes (keep beautiful!)

### Medium-term (Next Month)

7. **Consolidate Email Services** - Merge 3 services into 1
8. **Create Template Factory** - Smart template selection and rendering
9. **Consolidate Utilities** - Remove duplicate date/escape functions

### Long-term (Next Quarter)

10. **Add User Preferences** - Let users choose email format
11. **Enhance Internationalization** - Better i18n integration
12. **Add Email Analytics** - Track open rates, click rates

---

## 12. Architecture Diagram

### Current Architecture (Messy)

```
Email System (Current - SSOT Violations)
│
├── Services (3 separate services!)
│   ├── emailService.ts (730 lines)
│   │   ├── Uses: passwordResetEmailMultilang
│   │   ├── Uses: verificationEmail
│   │   └── Inline: sendProjectShareEmail ❌
│   ├── emailRetryService.ts (517 lines)
│   │   └── Helper for retry/queue logic
│   └── reliableEmailService.ts (307 lines)
│       ├── Uses: passwordResetEmailSimple
│       └── Uses: verificationEmail
│
├── Templates (7 files, some unused!)
│   ├── passwordResetEmail.ts (124 lines) ❌ UNUSED
│   ├── passwordResetEmailMultilang.ts (195 lines) ✅ ACTIVE
│   ├── passwordResetEmailSimple.ts (87 lines) ⚠️ Alternative
│   ├── shareInvitationEmail.ts (595 lines) ❌ UNUSED
│   ├── shareInvitationEmailSimple.ts (179 lines) ✅ ACTIVE
│   ├── verificationEmail.ts (217 lines) ✅ ACTIVE
│   │   └── ❌ NO PLAIN TEXT VERSION!
│   └── (Inline in emailService.ts) ❌ sendProjectShareEmail
│
├── Utilities (Duplicated!)
│   ├── escapeHtml.ts ✅ (proper)
│   ├── verificationEmail.ts ❌ (duplicate escapeHtml)
│   ├── passwordResetEmail.ts ❌ (duplicate escapePlainText)
│   ├── 4 different date formatters ❌
│   └── 5+ translation dictionaries ❌
│
└── Types (Scattered!)
    ├── PasswordResetEmailData (defined 3 times) ❌
    ├── ShareInvitationData (defined 2 times) ❌
    └── VerificationEmailData (defined 1 time) ✅
```

### Proposed Architecture (Clean)

```
Email System (Proposed - SSOT Compliant)
│
├── Service (Single source of truth)
│   └── emailService.ts
│       ├── Core: init(), send(), test()
│       ├── Retry: integrated from emailRetryService
│       ├── Queue: integrated from emailRetryService
│       └── API: sendPasswordReset(), sendVerification(), sendShareInvitation()
│
├── Templates (Organized by type)
│   ├── passwordReset/
│   │   ├── index.ts (exports factory)
│   │   ├── html.standard.ts
│   │   ├── html.simple.ts (for UTIA)
│   │   ├── text.ts (unified text version)
│   │   └── types.ts
│   ├── shareInvitation/
│   │   ├── index.ts (exports factory)
│   │   ├── html.rich.ts (beautiful design)
│   │   ├── html.simple.ts (for UTIA)
│   │   ├── text.ts (unified text version)
│   │   └── types.ts
│   ├── verification/
│   │   ├── index.ts (exports factory)
│   │   ├── html.ts
│   │   ├── text.ts ✅ NEW
│   │   └── types.ts
│   └── factory.ts (Smart template selector)
│
├── Translations (Centralized)
│   └── emailTranslations.ts ✅ NEW
│       ├── passwordReset: { en, cs, es, de, fr, zh }
│       ├── shareInvitation: { en, cs, es, de, fr, zh }
│       ├── verification: { en, cs, es, de, fr, zh }
│       └── getTranslation(type, locale)
│
├── Utilities (Single source of truth)
│   ├── escapeHtml.ts ✅ (keep this)
│   └── emailFormatters.ts ✅ NEW
│       ├── formatDate(date, locale)
│       ├── formatExpiry(date, locale)
│       └── truncateText(text, maxLength)
│
└── Types (Centralized)
    └── email.ts ✅ NEW
        ├── PasswordResetEmailData
        ├── ShareInvitationEmailData
        ├── VerificationEmailData
        ├── EmailFormat enum
        ├── EmailComplexity enum
        └── EmailServiceOptions
```

---

## 13. Conclusion

The email system in Cell Segmentation Hub has **significant SSOT violations** that need to be addressed before adding more plain text templates:

### Critical Issues

1. **Three email service implementations** instead of one
2. **Seven template files** with heavy duplication (3 for password reset alone!)
3. **No consistent plain text support** (verification email missing text version)
4. **Dead code**: ~600 lines of beautiful but unused share invitation template
5. **Scattered translations**: 5+ locations instead of central system

### Before Adding Plain Text Templates

**Must Do:**

1. ✅ Add text version to `verificationEmail.ts`
2. ✅ Delete unused `passwordResetEmail.ts`
3. ✅ Decide fate of beautiful share invitation template (recommend: keep it!)
4. ✅ Create central translation system

**Should Do:** 5. Merge duplicate templates into unified versions with modes 6. Consolidate the 3 email services into 1 7. Remove duplicate utility functions

**Nice to Have:** 8. Create template factory for smart rendering 9. Add user email format preferences 10. Enhance i18n integration

### Recommendation

**Do NOT add more plain text templates until at least the "Must Do" items are completed.** The current architecture makes it easy to create more duplication and hard to maintain consistency.

Instead, follow this approach:

1. Fix immediate issues (dead code, missing text versions)
2. Consolidate existing templates
3. Create template factory
4. Then add new features from a clean foundation

This will ensure that plain text support is **uniform, maintainable, and follows SSOT principles**.

---

## Appendices

### Appendix A: File Size Analysis

| File                           | Lines      | HTML | Text | i18n | Status                |
| ------------------------------ | ---------- | ---- | ---- | ---- | --------------------- |
| emailService.ts                | 730        | -    | -    | -    | Keep & refactor       |
| emailRetryService.ts           | 517        | -    | -    | -    | Merge into main       |
| reliableEmailService.ts        | 307        | -    | -    | -    | Merge into main       |
| passwordResetEmail.ts          | 124        | ✅   | ✅   | ❌   | **DELETE**            |
| passwordResetEmailMultilang.ts | 195        | ✅   | ✅   | ✅   | Keep & enhance        |
| passwordResetEmailSimple.ts    | 87         | ✅   | ✅   | ❌   | Merge into multilang  |
| shareInvitationEmail.ts        | 595        | ✅   | ✅   | ✅   | **Keep!** (beautiful) |
| shareInvitationEmailSimple.ts  | 179        | ✅   | ✅   | ✅   | Merge into main       |
| verificationEmail.ts           | 217        | ✅   | ❌   | ✅   | Fix (add text)        |
| **Total**                      | **2,951**  | -    | -    | -    | -                     |
| **After cleanup**              | **~2,100** | -    | -    | -    | **-851 lines**        |

### Appendix B: Translation Coverage

| Template                    | EN  | CS  | ES  | DE  | FR  | ZH  | Complete? |
| --------------------------- | --- | --- | --- | --- | --- | --- | --------- |
| passwordResetEmailMultilang | ✅  | ✅  | ✅  | ✅  | ✅  | ✅  | ✅        |
| shareInvitationEmail        | ✅  | ✅  | ✅  | ✅  | ✅  | ✅  | ✅        |
| shareInvitationEmailSimple  | ✅  | ✅  | ✅  | ✅  | ✅  | ✅  | ✅        |
| verificationEmail           | ✅  | ✅  | ✅  | ✅  | ✅  | ✅  | ✅        |
| passwordResetEmail          | ❌  | ✅  | ❌  | ❌  | ❌  | ❌  | ❌        |
| passwordResetEmailSimple    | ❌  | ✅  | ❌  | ❌  | ❌  | ❌  | ❌        |

### Appendix C: Contact & Next Steps

**For questions about this analysis:**

- Architecture decisions: Review with team
- Implementation priorities: Discuss with product owner
- Timeline: Based on team capacity

**Suggested next meeting topics:**

1. Approve refactoring plan
2. Decide on beautiful vs simple share invitation template
3. Set timeline for phases
4. Assign ownership

**Related Documentation:**

- `/docs/SSOT_*.md` - Other SSOT analysis documents
- `CLAUDE.md` - Project guidelines
- Backend README - Service architecture

---

_End of Email System SSOT Analysis Report_
