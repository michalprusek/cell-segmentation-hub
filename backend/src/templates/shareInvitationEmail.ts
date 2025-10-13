import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

/**
 * Share Invitation Email Template
 * Multi-language support for project sharing invitations
 * SSOT for share invitation emails
 */

export interface ShareInvitationData {
  projectTitle: string;
  projectDescription?: string;
  sharedByName: string;
  sharedByEmail: string;
  acceptUrl: string;
  expiresAt: Date;
  message?: string;
  locale?: string;
  permissions?: string;
}

interface ShareInvitationTranslations {
  subject: string;
  headerTitle: string;
  headerSubtitle: string;
  greeting: string;
  sharedByText: string;
  projectLabel: string;
  descriptionLabel: string;
  permissionsLabel: string;
  messageLabel: string;
  acceptButton: string;
  linkFallback: string;
  expiryWarning: string;
  validUntil: string;
  footer: string;
  poweredBy: string;
  helpText: string;
}

const translations: Record<string, ShareInvitationTranslations> = {
  en: {
    subject: 'Project Shared With You',
    headerTitle: '🔬 Project Invitation',
    headerSubtitle: 'You\'ve been invited to collaborate',
    greeting: 'Hello!',
    sharedByText: 'shared a project with you',
    projectLabel: 'Project',
    descriptionLabel: 'Description',
    permissionsLabel: 'Your access level',
    messageLabel: 'Personal message',
    acceptButton: 'Accept Invitation & View Project',
    linkFallback: 'Or copy this link',
    expiryWarning: 'This invitation expires on',
    validUntil: 'Valid until',
    footer: 'This invitation was sent from SpheroSeg, the cell segmentation platform.',
    poweredBy: 'SpheroSeg - Advanced Cell Segmentation',
    helpText: 'Need help? Visit our platform or contact support.',
  },
  cs: {
    subject: 'Sdílený projekt',
    headerTitle: '🔬 Pozvánka k projektu',
    headerSubtitle: 'Byli jste pozváni ke spolupráci',
    greeting: 'Dobrý den!',
    sharedByText: 's vámi sdílel projekt',
    projectLabel: 'Projekt',
    descriptionLabel: 'Popis',
    permissionsLabel: 'Vaše úroveň přístupu',
    messageLabel: 'Osobní zpráva',
    acceptButton: 'Přijmout pozvánku a zobrazit projekt',
    linkFallback: 'Nebo zkopírujte tento odkaz',
    expiryWarning: 'Tato pozvánka vyprší',
    validUntil: 'Platná do',
    footer: 'Tato pozvánka byla odeslána ze SpheroSeg, platformy pro segmentaci buněk.',
    poweredBy: 'SpheroSeg - Pokročilá segmentace buněk',
    helpText: 'Potřebujete pomoc? Navštivte naši platformu nebo kontaktujte podporu.',
  },
  es: {
    subject: 'Proyecto compartido contigo',
    headerTitle: '🔬 Invitación al proyecto',
    headerSubtitle: 'Has sido invitado a colaborar',
    greeting: '¡Hola!',
    sharedByText: 'ha compartido un proyecto contigo',
    projectLabel: 'Proyecto',
    descriptionLabel: 'Descripción',
    permissionsLabel: 'Tu nivel de acceso',
    messageLabel: 'Mensaje personal',
    acceptButton: 'Aceptar invitación y ver proyecto',
    linkFallback: 'O copia este enlace',
    expiryWarning: 'Esta invitación expira el',
    validUntil: 'Válido hasta',
    footer: 'Esta invitación fue enviada desde SpheroSeg, la plataforma de segmentación celular.',
    poweredBy: 'SpheroSeg - Segmentación celular avanzada',
    helpText: '¿Necesitas ayuda? Visita nuestra plataforma o contacta con soporte.',
  },
  de: {
    subject: 'Projekt mit Ihnen geteilt',
    headerTitle: '🔬 Projekteinladung',
    headerSubtitle: 'Sie wurden zur Zusammenarbeit eingeladen',
    greeting: 'Hallo!',
    sharedByText: 'hat ein Projekt mit Ihnen geteilt',
    projectLabel: 'Projekt',
    descriptionLabel: 'Beschreibung',
    permissionsLabel: 'Ihre Zugriffsebene',
    messageLabel: 'Persönliche Nachricht',
    acceptButton: 'Einladung annehmen und Projekt ansehen',
    linkFallback: 'Oder kopieren Sie diesen Link',
    expiryWarning: 'Diese Einladung läuft ab am',
    validUntil: 'Gültig bis',
    footer: 'Diese Einladung wurde von SpheroSeg, der Zellsegmentierungsplattform, gesendet.',
    poweredBy: 'SpheroSeg - Fortschrittliche Zellsegmentierung',
    helpText: 'Brauchen Sie Hilfe? Besuchen Sie unsere Plattform oder kontaktieren Sie den Support.',
  },
  fr: {
    subject: 'Projet partagé avec vous',
    headerTitle: '🔬 Invitation au projet',
    headerSubtitle: 'Vous avez été invité à collaborer',
    greeting: 'Bonjour !',
    sharedByText: 'a partagé un projet avec vous',
    projectLabel: 'Projet',
    descriptionLabel: 'Description',
    permissionsLabel: 'Votre niveau d\'accès',
    messageLabel: 'Message personnel',
    acceptButton: 'Accepter l\'invitation et voir le projet',
    linkFallback: 'Ou copiez ce lien',
    expiryWarning: 'Cette invitation expire le',
    validUntil: 'Valable jusqu\'au',
    footer: 'Cette invitation a été envoyée depuis SpheroSeg, la plateforme de segmentation cellulaire.',
    poweredBy: 'SpheroSeg - Segmentation cellulaire avancée',
    helpText: 'Besoin d\'aide ? Visitez notre plateforme ou contactez le support.',
  },
  zh: {
    subject: '项目已与您共享',
    headerTitle: '🔬 项目邀请',
    headerSubtitle: '您已被邀请协作',
    greeting: '您好！',
    sharedByText: '与您共享了一个项目',
    projectLabel: '项目',
    descriptionLabel: '描述',
    permissionsLabel: '您的访问级别',
    messageLabel: '个人消息',
    acceptButton: '接受邀请并查看项目',
    linkFallback: '或复制此链接',
    expiryWarning: '此邀请将于以下日期过期',
    validUntil: '有效期至',
    footer: '此邀请由细胞分割平台 SpheroSeg 发送。',
    poweredBy: 'SpheroSeg - 高级细胞分割',
    helpText: '需要帮助？访问我们的平台或联系支持。',
  },
};

