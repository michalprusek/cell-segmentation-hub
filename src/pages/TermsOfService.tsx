import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

const TermsOfService = () => {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1 mt-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              {t('legal.terms.title')}
            </h1>
            <p className="text-lg text-gray-600">
              {t('legal.terms.lastUpdated')}
            </p>
          </div>

          <div className="prose prose-lg prose-blue max-w-none">
            <div className="bg-blue-50 p-6 rounded-lg mb-8">
              <p className="text-blue-800 font-medium mb-0">
                {t('legal.terms.disclaimer')}
              </p>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.acceptance.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.acceptance.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.useLicense.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t('legal.terms.sections.useLicense.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.terms.sections.useLicense.permittedUses').map(
                (use: string, index: number) => (
                  <li key={index}>{use}</li>
                )
              )}
            </ul>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.useLicense.licenseNote')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.dataUsage.title')}
            </h2>
            <div className="bg-amber-50 border-l-4 border-amber-400 p-6 mb-6">
              <p className="text-amber-800 font-semibold mb-2">
                {t('legal.terms.sections.dataUsage.importantTitle')}
              </p>
              <p className="text-amber-700 mb-0">
                {t('legal.terms.sections.dataUsage.importantContent')}
              </p>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">
              <strong>
                {t('legal.terms.sections.dataUsage.ownershipTitle')}
              </strong>{' '}
              {t('legal.terms.sections.dataUsage.ownershipContent')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.terms.sections.dataUsage.permissions').map(
                (permission: string, index: number) => (
                  <li key={index}>{permission}</li>
                )
              )}
            </ul>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.dataUsage.protectionNote')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.userResponsibilities.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t('legal.terms.sections.userResponsibilities.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t(
                'legal.terms.sections.userResponsibilities.responsibilities'
              ).map((responsibility: string, index: number) => (
                <li key={index}>{responsibility}</li>
              ))}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.serviceAvailability.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.serviceAvailability.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.limitationLiability.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.limitationLiability.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.privacy.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.privacy.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.changes.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.changes.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.termination.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.termination.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.terms.sections.governingLaw.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.terms.sections.governingLaw.content')}
            </p>

            <div className="bg-gray-50 p-6 rounded-lg mt-10">
              <p className="text-gray-600 text-sm mb-2">
                <strong>{t('legal.terms.contact.title')}</strong>
              </p>
              <p className="text-gray-600 text-sm mb-0">
                {t('legal.terms.contact.content')}
              </p>
            </div>
          </div>

          <div className="mt-8 flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/">{t('legal.terms.navigation.backToHome')}</Link>
            </Button>
            <Button asChild>
              <Link to="/privacy-policy">
                {t('legal.terms.navigation.privacyPolicy')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default TermsOfService;
