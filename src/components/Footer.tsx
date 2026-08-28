import React from 'react';
import { Link } from 'react-router-dom';
import { Microscope } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-gray-50 border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-12 md:py-16">
        {/* 1 → 4 columns with nothing in between left tablets with a single
            very wide column of short link lists. */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="col-span-1 sm:col-span-2">
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
                  href="mailto:prusek@utia.cas.cz"
                  className="break-all text-blue-600 hover:underline dark:text-blue-400"
                >
                  prusek@utia.cas.cz
                </a>
              </p>
              <p className="text-gray-600">
                <strong>{t('footer.institution')}:</strong>{' '}
                {t('footer.institutionName')}
              </p>
              <p className="text-gray-600">
                <strong>{t('footer.address')}:</strong>{' '}
                {t('footer.addressText')}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4 dark:text-gray-100">
              {t('footer.resources')}
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/documentation"
                  className="text-base text-gray-600 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {t('footer.documentation')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4 dark:text-gray-100">
              {t('footer.legal')}
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/terms-of-service"
                  className="text-base text-gray-600 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {t('footer.termsOfService')}
                </Link>
              </li>
              <li>
                <Link
                  to="/privacy-policy"
                  className="text-base text-gray-600 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {t('footer.privacyPolicy')}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:prusek@utia.cas.cz"
                  className="text-base text-gray-600 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {t('footer.contactUs')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 text-center">
            © {new Date().getFullYear()} SpheroSeg. {t('footer.developedAt')}{' '}
            <a
              href="https://utia.cas.cz/en/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              ÚTIA AV ČR
            </a>
            . {t('footer.designBy')}{' '}
            <a
              href="https://utia.cas.cz/en/people/?pid=3850"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Michal Průšek
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
