
import React from 'react';

const CanvasSvgFilters = () => {
  return (
    <defs>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <filter id="hover-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feFlood floodColor="white" floodOpacity="0.5" result="glow" />
        <feComposite in="glow" in2="blur" operator="in" result="colored-blur" />
        <feComposite in="SourceGraphic" in2="colored-blur" operator="over" />
      </filter>
    </defs>
  );
};

export default CanvasSvgFilters;
