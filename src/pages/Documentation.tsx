import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface LocationState {
  from?: string;
  path?: string;
}
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
  Users,
} from 'lucide-react';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { Button } from '@/components/ui/button';

const Documentation = () => {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const sectionIds = [
    'introduction',
    'getting-started',
    'upload-images',
    'models-selection',
    'segmentation',
    'segmentation-editor',
    'export-features',
    'shared-projects',
  ];

  const { activeSection, scrollToSection } = useActiveSection(sectionIds);

  // Get referrer information from navigation state
  const locationState = location.state as LocationState | null;
  const referrerPage = locationState?.from;
  const referrerPath = locationState?.path;

  // Show Navbar only when NOT coming from authenticated pages
  const showNavbar = !isAuthenticated || !referrerPage || !referrerPath;

  return (
    <div className="min-h-screen flex flex-col">
      {showNavbar && <Navbar />}
      <main className={`flex-1 ${showNavbar ? 'pt-24' : 'pt-8'} pb-16`}>
        <div className="container mx-auto px-4">
          {/* Back button for authenticated users */}
          {isAuthenticated && referrerPage && referrerPath && (
            <div className="max-w-7xl mx-auto mb-4 flex justify-end">
              <Button
                variant="outline"
                onClick={() => navigate(referrerPath)}
                className="flex items-center gap-2"
              >
                {t('docs.backTo', { page: referrerPage })}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}

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
                  <button
                    onClick={() => scrollToSection('shared-projects')}
                    className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${
                      activeSection === 'shared-projects'
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    {t('docs.nav.sharedProjects')}
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
                          {t('docs.modelSelection.models.unet.name')}
                        </h3>
                      </div>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.unet.inferenceTime')}
                        </strong>
                      </p>
                      <p className="text-sm text-green-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.unet.bestFor')}
                        </strong>
                      </p>
                      <p className="text-sm text-green-700">
                        {t('docs.modelSelection.models.unet.description')}
                      </p>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <Cpu className="w-5 h-5 text-yellow-600 mr-2" />
                        <h3 className="font-semibold text-yellow-800">
                          {t('docs.modelSelection.models.hrnet.name')}
                        </h3>
                      </div>
                      <p className="text-sm text-yellow-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.hrnet.inferenceTime')}
                        </strong>
                      </p>
                      <p className="text-sm text-yellow-700 mb-2">
                        <strong>
                          {t('docs.modelSelection.models.hrnet.bestFor')}
                        </strong>
                      </p>
                      <p className="text-sm text-yellow-700">
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

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationEditor.keyFeatures')}
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>{t('docs.segmentationEditor.features.undoRedo')}</li>
                    <li>{t('docs.segmentationEditor.features.autoSave')}</li>
                    <li>{t('docs.segmentationEditor.features.zoomPan')}</li>
                    <li>
                      {t('docs.segmentationEditor.features.polygonManagement')}
                    </li>
                    <li>
                      {t('docs.segmentationEditor.features.keyboardShortcuts')}
                    </li>
                    <li>
                      {t('docs.segmentationEditor.features.realTimeFeedback')}
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationEditor.shortcuts')}
                  </h3>
                  <div className="bg-gray-50 border rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium mb-1">
                          {t(
                            'docs.segmentationEditor.shortcutCategories.navigation'
                          )}
                        </p>
                        <ul className="space-y-1">
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              V
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.v')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              E
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.e')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              A
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.a')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              N
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.n')}
                          </li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium mb-1">
                          {t(
                            'docs.segmentationEditor.shortcutCategories.actions'
                          )}
                        </p>
                        <ul className="space-y-1">
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+Z
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.ctrlZ')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+Y
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.ctrlY')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Ctrl+S
                            </kbd>{' '}
                            - {t('docs.segmentationEditor.shortcutsList.ctrlS')}
                          </li>
                          <li>
                            <kbd className="bg-gray-200 px-2 py-1 rounded">
                              Delete
                            </kbd>{' '}
                            -{' '}
                            {t('docs.segmentationEditor.shortcutsList.delete')}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.segmentationEditor.workingWithPolygons')}
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.segmentationEditor.polygonSteps.step1')}</li>
                    <li>{t('docs.segmentationEditor.polygonSteps.step2')}</li>
                    <li>{t('docs.segmentationEditor.polygonSteps.step3')}</li>
                    <li>{t('docs.segmentationEditor.polygonSteps.step4')}</li>
                    <li>{t('docs.segmentationEditor.polygonSteps.step5')}</li>
                  </ol>
                </section>

                <section id="export-features" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.exportFeatures.title')}
                  </h2>

                  <p className="mb-4">{t('docs.exportFeatures.description')}</p>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.packageContents')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-800 mb-2 flex items-center">
                        <FileText className="w-4 h-4 mr-2" />
                        {t('docs.exportFeatures.contents.originalImages.title')}
                      </h4>
                      <p className="text-sm text-blue-600">
                        {t(
                          'docs.exportFeatures.contents.originalImages.description'
                        )}
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-800 mb-2 flex items-center">
                        <Layers className="w-4 h-4 mr-2" />
                        {t('docs.exportFeatures.contents.visualizations.title')}
                      </h4>
                      <p className="text-sm text-green-600">
                        {t(
                          'docs.exportFeatures.contents.visualizations.description'
                        )}
                      </p>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.annotationFormats')}
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>{t('docs.exportFeatures.formats.coco')}</li>
                    <li>{t('docs.exportFeatures.formats.yolo')}</li>
                    <li>{t('docs.exportFeatures.formats.json')}</li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.calculatedMetrics')}
                  </h3>
                  <p className="mb-4">
                    {t('docs.exportFeatures.metricsDescription')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <h4 className="font-semibold mb-2">
                        {t('docs.exportFeatures.metricsCategories.basic.title')}
                      </h4>
                      <ul className="list-disc pl-6 text-sm space-y-1">
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.basic.items.area'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.basic.items.perimeter'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.basic.items.diameter'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.basic.items.circularity'
                          )}
                        </li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">
                        {t(
                          'docs.exportFeatures.metricsCategories.advanced.title'
                        )}
                      </h4>
                      <ul className="list-disc pl-6 text-sm space-y-1">
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.advanced.items.feret'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.advanced.items.majorMinor'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.advanced.items.compactness'
                          )}
                        </li>
                        <li>
                          {t(
                            'docs.exportFeatures.metricsCategories.advanced.items.sphericity'
                          )}
                        </li>
                      </ul>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.exportFormats')}
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>{t('docs.exportFeatures.exportFormatsList.excel')}</li>
                    <li>{t('docs.exportFeatures.exportFormatsList.csv')}</li>
                    <li>
                      {t('docs.exportFeatures.exportFormatsList.jsonExport')}
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.visualizationCustomization')}
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>
                      {t('docs.exportFeatures.customizationOptions.colors')}
                    </li>
                    <li>
                      {t('docs.exportFeatures.customizationOptions.numbering')}
                    </li>
                    <li>
                      {t(
                        'docs.exportFeatures.customizationOptions.strokeWidth'
                      )}
                    </li>
                    <li>
                      {t('docs.exportFeatures.customizationOptions.fontSize')}
                    </li>
                    <li>
                      {t(
                        'docs.exportFeatures.customizationOptions.transparency'
                      )}
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.exportFeatures.howToExport')}
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.exportFeatures.exportSteps.step1')}</li>
                    <li>{t('docs.exportFeatures.exportSteps.step2')}</li>
                    <li>{t('docs.exportFeatures.exportSteps.step3')}</li>
                    <li>{t('docs.exportFeatures.exportSteps.step4')}</li>
                    <li>{t('docs.exportFeatures.exportSteps.step5')}</li>
                    <li>{t('docs.exportFeatures.exportSteps.step6')}</li>
                  </ol>

                  <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Download className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-green-700">
                          <strong>{t('docs.exportFeatures.exportNote')}</strong>{' '}
                          {t('docs.exportFeatures.exportNoteText')}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="shared-projects" className="mb-12">
                  <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200">
                    {t('docs.sharedProjects.title')}
                  </h2>

                  <p className="mb-4">{t('docs.sharedProjects.description')}</p>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.sharedProjects.sharingFeatures')}
                  </h3>
                  <ul className="list-disc pl-6 mb-6 space-y-2">
                    <li>{t('docs.sharedProjects.features.readOnly')}</li>
                    <li>{t('docs.sharedProjects.features.emailInvite')}</li>
                    <li>{t('docs.sharedProjects.features.revokeAccess')}</li>
                    <li>
                      {t('docs.sharedProjects.features.multipleCollaborators')}
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-3">
                    {t('docs.sharedProjects.howToShare')}
                  </h3>
                  <ol className="list-decimal pl-6 mb-6 space-y-2">
                    <li>{t('docs.sharedProjects.shareSteps.step1')}</li>
                    <li>{t('docs.sharedProjects.shareSteps.step2')}</li>
                    <li>{t('docs.sharedProjects.shareSteps.step3')}</li>
                    <li>{t('docs.sharedProjects.shareSteps.step4')}</li>
                    <li>{t('docs.sharedProjects.shareSteps.step5')}</li>
                  </ol>

                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-blue-700">
                          <strong>
                            {t('docs.sharedProjects.permissionsNote')}
                          </strong>{' '}
                          {t('docs.sharedProjects.permissionsNoteText')}
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

// Set displayName for React DevTools
Documentation.displayName = 'Documentation';

export default Documentation;
