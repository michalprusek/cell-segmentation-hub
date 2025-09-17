/**
 * PLAIN TEXT ONLY template for project share invitations
 * - NO HTML at all
 * - Minimal text with just the link
 * - Multi-language support
 */

export interface ShareInvitationData {
  projectUrl: string;
  projectName: string;
  senderName: string;
  recipientEmail: string;
  locale?: string;
}

interface ShareTranslations {
  subject: string;
  body: string;
}

const translations: Record<string, ShareTranslations> = {
  en: {
    subject: 'Shared Project - SpheroSeg',
    body: 'has shared a project with you'
  },
  cs: {
    subject: 'Sdílený projekt - SpheroSeg',
    body: 's vámi sdílel projekt'
  },
  es: {
    subject: 'Proyecto compartido - SpheroSeg',
    body: 'ha compartido un proyecto contigo'
  },
  de: {
    subject: 'Geteiltes Projekt - SpheroSeg',
    body: 'hat ein Projekt mit Ihnen geteilt'
  },
  fr: {
    subject: 'Projet partagé - SpheroSeg',
    body: 'a partagé un projet avec vous'
  },
  zh: {
    subject: '共享项目 - SpheroSeg',
    body: '与您共享了一个项目'
  }
};

// NOT USED - kept for compatibility
export const generateShareHTML = (data: ShareInvitationData): string => {
  return '';
};

// ULTRA MINIMAL plain text
export const generateShareText = (data: ShareInvitationData): string => {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  return `${data.senderName} ${t.body}: ${data.projectName}

${data.projectUrl}`;
};

export const getShareSubject = (projectName: string, locale?: string): string => {
  const t = translations[locale || 'en'] || translations.en;
  return `${t.subject}: ${projectName}`;
};