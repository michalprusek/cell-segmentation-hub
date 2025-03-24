
import React from 'react';

interface CanvasImageProps {
  src: string;
  alt?: string;
}

const CanvasImage = ({ src, alt = "Source image" }: CanvasImageProps) => {
  return (
    <img 
      src={src} 
      alt={alt}
      className="max-w-none pointer-events-none select-none"
      style={{
        maxWidth: "none",
        display: "block"
      }}
      draggable={false}
    />
  );
};

export default CanvasImage;
