import React, { ReactNode } from 'react';

interface EditorContentProps {
  children: ReactNode;
}

/**
 * Modernizovaný grid layout pro hlavní obsah editoru
 * Grid: [Toolbar | Canvas | Panel]
 */
const EditorContent = ({ children }: EditorContentProps) => {
  return (
    <div className="flex-1 grid grid-cols-[80px_1fr_320px] overflow-hidden">
      {children}
    </div>
  );
};

export default EditorContent;
