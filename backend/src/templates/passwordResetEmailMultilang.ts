import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
  locale?: string;
}

interface PasswordResetTranslations {
  subject: string;
  title: string;
  greeting: string;
  requestText: string;
  clickHere: string;
  orCopy: string;
  validUntil: string;
  ignoreText: string;
  signature: string;
}

const translations: Record<string, PasswordResetTranslations> = {
  en: {
    subject: 'Password Reset - SpheroSeg',
    title: 'Password Reset - SpheroSeg',
    greeting: 'Hello,',
    requestText: 'A password reset was requested for account:',
    clickHere: 'Click here to reset password',
    orCopy: 'Or copy this link:',
    validUntil: 'Valid until:',
    ignoreText: 'If you did not request this reset, please ignore this email.',
    signature: '---\nSpheroSeg',
  },
  cs: {
    subject: 'Reset hesla - SpheroSeg',
    title: 'Reset hesla - SpheroSeg',
    greeting: 'Dobrý den,',
    requestText: 'Byla vyžádána změna hesla pro účet:',
    clickHere: 'Klikněte zde pro reset hesla',
    orCopy: 'Nebo zkopírujte tento odkaz:',
    validUntil: 'Platnost do:',
    ignoreText: 'Pokud jste si reset nevyžádali, ignorujte tento email.',
    signature: '---\nSpheroSeg',
  },
  es: {
    subject: 'Restablecimiento de contraseña - SpheroSeg',
    title: 'Restablecimiento de contraseña - SpheroSeg',
    greeting: 'Hola,',
    requestText:
      'Se solicitó un restablecimiento de contraseña para la cuenta:',
    clickHere: 'Haga clic aquí para restablecer la contraseña',
    orCopy: 'O copie este enlace:',
    validUntil: 'Válido hasta:',
    ignoreText: 'Si no solicitó este restablecimiento, ignore este correo.',
    signature: '---\nSpheroSeg',
  },
  de: {
    subject: 'Passwort zurücksetzen - SpheroSeg',
    title: 'Passwort zurücksetzen - SpheroSeg',
    greeting: 'Hallo,',
    requestText: 'Ein Passwort-Reset wurde angefordert für das Konto:',
    clickHere: 'Hier klicken um Passwort zurückzusetzen',
    orCopy: 'Oder kopieren Sie diesen Link:',
    validUntil: 'Gültig bis:',
    ignoreText:
      'Falls Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail.',
    signature: '---\nSpheroSeg',
  },
  fr: {
    subject: 'Réinitialisation du mot de passe - SpheroSeg',
    title: 'Réinitialisation du mot de passe - SpheroSeg',
    greeting: 'Bonjour,',
    requestText:
      'Une réinitialisation du mot de passe a été demandée pour le compte:',
    clickHere: 'Cliquez ici pour réinitialiser le mot de passe',
    orCopy: 'Ou copiez ce lien:',
    validUntil: "Valide jusqu'au:",
    ignoreText:
      "Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet e-mail.",
    signature: '---\nSpheroSeg',
  },
  zh: {
    subject: '密码重置 - SpheroSeg',
    title: '密码重置 - SpheroSeg',
    greeting: '您好，',
    requestText: '已请求重置以下账户的密码：',
    clickHere: '点击此处重置密码',
    orCopy: '或复制此链接：',
    validUntil: '有效期至：',
    ignoreText: '如果您没有请求重置密码，请忽略此邮件。',
    signature: '---\nSpheroSeg',
  },
};

function getLocaleString(date: Date, locale: string): string {
  // Map our locale codes to proper locale strings
  const localeMap: Record<string, string> = {
    en: 'en-US',
    cs: 'cs-CZ',
    es: 'es-ES',
    de: 'de-DE',
    fr: 'fr-FR',
    zh: 'zh-CN',
  };

  const localeString = localeMap[locale] || 'en-US';
  const timeZone = locale === 'cs' ? 'Europe/Prague' : 'UTC';

  return date.toLocaleString(localeString, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * UTIA-compatible simplified email template with multi-language support
 * - Minimal HTML structure
 * - No complex styling
 * - Plain text-like appearance
 * - Proven to work with hermes.utia.cas.cz
 */
export const generateSimplePasswordResetHTML = (
  data: PasswordResetEmailData
): string => {
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  const safeUserEmail = escapeHtml(data.userEmail);
  const safeResetUrl = escapeHtml(validatedUrl);
  const expirationTime = getLocaleString(data.expiresAt, locale);

  // ULTRA-SIMPLE HTML - proven to work with UTIA SMTP
  return `<html>
<body>
<h2>${t.title}</h2>
<p>${t.greeting}</p>
<p>${t.requestText} ${safeUserEmail}</p>
<p><a href="${safeResetUrl}">${t.clickHere}</a></p>
<p>${t.orCopy}<br>${safeResetUrl}</p>
<p><strong>${t.validUntil} ${expirationTime}</strong></p>
<p>${t.ignoreText}</p>
<p>${t.signature.replace('\n', '<br>')}</p>
</body>
</html>`;
};

/**
 * Plain text version for maximum compatibility with multi-language support
 */
export const generateSimplePasswordResetText = (
  data: PasswordResetEmailData
): string => {
  const validatedUrl = sanitizeUrl(data.resetUrl);
  if (!validatedUrl) {
    throw new Error('Invalid reset URL provided');
  }

  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;
  const expirationTime = getLocaleString(data.expiresAt, locale);

  return `${t.title}

${t.greeting}

${t.requestText} ${data.userEmail}

${t.clickHere}:
${validatedUrl}

${t.validUntil} ${expirationTime}

${t.ignoreText}

${t.signature}`;
};

/**
 * Get the email subject for the given locale
 */
export const getPasswordResetSubject = (locale?: string): string => {
  const t = translations[locale || 'en'] || translations.en;
  return t.subject;
};
