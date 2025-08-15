
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
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
            <p className="text-lg text-gray-600">Last updated: January 2025</p>
          </div>
          
          <div className="prose prose-lg prose-blue max-w-none">
            <div className="bg-blue-50 p-6 rounded-lg mb-8">
              <p className="text-blue-800 font-medium mb-0">
                Your privacy is important to us. This policy explains how we collect, use, and protect your data.
              </p>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">1. Introduction</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              This Privacy Policy explains how SpheroSeg ("we", "us", "our") collects, uses, protects, and shares
              your information when you use our platform for spheroid segmentation and analysis. By using our
              service, you consent to the data practices described in this policy.
            </p>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">2. Information We Collect</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              We collect information you provide directly to us when you create an account, upload images,
              create projects, and interact with our services.
            </p>
            
            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">2.1 Personal Information</h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Name and email address</li>
              <li>Institution or organization affiliation</li>
              <li>Account credentials and preferences</li>
              <li>Contact information for support requests</li>
            </ul>
            
            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">2.2 Research Data and Images</h3>
            <div className="bg-green-50 border-l-4 border-green-400 p-6 mb-6">
              <p className="text-green-800 font-semibold mb-2">Your Research Data</p>
              <p className="text-green-700 mb-0">
                You retain full ownership of all images and research data you upload to SpheroSeg.
                We never claim ownership of your content.
              </p>
            </div>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Images you upload for analysis</li>
              <li>Project metadata and settings</li>
              <li>Segmentation results and annotations</li>
              <li>Analysis parameters and custom configurations</li>
            </ul>
            
            <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3">2.3 Usage Information</h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Log data and access timestamps</li>
              <li>Device information and browser type</li>
              <li>Usage patterns and feature interactions</li>
              <li>Performance metrics and error reports</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">3. Machine Learning and Data Improvement</h2>
            <div className="bg-amber-50 border-l-4 border-amber-400 p-6 mb-6">
              <p className="text-amber-800 font-semibold mb-2">Important: Use of Your Data for AI Training</p>
              <p className="text-amber-700 mb-4">
                To continuously improve our segmentation algorithms, we may use uploaded images and data
                to train and enhance our machine learning models.
              </p>
              <p className="text-amber-700 mb-4">
                <strong>You have full control over your data:</strong> During account creation, you can choose whether
                to allow your data to be used for ML training. You can change these preferences at any time.
              </p>
              <p className="text-amber-700 mb-0">
                <strong>To manage your consent:</strong> Go to Settings → Privacy tab in your dashboard.
                There you can enable or disable ML training consent and choose specific purposes
                (algorithm improvement, feature development) for which your data may be used.
              </p>
            </div>

            <h3 className="text-xl font-semibold text-gray-900 mt-6 mb-3">How We Use Your Data for ML:</h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li><strong>Model Training:</strong> Images are used to train segmentation algorithms for better accuracy</li>
              <li><strong>Algorithm Enhancement:</strong> Your segmentation corrections help improve automated detection</li>
              <li><strong>Feature Development:</strong> Usage patterns guide development of new analysis tools</li>
              <li><strong>Quality Assurance:</strong> Data helps validate and test new model versions</li>
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mt-6 mb-3">Data Protection in ML Training:</h3>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li><strong>Anonymization:</strong> All data is anonymized before use in ML training</li>
              <li><strong>Metadata Removal:</strong> Personal and institutional identifying information is stripped</li>
              <li><strong>Secure Processing:</strong> Training occurs in secure, isolated environments</li>
              <li><strong>No Raw Distribution:</strong> Your original images are never shared with third parties</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">4. How We Use Your Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">We use collected information to:</p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Provide and maintain segmentation services</li>
              <li>Process your images and generate analysis results</li>
              <li>Improve our algorithms and develop new features</li>
              <li>Communicate with you about your account and updates</li>
              <li>Provide technical support and troubleshooting</li>
              <li>Comply with legal obligations and protect our rights</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">5. Data Security and Protection</h2>
            <p className="text-gray-700 leading-relaxed mb-4">We implement robust security measures including:</p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>Encryption of data in transit and at rest</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Access controls and authentication systems</li>
              <li>Secure backup and disaster recovery procedures</li>
              <li>Employee security training and access limitations</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">6. Data Sharing and Third Parties</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              <strong>We do not sell your personal information or research data.</strong> We may share information only in these limited circumstances:
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li>With your explicit consent</li>
              <li>To comply with legal obligations or court orders</li>
              <li>With trusted service providers who help operate our platform (under strict confidentiality agreements)</li>
              <li>To protect our rights, safety, or property</li>
              <li>In anonymized, aggregated form for research publications (with your consent)</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">7. Your Privacy Rights and Choices</h2>
            <p className="text-gray-700 leading-relaxed mb-4">You have the right to:</p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li><strong>Access:</strong> Request copies of your personal data and research content</li>
              <li><strong>Rectification:</strong> Update or correct inaccurate information</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data</li>
              <li><strong>Portability:</strong> Export your data in a machine-readable format</li>
              <li><strong>Opt-out:</strong> Request exclusion from ML training. Note: This may limit the following features: automated segmentation accuracy, personalized model recommendations, adaptive threshold suggestions, batch processing optimizations, and future AI-powered enhancements. Contact support for specific impacts on your account.</li>
              <li><strong>Restriction:</strong> Limit how we process your information</li>
            </ul>

            <p className="text-gray-700 leading-relaxed mb-6">
              To exercise these rights, contact us at spheroseg@utia.cas.cz. We will respond within 30 days.
            </p>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">8. Data Retention</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              We distinguish between personal data and ML training data:
            </p>
            <ul className="list-disc ml-6 mb-6 text-gray-700">
              <li><strong>Personal/Account Data:</strong> All personal identifiers, profile information, account settings, and transaction history will be permanently deleted within 90 days of account closure.</li>
              <li><strong>Research Data:</strong> Original images and project data linked to your account will be deleted within 90 days of account closure.</li>
              <li><strong>ML Training Data:</strong> Data used for ML training is first anonymized/pseudonymized to remove all personal identifiers. This anonymized data may be retained indefinitely to preserve model improvements, unless you specifically opt out of ML training or request full deletion.</li>
              <li><strong>Opt-out Options:</strong> You can request complete deletion of all data, including anonymized ML training data, by contacting spheroseg@utia.cas.cz. Processing time is typically 30 days.</li>
            </ul>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">9. International Data Transfers</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              Your data may be processed in countries other than your own. We ensure appropriate safeguards
              and protections are in place for international transfers, including standard contractual
              clauses and adequacy decisions.
            </p>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">10. Children's Privacy</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              Our service is intended for researchers and is not directed at children under 16. We do not
              knowingly collect personal information from children under 16. If we discover such collection,
              we will delete the information promptly.
            </p>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">11. Changes to This Policy</h2>
            <p className="text-gray-700 leading-relaxed mb-6">
              We may update this Privacy Policy to reflect changes in our practices or legal requirements.
              We will notify you of material changes via email or prominent notice on our website.
              Continued use constitutes acceptance of updated terms.
            </p>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">12. Contact Information</h2>
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-gray-700 mb-4">
                <strong>Data Protection Officer:</strong> spheroseg@utia.cas.cz
              </p>
              <p className="text-gray-700 mb-4">
                <strong>General Inquiries:</strong> spheroseg@utia.cas.cz
              </p>
              <p className="text-gray-700 mb-0">
                <strong>Postal Address:</strong><br/>
                ÚTIA AV ČR<br/>
                Pod Vodárenskou věží 4<br/>
                182 08 Prague 8<br/>
                Czech Republic
              </p>
            </div>
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