/**
 * Format date based on locale
 */
function formatDate(date: Date, locale: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    // Fallback to en-US if locale is invalid
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}

/**
 * Get permission display text
 */
function getPermissionText(permission: string, locale: string): string {
  const permissionTexts: Record<string, Record<string, string>> = {
    en: { view: 'Viewer', edit: 'Editor', admin: 'Administrator' },
    cs: { view: 'Prohlížeč', edit: 'Editor', admin: 'Administrátor' },
    es: { view: 'Visualizador', edit: 'Editor', admin: 'Administrador' },
    de: { view: 'Betrachter', edit: 'Bearbeiter', admin: 'Administrator' },
    fr: { view: 'Visualiseur', edit: 'Éditeur', admin: 'Administrateur' },
    zh: { view: '查看者', edit: '编辑者', admin: '管理员' },
  };

  return permissionTexts[locale]?.[permission.toLowerCase()] || permission;
}

/**
 * Generate HTML email for share invitation
 */
export function generateShareInvitationHTML(data: ShareInvitationData): string {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;

  const safeProjectTitle = escapeHtml(data.projectTitle);
  const safeSharedByName = escapeHtml(data.sharedByName);
  const safeSharedByEmail = escapeHtml(data.sharedByEmail);
  const safeMessage = data.message ? escapeHtml(data.message) : null;
  const safeAcceptUrl = sanitizeUrl(data.acceptUrl);
  const formattedExpiry = formatDate(data.expiresAt, locale);

  // Get first letter for avatar
  const avatarLetter = safeSharedByName.charAt(0).toUpperCase();

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(t.subject)}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1a202c;
            background-color: #f7fafc;
            margin: 0;
            padding: 0;
        }
        .wrapper {
            background-color: #f7fafc;
            padding: 40px 20px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0 0 8px 0;
            font-size: 28px;
            font-weight: 600;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header p {
            margin: 0;
            opacity: 0.95;
            font-size: 16px;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 18px;
            color: #2d3748;
            margin-bottom: 20px;
            font-weight: 500;
        }
        .shared-by {
            display: flex;
            align-items: center;
            gap: 15px;
            margin: 25px 0;
            padding: 20px;
            background: #f8fafc;
            border-radius: 10px;
            border-left: 4px solid #667eea;
        }
        .avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 20px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .shared-info {
            flex: 1;
        }
        .shared-name {
            font-weight: 600;
            color: #2d3748;
            font-size: 16px;
            margin-bottom: 4px;
        }
        .shared-email {
            color: #718096;
            font-size: 14px;
        }
        .project-card {
            background: linear-gradient(135deg, #667eea08 0%, #764ba208 100%);
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            padding: 25px;
            margin: 25px 0;
        }
        .project-title {
            font-size: 22px;
            font-weight: 600;
            color: #2d3748;
            margin: 0 0 15px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .project-icon {
            font-size: 24px;
        }
        .info-row {
            margin: 12px 0;
            padding: 12px 0;
            border-bottom: 1px solid #e2e8f0;
        }
        .info-row:last-child {
            border-bottom: none;
        }
        .info-label {
            font-weight: 600;
            color: #4a5568;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        .info-value {
            color: #2d3748;
            font-size: 15px;
            line-height: 1.5;
        }
        .permission-badge {
            display: inline-block;
            padding: 6px 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }
        .message-box {
            background: #fef5e7;
            border-left: 4px solid #f39c12;
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
        }
        .message-label {
            font-weight: 600;
            color: #e67e22;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .message-text {
            color: #4a5568;
            font-style: italic;
            line-height: 1.6;
        }
        .button-container {
            text-align: center;
            margin: 35px 0 25px 0;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            padding: 16px 40px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
        }
        .link-fallback {
            text-align: center;
            margin-top: 20px;
            font-size: 14px;
            color: #718096;
        }
        .link-text {
            color: #667eea;
            word-break: break-all;
            display: block;
            margin-top: 8px;
            padding: 10px;
            background: #f8fafc;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
        }
        .expiry-warning {
            background: #fff5f5;
            border: 1px solid #fc8181;
            border-radius: 8px;
            padding: 15px;
            margin: 25px 0;
            text-align: center;
        }
        .expiry-text {
            color: #c53030;
            font-weight: 600;
            font-size: 14px;
        }
        .expiry-date {
            color: #742a2a;
            font-size: 15px;
            margin-top: 5px;
            font-weight: 600;
        }
        .footer {
            background: #f8fafc;
            padding: 30px;
            text-align: center;
            color: #718096;
            font-size: 14px;
            border-top: 1px solid #e2e8f0;
        }
        .footer-logo {
            font-weight: 700;
            font-size: 18px;
            color: #667eea;
            margin-bottom: 10px;
        }
        .footer-text {
            margin: 8px 0;
            line-height: 1.5;
        }
        @media only screen and (max-width: 600px) {
            .wrapper {
                padding: 20px 10px;
            }
            .content {
                padding: 25px 20px;
            }
            .header {
                padding: 30px 20px;
            }
            .header h1 {
                font-size: 24px;
            }
            .button {
                padding: 14px 30px;
                font-size: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                <h1>${escapeHtml(t.headerTitle)}</h1>
                <p>${escapeHtml(t.headerSubtitle)}</p>
            </div>

            <div class="content">
                <p class="greeting">${escapeHtml(t.greeting)}</p>

                <div class="shared-by">
                    <div class="avatar">${avatarLetter}</div>
                    <div class="shared-info">
                        <div class="shared-name">${safeSharedByName}</div>
                        <div class="shared-email">${safeSharedByEmail}</div>
                    </div>
                </div>

                <p style="color: #4a5568; margin: 20px 0;">
                    <strong>${safeSharedByName}</strong> ${escapeHtml(t.sharedByText)}:
                </p>

                <div class="project-card">
                    <div class="project-title">
                        <span class="project-icon">🔬</span>
                        <span>${safeProjectTitle}</span>
                    </div>

                    ${
                      data.projectDescription
                        ? `
                    <div class="info-row">
                        <div class="info-label">${escapeHtml(t.descriptionLabel)}</div>
                        <div class="info-value">${escapeHtml(data.projectDescription)}</div>
                    </div>
                    `
                        : ''
                    }

                    ${
                      data.permissions
                        ? `
                    <div class="info-row">
                        <div class="info-label">${escapeHtml(t.permissionsLabel)}</div>
                        <div class="info-value">
                            <span class="permission-badge">${getPermissionText(data.permissions, locale)}</span>
                        </div>
                    </div>
                    `
                        : ''
                    }
                </div>

                ${
                  safeMessage
                    ? `
                <div class="message-box">
                    <div class="message-label">
                        <span>💬</span>
                        <span>${escapeHtml(t.messageLabel)}</span>
                    </div>
                    <div class="message-text">${safeMessage}</div>
                </div>
                `
                    : ''
                }

                <div class="expiry-warning">
                    <div class="expiry-text">⏰ ${escapeHtml(t.expiryWarning)}</div>
                    <div class="expiry-date">${formattedExpiry}</div>
                </div>

                <div class="button-container">
                    <a href="${safeAcceptUrl}" class="button">
                        ${escapeHtml(t.acceptButton)}
                    </a>
                </div>

                <div class="link-fallback">
                    <div style="margin-bottom: 8px;">${escapeHtml(t.linkFallback)}:</div>
                    <div class="link-text">${safeAcceptUrl}</div>
                </div>
            </div>

            <div class="footer">
                <div class="footer-logo">${escapeHtml(t.poweredBy)}</div>
                <div class="footer-text">${escapeHtml(t.footer)}</div>
                <div class="footer-text" style="margin-top: 15px;">${escapeHtml(t.helpText)}</div>
            </div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate plain text email for share invitation
 */
export function generateShareInvitationText(data: ShareInvitationData): string {
  const locale = data.locale || 'en';
  const t = translations[locale] || translations.en;
  const formattedExpiry = formatDate(data.expiresAt, locale);

  let text = `${t.headerTitle}\n`;
  text += `${'='.repeat(t.headerTitle.length)}\n\n`;
  text += `${t.greeting}\n\n`;
  text += `${data.sharedByName} (${data.sharedByEmail}) ${t.sharedByText}:\n\n`;
  text += `${t.projectLabel}: ${data.projectTitle}\n`;

  if (data.projectDescription) {
    text += `${t.descriptionLabel}: ${data.projectDescription}\n`;
  }

  if (data.permissions) {
    text += `${t.permissionsLabel}: ${getPermissionText(data.permissions, locale)}\n`;
  }

  if (data.message) {
    text += `\n${t.messageLabel}:\n"${data.message}"\n`;
  }

  text += `\n${t.acceptButton}:\n${data.acceptUrl}\n\n`;
  text += `${t.expiryWarning}: ${formattedExpiry}\n\n`;
  text += `---\n${t.footer}\n`;

  return text;
}

/**
 * Get email subject for share invitation
 */
export function getShareInvitationSubject(
  projectTitle: string,
  locale?: string
): string {
  const t = translations[locale || 'en'] || translations.en;
  return `${t.subject}: ${projectTitle} - SpheroSeg`;
}
