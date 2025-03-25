
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X, Microscope } from "lucide-react";

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 w-full z-50 transition-all duration-300 ${
        isScrolled
          ? "py-3 bg-white/80 backdrop-blur-md shadow-sm"
          : "py-5 bg-transparent"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
        <Link 
          to="/"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <div className="w-10 h-10 rounded-md bg-blue-500 flex items-center justify-center">
            <Microscope className="text-white w-6 h-6" />
          </div>
          <span className="font-semibold text-lg">SpheroSeg</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link 
            to="/"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Home
          </Link>
          <Link 
            to="/#features"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Features
          </Link>
          <Link 
            to="/documentation"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Documentation
          </Link>
          <Link 
            to="/terms-of-service"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Terms
          </Link>
          <Link 
            to="/privacy-policy"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Privacy
          </Link>
          <Link 
            to="/sign-in"
            className="text-sm text-gray-700 hover:text-blue-500 transition-colors"
          >
            Login
          </Link>
          <Button asChild size="sm" className="rounded-md">
            <Link to="/request-access">Request Access</Link>
          </Button>
        </nav>

        {/* Mobile Menu Button */}
        <button 
          className="md:hidden text-gray-700"
          onClick={toggleMobileMenu}
          aria-label="Toggle menu"
        >
          {isMobileMenuOpen ? (
            <X size={24} className="animate-fade-in" />
          ) : (
            <Menu size={24} className="animate-fade-in" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md shadow-lg animate-fade-in">
          <div className="container mx-auto px-4 py-6 flex flex-col space-y-4">
            <Link 
              to="/"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Home
            </Link>
            <Link 
              to="/#features"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link 
              to="/documentation"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Documentation
            </Link>
            <Link 
              to="/terms-of-service"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Terms of Service
            </Link>
            <Link 
              to="/privacy-policy"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Privacy Policy
            </Link>
            <Link 
              to="/sign-in"
              className="text-gray-700 hover:text-blue-500 py-2 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Login
            </Link>
            <Button asChild className="w-full rounded-md">
              <Link to="/request-access" onClick={() => setIsMobileMenuOpen(false)}>
                Request Access
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
