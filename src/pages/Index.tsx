import React, { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import Footer from '@/components/Footer';
import { useLanguage } from '@/contexts/LanguageContext';

const Index = () => {
  const { t } = useLanguage();

  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -100px 0px',
    };

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
        }
      });
    }, observerOptions);

    const animatedElements = document.querySelectorAll('.animate-on-scroll');
    animatedElements.forEach(element => {
      observer.observe(element);
    });

    return () => {
      animatedElements.forEach(element => {
        observer.unobserve(element);
      });
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />

        {/* About Section */}
        <section id="about" className="py-20 bg-gray-50">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <div className="inline-block bg-blue-100 px-4 py-2 rounded-full mb-4">
                  <span className="text-sm font-medium text-blue-700">
                    {t('landing.about.badge')}
                  </span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold mb-6">
                  {t('landing.about.title')}
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center animate-on-scroll">
                <div className="glass-morphism rounded-2xl overflow-hidden">
                  <img
                    src="/lovable-uploads/8f483962-36d5-4bae-8c90-c9542f8cc2d8.png"
                    alt="Segmented spheroid"
                    className="w-full h-auto"
                  />
                </div>

                <div className="space-y-6">
                  <p className="text-gray-700 leading-relaxed">
                    {t('landing.about.description1')}
                  </p>
                  <p className="text-gray-700 leading-relaxed">
                    {t('landing.about.description2')}
                  </p>
                  <p className="text-gray-700 leading-relaxed">
                    {t('landing.about.description3')}
                  </p>
                  <p className="text-gray-700 leading-relaxed">
                    {t('landing.about.contactText')}{' '}
                    <a
                      href="mailto:prusemic@cvut.cz"
                      className="text-blue-600 hover:underline"
                    >
                      prusemic@cvut.cz
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 relative overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div
              className="absolute top-1/4 right-1/4 w-64 h-64 bg-blue-200/30 rounded-full filter blur-3xl animate-float"
              style={{ animationDelay: '-3s' }}
            />
            <div
              className="absolute bottom-1/3 left-1/3 w-80 h-80 bg-blue-300/20 rounded-full filter blur-3xl animate-float"
              style={{ animationDelay: '-1s' }}
            />
          </div>

          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center animate-on-scroll">
              <h2 className="text-3xl md:text-4xl font-bold mb-8">
                {t('landing.cta.title')}
              </h2>
              <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
                {t('landing.cta.subtitle')}
              </p>
              <div className="inline-block glass-morphism rounded-xl p-10 shadow-glass-lg">
                <h3 className="text-2xl font-semibold mb-6">
                  {t('landing.cta.cardTitle')}
                </h3>
                <p className="text-gray-600 mb-6">
                  {t('landing.cta.cardDescription')}
                </p>
                <a
                  href="/sign-in"
                  className="inline-block bg-blue-600 hover:bg-blue-700 text-white py-3 px-8 rounded-md font-medium transition-colors"
                >
                  {t('landing.cta.createAccount')}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
