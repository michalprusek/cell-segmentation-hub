import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, HardDriveDownload } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import SpecimenShowcase from '@/components/landing/SpecimenShowcase';

function Hero() {
  const { t } = useLanguage();

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32">
      {/* A single soft wash behind the type, no further decoration: the
          specimen tray below is the only thing here that should draw the eye. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-gradient-to-b from-blue-50/80 to-transparent dark:from-blue-950/30"
      />

      <div className="container mx-auto px-4">
        <div className="max-w-6xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
            {t('landing.hero.eyebrow')}
          </p>

          <h1 className="mt-5 max-w-4xl text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-gray-900 sm:text-5xl lg:text-6xl dark:text-gray-50">
            {t('landing.hero.title')}
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 dark:text-gray-300">
            {t('landing.hero.subtitle')}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="framed" size="lg" className="rounded-md">
              <Link to="/sign-in">
                {t('landing.hero.getStarted')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-md">
              <a href="#features">{t('landing.hero.learnMore')}</a>
            </Button>
          </div>

          {/* Immediately under the sign-up call to action, because this is the
              moment someone decides whether to put their microscopy here. The
              wording is deliberately specific: the DATABASE is backed up daily
              and restore-verified, the uploaded image FILES are not, and
              "your data is not backed up" would be wrong in one direction
              while "everything is safe" would be wrong in the other. */}
          <p className="mt-6 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            <HardDriveDownload
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
              aria-hidden="true"
            />
            <span>
              <strong className="font-medium text-gray-900 dark:text-gray-100">
                {t('landing.hero.backupNoticeTitle')}
              </strong>{' '}
              {t('landing.hero.backupNotice')}
            </span>
          </p>

          <div className="mt-14">
            <SpecimenShowcase />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
