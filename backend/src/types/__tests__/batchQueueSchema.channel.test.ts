import { describe, it, expect } from 'vitest';
import { batchQueueSchema } from '../validation';

const baseBody = {
  imageIds: ['11111111-1111-4111-8111-111111111111'],
  projectId: '22222222-2222-4222-8222-222222222222',
  model: 'microtubule' as const,
};

describe('batchQueueSchema — channel field', () => {
  it('is optional (parses without channel)', () => {
    const out = batchQueueSchema.parse(baseBody);
    expect(out.channel).toBeUndefined();
  });

  it('accepts a typical wavelength channel name', () => {
    const out = batchQueueSchema.parse({ ...baseBody, channel: '488_nm' });
    expect(out.channel).toBe('488_nm');
  });

  it('accepts a generic ch_N channel name', () => {
    const out = batchQueueSchema.parse({ ...baseBody, channel: 'ch_0' });
    expect(out.channel).toBe('ch_0');
  });

  it('rejects empty channel string', () => {
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: '' })
    ).toThrow();
  });

  it('rejects channel with whitespace', () => {
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: 'channel one' })
    ).toThrow();
  });

  it('rejects channel with shell-special characters (defense in depth — value flows to a storage key)', () => {
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: '../etc' })
    ).toThrow();
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: '488/nm' })
    ).toThrow();
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: '488;rm' })
    ).toThrow();
  });

  it('rejects channel longer than 64 characters', () => {
    const long = 'a'.repeat(65);
    expect(() =>
      batchQueueSchema.parse({ ...baseBody, channel: long })
    ).toThrow();
  });

  it('accepts a 64-character channel name (boundary)', () => {
    const ch = 'a'.repeat(64);
    const out = batchQueueSchema.parse({ ...baseBody, channel: ch });
    expect(out.channel).toBe(ch);
  });
});
