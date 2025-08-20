import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
}

export const generatePasswordResetEmailHTML = (data: PasswordResetEmailData): string => {
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
    minute: '2-digit'
  });
  return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset hesla - Cell Segmentation Platform</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            background-color: #f8fafc;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 30px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 28px;
            font-weight: 600;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #2d3748;
        }
        .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #4a5568;
            line-height: 1.6;
        }
        .password-section {
            background-color: #f7fafc;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 25px;
            margin: 30px 0;
            text-align: center;
        }
        .password-label {
            font-size: 14px;
            color: #718096;
            margin-bottom: 10px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .password-value {
            font-size: 24px;
            font-weight: 700;
            color: #2d3748;
            font-family: 'Courier New', monospace;
            margin: 15px 0;
            padding: 15px;
            background-color: #ffffff;
            border: 1px solid #cbd5e0;
            border-radius: 6px;
            letter-spacing: 2px;
        }
        .copy-button {
            display: inline-block;
            background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
            margin: 10px 5px;
            cursor: pointer;
            border: none;
            transition: all 0.2s ease;
        }
        .copy-button:hover {
            background: linear-gradient(135deg, #3182ce 0%, #2c5aa0 100%);
            transform: translateY(-1px);
        }
        .signin-button {
            display: inline-block;
            background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
            margin: 10px 5px;
            transition: all 0.2s ease;
        }
        .signin-button:hover {
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
            transform: translateY(-1px);
        }
        .warning {
            background-color: #fed7d7;
            border-left: 4px solid #fc8181;
            padding: 15px;
            margin: 25px 0;
            border-radius: 4px;
        }
        .warning-text {
            color: #742a2a;
            font-size: 14px;
            margin: 0;
        }
        .footer {
            background-color: #edf2f7;
            padding: 30px;
            text-align: center;
            font-size: 14px;
            color: #718096;
        }
        .footer a {
            color: #4299e1;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        @media (max-width: 600px) {
            .container {
                margin: 0;
                box-shadow: none;
            }
            .header, .content, .footer {
                padding: 20px;
            }
            .password-value {
                font-size: 20px;
                letter-spacing: 1px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Reset hesla</h1>
        </div>
        
        <div class="content">
            <div class="greeting">Dobrý den,</div>
            
            <div class="message">
                Byla vyžádána změna hesla pro váš účet (<strong>${safeUserEmail}</strong>) na platformě Cell Segmentation Platform.
                <br><br>
                Pro pokračování klikněte na tlačítko níže a nastavte si nové heslo:
            </div>
            
            <div class="password-section">
                <div class="password-label">Resetovat heslo</div>
                <div style="margin: 20px 0; text-align: center;">
                    <a href="${safeResetUrl}" class="signin-button" style="display: inline-block; padding: 15px 30px; font-size: 16px;">
                        🔗 Nastavit nové heslo
                    </a>
                </div>
                <div style="margin-top: 15px; font-size: 14px; color: #666; text-align: center;">
                    Nebo zkopírujte tento odkaz do prohlížeče:<br>
                    <div style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 4px; margin-top: 5px; font-family: monospace;">
                        ${safeResetUrl}
                    </div>
                </div>
            </div>
            
            <div class="warning">
                <p class="warning-text">
                    <strong>Důležité:</strong> Tento odkaz je platný pouze do ${expirationTime}. 
                    Pokud odkaz vypršel, můžete požádat o nový reset hesla.
                </p>
            </div>
            
            <div class="message">
                Pokud jste si reset hesla nevyžádali, ignorujte tento email. Vaše heslo zůstane beze změny.
            </div>
        </div>
        
        <div class="footer">
            <p>
                Cell Segmentation Platform<br>
                Tento email byl odeslán automaticky, neodpovídejte na něj.
            </p>
        </div>
    </div>
</body>
</html>
  `.trim();
};

// Helper function to escape plain text for security
const escapePlainText = (text: string): string => {
  return text
    // Remove all control characters (0-31 and 127) except space
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize whitespace
    .replace(/[\r\n\t]/g, ' ')
    // Remove multiple consecutive spaces
    .replace(/\s+/g, ' ')
    .trim();
};

export const generatePasswordResetEmailText = (data: PasswordResetEmailData): string => {
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
    minute: '2-digit'
  });
  
  return `
Reset hesla - Cell Segmentation Platform

Dobrý den,

Byla vyžádána změna hesla pro váš účet (${safeEmail}) na platformě Cell Segmentation Platform.

Pro nastavení nového hesla klikněte na tento odkaz:
${safeResetUrl}

DŮLEŽITÉ: Tento odkaz je platný pouze do ${expirationTime}. 
Pokud odkaz vypršel, můžete požádat o nový reset hesla.

Pokud jste si reset hesla nevyžádali, ignorujte tento email. Vaše heslo zůstane beze změny.

Cell Segmentation Platform
Tento email byl odeslán automaticky, neodpovídejte na něj.
  `.trim();
};