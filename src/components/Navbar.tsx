import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useLanguage } from '@/contexts/useLanguage';

const Navbar = () => {
  const { t } = useLanguage();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 w-full z-50 transition-all duration-300 ${
        isScrolled
          ? 'py-3 bg-white/80 backdrop-blur-md shadow-sm'
          : 'py-5 bg-transparent'
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <img src="/logo.svg" alt="SpheroSeg Logo" className="w-10 h-10" />
          <span className="font-semibold text-lg">SpheroSeg</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            to="/documentation"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            {t('common.documentation')}
          </Link>
          <Link
            to="/terms-of-service"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            {t('common.termsOfService')}
          </Link>
          <Link
            to="/privacy-policy"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            {t('common.privacyPolicy')}
          </Link>
          <Link
            to="/sign-in"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            {t('auth.signIn')}
          </Link>
          <div className="flex items-center gap-2 ml-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </nav>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-gray-700"
          onClick={toggleMobileMenu}
          aria-label={t('accessibility.toggleMenu')}
        >
          {isMobileMenuOpen ? (
            <X size={24} className="animate-fade-in" />
          ) : (
            <Menu size={24} className="animate-fade-in" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-lg animate-fade-in">
          <div className="container mx-auto px-4 py-6 flex flex-col space-y-4">
            <Link
              to="/documentation"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('common.documentation')}
            </Link>
            <Link
              to="/terms-of-service"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('common.termsOfService')}
            </Link>
            <Link
              to="/privacy-policy"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('common.privacyPolicy')}
            </Link>
            <div className="flex items-center justify-between py-2 border-t border-gray-200">
              <span className="text-sm text-gray-600">
                {t('common.settings')}
              </span>
              <div className="flex items-center gap-2">
                <LanguageSwitcher />
                <ThemeSwitcher />
              </div>
            </div>
            <Link
              to="/sign-in"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('auth.signIn')}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
