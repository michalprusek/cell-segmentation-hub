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
  hasAttachment?: boolean;
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
    ${
      data.hasAttachment
        ? `<tr><td style="padding: 4px 0; color: #6b7280;">Attachment:</td><td style="color: #059669;">included (see attachments)</td></tr>`
        : ''
    }
  </table>

  <div style="background: #f9fafb; border-left: 4px solid ${typeColor}; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
    <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; line-height: 1.6;">${escapeHtml(data.body)}</pre>
  </div>

  <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; color: #6b7280; font-size: 12px;">
    <p style="margin: 0;">Reply directly to this email to respond to the user — the Reply-To header is set to their address.</p>
    <p style="margin: 8px 0 0 0;">— SpheroSeg feedback system</p>
  </div>
</body>
</html>`;

  const text = `${typeLabel}: ${data.title}

From:        ${data.submitterEmail}
Submitted:   ${submittedAt}
Feedback ID: ${data.feedbackId}${data.hasAttachment ? '\nAttachment:  included (see attachments)' : ''}

${data.body}

---
Reply directly to this email to respond to the user — the Reply-To
header is set to their address.

— SpheroSeg feedback system`;

  return { subject, html, text };
}
