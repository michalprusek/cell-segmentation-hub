
import React from "react";
import { Link } from "react-router-dom";

const Logo = () => {
  return (
    <Link to="/dashboard" className="flex items-center">
      <div className="w-9 h-9 rounded-md bg-blue-500 flex items-center justify-center">
        <span className="text-white font-bold text-lg">S</span>
      </div>
      <span className="ml-2 text-xl font-semibold hidden sm:inline-block dark:text-white">
        SpheroSeg
      </span>
    </Link>
  );
};

export default Logo;
