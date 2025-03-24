
import React from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";

const TermsOfService = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
          
          <div className="prose prose-blue max-w-none">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using SpheroSeg, you agree to be bound by these Terms of Service
              and all applicable laws and regulations. If you do not agree with any of these terms,
              you are prohibited from using this service.
            </p>
            
            <h2>2. Use License</h2>
            <p>
              Permission is granted to temporarily use SpheroSeg for personal, non-commercial,
              or academic research purposes only. This is the grant of a license, not a transfer of title.
            </p>
            
            <h2>3. Data Usage</h2>
            <p>
              Any data uploaded to SpheroSeg remains your property. We do not claim ownership
              of your content but require certain permissions to provide the service.
            </p>
            
            <h2>4. Limitations</h2>
            <p>
              In no event shall SpheroSeg be liable for any damages arising out of the use
              or inability to use the platform, even if we have been notified of the possibility
              of such damage.
            </p>
            
            <h2>5. Revisions and Errata</h2>
            <p>
              The materials appearing on SpheroSeg could include technical, typographical,
              or photographic errors. We do not warrant that any of the materials are accurate,
              complete, or current.
            </p>
            
            <h2>6. Governing Law</h2>
            <p>
              These terms and conditions are governed by and construed in accordance with the
              laws of the country in which the service is hosted, and you irrevocably submit to
              the exclusive jurisdiction of the courts in that location.
            </p>
          </div>
          
          <div className="mt-8 flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/">Back to Home</Link>
            </Button>
            <Button asChild>
              <Link to="/privacy-policy">Privacy Policy</Link>
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default TermsOfService;
