import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';

const TermsOfService = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1 mt-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Terms of Service
            </h1>
            <p className="text-lg text-gray-600">Last updated: January 2025</p>
          </div>

          <div className="prose prose-lg prose-blue max-w-none">
            <div className="bg-blue-50 p-6 rounded-lg mb-8">
              <p className="text-blue-800 font-medium mb-0">
                By using SpheroSeg, you agree to these terms. Please read them
                carefully.
              </p>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              1. Acceptance of Terms
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              By accessing or using SpheroSeg ("the Service"), you agree to be
              bound by these Terms of Service ("Terms") and all applicable laws
              and regulations. If you do not agree with any of these terms, you
              are prohibited from using this service. These Terms constitute a
              legally binding agreement between you and SpheroSeg.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              2. Use License and Permitted Use
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Permission is granted to use SpheroSeg for:
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Personal, non-commercial research purposes</li>
              <li>Academic and educational research</li>
              <li>Scientific publications and studies</li>
              <li>Biomedical research and analysis</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mb-6">
              This is the grant of a license, not a transfer of title. You may
              not use the service for commercial purposes without explicit
              written consent.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              3. Data Usage and Machine Learning
            </h2>
            <div className="bg-amber-50 border-l-4 border-amber-400 p-6 mb-6">
              <p className="text-amber-800 font-semibold mb-2">
                Important: Use of Your Data
              </p>
              <p className="text-amber-700 mb-0">
                By uploading images and data to SpheroSeg, you consent to us
                using this data to improve and train our machine learning models
                for better segmentation accuracy.
              </p>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">
              <strong>Data ownership:</strong> You retain ownership of all data
              you upload to SpheroSeg. However, by using our service, you grant
              us permission to:
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Process your images for segmentation analysis</li>
              <li>
                Use uploaded data (in anonymized form) to improve our ML
                algorithms
              </li>
              <li>Enhance model accuracy through continuous learning</li>
              <li>Develop new features and segmentation capabilities</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mb-6">
              All data used for ML training is anonymized and stripped of
              identifying information. We do not share your raw data with third
              parties without explicit consent.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              4. User Responsibilities
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">You agree to:</p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Use the service only for lawful purposes</li>
              <li>Respect intellectual property rights</li>
              <li>Not attempt to reverse engineer or compromise the service</li>
              <li>Provide accurate information when creating an account</li>
              <li>Maintain the security of your account credentials</li>
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              5. Service Availability and Limitations
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              While we strive to maintain continuous service availability,
              SpheroSeg is provided "as is" without warranties of any kind. We
              do not guarantee uninterrupted access, and the service may be
              subject to maintenance, updates, or temporary unavailability.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              6. Limitation of Liability
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              In no event shall SpheroSeg, its developers, or affiliates be
              liable for any indirect, incidental, special, consequential, or
              punitive damages, including but not limited to loss of data,
              profits, or business opportunities, arising out of your use of the
              service.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              7. Privacy and Data Protection
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              Your privacy is important to us. Please review our Privacy Policy,
              which governs how we collect, use, and protect your personal
              information and research data.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              8. Changes to Terms
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              We reserve the right to modify these Terms at any time. Changes
              will be effective immediately upon posting. Your continued use of
              the service constitutes acceptance of modified Terms.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              9. Termination
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              Either party may terminate this agreement at any time. Upon
              termination, your right to access the service will cease
              immediately, though these Terms will remain in effect regarding
              prior use.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
              10. Governing Law
            </h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              These Terms are governed by and construed in accordance with
              applicable laws. Any disputes shall be resolved through binding
              arbitration or in courts of competent jurisdiction.
            </p>

            <div className="bg-gray-50 p-6 rounded-lg mt-10">
              <p className="text-gray-600 text-sm mb-2">
                <strong>Contact Information:</strong>
              </p>
              <p className="text-gray-600 text-sm mb-0">
                If you have questions about these Terms, please contact us at
                spheroseg@utia.cas.cz
              </p>
            </div>
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
