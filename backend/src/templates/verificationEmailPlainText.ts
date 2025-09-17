/**
 * PLAIN TEXT ONLY template for email verification
 * - NO HTML at all
 * - Minimal text with just the link
 * - Multi-language support
 */

export interface VerificationEmailData {
  verificationUrl: string;
  userEmail: string;
  locale?: string;
}

interface VerificationTranslations {
  subject: string;
  body: string;
}

const translations: Record<string, VerificationTranslations> = {
  en: {
    subject: 'Verify Your Email - SpheroSeg',
    body: 'Please verify your email address'
  },
  cs: {
    subject: 'Ověřte svůj e-mail - SpheroSeg',
    body: 'Prosím ověřte svou e-mailovou adresu'
  },
  es: {
    subject: 'Verifica tu correo - SpheroSeg',
    body: 'Por favor verifica tu dirección de correo'
  },
  de: {
    subject: 'E-Mail bestätigen - SpheroSeg',
    body: 'Bitte bestätigen Sie Ihre E-Mail-Adresse'
  },
  fr: {
    subject: 'Vérifiez votre email - SpheroSeg',
    body: 'Veuillez vérifier votre adresse email'
  },
  zh: {
    subject: '验证您的电子邮件 - SpheroSeg',
    body: '请验证您的电子邮件地址'
  }
};

// NOT USED - kept for compatibility
export const generateVerificationHTML = (data: VerificationEmailData): string => {
  return '';
};

// ULTRA MINIMAL plain text
export const generateVerificationText = (data: VerificationEmailData): string => {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  return `${t.body}

${data.verificationUrl}`;
};

export const getVerificationSubject = (locale?: string): string => {
  const t = translations[locale || 'en'] || translations.en;
  return t.subject;
};