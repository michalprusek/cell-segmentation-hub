# Test Patterns Library - SSOT Analysis

## Executive Summary

This document provides a comprehensive library of proven test patterns extracted from passing tests in the SpheroSeg codebase. These patterns should be used as the **Single Source of Truth (SSOT)** for fixing failing tests.

**Key Findings:**
- ✅ **4 Backend passing test files analyzed** (accessLogger, polygonValidation, numberPaths, metricsCalculator)
- ✅ **3 Frontend passing test files analyzed** (constants, useDebounce, LanguageSwitcher)
- ✅ **Comprehensive test utilities already exist** (canvasTestUtils, webSocketTestUtils)
- ⚠️ **SSOT violations found**: Some tests create ad-hoc mocks instead of using shared utilities
- ✅ **Clear patterns** for Jest and Vitest usage identified

---

## Section 1: Backend Jest Patterns

### 1.1 Import Pattern (CRITICAL)

**✅ CORRECT Pattern:**
```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
```

**❌ INCORRECT Pattern:**
```typescript
import { describe, it, expect, beforeEach, jest } from 'jest';  // WRONG
// or
import { vi } from 'vitest';  // WRONG - This is for frontend
```

**Why:** Jest requires imports from `@jest/globals` for ESM modules.

