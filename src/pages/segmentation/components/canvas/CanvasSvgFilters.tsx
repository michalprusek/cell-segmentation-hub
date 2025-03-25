
import React from 'react';

const CanvasSvgFilters = () => {
  return (
    <defs>
      {/* Filter pro obrysy vybraného polygonu */}
      <filter
        id="filter-selected"
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="2" />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 1   0 0 0 0 0.3   0 0 0 0 0.1  0 0 0 1 0"
        />
      </filter>

      {/* Filter pro zvýraznění při hoveru */}
      <filter
        id="hover-glow"
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feFlood floodColor="#FFFFFF" result="color" />
        <feComposite operator="in" in="color" in2="blur" result="glow" />
        <feComposite operator="over" in="SourceGraphic" in2="glow" />
      </filter>

      {/* Filter pro stín vertexů */}
      <filter id="point-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0" stdDeviation="1" floodColor="#000000" floodOpacity="0.5" />
      </filter>

      {/* Filter pro zvýraznění bodů */}
      <filter id="point-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feFlood floodColor="#FFFFFF" floodOpacity="0.7" result="glow-color" />
        <feComposite operator="in" in="glow-color" in2="blur" result="glow" />
        <feComposite operator="over" in="SourceGraphic" in2="glow" />
      </filter>

      {/* Filter pro zvýraznění čar */}
      <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feFlood floodColor="#FFFFFF" floodOpacity="0.5" result="glow-color" />
        <feComposite operator="in" in="glow-color" in2="blur" result="glow" />
        <feComposite operator="over" in="SourceGraphic" in2="glow" />
      </filter>

      {/* Filter pro zvýraznění okrajů */}
      <filter id="border-glow" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feFlood floodColor="#FFFFFF" floodOpacity="0.3" result="glow-color" />
        <feComposite operator="in" in="glow-color" in2="blur" result="glow" />
        <feComposite operator="over" in="SourceGraphic" in2="glow" />
      </filter>
    </defs>
  );
};

export default CanvasSvgFilters;
