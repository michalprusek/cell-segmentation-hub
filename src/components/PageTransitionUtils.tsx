import React from 'react';
import { PageTransition } from './PageTransition';

// HOC for wrapping pages with transitions
export function withPageTransition<P extends object>(
  Component: React.ComponentType<P>,
  mode: 'fade' | 'slide' | 'scale' = 'fade'
) {
  return (props: P) => (
    <PageTransition mode={mode}>
      <Component {...props} />
    </PageTransition>
  );
}
