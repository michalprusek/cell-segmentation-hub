import React from 'react';

const CanvasSvgFilters = () => {
  return (
    <defs>
      <filter id="point-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0" stdDeviation="1" floodOpacity="0.5" />
      </filter>

      <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <filter id="red-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feFlood floodColor="#ea384c" floodOpacity="0.3" result="flood" />
        <feComposite
          in="flood"
          in2="SourceGraphic"
          operator="in"
          result="mask"
        />
        <feGaussianBlur in="mask" stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <filter id="blue-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feFlood floodColor="#0EA5E9" floodOpacity="0.3" result="flood" />
        <feComposite
          in="flood"
          in2="SourceGraphic"
          operator="in"
          result="mask"
        />
        <feGaussianBlur in="mask" stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <filter id="point-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
  );
};

export default CanvasSvgFilters;
