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
import { useLanguage } from '@/contexts/LanguageContext';

const Documentation = () => {
  const { t } = useLanguage();
  const sectionIds = [
    'introduction',
    'getting-started',
    'upload-images',
    'models-selection',
    'segmentation',
    'segmentation-editor',
    'export-features',
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
                {t('docs.badge')}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              {t('docs.title')}
            </h1>
            <p className="text-xl text-gray-600">{t('docs.subtitle')}</p>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
            {/* Sidebar */}
            <aside className="lg:col-span-1">
              <div className="sticky top-24 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-lg mb-4">
                  {t('docs.navigation')}
                </h3>
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
                    {t('docs.nav.introduction')}
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
                    {t('docs.nav.gettingStarted')}
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
                    {t('docs.nav.uploadingImages')}
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
                    {t('docs.nav.modelSelection')}
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
                    {t('docs.nav.segmentationProcess')}
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
                    {t('docs.nav.segmentationEditor')}
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
                    {t('docs.nav.exportFeatures')}
                  </button>
                </nav>
              </div>
            </aside>

            {/* Documentation Content */}
            <div className="lg:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 p-6 md:p-8">
              <div className="prose max-w-none">
                <section id="introduction" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.introduction.title')}
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
                          {t('docs.introduction.whatIs')}
                        </h3>
                        <p className="text-gray-700">
                          {t('docs.introduction.description')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="mb-4">{t('docs.introduction.developedBy')}</p>

                  <p className="mb-4">{t('docs.introduction.addresses')}</p>
                </section>

                <section id="getting-started" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.gettingStarted.title')}
                  </h2>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.gettingStarted.accountCreation')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.gettingStarted.accountDescription')}
                  </p>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>
                      <Link
                        to="/sign-up"
                        className="text-blue-600 hover:underline"
                      >
                        {t('docs.gettingStarted.accountSteps.step1')}
                      </Link>
                    </li>
                    <li>{t('docs.gettingStarted.accountSteps.step2')}</li>
                    <li>{t('docs.gettingStarted.accountSteps.step3')}</li>
                    <li>{t('docs.gettingStarted.accountSteps.step4')}</li>
                  </ol>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.gettingStarted.firstProject')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.gettingStarted.projectDescription')}
                  </p>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.gettingStarted.projectSteps.step1')}</li>
                    <li>{t('docs.gettingStarted.projectSteps.step2')}</li>
                    <li>{t('docs.gettingStarted.projectSteps.step3')}</li>
                    <li>{t('docs.gettingStarted.projectSteps.step4')}</li>
                  </ol>
                </section>

                <section id="upload-images" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.uploadImages.title')}
                  </h2>

                  <p className="mb-4">{t('docs.uploadImages.description')}</p>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.uploadImages.methods')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.uploadImages.methodsDescription')}
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>{t('docs.uploadImages.methodsList.dragDrop')}</li>
                    <li>{t('docs.uploadImages.methodsList.browse')}</li>
                    <li>{t('docs.uploadImages.methodsList.batch')}</li>
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
                          <strong>{t('docs.uploadImages.note')}</strong>{' '}
                          {t('docs.uploadImages.noteText')}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="models-selection" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.modelSelection.title')}
                  </h2>

                  <p className="mb-4">{t('docs.modelSelection.description')}</p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Cpu className="w-5 h-5 text-green-600 mr-2" />
                        <h3 className="font-semibold text-green-800">
                          {t('docs.modelSelection.models.hrnet.name')}
                        </h3>
                      </div>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.hrnet.inferenceTime')}
                        </strong>
                      </p>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.hrnet.bestFor')}
                        </strong>
                      </p>
                      <p className="text-sm text-green-700">
                        {t('docs.modelSelection.models.hrnet.description')}
                      </p>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Layers className="w-5 h-5 text-blue-600 mr-2" />
                        <h3 className="font-semibold text-blue-800">
                          {t('docs.modelSelection.models.cbam.name')}
                        </h3>
                      </div>
                      <p className="text-sm text-blue-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.cbam.inferenceTime')}
                        </strong>
                      </p>
                      <p className="text-sm text-blue-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.cbam.bestFor')}
                        </strong>
                      </p>
                      <p className="text-sm text-blue-700">
                        {t('docs.modelSelection.models.cbam.description')}
                      </p>
                    </div>

                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Settings className="w-5 h-5 text-purple-600 mr-2" />
                        <h3 className="font-semibold text-purple-800">
                          {t('docs.modelSelection.models.ma.name')}
                        </h3>
                      </div>
                      <p className="text-sm text-purple-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.ma.inferenceTime')}
                        </strong>
                      </p>
                      <p className="text-sm text-purple-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.ma.bestFor')}
                        </strong>
                      </p>
                      <p className="text-sm text-purple-700">
                        {t('docs.modelSelection.models.ma.description')}
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.modelSelection.howToSelect')}
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.modelSelection.selectionSteps.step1')}</li>
                    <li>{t('docs.modelSelection.selectionSteps.step2')}</li>
                    <li>{t('docs.modelSelection.selectionSteps.step3')}</li>
                    <li>{t('docs.modelSelection.selectionSteps.step4')}</li>
                    <li>{t('docs.modelSelection.selectionSteps.step5')}</li>
                  </ol>

                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-blue-700">
                          <strong>{t('docs.modelSelection.tip')}</strong>{' '}
                          {t('docs.modelSelection.tipText')}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="segmentation" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.segmentationProcess.title')}
                  </h2>

                  <p className="mb-4">
                    {t('docs.segmentationProcess.description')}
                  </p>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationProcess.queueBased')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.segmentationProcess.queueDescription')}
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      {t('docs.segmentationProcess.queueFeatures.realTime')}
                    </li>
                    <li>{t('docs.segmentationProcess.queueFeatures.batch')}</li>
                    <li>
                      {t('docs.segmentationProcess.queueFeatures.priority')}
                    </li>
                    <li>
                      {t('docs.segmentationProcess.queueFeatures.recovery')}
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationProcess.workflow')}
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.segmentationProcess.workflowSteps.step1')}</li>
                    <li>{t('docs.segmentationProcess.workflowSteps.step2')}</li>
                    <li>{t('docs.segmentationProcess.workflowSteps.step3')}</li>
                    <li>{t('docs.segmentationProcess.workflowSteps.step4')}</li>
                    <li>{t('docs.segmentationProcess.workflowSteps.step5')}</li>
                    <li>{t('docs.segmentationProcess.workflowSteps.step6')}</li>
                  </ol>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationProcess.polygonTypes')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.segmentationProcess.polygonDescription')}
                  </p>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      {t('docs.segmentationProcess.polygonTypesList.external')}
                    </li>
                    <li>
                      {t('docs.segmentationProcess.polygonTypesList.internal')}
                    </li>
                  </ul>

                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-yellow-700">
                          <strong>
                            {t('docs.segmentationProcess.processingNote')}
                          </strong>{' '}
                          {t('docs.segmentationProcess.processingTimes')}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="segmentation-editor" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.segmentationEditor.title')}
                  </h2>

                  <p className="mb-4">
                    {t('docs.segmentationEditor.description')}
                  </p>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationEditor.editingModes')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-gray-50 border rounded-lg p-4">
                      <h4 className="font-semibold text-gray-800 mb-2">
                        {t('docs.segmentationEditor.modes.view.title')}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {t('docs.segmentationEditor.modes.view.description')}
                      </p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-800 mb-2">
                        {t('docs.segmentationEditor.modes.editVertices.title')}
                      </h4>
                      <p className="text-sm text-blue-600">
                        {t(
                          'docs.segmentationEditor.modes.editVertices.description'
                        )}
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-800 mb-2">
                        {t('docs.segmentationEditor.modes.addPoints.title')}
                      </h4>
                      <p className="text-sm text-green-600">
                        {t(
                          'docs.segmentationEditor.modes.addPoints.description'
                        )}
                      </p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-800 mb-2">
                        {t('docs.segmentationEditor.modes.createPolygon.title')}
                      </h4>
                      <p className="text-sm text-purple-600">
                        {t(
                          'docs.segmentationEditor.modes.createPolygon.description'
                        )}
                      </p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h4 className="font-semibold text-orange-800 mb-2">
                        {t('docs.segmentationEditor.modes.sliceMode.title')}
                      </h4>
                      <p className="text-sm text-orange-600">
                        {t(
                          'docs.segmentationEditor.modes.sliceMode.description'
                        )}
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <h4 className="font-semibold text-red-800 mb-2">
                        {t('docs.segmentationEditor.modes.deletePolygon.title')}
                      </h4>
                      <p className="text-sm text-red-600">
                        {t(
                          'docs.segmentationEditor.modes.deletePolygon.description'
                        )}
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">Key Features</h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      <strong>Undo/Redo System:</strong> Full history tracking
                      with Ctrl+Z/Ctrl+Y support
                    </li>
                    <li>
                      <strong>Auto-save:</strong> Periodic saving with visual
                      indicators showing unsaved changes
                    </li>
                    <li>
                      <strong>Zoom & Pan:</strong> Mouse wheel zooming and
                      drag-to-pan navigation
                    </li>
                    <li>
                      <strong>Polygon Management:</strong> Show/hide, rename,
                      and batch operations
                    </li>
                    <li>
                      <strong>Keyboard Shortcuts:</strong> Comprehensive hotkeys
                      for efficient editing
                    </li>
                    <li>
                      <strong>Real-time Feedback:</strong> Live preview of edits
                      and status updates
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    Essential Keyboard Shortcuts
                  </h3>
                  <div className="bg-gray-50 border rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium mb-1">Navigation:</p>
                        <ul className="space-y-1">
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              V
                            </kbd>{' '}
                            - View mode
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              E
                            </kbd>{' '}
                            - Edit vertices
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              A
                            </kbd>{' '}
                            - Add points
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              N
                            </kbd>{' '}
                            - Create polygon
                          </li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Actions:</p>
                        <ul className="space-y-1">
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+Z
                            </kbd>{' '}
                            - Undo
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+Y
                            </kbd>{' '}
                            - Redo
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+S
                            </kbd>{' '}
                            - Save
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Delete
                            </kbd>{' '}
                            - Remove selected
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    Working with Polygons
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>
                      Select a polygon by clicking on it (highlighted in blue
                      when selected)
                    </li>
                    <li>
                      Switch to the appropriate editing mode for your task
                    </li>
                    <li>Make your modifications using mouse interactions</li>
                    <li>
                      Use the polygon panel on the right to manage visibility
                      and properties
                    </li>
                    <li>Save your changes periodically or rely on auto-save</li>
                  </ol>
                </section>

                <section id="export-features" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.exportFeatures.title')}
                  </h2>

                  <p className="mb-4">{t('docs.exportFeatures.description')}</p>

                  <h3 className="text-xl font-semibold mb-3">
                    Export Package Contents
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-800 mb-2 flex items-center">
                        <FileText className="w-4 h-4 mr-2" />
                        Original Images
                      </h4>
                      <p className="text-sm text-blue-600">
                        High-quality original microscopic images in their native
                        format.
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-800 mb-2 flex items-center">
                        <Layers className="w-4 h-4 mr-2" />
                        Visualizations
                      </h4>
                      <p className="text-sm text-green-600">
                        Annotated images with numbered polygons and customizable
                        colors.
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    Annotation Formats
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      <strong>COCO Format:</strong> Common Objects in Context -
                      standard format for object detection frameworks like
                      PyTorch and TensorFlow
                    </li>
                    <li>
                      <strong>YOLO Format:</strong> You Only Look Once -
                      optimized format for YOLO-based detection models
                    </li>
                    <li>
                      <strong>Custom JSON:</strong> Structured JSON format with
                      detailed polygon coordinates and metadata
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    Calculated Metrics
                  </h3>
                  <p className="mb-4">
                    SpheroSeg automatically calculates comprehensive
                    morphological metrics for each detected spheroid:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <h4 className="font-semibold mb-2">
                        Basic Measurements:
                      </h4>
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

                  <h3 className="text-xl font-semibold mb-3">
                    Metrics Export Formats
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      <strong>Excel (.xlsx):</strong> Formatted spreadsheet with
                      separate sheets for summary and detailed data
                    </li>
                    <li>
                      <strong>CSV:</strong> Comma-separated values for easy
                      import into statistical software
                    </li>
                    <li>
                      <strong>JSON:</strong> Structured data format for
                      programmatic analysis
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    Visualization Customization
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      <strong>Polygon colors:</strong> Customize external
                      (green) and internal (red) polygon colors
                    </li>
                    <li>
                      <strong>Numbering:</strong> Show/hide polygon numbers for
                      identification
                    </li>
                    <li>
                      <strong>Stroke width:</strong> Adjust line thickness
                      (1-10px)
                    </li>
                    <li>
                      <strong>Font size:</strong> Control text size for polygon
                      numbers (10-30px)
                    </li>
                    <li>
                      <strong>Transparency:</strong> Set polygon fill
                      transparency (0-100%)
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">How to Export</h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>Navigate to your project dashboard</li>
                    <li>
                      Select the images you want to export (or export all)
                    </li>
                    <li>Click "Advanced Export" to open the export dialog</li>
                    <li>
                      Configure your export settings across the three tabs:
                      General, Visualization, and Formats
                    </li>
                    <li>Review the export summary</li>
                    <li>
                      Click "Start Export" to generate and download your package
                    </li>
                  </ol>

                  <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Download className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-green-700">
                          <strong>Export packages are comprehensive:</strong>{' '}
                          Each export includes documentation, metadata, and all
                          selected content types organized in a clear folder
                          structure for easy use.
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
                    {t('docs.footer.backToHome')}
                  </Link>
                  <button
                    onClick={() => scrollToSection('introduction')}
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    {t('docs.footer.backToTop')}
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
