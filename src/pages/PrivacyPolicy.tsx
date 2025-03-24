
import React from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1 mt-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
          
          <div className="prose prose-blue max-w-none">
            <h2 className="text-2xl font-bold mt-6 mb-4">1. Introduction</h2>
            <p className="mb-4">
              This Privacy Policy explains how SpheroSeg ("we", "us", "our") collects, uses, and shares
              your information when you use our platform for spheroid segmentation and analysis.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">2. Information We Collect</h2>
            <p className="mb-4">
              We collect information you provide directly to us when you create an account, upload images,
              create projects, and otherwise interact with our services.
            </p>
            
            <h3 className="text-xl font-semibold mt-4 mb-3">2.1 Personal Information</h3>
            <p className="mb-4">
              This includes your name, email address, institution/organization, and other information
              you provide when setting up your account or requesting access to our services.
            </p>
            
            <h3 className="text-xl font-semibold mt-4 mb-3">2.2 Research Data</h3>
            <p className="mb-4">
              This includes images you upload, project details, analysis results, and other research
              related data you create or upload to our platform.
            </p>
            
            <h3 className="text-xl font-semibold mt-4 mb-3">2.3 Usage Information</h3>
            <p className="mb-4">
              We collect information about how you use our platform, including log data, device information,
              and usage patterns.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">3. How We Use Your Information</h2>
            <p className="mb-4">
              We use the information we collect to provide, maintain, and improve our services,
              to communicate with you, and to comply with our legal obligations.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">4. Data Security</h2>
            <p className="mb-4">
              We implement appropriate security measures to protect your personal information and
              research data from unauthorized access, alteration, disclosure, or destruction.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">5. Data Sharing</h2>
            <p className="mb-4">
              We do not sell your personal information or research data. We may share your information
              in limited circumstances, such as with your consent, to comply with legal obligations,
              or with service providers who help us operate our platform.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">6. Your Choices</h2>
            <p className="mb-4">
              You can access, update, or delete your account information and research data through
              your account settings. You can also contact us to request access to, correction of,
              or deletion of any personal information we have about you.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">7. Changes to This Policy</h2>
            <p className="mb-4">
              We may update this Privacy Policy from time to time. We will notify you of any changes
              by posting the new Privacy Policy on this page and updating the "Last Updated" date.
            </p>
            
            <h2 className="text-2xl font-bold mt-6 mb-4">8. Contact Us</h2>
            <p className="mb-4">
              If you have any questions about this Privacy Policy, please contact us at
              privacy@spheroseg.com.
            </p>
            
            <p className="text-sm text-gray-500 mt-8 mb-4">Last Updated: July 1, 2023</p>
          </div>
          
          <div className="mt-8 flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/">Back to Home</Link>
            </Button>
            <Button asChild>
              <Link to="/terms-of-service">Terms of Service</Link>
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
