import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from 'react-router-dom';
import {
  FileText,
  Code,
  Info,
  BookOpen,
  Microscope,
  ArrowRight,
} from 'lucide-react';

const Documentation = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-16">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <div className="inline-block bg-blue-100 px-4 py-2 rounded-full mb-4">
              <span className="text-sm font-medium text-blue-700">
                Documentation
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              SpheroSeg Documentation
            </h1>
            <p className="text-xl text-gray-600">
              Comprehensive guide to using our spheroid segmentation platform
            </p>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
            {/* Sidebar */}
            <aside className="lg:col-span-1">
              <div className="sticky top-24 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-lg mb-4">Navigation</h3>
                <nav className="space-y-2">
                  <a
                    href="#introduction"
                    className="flex items-center text-blue-600 p-2 rounded-md bg-blue-50"
                  >
                    <Info className="w-4 h-4 mr-2" />
                    Introduction
                  </a>
                  <a
                    href="#getting-started"
                    className="flex items-center text-gray-700 hover:text-blue-600 p-2 rounded-md hover:bg-gray-50"
                  >
                    <BookOpen className="w-4 h-4 mr-2" />
                    Getting Started
                  </a>
                  <a
                    href="#upload-images"
                    className="flex items-center text-gray-700 hover:text-blue-600 p-2 rounded-md hover:bg-gray-50"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Uploading Images
                  </a>
                  <a
                    href="#segmentation"
                    className="flex items-center text-gray-700 hover:text-blue-600 p-2 rounded-md hover:bg-gray-50"
                  >
                    <Microscope className="w-4 h-4 mr-2" />
                    Segmentation Process
                  </a>
                  <a
                    href="#api"
                    className="flex items-center text-gray-700 hover:text-blue-600 p-2 rounded-md hover:bg-gray-50"
                  >
                    <Code className="w-4 h-4 mr-2" />
                    API Reference
                  </a>
                </nav>
              </div>
            </aside>

            {/* Documentation Content */}
            <div className="lg:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 p-6 md:p-8">
              <div className="prose max-w-none">
                <section id="introduction" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Introduction
                  </h2>
                  <div className="glass-morphism rounded-xl overflow-hidden p-6 mb-6 bg-gradient-to-r from-blue-50 to-purple-50">
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                      <div className="md:w-1/3">
                        <img
                          src="/lovable-uploads/8f483962-36d5-4bae-8c90-c9542f8cc2d8.png"
                          alt="Segmented spheroid example"
                          className="rounded-lg shadow-md w-full"
                        />
                      </div>
                      <div className="md:w-2/3">
                        <h3 className="text-xl font-semibold mb-2">
                          What is SpheroSeg?
                        </h3>
                        <p className="text-gray-700">
                          SpheroSeg is an advanced platform designed
                          specifically for the segmentation and analysis of
                          cellular spheroids in microscopic images. Our tool
                          combines cutting-edge AI algorithms with an intuitive
                          interface to provide researchers with precise spheroid
                          boundary detection and analysis capabilities.
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="mb-4">
                    This platform was developed by Bc. Michal Průšek, a student
                    at the Faculty of Nuclear Sciences and Physical Engineering
                    at Czech Technical University in Prague, under the
                    supervision of Ing. Adam Novozámský, Ph.D. The project is a
                    collaboration with researchers from the Institute of
                    Biochemistry and Microbiology at UCT Prague.
                  </p>

                  <p className="mb-4">
                    SpheroSeg addresses the challenging task of accurately
                    identifying and segmenting spheroid boundaries in
                    microscopic images, a critical step in many biomedical
                    research workflows involving 3D cell culture models.
                  </p>
                </section>

                <section id="getting-started" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Getting Started
                  </h2>

                  <h3 className="text-xl font-semibold mb-3">
                    Account Creation
                  </h3>
                  <p className="mb-4">
                    To use SpheroSeg, you'll need to create an account. This
                    allows us to store your projects and images securely.
                  </p>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>
                      Navigate to the{' '}
                      <Link
                        to="/sign-up"
                        className="text-blue-600 hover:underline"
                      >
                        sign-up page
                      </Link>
                    </li>
                    <li>
                      Enter your institutional email address and create a
                      password
                    </li>
                    <li>
                      Complete your profile with your name and institution
                    </li>
                    <li>
                      Verify your email address through the link sent to your
                      inbox
                    </li>
                  </ol>

                  <h3 className="text-xl font-semibold mb-3">
                    Creating Your First Project
                  </h3>
                  <p className="mb-4">
                    Projects help you organize your work. Each project can
                    contain multiple images and their corresponding segmentation
                    results.
                  </p>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>From your dashboard, click "New Project"</li>
                    <li>Enter a project name and description</li>
                    <li>
                      Select the project type (default: Spheroid Analysis)
                    </li>
                    <li>Click "Create Project" to proceed</li>
                  </ol>
                </section>

                <section id="upload-images" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Uploading Images
                  </h2>

                  <p className="mb-4">
                    SpheroSeg supports various image formats commonly used in
                    microscopy, including TIFF, PNG, and JPEG.
                  </p>

                  <h3 className="text-xl font-semibold mb-3">Upload Methods</h3>
                  <p className="mb-4">
                    There are multiple ways to upload your images:
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>Drag and drop files directly onto the upload area</li>
                    <li>
                      Click the upload area to browse and select files from your
                      computer
                    </li>
                    <li>Batch upload multiple images at once</li>
                  </ul>

                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg
                          className="h-5 w-5 text-yellow-400"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-yellow-700">
                          <strong>Note:</strong> For optimal results, ensure
                          your microscopic images have good contrast between the
                          spheroid and background.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="segmentation" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Segmentation Process
                  </h2>

                  <p className="mb-4">
                    The segmentation process identifies the boundaries of
                    spheroids in your images, allowing for precise analysis of
                    their morphology.
                  </p>

                  <h3 className="text-xl font-semibold mb-3">
                    Automatic Segmentation
                  </h3>
                  <p className="mb-4">
                    Our AI-powered automatic segmentation can detect spheroid
                    boundaries with high precision:
                  </p>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Select an image from your project</li>
                    <li>Click "Auto-Segment" to start the process</li>
                    <li>
                      The system will process the image and display the detected
                      boundaries
                    </li>
                    <li>Review the results in the segmentation editor</li>
                  </ol>

                  <h3 className="text-xl font-semibold mb-3">Manual Editing</h3>
                  <p className="mb-4">
                    Sometimes the automatic segmentation may need refinement.
                    Our editor provides tools to:
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>Add or remove vertices along the boundary</li>
                    <li>Adjust vertex positions for more precise boundaries</li>
                    <li>Split or merge regions</li>
                    <li>Add or remove holes within spheroids</li>
                  </ul>
                </section>

                <section id="api" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    API Reference
                  </h2>

                  <p className="mb-4">
                    SpheroSeg offers a RESTful API for programmatic access to
                    the platform's capabilities. This is ideal for integrating
                    with your existing workflows or batch processing.
                  </p>

                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="font-mono text-sm mb-2">
                      GET /api/v1/projects
                    </p>
                    <p className="text-gray-700 text-sm">
                      Retrieves a list of all your projects
                    </p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="font-mono text-sm mb-2">
                      GET /api/v1/projects/:id/images
                    </p>
                    <p className="text-gray-700 text-sm">
                      Retrieves all images within a specific project
                    </p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="font-mono text-sm mb-2">
                      POST /api/v1/images/:id/segment
                    </p>
                    <p className="text-gray-700 text-sm">
                      Triggers segmentation for a specific image
                    </p>
                  </div>

                  <p className="mb-4">
                    For full API documentation and authentication details,
                    please contact us at{' '}
                    <a
                      href="mailto:prusemic@cvut.cz"
                      className="text-blue-600 hover:underline"
                    >
                      prusemic@cvut.cz
                    </a>
                    .
                  </p>
                </section>

                <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-200">
                  <Link
                    to="/"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    <ArrowRight className="w-4 h-4 mr-2 transform rotate-180" />
                    Back to Home
                  </Link>
                  <a
                    href="#introduction"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    Back to Top
                    <ArrowRight className="w-4 h-4 ml-2 transform -rotate-90" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Documentation;
