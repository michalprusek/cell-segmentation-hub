/**
 * Email template for the in-app feedback notification.
 *
 * Sent to the project maintainer (12bprusek@gym-nymburk.cz) every time
 * a user submits a bug report or feature request. The Reply-To header
 * is set to the submitter's email by the calling service so the
 * maintainer can reply directly — this template renders the body only.
 *
 * Plain HTML string (no handlebars) to match the existing
 * `generateMultilangPasswordResetHTML` pattern in emailService.ts. The
 * text alternative mirrors the HTML for plaintext-only clients.
 */

export interface FeedbackEmailData {
  feedbackId: string;
  type: 'bug' | 'feature';
  title: string;
  body: string;
  submitterEmail: string;
  /** Present when the reporter attached a file. Large files (video/ND2)
   *  are stored on the server and only referenced here; small images are
   *  additionally inlined into this email. */
  attachment?: {
    filename: string;
    sizeBytes: number;
    /** Path relative to the uploads root. */
    storageKey: string;
    /** Absolute path inside the backend container. */
    absolutePath: string;
    /** True when the file is also attached inline to this email. */
    inlined: boolean;
  };
}

/** Human-readable byte size (1 decimal place above KB). */
function humanizeBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

/** Escape user-provided strings before interpolating into the HTML body
 *  — title/body come from the form and can contain &<>"'. The plain
 *  text alternative doesn't need escaping. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderFeedbackReceivedEmail(data: FeedbackEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const typeLabel = data.type === 'bug' ? 'Bug report' : 'Feature request';
  const typeColor = data.type === 'bug' ? '#dc2626' : '#2563eb'; // red-600 / blue-600
  const submittedAt = new Date().toISOString();

  // Stable mailbox-filter-friendly prefix.
  const subject = `[SpheroSeg ${data.type}] ${data.title}`;

  const att = data.attachment;
  const attachmentHtmlRow = att
    ? `<tr><td style="padding: 4px 0; color: #6b7280;">Attachment:</td><td style="color: #059669;">${escapeHtml(att.filename)} (${humanizeBytes(att.sizeBytes)})</td></tr>`
    : '';
  const attachmentHtmlBlock = att
    ? `<div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; border-radius: 4px; margin-bottom: 24px; font-size: 13px;">
    <p style="margin: 0 0 8px 0; font-weight: 600;">Attachment stored on server</p>
    <p style="margin: 0 0 4px 0; color: #374151;">${escapeHtml(att.filename)} &middot; ${humanizeBytes(att.sizeBytes)}</p>
    <p style="margin: 0; color: #6b7280;">Path: <code style="background: #e0f2fe; padding: 2px 6px; border-radius: 3px; word-break: break-all;">${escapeHtml(att.absolutePath)}</code></p>
    ${
      att.inlined
        ? '<p style="margin: 8px 0 0 0; color: #059669;">A copy is attached to this email.</p>'
        : '<p style="margin: 8px 0 0 0; color: #b45309;">Too large to attach by email — retrieve it from the server path above.</p>'
    }
  </div>`
    : '';
  const attachmentText = att
    ? `\nAttachment:  ${att.filename} (${humanizeBytes(att.sizeBytes)})\nStored at:   ${att.absolutePath}${
        att.inlined
          ? '\n             (a copy is also attached to this email)'
          : '\n             (too large to attach — retrieve from the server path)'
      }`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">
    <div style="display: inline-block; background: ${typeColor}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
      ${typeLabel}
    </div>
    <h1 style="margin: 12px 0 0 0; font-size: 22px; line-height: 1.3;">${escapeHtml(data.title)}</h1>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
    <tr>
      <td style="padding: 4px 0; color: #6b7280; width: 120px;">From:</td>
      <td><a href="mailto:${escapeHtml(data.submitterEmail)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(data.submitterEmail)}</a></td>
    </tr>
    <tr>
      <td style="padding: 4px 0; color: #6b7280;">Submitted:</td>
      <td>${submittedAt}</td>
    </tr>
    <tr>
      <td style="padding: 4px 0; color: #6b7280;">Feedback ID:</td>
      <td><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 12px;">${escapeHtml(data.feedbackId)}</code></td>
    </tr>
    ${attachmentHtmlRow}
  </table>

  <div style="background: #f9fafb; border-left: 4px solid ${typeColor}; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
    <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; line-height: 1.6;">${escapeHtml(data.body)}</pre>
  </div>

  ${attachmentHtmlBlock}

  <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; color: #6b7280; font-size: 12px;">
    <p style="margin: 0;">Reply directly to this email to respond to the user — the Reply-To header is set to their address.</p>
    <p style="margin: 8px 0 0 0;">— SpheroSeg feedback system</p>
  </div>
</body>
</html>`;

  const text = `${typeLabel}: ${data.title}

From:        ${data.submitterEmail}
Submitted:   ${submittedAt}
Feedback ID: ${data.feedbackId}${attachmentText}

${data.body}

---
Reply directly to this email to respond to the user — the Reply-To
header is set to their address.

— SpheroSeg feedback system`;

  return { subject, html, text };
}
