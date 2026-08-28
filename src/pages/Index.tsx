import React from 'react';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import Footer from '@/components/Footer';
import { useLanguage } from '@/contexts/useLanguage';

function Index() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />

        {/* About */}
        <section
          id="about"
          className="border-t border-gray-200 py-20 dark:border-gray-800"
        >
          <div className="container mx-auto px-4">
            <div className="grid gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                  {t('landing.about.badge')}
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-gray-900 md:text-4xl dark:text-gray-50">
                  {t('landing.about.title')}
                </h2>
              </div>

              <div className="max-w-2xl space-y-5 text-gray-600 dark:text-gray-300">
                <p className="leading-relaxed">
                  {t('landing.about.description1')}
                </p>
                <p className="leading-relaxed">
                  {t('landing.about.description2')}
                </p>
                <p className="leading-relaxed">
                  {t('landing.about.description3')}
                </p>
                <p className="leading-relaxed">
                  {t('landing.about.contactText')}{' '}
                  <a
                    href="mailto:prusek@utia.cas.cz"
                    className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                  >
                    prusek@utia.cas.cz
                  </a>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Acknowledgments */}
        <section
          id="acknowledgments"
          className="border-t border-gray-200 py-16 dark:border-gray-800"
        >
          <div className="container mx-auto px-4">
            <div className="grid gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                  {t('landing.acknowledgments.badge')}
                </p>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-gray-900 md:text-3xl dark:text-gray-50">
                  {t('landing.acknowledgments.title')}
                </h2>
              </div>

              <div className="max-w-2xl">
                <p className="leading-relaxed text-gray-600 dark:text-gray-300">
                  {t('landing.acknowledgments.lukasIntro')}{' '}
                  <a
                    href="https://veskrna.matfyz.cz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                  >
                    {t('landing.acknowledgments.lukasName')}
                  </a>{' '}
                  {t('landing.acknowledgments.lukasContribution')}
                </p>
                <a
                  href="https://veskrna.matfyz.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block text-sm text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                >
                  {t('landing.acknowledgments.visitPage')} →
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Sign-up */}
        <section className="border-t border-white/10 bg-gray-950 py-20 text-gray-100">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
                {t('landing.cta.title')}
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-gray-400">
                {t('landing.cta.subtitle')}
              </p>
              <a
                href="/sign-in"
                className="mt-8 inline-flex items-center rounded-md bg-blue-600 px-7 py-3 font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
              >
                {t('landing.cta.createAccount')}
              </a>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-gray-400">
                {t('landing.cta.cardDescription')}
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default Index;
