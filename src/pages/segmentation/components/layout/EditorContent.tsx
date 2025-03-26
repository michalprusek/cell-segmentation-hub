
import React, { ReactNode } from 'react';

interface EditorContentProps {
  children: ReactNode;
}

/**
 * Komponenta obsahující hlavní obsah editoru
 */
const EditorContent = ({ children }: EditorContentProps) => {
  return (
    <div className="flex-1 flex flex-col relative overflow-hidden items-center justify-center p-4">
      {children}
    </div>
  );
};

export default EditorContent;
