import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
}

/**
 * UTIA-compatible simplified email template
 * - Minimal HTML structure
 * - No complex styling
 * - Plain text-like appearance
 * - Proven to work with mail.utia.cas.cz
 */
export const generateSimplePasswordResetHTML = (data: PasswordResetEmailData): string => {
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  const safeUserEmail = escapeHtml(data.userEmail);
  const safeResetUrl = escapeHtml(validatedUrl);
  const expirationTime = data.expiresAt.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // ULTRA-SIMPLE HTML - proven to work with UTIA SMTP
  return `<html>
<body>
<h2>Reset hesla - SpheroSeg</h2>
<p>Dobrý den,</p>
<p>Byla vyžádána změna hesla pro účet: ${safeUserEmail}</p>
<p><a href="${safeResetUrl}">Klikněte zde pro reset hesla</a></p>
<p>Nebo zkopírujte tento odkaz:<br>${safeResetUrl}</p>
<p><strong>Platnost do: ${expirationTime}</strong></p>
<p>Pokud jste si reset nevyžádali, ignorujte tento email.</p>
<p>---<br>SpheroSeg</p>
</body>
</html>`;
};

/**
 * Plain text version for maximum compatibility
 */
export const generateSimplePasswordResetText = (data: PasswordResetEmailData): string => {
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  const expirationTime = data.expiresAt.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `Reset hesla - SpheroSeg

Dobrý den,

Byla vyžádána změna hesla pro účet: ${data.userEmail}

Pro reset hesla použijte tento odkaz:
${validatedUrl}

Platnost do: ${expirationTime}

Pokud jste si reset nevyžádali, ignorujte tento email.

---
SpheroSeg`;
};