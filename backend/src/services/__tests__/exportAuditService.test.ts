/**
 * The audit log's two load-bearing promises:
 *
 *  1. It records what actually left the platform, with the right types — a
 *     BIGINT size, because an export ZIP passes 2^31 bytes long before it
 *     passes any other limit.
 *  2. It never breaks an export. A row is worth less than the archive it
 *     describes, so a database that refuses the write must cost a log line,
 *     not the user's data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createMock, warnMock, findUserMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  warnMock: vi.fn(),
  findUserMock: vi.fn(),
}));

vi.mock('../../db', () => ({
  prisma: {
    exportLog: { create: createMock },
    user: { findUnique: findUserMock },
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordExportEvent } from '../exportAuditService';

describe('recordExportEvent', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({});
    warnMock.mockReset();
    findUserMock.mockReset().mockResolvedValue({ email: 'who@example.com' });
  });

  it('records who took what, when', async () => {
    await recordExportEvent({
      kind: 'project',
      event: 'downloaded',
      userId: 'user-1',
      jobId: 'job-1',
      projectId: 'project-1',
      fileSizeBytes: 4096,
      detail: 'token',
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      kind: 'project',
      event: 'downloaded',
      userId: 'user-1',
      jobId: 'job-1',
      projectId: 'project-1',
      detail: 'token',
    });
  });

  it('stores the file size as a BigInt', async () => {
    // 4 GB: an export archive reaches this before it reaches any other limit,
    // and an Int4 column has silently overflowed in this schema before.
    const fourGigabytes = 4_294_967_296;
    await recordExportEvent({
      kind: 'project',
      event: 'completed',
      userId: 'user-1',
      jobId: 'job-1',
      fileSizeBytes: fourGigabytes,
    });

    const { fileSizeBytes } = createMock.mock.calls[0][0].data;
    expect(typeof fileSizeBytes).toBe('bigint');
    expect(fileSizeBytes).toBe(BigInt(fourGigabytes));
  });

  it('normalises absent fields so they store as NULL', async () => {
    await recordExportEvent({
      kind: 'essays',
      event: 'downloaded',
      userId: 'user-1',
      jobId: 'job-1',
    });

    const { data } = createMock.mock.calls[0][0];
    expect(data.projectId).toBeNull();
    expect(data.fileSizeBytes).toBeNull();
    expect(data.imageCount).toBeNull();
    expect(data.detail).toBeNull();
    // `options` must be absent, not null: Prisma treats the two differently
    // on a Json column and `null` there means the JSON value `null`.
    expect(data.options).toBeUndefined();
  });

  it('keeps the requested options whole', async () => {
    const options = {
      annotationFormats: ['coco'],
      includeVisualizations: true,
      mtKymographs: { lineWidth: 5 },
    };
    await recordExportEvent({
      kind: 'project',
      event: 'created',
      userId: 'user-1',
      jobId: 'job-1',
      options,
    });

    expect(createMock.mock.calls[0][0].data.options).toEqual(options);
  });

  it('stores a malformed size as NULL rather than losing the row', async () => {
    // `BigInt(3.5)` and `BigInt(NaN)` THROW, and this module's catch would
    // swallow that — taking the actor, the timestamp and the job down with it
    // over the least important field on the record.
    for (const bad of [3.5, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 2]) {
      createMock.mockClear();
      await recordExportEvent({
        kind: 'project',
        event: 'completed',
        userId: 'user-1',
        jobId: 'job-1',
        fileSizeBytes: bad,
      });
      expect(createMock, `size ${bad} lost the row`).toHaveBeenCalledTimes(1);
      expect(createMock.mock.calls[0][0].data.fileSizeBytes).toBeNull();
    }
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('denormalises the actor e-mail so the row outlives the account', async () => {
    // The FK is SET NULL, which keeps the row but not the join. Without the
    // e-mail a deleted user's rows would say only "someone" — and the person
    // who deletes their account is exactly the one an audit needs to name.
    await recordExportEvent({
      kind: 'project',
      event: 'downloaded',
      userId: 'user-1',
      jobId: 'job-1',
    });
    expect(createMock.mock.calls[0][0].data.userEmail).toBe('who@example.com');
  });

  it('still writes the row when the e-mail lookup fails', async () => {
    findUserMock.mockRejectedValue(new Error('db down'));
    await recordExportEvent({
      kind: 'project',
      event: 'downloaded',
      userId: 'user-1',
      jobId: 'job-1',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.userEmail).toBeNull();
  });

  it('records a denial that carried no credential at all', async () => {
    // The most interesting row in an attribution log: a forwarded link retried
    // after it expired. There is no actor to name, and that must not stop it
    // being written.
    await recordExportEvent({
      kind: 'project',
      event: 'denied',
      userId: null,
      jobId: 'job-1',
      detail: 'no-credential',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      event: 'denied',
      userId: null,
      userEmail: null,
    });
    // No pointless lookup for an actor that does not exist.
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('never lets a failed write escape to the caller', async () => {
    createMock.mockRejectedValue(new Error('deadlock detected'));

    await expect(
      recordExportEvent({
        kind: 'project',
        event: 'downloaded',
        userId: 'user-1',
        jobId: 'job-1',
      })
    ).resolves.toBeUndefined();

    // Swallowed, but not silent: a systematically failing audit has to be
    // visible somewhere.
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(String(warnMock.mock.calls[0][0])).toContain('deadlock detected');
  });
});
