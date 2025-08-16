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
  Download,
  Settings,
  Edit3,
  Cpu,
  Layers,
} from 'lucide-react';
import { useActiveSection } from '@/hooks/useActiveSection';

const Documentation = () => {
  const sectionIds = [
    'introduction',
    'getting-started',
    'upload-images',
    'models-selection',
    'segmentation',
    'segmentation-editor',
    'export-features'
  ];
  
  const { activeSection, scrollToSection } = useActiveSection(sectionIds);

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
                  <button
                    onClick={() => scrollToSection('introduction')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'introduction'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Info className="w-4 h-4 mr-2" />
                    Introduction
                  </button>
                  <button
                    onClick={() => scrollToSection('getting-started')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'getting-started'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <BookOpen className="w-4 h-4 mr-2" />
                    Getting Started
                  </button>
                  <button
                    onClick={() => scrollToSection('upload-images')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'upload-images'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Uploading Images
                  </button>
                  <button
                    onClick={() => scrollToSection('models-selection')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'models-selection'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Cpu className="w-4 h-4 mr-2" />
                    Model Selection
                  </button>
                  <button
                    onClick={() => scrollToSection('segmentation')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'segmentation'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Microscope className="w-4 h-4 mr-2" />
                    Segmentation Process
                  </button>
                  <button
                    onClick={() => scrollToSection('segmentation-editor')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'segmentation-editor'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Edit3 className="w-4 h-4 mr-2" />
                    Segmentation Editor
                  </button>
                  <button
                    onClick={() => scrollToSection('export-features')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'export-features'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Features
                  </button>
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

                <section id="models-selection" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Model Selection
                  </h2>

                  <p className="mb-4">
                    SpheroSeg offers three different AI models optimized for different use cases. 
                    Choose the model that best fits your requirements for speed vs accuracy.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Cpu className="w-5 h-5 text-green-600 mr-2" />
                        <h3 className="font-semibold text-green-800">HRNet (Small)</h3>
                      </div>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>Inference time:</strong> ~3.1 seconds
                      </p>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>Best for:</strong> Real-time processing and quick results
                      </p>
                      <p className="text-sm text-green-700">
                        Fast and efficient model ideal for rapid segmentation when speed is prioritized over maximum accuracy.
                      </p>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Layers className="w-5 h-5 text-blue-600 mr-2" />
                        <h3 className="font-semibold text-blue-800">CBAM-ResUNet (Medium)</h3>
                      </div>
                      <p className="text-sm text-blue-700 mb-2">
                        <strong>Inference time:</strong> ~6.9 seconds
                      </p>
                      <p className="text-sm text-blue-700 mb-2">
                        <strong>Best for:</strong> Balanced speed and accuracy
                      </p>
                      <p className="text-sm text-blue-700">
                        Optimal balance between processing speed and segmentation quality for most use cases.
                      </p>
                    </div>

                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Settings className="w-5 h-5 text-purple-600 mr-2" />
                        <h3 className="font-semibold text-purple-800">MA-ResUNet (Large)</h3>
                      </div>
                      <p className="text-sm text-purple-700 mb-2">
                        <strong>Inference time:</strong> ~18.1 seconds
                      </p>
                      <p className="text-sm text-purple-700 mb-2">
                        <strong>Best for:</strong> Maximum precision
                      </p>
                      <p className="text-sm text-purple-700">
                        Highest accuracy model with attention mechanisms for the most precise spheroid boundary detection.
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">How to Select a Model</h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Open your project and navigate to any image</li>
                    <li>In the project toolbar, find the model selection dropdown</li>
                    <li>Choose from HRNet, CBAM-ResUNet, or MA-ResUNet</li>
                    <li>Adjust the confidence threshold (0.0-1.0) to fine-tune detection sensitivity</li>
                    <li>Your selection is automatically saved for future processing</li>
                  </ol>

                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-blue-700">
                          <strong>Tip:</strong> Start with CBAM-ResUNet for most cases. Use HRNet for rapid prototyping 
                          and MA-ResUNet when you need the highest possible accuracy for research or publication.
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
                    The segmentation process uses advanced AI models to automatically detect spheroid boundaries 
                    in your microscopic images. The system supports both automatic processing and manual refinement.
                  </p>

                  <h3 className="text-xl font-semibold mb-3">Queue-based Processing</h3>
                  <p className="mb-4">
                    SpheroSeg uses a processing queue system to handle multiple segmentation tasks efficiently:
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>Real-time status:</strong> WebSocket notifications provide live updates on processing progress</li>
                    <li><strong>Batch processing:</strong> Process multiple images simultaneously</li>
                    <li><strong>Priority handling:</strong> More recent requests are processed first</li>
                    <li><strong>Error recovery:</strong> Failed jobs are automatically retried with detailed error reporting</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">Automatic Segmentation Workflow</h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Upload your microscopic images to a project</li>
                    <li>Select your preferred AI model (HRNet, CBAM-ResUNet, or MA-ResUNet)</li>
                    <li>Adjust the confidence threshold if needed (default: 0.5)</li>
                    <li>Click "Auto-Segment" or use batch processing for multiple images</li>
                    <li>Monitor real-time progress through the status indicators</li>
                    <li>Review results in the segmentation editor once processing completes</li>
                  </ol>

                  <h3 className="text-xl font-semibold mb-3">Polygon Types</h3>
                  <p className="mb-4">The system detects two types of polygons:</p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>External polygons:</strong> Main spheroid boundaries (shown in green by default)</li>
                    <li><strong>Internal polygons:</strong> Holes or internal structures within spheroids (shown in red by default)</li>
                  </ul>

                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-yellow-700">
                          <strong>Processing times vary by model:</strong> HRNet (~3s), CBAM-ResUNet (~7s), MA-ResUNet (~18s). 
                          Choose based on your accuracy requirements and time constraints.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="segmentation-editor" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Segmentation Editor
                  </h2>

                  <p className="mb-4">
                    The segmentation editor is a powerful tool for refining AI-generated segmentations 
                    and creating manual annotations. It features multiple editing modes, keyboard shortcuts, 
                    and advanced polygon manipulation tools.
                  </p>

                  <h3 className="text-xl font-semibold mb-3">Editing Modes</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-gray-50 border rounded-lg p-4">
                      <h4 className="font-semibold text-gray-800 mb-2">View Mode</h4>
                      <p className="text-sm text-gray-600">
                        Navigate and inspect polygons without making changes. 
                        Click polygons to select them and view details.
                      </p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-800 mb-2">Edit Vertices</h4>
                      <p className="text-sm text-blue-600">
                        Drag individual vertices to refine polygon boundaries. 
                        Precise control for boundary adjustments.
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-800 mb-2">Add Points</h4>
                      <p className="text-sm text-green-600">
                        Insert new vertices between existing ones. 
                        Shift+click for automatic point placement.
                      </p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-800 mb-2">Create Polygon</h4>
                      <p className="text-sm text-purple-600">
                        Draw new polygons from scratch. 
                        Click to add points, double-click to complete.
                      </p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h4 className="font-semibold text-orange-800 mb-2">Slice Mode</h4>
                      <p className="text-sm text-orange-600">
                        Cut polygons into multiple parts by drawing 
                        lines through them.
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <h4 className="font-semibold text-red-800 mb-2">Delete Polygon</h4>
                      <p className="text-sm text-red-600">
                        Remove unwanted polygons by clicking on them. 
                        Useful for eliminating false detections.
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">Key Features</h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>Undo/Redo System:</strong> Full history tracking with Ctrl+Z/Ctrl+Y support</li>
                    <li><strong>Auto-save:</strong> Periodic saving with visual indicators showing unsaved changes</li>
                    <li><strong>Zoom & Pan:</strong> Mouse wheel zooming and drag-to-pan navigation</li>
                    <li><strong>Polygon Management:</strong> Show/hide, rename, and batch operations</li>
                    <li><strong>Keyboard Shortcuts:</strong> Comprehensive hotkeys for efficient editing</li>
                    <li><strong>Real-time Feedback:</strong> Live preview of edits and status updates</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">Essential Keyboard Shortcuts</h3>
                  <div className="bg-gray-50 border rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium mb-1">Navigation:</p>
                        <ul className="space-y-1">
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">V</kbd> - View mode</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">E</kbd> - Edit vertices</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">A</kbd> - Add points</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">N</kbd> - Create polygon</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Actions:</p>
                        <ul className="space-y-1">
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">Ctrl+Z</kbd> - Undo</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">Ctrl+Y</kbd> - Redo</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">Ctrl+S</kbd> - Save</li>
                          <li><kbd className="bg-gray-200 px-2 py-1 rounded">Delete</kbd> - Remove selected</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">Working with Polygons</h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Select a polygon by clicking on it (highlighted in blue when selected)</li>
                    <li>Switch to the appropriate editing mode for your task</li>
                    <li>Make your modifications using mouse interactions</li>
                    <li>Use the polygon panel on the right to manage visibility and properties</li>
                    <li>Save your changes periodically or rely on auto-save</li>
                  </ol>
                </section>

                <section id="export-features" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    Export Features
                  </h2>

                  <p className="mb-4">
                    SpheroSeg provides comprehensive export capabilities to integrate with your research workflow. 
                    Export segmentation data in multiple formats suitable for machine learning frameworks and analysis tools.
                  </p>

                  <h3 className="text-xl font-semibold mb-3">Export Package Contents</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-800 mb-2 flex items-center">
                        <FileText className="w-4 h-4 mr-2" />
                        Original Images
                      </h4>
                      <p className="text-sm text-blue-600">
                        High-quality original microscopic images in their native format.
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-800 mb-2 flex items-center">
                        <Layers className="w-4 h-4 mr-2" />
                        Visualizations
                      </h4>
                      <p className="text-sm text-green-600">
                        Annotated images with numbered polygons and customizable colors.
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">Annotation Formats</h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>COCO Format:</strong> Common Objects in Context - standard format for object detection frameworks like PyTorch and TensorFlow</li>
                    <li><strong>YOLO Format:</strong> You Only Look Once - optimized format for YOLO-based detection models</li>
                    <li><strong>Custom JSON:</strong> Structured JSON format with detailed polygon coordinates and metadata</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">Calculated Metrics</h3>
                  <p className="mb-4">
                    SpheroSeg automatically calculates comprehensive morphological metrics for each detected spheroid:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <h4 className="font-semibold mb-2">Basic Measurements:</h4>
                      <ul className="list-disc pl-6 text-sm space-y-1">
                        <li>Area (pixels and scaled units)</li>
                        <li>Perimeter</li>
                        <li>Equivalent diameter</li>
                        <li>Circularity</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Advanced Metrics:</h4>
                      <ul className="list-disc pl-6 text-sm space-y-1">
                        <li>Feret diameters (max, min, aspect ratio)</li>
                        <li>Major/minor diameter through centroid</li>
                        <li>Compactness, convexity, solidity</li>
                        <li>Sphericity index</li>
                      </ul>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">Metrics Export Formats</h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>Excel (.xlsx):</strong> Formatted spreadsheet with separate sheets for summary and detailed data</li>
                    <li><strong>CSV:</strong> Comma-separated values for easy import into statistical software</li>
                    <li><strong>JSON:</strong> Structured data format for programmatic analysis</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">Visualization Customization</h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li><strong>Polygon colors:</strong> Customize external (green) and internal (red) polygon colors</li>
                    <li><strong>Numbering:</strong> Show/hide polygon numbers for identification</li>
                    <li><strong>Stroke width:</strong> Adjust line thickness (1-10px)</li>
                    <li><strong>Font size:</strong> Control text size for polygon numbers (10-30px)</li>
                    <li><strong>Transparency:</strong> Set polygon fill transparency (0-100%)</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">How to Export</h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Navigate to your project dashboard</li>
                    <li>Select the images you want to export (or export all)</li>
                    <li>Click "Advanced Export" to open the export dialog</li>
                    <li>Configure your export settings across the three tabs: General, Visualization, and Formats</li>
                    <li>Review the export summary</li>
                    <li>Click "Start Export" to generate and download your package</li>
                  </ol>

                  <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Download className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-green-700">
                          <strong>Export packages are comprehensive:</strong> Each export includes documentation, 
                          metadata, and all selected content types organized in a clear folder structure for easy use.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-200">
                  <Link
                    to="/"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    <ArrowRight className="w-4 h-4 mr-2 transform rotate-180" />
                    Back to Home
                  </Link>
                  <button
                    onClick={() => scrollToSection('introduction')}
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    Back to Top
                    <ArrowRight className="w-4 h-4 ml-2 transform -rotate-90" />
                  </button>
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
