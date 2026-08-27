import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  mode?: 'fade' | 'slide' | 'scale';
  duration?: number;
}

const pageVariants = {
  fade: {
    initial: {
      opacity: 0,
    },
    in: {
      opacity: 1,
    },
    out: {
      opacity: 0,
    },
  },
  slide: {
    initial: {
      opacity: 0,
      x: '-10%',
    },
    in: {
      opacity: 1,
      x: 0,
    },
    out: {
      opacity: 0,
      x: '10%',
    },
  },
  scale: {
    initial: {
      opacity: 0,
      scale: 0.95,
    },
    in: {
      opacity: 1,
      scale: 1,
    },
    out: {
      opacity: 0,
      scale: 1.05,
    },
  },
};

// Annotated rather than inferred: framer-motion 12.43 narrowed `Transition`,
// so a bare object literal widens `type` and `ease` to `string` and no longer
// matches the easing/type unions. The return annotation gives the literals a
// contextual type, which is also what keeps a typo in them an error.
const pageTransition = (duration: number): Transition => ({
  type: 'tween',
  ease: 'anticipate',
  duration,
});

export function PageTransition({
  children,
  mode = 'fade',
  duration = 0.3,
}: PageTransitionProps) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial="initial"
        animate="in"
        exit="out"
        variants={pageVariants[mode]}
        transition={pageTransition(duration)}
        className="w-full h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
