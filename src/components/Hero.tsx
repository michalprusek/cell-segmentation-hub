
import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const Hero = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  
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

    if (heroRef.current) {
      observer.observe(heroRef.current);
    }

    return () => {
      if (heroRef.current) {
        observer.unobserve(heroRef.current);
      }
    };
  }, []);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background elements */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-blue-200/30 rounded-full filter blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-blue-300/20 rounded-full filter blur-3xl animate-float" style={{ animationDelay: "-2s" }} />
        <div className="absolute top-2/3 left-1/3 w-40 h-40 bg-blue-400/20 rounded-full filter blur-3xl animate-float" style={{ animationDelay: "-4s" }} />
      </div>
      
      <div ref={heroRef} className="container mx-auto px-4 py-20 staggered-fade-in">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-block glass-morphism px-4 py-2 rounded-full mb-4">
            <span className="text-sm font-medium text-blue-600">Advanced Spheroid Segmentation Platform</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
            AI-powered Cell Analysis for Biomedical Research
          </h1>
          
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Elevate your microscopic cell image analysis with our cutting-edge spheroid segmentation platform. Designed for researchers seeking precision and efficiency.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button asChild size="lg" className="rounded-md text-base px-8 py-6">
              <Link to="/sign-in">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-md text-base px-8 py-6">
              <a href="#features">
                Learn More
              </a>
            </Button>
          </div>
          
          <div className="pt-12 pb-8 max-w-5xl mx-auto">
            <div className="relative glass-morphism rounded-2xl shadow-glass-lg overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10"></div>
              <img 
                src="/placeholder.svg" 
                alt="Spheroid Analysis Dashboard"
                className="w-full h-auto rounded-2xl transform hover:scale-[1.01] transition-transform duration-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
