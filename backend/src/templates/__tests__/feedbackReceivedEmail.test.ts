import { describe, it, expect } from 'vitest';
import { renderFeedbackReceivedEmail } from '../feedbackReceivedEmail';

const BASE = {
  feedbackId: 'fb-123',
  type: 'bug' as const,
  title: 'Editor crashes on save',
  body: 'Steps: open editor, click save, boom.',
  submitterEmail: 'reporter@example.com',
};

describe('renderFeedbackReceivedEmail', () => {
  it('renders subject, title and body with no attachment section', () => {
    const { subject, html, text } = renderFeedbackReceivedEmail(BASE);
    expect(subject).toBe('[SpheroSeg bug] Editor crashes on save');
    expect(html).toContain('Editor crashes on save');
    expect(text).toContain('Steps: open editor, click save, boom.');
    expect(html).not.toContain('Attachment:');
    expect(text).not.toContain('Attachment:');
  });

  it("uses 'Feature request' wording for feature type", () => {
    const { subject, html } = renderFeedbackReceivedEmail({
      ...BASE,
      type: 'feature',
    });
    expect(subject).toBe('[SpheroSeg feature] Editor crashes on save');
    expect(html).toContain('Feature request');
  });

  it('HTML-escapes user-supplied title and body (injection guard)', () => {
    const { html } = renderFeedbackReceivedEmail({
      ...BASE,
      title: '<script>alert(1)</script>',
      body: 'a & b < c > d "e" \'f\'',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('renders an inlined small-image attachment with humanized size', () => {
    const { html, text } = renderFeedbackReceivedEmail({
      ...BASE,
      attachment: {
        filename: 'screenshot.png',
        sizeBytes: 1536, // 1.5 KB
        storageKey: 'feedback/fb-123/screenshot.png',
        absolutePath: '/app/uploads/feedback/fb-123/screenshot.png',
        inlined: true,
      },
    });
    expect(html).toContain('screenshot.png');
    expect(html).toContain('1.5 KB');
    expect(html).toContain('attached to this email');
    expect(text).toContain('also attached to this email');
    expect(text).toContain('/app/uploads/feedback/fb-123/screenshot.png');
  });

  it('renders a large non-inlined attachment as a server-path reference', () => {
    const { html, text } = renderFeedbackReceivedEmail({
      ...BASE,
      attachment: {
        filename: 'WellD03.nd2',
        sizeBytes: 50 * 1024 * 1024 * 1024, // 50 GB
        storageKey: 'feedback/fb-123/WellD03.nd2',
        absolutePath: '/app/uploads/feedback/fb-123/WellD03.nd2',
        inlined: false,
      },
    });
    expect(html).toContain('WellD03.nd2');
    expect(html).toContain('50.0 GB');
    expect(html).toContain('Too large to attach');
    expect(text).toContain('too large to attach');
    expect(text).toContain('/app/uploads/feedback/fb-123/WellD03.nd2');
  });

  it('renders the failed-to-persist notice when attachmentFailed is set', () => {
    const { html, text } = renderFeedbackReceivedEmail({
      ...BASE,
      attachmentFailed: true,
    });
    expect(html).toContain('failed to store on the server');
    expect(text).toContain('FAILED TO STORE');
  });

  it('humanizes byte sizes across unit boundaries', () => {
    const cases: Array<[number, string]> = [
      [512, '512 B'],
      [20_000_000, '19.1 MB'],
      [3 * 1024 * 1024 * 1024, '3.0 GB'],
    ];
    for (const [bytes, label] of cases) {
      const { html } = renderFeedbackReceivedEmail({
        ...BASE,
        attachment: {
          filename: 'f.bin',
          sizeBytes: bytes,
          storageKey: 'feedback/fb-123/f.bin',
          absolutePath: '/app/uploads/feedback/fb-123/f.bin',
          inlined: false,
        },
      });
      expect(html).toContain(label);
    }
  });
});
