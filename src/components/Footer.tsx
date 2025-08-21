import React from 'react';
import { Link } from 'react-router-dom';
import { Microscope } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-md bg-blue-500 flex items-center justify-center">
                <Microscope className="text-white w-6 h-6" />
              </div>
              <span className="font-semibold text-lg">
                {t('footer.appName')}
              </span>
            </Link>
            <p className="text-gray-600 mb-6 max-w-md">
              {t('footer.description')}
            </p>
            <div className="space-y-2">
              <p className="text-gray-600">
                <strong>{t('footer.contact')}:</strong>{' '}
                <a
                  href="mailto:spheroseg@utia.cas.cz"
                  className="text-blue-600 hover:underline"
                >
                  spheroseg@utia.cas.cz
                </a>
              </p>
              <p className="text-gray-600">
                <strong>{t('footer.institution')}:</strong>{' '}
                <a
                  href="https://www.utia.cas.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {t('footer.institutionName')}
                </a>
              </p>
              <p className="text-gray-600">
                <strong>{t('footer.address')}:</strong>{' '}
                <a
                  href="https://maps.google.com/?q=Pod+Vod%C3%A1renskou+v%C4%9B%C5%BE%C3%AD+4%2C+182+08+Praha+8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {t('footer.addressText')}
                </a>
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4">
              {t('footer.resources')}
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/documentation"
                  className="text-base text-gray-600 hover:text-blue-600 transition-colors"
                  onClick={() =>
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                >
                  {t('footer.documentation')}
                </Link>
              </li>
              <li>
                <a
                  href="#features"
                  className="text-base text-gray-600 hover:text-blue-600 transition-colors"
                >
                  {t('footer.features')}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4">
              {t('footer.legal')}
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/terms-of-service"
                  className="text-base text-gray-600 hover:text-blue-600 transition-colors"
                  onClick={() =>
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                >
                  {t('footer.termsOfService')}
                </Link>
              </li>
              <li>
                <Link
                  to="/privacy-policy"
                  className="text-base text-gray-600 hover:text-blue-600 transition-colors"
                  onClick={() =>
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                >
                  {t('footer.privacyPolicy')}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:spheroseg@utia.cas.cz"
                  className="text-base text-gray-600 hover:text-blue-600 transition-colors"
                >
                  {t('footer.contactUs')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-gray-500 text-center">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
