
import React from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
          
          <div className="prose prose-blue max-w-none">
            <h2>1. Information We Collect</h2>
            <p>
              SpheroSeg collects information that you provide directly to us, such as when you create 
              an account, upload images, or contact us. This may include your name, email address, 
              institution name, and the images you upload for segmentation.
            </p>
            
            <h2>2. How We Use Your Information</h2>
            <p>
              We use the information we collect to provide, maintain, and improve our services,
              to develop new features, and to protect SpheroSeg and our users.
            </p>
            
            <h2>3. Data Security</h2>
            <p>
              We implement reasonable security measures to protect your personal information from 
              unauthorized access, alteration, disclosure, or destruction.
            </p>
            
            <h2>4. Data Retention</h2>
            <p>
              We retain your personal information for as long as necessary to fulfill the purposes 
              outlined in this Privacy Policy, unless a longer retention period is required or permitted 
              by law.
            </p>
            
            <h2>5. Your Rights</h2>
            <p>
              Depending on your location, you may have rights regarding your personal information, 
              such as the right to access, correct, or delete your data.
            </p>
            
            <h2>6. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes 
              by posting the new Privacy Policy on this page and updating the "Last Updated" date.
            </p>
            
            <h2>7. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy or our practices, please contact us.
            </p>
          </div>
          
          <div className="mt-8 flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/terms-of-service">Terms of Service</Link>
            </Button>
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
