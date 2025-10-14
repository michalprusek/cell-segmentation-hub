import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

/**
 * Ultra-Simple Share Invitation Email Template
 * Designed for hermes.utia.cas.cz with 1000 character limit
 * NO fancy HTML - plain text with minimal HTML structure only
 */

export interface ShareInvitationSimpleData {
  projectTitle: string;
  sharedByEmail: string;
  acceptUrl: string;
  expiresAt: Date;
  locale?: string;
}

interface ShareInvitationSimpleTranslations {
  subject: string;
  greeting: string;
  shared: string;
  project: string;
  clickHere: string;
  orCopy: string;
  expires: string;
  footer: string;
}

const translations: Record<string, ShareInvitationSimpleTranslations> = {
  en: {
    subject: 'Project Shared',
    greeting: 'Hello!',
    shared: 'shared a project with you',
    project: 'Project',
    clickHere: 'Accept invitation',
    orCopy: 'Or copy this link',
    expires: 'Expires',
    footer: 'SpheroSeg',
  },
  cs: {
    subject: 'Sdílený projekt',
    greeting: 'Dobrý den!',
    shared: 's vámi sdílel projekt',
    project: 'Projekt',
    clickHere: 'Přijmout pozvánku',
    orCopy: 'Nebo zkopírujte odkaz',
    expires: 'Platnost',
    footer: 'SpheroSeg',
  },
  es: {
    subject: 'Proyecto compartido',
    greeting: '¡Hola!',
    shared: 'compartió un proyecto contigo',
    project: 'Proyecto',
    clickHere: 'Aceptar invitación',
    orCopy: 'O copia el enlace',
    expires: 'Expira',
    footer: 'SpheroSeg',
  },
  de: {
    subject: 'Projekt geteilt',
    greeting: 'Hallo!',
    shared: 'hat ein Projekt mit Ihnen geteilt',
    project: 'Projekt',
    clickHere: 'Einladung annehmen',
    orCopy: 'Oder kopieren Sie den Link',
    expires: 'Gültig bis',
    footer: 'SpheroSeg',
  },
  fr: {
    subject: 'Projet partagé',
    greeting: 'Bonjour !',
    shared: 'a partagé un projet avec vous',
    project: 'Projet',
    clickHere: 'Accepter l\'invitation',
    orCopy: 'Ou copiez le lien',
    expires: 'Expire',
    footer: 'SpheroSeg',
  },
  zh: {
    subject: '项目已共享',
    greeting: '您好！',
    shared: '与您共享了一个项目',
    project: '项目',
    clickHere: '接受邀请',
    orCopy: '或复制链接',
    expires: '有效期至',
    footer: 'SpheroSeg',
  },
};

/**
 * Format date in short format
 */
function formatDateShort(date: Date, locale: string): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
}

/**
 * Generate ultra-simple HTML email (under 1000 chars)
 * NO fancy styling, NO CSS, just basic HTML
 */
export function generateShareInvitationSimpleHTML(
  data: ShareInvitationSimpleData
): string {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  const safeProjectTitle = escapeHtml(data.projectTitle);
  const safeEmail = escapeHtml(data.sharedByEmail);
  const safeUrl = sanitizeUrl(data.acceptUrl);
  const formattedExpiry = formatDateShort(data.expiresAt, locale);

  // Ultra-minimal HTML - NO styles, NO fancy divs
  return `<html>
<body>
<h2>${t.greeting}</h2>
<p>${safeEmail} ${t.shared}:</p>
<p><b>${t.project}: ${safeProjectTitle}</b></p>
<p><a href="${safeUrl}">${t.clickHere}</a></p>
<p>${t.orCopy}:<br>${safeUrl}</p>
<p><b>${t.expires}: ${formattedExpiry}</b></p>
<p>---<br>${t.footer}</p>
</body>
</html>`;
}

/**
 * Generate plain text email (under 500 chars)
 */
export function generateShareInvitationSimpleText(
  data: ShareInvitationSimpleData
): string {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;
  const formattedExpiry = formatDateShort(data.expiresAt, locale);

  return `${t.greeting}

${data.sharedByEmail} ${t.shared}:

${t.project}: ${data.projectTitle}

${t.clickHere}:
${data.acceptUrl}

${t.expires}: ${formattedExpiry}

---
${t.footer}`;
}

/**
 * Get email subject
 */
export function getShareInvitationSimpleSubject(
  projectTitle: string,
  locale?: string
): string {
  const t = translations[locale || 'en'] || translations.en;
  return `${t.subject}: ${projectTitle}`;
}
