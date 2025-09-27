import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
}

export const generatePasswordResetEmailHTML = (
  data: PasswordResetEmailData
): string => {
  // Validate and sanitize the reset URL first
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  // Escape all user-supplied values
  const safeUserEmail = escapeHtml(data.userEmail);
  const safeResetUrl = escapeHtml(validatedUrl);
  const expirationTime = data.expiresAt.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Simplified HTML template for UTIA SMTP compatibility
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Reset hesla - SpheroSeg</title>
</head>
<body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
    <div style="max-width: 500px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px;">
        <h1 style="color: #333; text-align: center; margin-bottom: 30px;">Reset hesla</h1>
        
        <p>Dobrý den,</p>
        
        <p>Byla vyžádána změna hesla pro váš účet <strong>${safeUserEmail}</strong> na platformě SpheroSeg.</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${safeResetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Nastavit nové heslo</a>
        </div>
        
        <p>Nebo zkopírujte tento odkaz do prohlížeče:</p>
        <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace;">${safeResetUrl}</p>
        
        <p style="color: #d73a49; background-color: #f8d7da; padding: 10px; border-radius: 4px;">
            <strong>Důležité:</strong> Tento odkaz je platný pouze do ${expirationTime}.
        </p>
        
        <p>Pokud jste si reset hesla nevyžádali, ignorujte tento email.</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666; text-align: center;">
            SpheroSeg<br>
            Tento email byl odeslán automaticky.
        </p>
    </div>
</body>
</html>
  `.trim();
};

// Helper function to escape plain text for security
const escapePlainText = (text: string): string => {
  return (
    text
      // Remove all control characters (0-31 and 127) except space
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize whitespace
      .replace(/[\r\n\t]/g, ' ')
      // Remove multiple consecutive spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
};

export const generatePasswordResetEmailText = (
  data: PasswordResetEmailData
): string => {
  // Validate and sanitize the reset URL first
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  const safeEmail = escapePlainText(data.userEmail);
  const safeResetUrl = escapePlainText(validatedUrl);
  const expirationTime = data.expiresAt.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `
Reset hesla - SpheroSeg

Dobrý den,

Byla vyžádána změna hesla pro váš účet (${safeEmail}) na platformě SpheroSeg.

Pro nastavení nového hesla klikněte na tento odkaz:
${safeResetUrl}

DŮLEŽITÉ: Tento odkaz je platný pouze do ${expirationTime}. 
Pokud odkaz vypršel, můžete požádat o nový reset hesla.

Pokud jste si reset hesla nevyžádali, ignorujte tento email. Vaše heslo zůstane beze změny.

SpheroSeg
Tento email byl odeslán automaticky, neodpovídejte na něj.
  `.trim();
};
