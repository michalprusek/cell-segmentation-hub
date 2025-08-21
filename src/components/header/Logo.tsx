import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

const Logo = () => {
  const { t } = useLanguage();

  return (
    <Link to="/dashboard" className="flex items-center">
      <img src="/logo.svg" alt={t('common.logoAlt')} className="w-9 h-9" />
      <span className="ml-2 text-xl font-semibold hidden sm:inline-block dark:text-white">
        SpheroSeg
      </span>
    </Link>
  );
};

export default Logo;
