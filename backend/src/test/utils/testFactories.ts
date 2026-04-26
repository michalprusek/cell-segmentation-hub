/**
 * Test factory functions for creating mock Prisma model objects.
 *
 * Factories accept an optional `overrides` parameter so callers can
 * customise only the fields they care about while keeping sensible
 * defaults for everything else.
 *
 * Usage:
 *   const user = createMockUser({ email: 'custom@example.com' });
 *   const { req, res, next } = createMockReqRes();
 */

import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Minimal inline types that mirror the Prisma schema without importing
// the generated client (which requires a live DB connection at module load).
// ---------------------------------------------------------------------------

export interface MockProfile {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  avatarPath: string | null;
  avatarMimeType: string | null;
  avatarSize: number | null;
  bio: string | null;
  organization: string | null;
  location: string | null;
  title: string | null;
  publicProfile: boolean;
  preferredModel: string;
  modelThreshold: number;
  preferredLang: string;
  preferredTheme: string;
  emailNotifications: boolean;
  consentToMLTraining: boolean;
  consentToAlgorithmImprovement: boolean;
  consentToFeatureDevelopment: boolean;
  consentUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockUser {
  id: string;
  email: string;
  password: string;
  emailVerified: boolean;
  verificationToken: string | null;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
  profile: MockProfile | null;
}

export interface MockProject {
  id: string;
  title: string;
  description: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockImage {
  id: string;
  name: string;
  originalPath: string;
  thumbnailPath: string | null;
  segmentationThumbnailPath: string | null;
  projectId: string;
  segmentationStatus: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockQueueItem {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: string;
  threshold: number;
  detectHoles: boolean;
  priority: number;
  status: string;
  error: string | null;
  retryCount: number;
  batchId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface MockShare {
  id: string;
  projectId: string;
  sharedById: string;
  sharedWithId: string | null;
  email: string | null;
  shareToken: string;
  tokenExpiry: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a deterministic UUID-shaped string for test IDs. */
function makeId(prefix: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const rand = Math.floor(Math.random() * 0xffffffff);
  return `${prefix}-${hex(rand)}-4abc-8def-${hex(rand + 1)}`;
}

const BASE_DATE = new Date('2025-01-01T00:00:00.000Z');
const LATER_DATE = new Date('2025-06-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock User record.
 *
 * The `password` field defaults to a bcrypt hash of "password123" so tests
 * can call `verifyPassword('password123', user.password)` without mocking
 * the hash itself.
 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const userId = overrides.id ?? makeId('usr');

  const defaultProfile: MockProfile = {
    id: makeId('prf'),
    userId,
    username: 'testuser',
    avatarUrl: null,
    avatarPath: null,
    avatarMimeType: null,
    avatarSize: null,
    bio: null,
    organization: null,
    location: null,
    title: null,
    publicProfile: false,
    preferredModel: 'hrnet',
    modelThreshold: 0.5,
    preferredLang: 'cs',
    preferredTheme: 'light',
    emailNotifications: true,
    consentToMLTraining: true,
    consentToAlgorithmImprovement: true,
    consentToFeatureDevelopment: true,
    consentUpdatedAt: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
  };

  return {
    id: userId,
    email: 'test@example.com',
    // bcrypt hash of "password123" (cost 10) – stable across runs
    password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    emailVerified: true,
    verificationToken: null,
    resetToken: null,
    resetTokenExpiry: null,
    createdAt: BASE_DATE,
    updatedAt: LATER_DATE,
    profile: defaultProfile,
    ...overrides,
  };
}

/**
 * Creates a mock Project record.
 */
export function createMockProject(
  overrides: Partial<MockProject> = {}
): MockProject {
  return {
    id: makeId('prj'),
    title: 'Test Project',
    description: 'A test project for unit tests',
    userId: makeId('usr'),
    createdAt: BASE_DATE,
    updatedAt: LATER_DATE,
    ...overrides,
  };
}

/**
 * Creates a mock Image (ProjectImage) record.
 */
export function createMockImage(overrides: Partial<MockImage> = {}): MockImage {
  return {
    id: makeId('img'),
    name: 'test-image.jpg',
    originalPath: '/uploads/images/test-image.jpg',
    thumbnailPath: '/uploads/thumbnails/test-image.jpg',
    segmentationThumbnailPath: null,
    projectId: makeId('prj'),
    segmentationStatus: 'no_segmentation',
    fileSize: 204800, // 200 KB
    width: 512,
    height: 512,
    mimeType: 'image/jpeg',
    createdAt: BASE_DATE,
    updatedAt: LATER_DATE,
    ...overrides,
  };
}

/**
 * Creates a mock SegmentationQueue item.
 */
export function createMockQueueItem(
  overrides: Partial<MockQueueItem> = {}
): MockQueueItem {
  return {
    id: makeId('que'),
    imageId: makeId('img'),
    projectId: makeId('prj'),
    userId: makeId('usr'),
    model: 'hrnet',
    threshold: 0.5,
    detectHoles: true,
    priority: 0,
    status: 'queued',
    error: null,
    retryCount: 0,
    batchId: null,
    createdAt: BASE_DATE,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

/**
 * Creates a mock ProjectShare record.
 */
export function createMockShare(overrides: Partial<MockShare> = {}): MockShare {
  return {
    id: makeId('shr'),
    projectId: makeId('prj'),
    sharedById: makeId('usr'),
    sharedWithId: null,
    email: 'invited@example.com',
    shareToken: `tok-${makeId('tkn')}`,
    tokenExpiry: null,
    status: 'pending',
    createdAt: BASE_DATE,
    updatedAt: LATER_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Express mock helpers
// ---------------------------------------------------------------------------

export interface MockReqResNext {
  req: Partial<Request> & {
    user?: { id: string; email: string; emailVerified: boolean };
    params: Record<string, string>;
    query: Record<string, string>;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  };
  res: Partial<Response> & {
    status: MockedFunction<(code: number) => any>;
    json: MockedFunction<(body: unknown) => any>;
    send: MockedFunction<(body?: unknown) => any>;
    sendStatus: MockedFunction<(code: number) => any>;
    set: MockedFunction<
      (field: string, value?: string | string[]) => any
    >;
    locals: Record<string, unknown>;
  };
  next: MockedFunction<NextFunction>;
}

/**
 * Returns a trio of Express { req, res, next } mocks ready for controller
 * unit tests.  `res.status()` returns `res` itself so you can chain
 * `.status(404).json(...)` as in production code.
 */
export function createMockReqRes(
  reqOverrides: Partial<MockReqResNext['req']> = {}
): MockReqResNext {
  const json = vi.fn() as MockedFunction<(body: unknown) => any>;
  const send = vi.fn() as MockedFunction<(body?: unknown) => any>;
  const sendStatus = vi.fn() as MockedFunction<(code: number) => any>;
  const set = vi.fn() as unknown as MockedFunction<
    (field: string, value?: string | string[]) => any
  >;
  const status = vi.fn().mockReturnValue({
    json,
    send,
    sendStatus,
    set,
  }) as MockedFunction<(code: number) => any>;

  const res: MockReqResNext['res'] = {
    status,
    json,
    send,
    sendStatus,
    set,
    locals: {},
  };

  const req: MockReqResNext['req'] = {
    user: {
      id: makeId('usr'),
      email: 'test@example.com',
      emailVerified: true,
    },
    params: {},
    query: {},
    body: {},
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-access-token',
    },
    ...reqOverrides,
  };

  const next = vi.fn() as unknown as MockedFunction<NextFunction>;

  return { req, res, next };
}
