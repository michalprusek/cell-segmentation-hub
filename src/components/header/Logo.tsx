import React from 'react';
import { Link } from 'react-router-dom';

const Logo = () => {
  return (
    <Link to="/dashboard" className="flex items-center">
      <img src="/logo.svg" alt="SpheroSeg Logo" className="w-9 h-9" />
      <span className="ml-2 text-xl font-semibold hidden sm:inline-block dark:text-white">
        SpheroSeg
      </span>
    </Link>
  );
};

export default Logo;
