import React, { useEffect, useRef } from 'react';
import {
  Sparkles,
  Microscope,
  Share2,
  LineChart,
  Upload,
  Brain,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}

const FeatureCard = ({ icon, title, description, delay }: FeatureCardProps) => (
  <div
    className="glass-morphism p-6 rounded-xl transition-all duration-300 hover:shadow-glass-lg"
    style={{ transitionDelay: `${delay}ms` }}
  >
    <div className="w-14 h-14 mb-6 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
      {icon}
    </div>
    <h3 className="text-xl font-semibold mb-2">{title}</h3>
    <p className="text-gray-600">{description}</p>
  </div>
);

const Features = () => {
  const { t } = useTranslation();
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          }
        });
      },
      { threshold: 0.1 }
    );

    const currentRef = featuresRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, []);

  const features = [
    {
      icon: <Microscope size={28} />,
      title: t('landing.features.cards.advancedSegmentation.title'),
      description: t('landing.features.cards.advancedSegmentation.description'),
      delay: 100,
    },
    {
      icon: <Brain size={28} />,
      title: t('landing.features.cards.aiPowered.title'),
      description: t('landing.features.cards.aiPowered.description'),
      delay: 200,
    },
    {
      icon: <Upload size={28} />,
      title: t('landing.features.cards.effortlessUploads.title'),
      description: t('landing.features.cards.effortlessUploads.description'),
      delay: 300,
    },
    {
      icon: <LineChart size={28} />,
      title: t('landing.features.cards.statisticalInsights.title'),
      description: t('landing.features.cards.statisticalInsights.description'),
      delay: 400,
    },
    {
      icon: <Share2 size={28} />,
      title: t('landing.features.cards.collaboration.title'),
      description: t('landing.features.cards.collaboration.description'),
      delay: 500,
    },
    {
      icon: <Sparkles size={28} />,
      title: t('landing.features.cards.processingPipeline.title'),
      description: t('landing.features.cards.processingPipeline.description'),
      delay: 600,
    },
  ];

  return (
    <section id="features" className="py-20 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-background to-transparent -z-10"></div>

      <div
        ref={featuresRef}
        className="container mx-auto px-4 staggered-fade-in"
      >
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-block bg-blue-100 px-4 py-2 rounded-full mb-4">
            <span className="text-sm font-medium text-blue-700">
              {t('landing.features.badge')}
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            {t('landing.features.title')}
          </h2>
          <p className="text-lg text-gray-600">
            {t('landing.features.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              delay={feature.delay}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
