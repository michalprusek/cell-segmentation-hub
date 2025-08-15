
import React, { useEffect, useRef } from "react";
import { Sparkles, Microscope, Share2, LineChart, Upload, Brain } from "lucide-react";

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
  const featuresRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("active");
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
      title: "Advanced Segmentation",
      description: "Precise spheroid detection with boundary analysis for accurate cell measurements.",
      delay: 100
    },
    {
      icon: <Brain size={28} />,
      title: "AI-Powered Analysis",
      description: "Leverage deep learning algorithms for automated cell detection and classification.",
      delay: 200
    },
    {
      icon: <Upload size={28} />,
      title: "Effortless Uploads",
      description: "Drag and drop your microscopic images for instant processing and analysis.",
      delay: 300
    },
    {
      icon: <LineChart size={28} />,
      title: "Statistical Insights",
      description: "Comprehensive metrics and visualizations to extract meaningful data patterns.",
      delay: 400
    },
    {
      icon: <Share2 size={28} />,
      title: "Collaboration Tools",
      description: "Share projects with colleagues and collaborate in real-time on research findings.",
      delay: 500
    },
    {
      icon: <Sparkles size={28} />,
      title: "Processing Pipeline",
      description: "Automated workflow from preprocessing to final analysis with customizable parameters.",
      delay: 600
    }
  ];

  return (
    <section id="features" className="py-20 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-background to-transparent -z-10"></div>
      
      <div ref={featuresRef} className="container mx-auto px-4 staggered-fade-in">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-block bg-blue-100 px-4 py-2 rounded-full mb-4">
            <span className="text-sm font-medium text-blue-700">Powerful Capabilities</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Advanced Tools for Biomedical Research</h2>
          <p className="text-lg text-gray-600">
            Our platform offers a comprehensive suite of features designed to streamline your spheroid segmentation workflow.
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
