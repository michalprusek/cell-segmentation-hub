import React, { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface EditorLayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * Modernizovaný grid layout pro editor segmentace
 * - Header nahoře
 * - Grid pro toolbar (vlevo) + canvas (střed) + panel polygonů (vpravo)
 * - StatusBar dole
 */
const EditorLayout = ({ children, className = '' }: EditorLayoutProps) => {
  return (
    <motion.div
      className={`h-screen w-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900 text-foreground ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
};

export default EditorLayout;
