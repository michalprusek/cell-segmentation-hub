interface VerificationEmailData {
  verificationUrl: string;
  userEmail?: string;
  locale?: string;
}

// Simple HTML escape function for security
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'/]/g, char => map[char] || char);
}

const translations = {
  en: {
    subject: 'Verify Your Email - Cell Segmentation Platform',
    title: 'Email Verification',
    greeting: 'Hello,',
    body: 'Please click the button below to verify your email address and activate your account.',
    buttonText: 'Verify Email',
    altText: 'Or copy and paste this link into your browser:',
    footer: 'If you did not create an account, you can safely ignore this email.',
    regards: 'Best regards,',
    team: 'Cell Segmentation Platform Team'
  },
  cs: {
    subject: 'Ověřte svůj e-mail - Cell Segmentation Platform',
    title: 'Ověření e-mailu',
    greeting: 'Dobrý den,',
    body: 'Kliknutím na tlačítko níže ověřte svou e-mailovou adresu a aktivujte svůj účet.',
    buttonText: 'Ověřit e-mail',
    altText: 'Nebo zkopírujte a vložte tento odkaz do svého prohlížeče:',
    footer: 'Pokud jste si nevytvořili účet, můžete tento e-mail bezpečně ignorovat.',
    regards: 'S pozdravem,',
    team: 'Tým Cell Segmentation Platform'
  },
  es: {
    subject: 'Verifica tu correo - Cell Segmentation Platform',
    title: 'Verificación de correo',
    greeting: 'Hola,',
    body: 'Haz clic en el botón de abajo para verificar tu dirección de correo y activar tu cuenta.',
    buttonText: 'Verificar correo',
    altText: 'O copia y pega este enlace en tu navegador:',
    footer: 'Si no creaste una cuenta, puedes ignorar este correo de forma segura.',
    regards: 'Saludos,',
    team: 'Equipo de Cell Segmentation Platform'
  },
  de: {
    subject: 'E-Mail bestätigen - Cell Segmentation Platform',
    title: 'E-Mail-Bestätigung',
    greeting: 'Hallo,',
    body: 'Klicken Sie auf die Schaltfläche unten, um Ihre E-Mail-Adresse zu bestätigen und Ihr Konto zu aktivieren.',
    buttonText: 'E-Mail bestätigen',
    altText: 'Oder kopieren Sie diesen Link und fügen Sie ihn in Ihren Browser ein:',
    footer: 'Wenn Sie kein Konto erstellt haben, können Sie diese E-Mail sicher ignorieren.',
    regards: 'Mit freundlichen Grüßen,',
    team: 'Cell Segmentation Platform Team'
  },
  fr: {
    subject: 'Vérifiez votre email - Cell Segmentation Platform',
    title: 'Vérification d\'email',
    greeting: 'Bonjour,',
    body: 'Cliquez sur le bouton ci-dessous pour vérifier votre adresse email et activer votre compte.',
    buttonText: 'Vérifier l\'email',
    altText: 'Ou copiez et collez ce lien dans votre navigateur :',
    footer: 'Si vous n\'avez pas créé de compte, vous pouvez ignorer cet email en toute sécurité.',
    regards: 'Cordialement,',
    team: 'Équipe Cell Segmentation Platform'
  },
  zh: {
    subject: '验证您的电子邮件 - 细胞分割平台',
    title: '电子邮件验证',
    greeting: '您好，',
    body: '请点击下方按钮验证您的电子邮件地址并激活您的账户。',
    buttonText: '验证电子邮件',
    altText: '或将此链接复制并粘贴到您的浏览器中：',
    footer: '如果您没有创建账户，可以安全地忽略此邮件。',
    regards: '此致，',
    team: '细胞分割平台团队'
  }
};

export function generateVerificationEmailHTML(data: VerificationEmailData): {
  subject: string;
  html: string;
} {
  const locale = data.locale || 'en';
  const t = translations[locale as keyof typeof translations] || translations.en;
  
  // Validate and escape verification URL for security
  let safeUrl;
  try {
    const url = new URL(data.verificationUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    safeUrl = escapeHtml(data.verificationUrl);
  } catch (error) {
    // Fall back to safe default if URL is invalid
    safeUrl = escapeHtml('#');
  }
  
  const safeEmail = data.userEmail ? escapeHtml(data.userEmail) : '';

  // Validate and sanitize locale for HTML lang attribute
  const allowedLocales = ['en', 'cs', 'es', 'de', 'fr', 'zh'];
  const safeLocale = allowedLocales.includes(locale.toLowerCase()) ? locale.toLowerCase() : 'en';
  
  const html = `
    <!DOCTYPE html>
    <html lang="${safeLocale}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${t.title}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .container {
                background-color: white;
                border-radius: 8px;
                padding: 30px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
                color: #2563eb;
                margin-bottom: 20px;
                font-size: 24px;
            }
            .button {
                display: inline-block;
                padding: 12px 24px;
                background-color: #2563eb;
                color: white !important;
                text-decoration: none;
                border-radius: 6px;
                font-weight: 500;
                margin: 20px 0;
            }
            .link-container {
                background-color: #f8f9fa;
                padding: 15px;
                border-radius: 6px;
                margin: 20px 0;
                word-break: break-all;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #e5e7eb;
                color: #6b7280;
                font-size: 14px;
            }
            .user-info {
                background-color: #eff6ff;
                padding: 10px;
                border-radius: 4px;
                margin: 15px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>${t.title}</h1>
            <p>${t.greeting}</p>
            ${safeEmail ? `<div class="user-info">Account: ${safeEmail}</div>` : ''}
            <p>${t.body}</p>
            
            <div style="text-align: center;">
                <a href="${safeUrl}" class="button">${t.buttonText}</a>
            </div>
            
            <p>${t.altText}</p>
            <div class="link-container">
                ${safeUrl}
            </div>
            
            <div class="footer">
                <p>${t.footer}</p>
                <p>
                    ${t.regards}<br>
                    ${t.team}
                </p>
            </div>
        </div>
    </body>
    </html>
  `;

  return {
    subject: t.subject,
    html
  };
}