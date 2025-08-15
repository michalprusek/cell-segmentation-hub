
import React from "react";
import { Link } from "react-router-dom";
import { Microscope } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-md bg-blue-500 flex items-center justify-center">
                <Microscope className="text-white w-6 h-6" />
              </div>
              <span className="font-semibold text-lg">SpheroSeg</span>
            </Link>
            <p className="text-gray-600 mb-6 max-w-md">
              Advanced spheroid segmentation and analysis platform for biomedical researchers, providing AI-powered tools for microscopic cell image analysis.
            </p>
            <div className="space-y-2">
              <p className="text-gray-600">
                <strong>Contact:</strong> <a href="mailto:spheroseg@utia.cas.cz" className="text-blue-600 hover:underline">spheroseg@utia.cas.cz</a>
              </p>
              <p className="text-gray-600">
                <strong>Institution:</strong> ÚTIA AV ČR
              </p>
              <p className="text-gray-600">
                <strong>Address:</strong> Pod Vodárenskou věží 4, 182 08 Prague 8
              </p>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4">
              Resources
            </h3>
            <ul className="space-y-3">
              <li>
                <Link to="/documentation" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Documentation
                </Link>
              </li>
              <li>
                <a href="#features" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Features
                </a>
              </li>
              <li>
                <Link to="#" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Tutorials
                </Link>
              </li>
              <li>
                <Link to="#" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Research
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-wider uppercase mb-4">
              Legal
            </h3>
            <ul className="space-y-3">
              <li>
                <Link to="/terms-of-service" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy-policy" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <a href="mailto:spheroseg@utia.cas.cz" className="text-base text-gray-600 hover:text-blue-600 transition-colors">
                  Contact Us
                </a>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-gray-500 text-center">
            &copy; {new Date().getFullYear()} SpheroSeg. Developed at ÚTIA AV ČR (Institute of Information Theory and Automation, Czech Academy of Sciences).
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
