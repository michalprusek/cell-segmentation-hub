import { useState, useEffect, useCallback } from 'react';

export const useActiveSection = (sectionIds: string[]) => {
  const [activeSection, setActiveSection] = useState<string>(
    sectionIds[0] || ''
  );

  const handleScroll = useCallback(() => {
    // Get all sections
    const sections = sectionIds
      .map(id => document.getElementById(id))
      .filter(section => section !== null);

    if (sections.length === 0) return;

    // Find which section is currently in view
    const scrollTop = window.scrollY + 100; // Add offset for header

    let currentSection = sectionIds[0];

    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      if (section && section.offsetTop <= scrollTop) {
        currentSection = section.id;
        break;
      }
    }

    setActiveSection(currentSection);
  }, [sectionIds]);

  useEffect(() => {
    // Set initial active section
    handleScroll();

    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Cleanup
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const headerOffset = 120; // Account for fixed header
      const elementPosition = element.offsetTop;
      const offsetPosition = elementPosition - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }
  }, []);

  return { activeSection, scrollToSection };
};
