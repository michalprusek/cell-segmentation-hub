import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

const PrivacyPolicy = () => {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1 mt-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              {t('legal.privacy.title')}
            </h1>
            <p className="text-lg text-gray-600">
              {t('legal.privacy.lastUpdated')}
            </p>
          </div>

          <div className="prose prose-lg prose-blue max-w-none">
            <div className="bg-blue-50 p-6 rounded-lg mb-8">
              <p className="text-blue-800 font-medium mb-0">
                {t('legal.privacy.disclaimer')}
              </p>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.introduction.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.introduction.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.informationCollected.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.informationCollected.content')}
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">
              {t(
                'legal.privacy.sections.informationCollected.personalInfo.title'
              )}
            </h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t(
                'legal.privacy.sections.informationCollected.personalInfo.items'
              ).map((item: string, index: number) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">
              {t(
                'legal.privacy.sections.informationCollected.researchData.title'
              )}
            </h3>
            <div className="bg-green-50 border-l-4 border-green-400 p-6 mb-6">
              <p className="text-green-800 font-semibold mb-2">
                {t(
                  'legal.privacy.sections.informationCollected.researchData.ownershipTitle'
                )}
              </p>
              <p className="text-green-700 mb-0">
                {t(
                  'legal.privacy.sections.informationCollected.researchData.ownershipContent'
                )}
              </p>
            </div>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t(
                'legal.privacy.sections.informationCollected.researchData.items'
              ).map((item: string, index: number) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">
              {t('legal.privacy.sections.informationCollected.usageInfo.title')}
            </h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t(
                'legal.privacy.sections.informationCollected.usageInfo.items'
              ).map((item: string, index: number) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.mlTraining.title')}
            </h2>
            <div className="bg-amber-50 border-l-4 border-amber-400 p-6 mb-6">
              <p className="text-amber-800 font-semibold mb-2">
                {t('legal.privacy.sections.mlTraining.importantTitle')}
              </p>
              <p className="text-amber-700 mb-4">
                {t('legal.privacy.sections.mlTraining.importantIntro')}
              </p>
              <p className="text-amber-700 mb-4">
                <strong>
                  {t('legal.privacy.sections.mlTraining.controlTitle')}
                </strong>{' '}
                {t('legal.privacy.sections.mlTraining.controlContent')}
              </p>
              <p className="text-amber-700 mb-0">
                <strong>
                  {t('legal.privacy.sections.mlTraining.manageTitle')}
                </strong>{' '}
                {t('legal.privacy.sections.mlTraining.manageContent')}
              </p>
            </div>

            <h3 className="text-xl font-semibold text-gray-900 mt-6 mb-3">
              {t('legal.privacy.sections.mlTraining.howWeUse.title')}
            </h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.mlTraining.howWeUse.items').map(
                (item: string, index: number) => (
                  <li key={index}>{item}</li>
                )
              )}
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mt-6 mb-3">
              {t('legal.privacy.sections.mlTraining.protection.title')}
            </h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.mlTraining.protection.items').map(
                (item: string, index: number) => (
                  <li key={index}>{item}</li>
                )
              )}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.howWeUse.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t('legal.privacy.sections.howWeUse.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.howWeUse.purposes').map(
                (purpose: string, index: number) => (
                  <li key={index}>{purpose}</li>
                )
              )}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.dataSecurity.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t('legal.privacy.sections.dataSecurity.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.dataSecurity.measures').map(
                (measure: string, index: number) => (
                  <li key={index}>{measure}</li>
                )
              )}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.dataSharing.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              <strong>
                {t('legal.privacy.sections.dataSharing.noSaleStatement')}
              </strong>{' '}
              {t('legal.privacy.sections.dataSharing.sharingContent')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.dataSharing.circumstances').map(
                (circumstance: string, index: number) => (
                  <li key={index}>{circumstance}</li>
                )
              )}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.privacyRights.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t('legal.privacy.sections.privacyRights.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.privacyRights.rights').map(
                (right: string, index: number) => (
                  <li key={index}>{right}</li>
                )
              )}
            </ul>

            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.privacyRights.contactNote')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.dataRetention.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.dataRetention.content')}
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              {t('legal.privacy.sections.dataRetention.categories').map(
                (category: string, index: number) => (
                  <li key={index}>{category}</li>
                )
              )}
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.internationalTransfers.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.internationalTransfers.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.childrensPrivacy.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.childrensPrivacy.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.policyChanges.title')}
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              {t('legal.privacy.sections.policyChanges.content')}
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              {t('legal.privacy.sections.contact.title')}
            </h2>
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-gray-700 mb-4">
                <strong>{t('legal.privacy.sections.contact.dpo')}</strong>
              </p>
              <p className="text-gray-700 mb-4">
                <strong>{t('legal.privacy.sections.contact.general')}</strong>
              </p>
              <p className="text-gray-700 mb-0">
                <strong>{t('legal.privacy.sections.contact.postal')}</strong>
                <br />
                {t('legal.privacy.sections.contact.address.line1')}
                <br />
                {t('legal.privacy.sections.contact.address.line2')}
                <br />
                {t('legal.privacy.sections.contact.address.line3')}
                <br />
                {t('legal.privacy.sections.contact.address.line4')}
              </p>
            </div>
          </div>

          <div className="mt-8 flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/">{t('legal.privacy.navigation.backToHome')}</Link>
            </Button>
            <Button asChild>
              <Link to="/terms-of-service">
                {t('legal.privacy.navigation.termsOfService')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
