import React from 'react';

interface EditorModeFooterProps {
  mode: 'edit' | 'slice' | 'add';
  text: string;
}

/**
 * Komponenta pro zobrazení informací o aktivním editačním režimu
 */
const EditorModeFooter = ({ mode, text }: EditorModeFooterProps) => {
  const getGradientClass = () => {
    switch (mode) {
      case 'edit':
        return 'bg-gradient-to-r from-orange-600 to-orange-500';
      case 'slice':
        return 'bg-gradient-to-r from-red-600 to-red-500';
      case 'add':
        return 'bg-gradient-to-r from-green-600 to-green-500';
      default:
        return 'bg-gradient-to-r from-blue-600 to-blue-500';
    }
  };

  return (
    <div
      className={`absolute bottom-4 left-4 ${getGradientClass()} text-white px-4 py-2 rounded-md text-sm font-semibold shadow-lg`}
    >
      {text}
    </div>
  );
};

export default EditorModeFooter;
