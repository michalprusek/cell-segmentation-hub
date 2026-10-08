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

describe('batchQueueSchema — channels to merge', () => {
  const base = {
    imageIds: ['a1b2c3d4-e5f6-4890-abcd-ef1234567890'],
    projectId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
  };
  const parse = (channels: unknown) =>
    batchQueueSchema.safeParse({ ...base, channels });

  it('accepts a list of channel names and keeps their order', () => {
    const result = parse(['Channel_2', 'Channel_1']);
    expect(result.success).toBe(true);
    expect(result.success && result.data.channels).toEqual([
      'Channel_2',
      'Channel_1',
    ]);
  });

  it('is optional', () => {
    const result = batchQueueSchema.safeParse(base);
    expect(result.success && result.data.channels).toBeUndefined();
  });

  it('refuses an empty list, a duplicate, and more than eight', () => {
    expect(parse([]).success).toBe(false);
    expect(parse(['a', 'a']).success).toBe(false);
    expect(parse(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).success).toBe(true);
    expect(parse(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).success).toBe(
      false
    );
  });

  it('refuses a name that could leave the frame directory', () => {
    // Each name becomes a filename under frames/<NNNN>/.
    expect(parse(['../secret']).success).toBe(false);
    expect(parse(['a/b']).success).toBe(false);
    expect(parse(['a.png']).success).toBe(false);
    expect(parse(['']).success).toBe(false);
  });
});
