/**
 * Documentation.tsx — section rendering, nav buttons, conditional Navbar,
 * and footer navigation tests.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/pages/__tests__/Documentation.test.tsx --reporter=dot
 *
 * Strategy:
 *   All heavy children (Navbar, Footer, lucide-react icons) are stubbed.
 *   useActiveSection is stubbed to return a controllable activeSection so we
 *   can test the nav-button active-class logic without scroll events.
 *   useAuth controls isAuthenticated + referrer-path visibility.
 *
 * Behaviors tested:
 *   - Page badge, h1 title, subtitle rendered.
 *   - All 8 sidebar nav buttons rendered with their translated labels.
 *   - Clicking a nav button calls scrollToSection with the correct section id.
 *   - Active nav button gets the active CSS class when activeSection matches.
 *   - All 8 content sections rendered (h2 headings visible).
 *   - "Back to Home" footer link present at bottom of content.
 *   - "Back to top" button calls scrollToSection('introduction').
 *   - Navbar shown when user is NOT authenticated.
 *   - Navbar hidden when authenticated AND referrer state present.
 *   - "Back to" button shown (and navigates) when authenticated with referrer.
 *
 * NOT tested:
 *   - Real IntersectionObserver scroll behaviour (mocked).
 *   - Actual Navbar / Footer internals (stubs).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockScrollToSection,
  mockActiveSection,
  mockNavigate,
  mockIsAuthenticated,
} = vi.hoisted(() => ({
  mockScrollToSection: vi.fn(),
  mockActiveSection: { value: '' },
  mockNavigate: vi.fn(),
  mockIsAuthenticated: { value: false },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useActiveSection', () => ({
  useActiveSection: () => ({
    activeSection: mockActiveSection.value,
    scrollToSection: mockScrollToSection,
  }),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string, _params?: Record<string, string>) => {
      const map: Record<string, string> = {
        'docs.badge': 'Documentation',
        'docs.title': 'SpheroSeg Documentation',
        'docs.subtitle':
          'Comprehensive guide to using our spheroid segmentation platform',
        'docs.navigation': 'Navigation',
        'docs.nav.introduction': 'Introduction',
        'docs.nav.gettingStarted': 'Getting Started',
        'docs.nav.uploadingImages': 'Uploading Images',
        'docs.nav.modelSelection': 'Model Selection',
        'docs.nav.segmentationProcess': 'Segmentation Process',
        'docs.nav.segmentationEditor': 'Segmentation Editor',
        'docs.nav.exportFeatures': 'Export Features',
        'docs.nav.sharedProjects': 'Shared Projects',
        'docs.introduction.title': 'Introduction',
        'docs.introduction.whatIs': 'What is SpheroSeg?',
        'docs.introduction.description': 'Intro description.',
        'docs.introduction.developedBy': 'Developed by Michal.',
        'docs.introduction.addresses': 'Addresses challenges.',
        'docs.gettingStarted.title': 'Getting Started',
        'docs.gettingStarted.accountCreation': 'Account Creation',
        'docs.gettingStarted.accountDescription': 'Create an account.',
        'docs.gettingStarted.firstProject': 'Creating Your First Project',
        'docs.gettingStarted.projectDescription': 'Projects organize work.',
        'docs.gettingStarted.accountSteps.step1': 'Navigate to sign-up',
        'docs.gettingStarted.accountSteps.step2': 'Enter email',
        'docs.gettingStarted.accountSteps.step3': 'Complete profile',
        'docs.gettingStarted.accountSteps.step4': 'Verify email',
        'docs.gettingStarted.projectSteps.step1': 'Click New Project',
        'docs.gettingStarted.projectSteps.step2': 'Enter project name',
        'docs.gettingStarted.projectSteps.step3': 'Select type',
        'docs.gettingStarted.projectSteps.step4': 'Click Create',
        'docs.uploadImages.title': 'Uploading Images',
        'docs.uploadImages.description': 'Supports TIFF, PNG, JPEG.',
        'docs.uploadImages.methods': 'Upload Methods',
        'docs.uploadImages.methodsDescription': 'Multiple ways:',
        'docs.uploadImages.methodsList.dragDrop': 'Drag and drop',
        'docs.uploadImages.methodsList.browse': 'Browse files',
        'docs.uploadImages.methodsList.batch': 'Batch upload',
        'docs.uploadImages.note': 'Note:',
        'docs.uploadImages.noteText': 'Ensure good contrast.',
        'docs.modelSelection.title': 'Model Selection',
        'docs.modelSelection.description': 'Choose a model.',
        'docs.modelSelection.models.unet.name': 'UNet (Fastest)',
        'docs.modelSelection.models.unet.inferenceTime': '~286ms',
        'docs.modelSelection.models.unet.bestFor': 'Real-time',
        'docs.modelSelection.models.unet.description': 'Fast model.',
        'docs.modelSelection.models.hrnet.name': 'HRNet (Balanced)',
        'docs.modelSelection.models.hrnet.inferenceTime': '~309ms',
        'docs.modelSelection.models.hrnet.bestFor': 'Balanced',
        'docs.modelSelection.models.hrnet.description': 'Balanced model.',
        'docs.modelSelection.models.cbam.name': 'CBAM-ResUNet (Precise)',
        'docs.modelSelection.models.cbam.inferenceTime': '~482ms',
        'docs.modelSelection.models.cbam.bestFor': 'Maximum accuracy',
        'docs.modelSelection.models.cbam.description': 'Precise model.',
        'docs.modelSelection.howToSelect': 'How to Select',
        'docs.modelSelection.selectionSteps.step1': 'Open settings',
        'docs.modelSelection.selectionSteps.step2': 'Pick model',
        'docs.modelSelection.selectionSteps.step3': 'Save',
        'docs.modelSelection.selectionSteps.step4': 'Segment',
        'docs.modelSelection.selectionSteps.step5': 'Review',
        'docs.modelSelection.tip': 'Tip:',
        'docs.modelSelection.tipText': 'Start with HRNet.',
        'docs.segmentationProcess.title': 'Segmentation Process',
        'docs.segmentationProcess.description': 'Queue-based.',
        'docs.segmentationProcess.queueBased': 'Queue-Based Processing',
        'docs.segmentationProcess.queueDescription': 'Uses a queue.',
        'docs.segmentationProcess.queueFeatures.realTime': 'Real-time updates',
        'docs.segmentationProcess.queueFeatures.batch': 'Batch processing',
        'docs.segmentationProcess.queueFeatures.priority': 'Priority queue',
        'docs.segmentationProcess.queueFeatures.recovery': 'Auto-recovery',
        'docs.segmentationProcess.workflow': 'Workflow',
        'docs.segmentationProcess.workflowSteps.step1': 'Upload',
        'docs.segmentationProcess.workflowSteps.step2': 'Queue',
        'docs.segmentationProcess.workflowSteps.step3': 'Process',
        'docs.segmentationProcess.workflowSteps.step4': 'Review',
        'docs.segmentationProcess.workflowSteps.step5': 'Export',
        'docs.segmentationProcess.workflowSteps.step6': 'Done',
        'docs.segmentationProcess.polygonTypes': 'Polygon Types',
        'docs.segmentationProcess.polygonDescription': 'Two types.',
        'docs.segmentationProcess.polygonTypesList.external': 'External',
        'docs.segmentationProcess.polygonTypesList.internal': 'Internal',
        'docs.segmentationProcess.processingNote': 'Processing note:',
        'docs.segmentationProcess.processingTimes': 'Varies by model.',
        'docs.segmentationEditor.title': 'Segmentation Editor',
        'docs.segmentationEditor.description': 'Edit polygons.',
        'docs.segmentationEditor.editingModes': 'Editing Modes',
        'docs.segmentationEditor.modes.view.title': 'View Mode',
        'docs.segmentationEditor.modes.view.description': 'Read-only.',
        'docs.segmentationEditor.modes.editVertices.title': 'Edit Vertices',
        'docs.segmentationEditor.modes.editVertices.description': 'Edit verts.',
        'docs.segmentationEditor.modes.addPoints.title': 'Add Points',
        'docs.segmentationEditor.modes.addPoints.description': 'Add pts.',
        'docs.segmentationEditor.modes.createPolygon.title': 'Create Polygon',
        'docs.segmentationEditor.modes.createPolygon.description': 'Draw.',
        'docs.segmentationEditor.modes.sliceMode.title': 'Slice Mode',
        'docs.segmentationEditor.modes.sliceMode.description': 'Slice.',
        'docs.segmentationEditor.modes.deletePolygon.title': 'Delete Polygon',
        'docs.segmentationEditor.modes.deletePolygon.description': 'Delete.',
        'docs.segmentationEditor.keyFeatures': 'Key Features',
        'docs.segmentationEditor.features.undoRedo': 'Undo/Redo',
        'docs.segmentationEditor.features.autoSave': 'Auto Save',
        'docs.segmentationEditor.features.zoomPan': 'Zoom/Pan',
        'docs.segmentationEditor.features.polygonManagement': 'Polygon Mgmt',
        'docs.segmentationEditor.features.keyboardShortcuts': 'Shortcuts',
        'docs.segmentationEditor.features.realTimeFeedback': 'Feedback',
        'docs.segmentationEditor.shortcuts': 'Keyboard Shortcuts',
        'docs.segmentationEditor.shortcutCategories.navigation': 'Navigation',
        'docs.segmentationEditor.shortcutCategories.actions': 'Actions',
        'docs.segmentationEditor.shortcutsList.v': 'View mode',
        'docs.segmentationEditor.shortcutsList.e': 'Edit mode',
        'docs.segmentationEditor.shortcutsList.a': 'Add mode',
        'docs.segmentationEditor.shortcutsList.n': 'New polygon',
        'docs.segmentationEditor.shortcutsList.ctrlZ': 'Undo',
        'docs.segmentationEditor.shortcutsList.ctrlY': 'Redo',
        'docs.segmentationEditor.shortcutsList.ctrlS': 'Save',
        'docs.segmentationEditor.shortcutsList.delete': 'Delete',
        'docs.segmentationEditor.workingWithPolygons': 'Working with Polygons',
        'docs.segmentationEditor.polygonSteps.step1': 'Select polygon',
        'docs.segmentationEditor.polygonSteps.step2': 'Edit vertices',
        'docs.segmentationEditor.polygonSteps.step3': 'Add points',
        'docs.segmentationEditor.polygonSteps.step4': 'Delete',
        'docs.segmentationEditor.polygonSteps.step5': 'Save',
        'docs.exportFeatures.title': 'Export Features',
        'docs.exportFeatures.description': 'Multiple export formats.',
        'docs.exportFeatures.packageContents': 'Package Contents',
        'docs.exportFeatures.contents.originalImages.title': 'Original Images',
        'docs.exportFeatures.contents.originalImages.description':
          'Source images.',
        'docs.exportFeatures.contents.visualizations.title': 'Visualizations',
        'docs.exportFeatures.contents.visualizations.description': 'Overlays.',
        'docs.exportFeatures.annotationFormats': 'Annotation Formats',
        'docs.exportFeatures.formats.coco': 'COCO',
        'docs.exportFeatures.formats.yolo': 'YOLO',
        'docs.exportFeatures.formats.json': 'JSON',
        'docs.exportFeatures.calculatedMetrics': 'Calculated Metrics',
        'docs.exportFeatures.metricsDescription': 'Various metrics.',
        'docs.exportFeatures.metricsCategories.basic.title': 'Basic',
        'docs.exportFeatures.metricsCategories.basic.items.area': 'Area',
        'docs.exportFeatures.metricsCategories.basic.items.perimeter':
          'Perimeter',
        'docs.exportFeatures.metricsCategories.basic.items.diameter':
          'Diameter',
        'docs.exportFeatures.metricsCategories.basic.items.circularity':
          'Circularity',
        'docs.exportFeatures.metricsCategories.advanced.title': 'Advanced',
        'docs.exportFeatures.metricsCategories.advanced.items.feret': 'Feret',
        'docs.exportFeatures.metricsCategories.advanced.items.majorMinor':
          'Major/Minor',
        'docs.exportFeatures.metricsCategories.advanced.items.compactness':
          'Compactness',
        'docs.exportFeatures.metricsCategories.advanced.items.sphericity':
          'Sphericity',
        'docs.exportFeatures.exportFormats': 'Export Formats',
        'docs.exportFeatures.exportFormatsList.excel': 'Excel',
        'docs.exportFeatures.exportFormatsList.csv': 'CSV',
        'docs.exportFeatures.exportFormatsList.jsonExport': 'JSON Export',
        'docs.exportFeatures.visualizationCustomization': 'Viz Customization',
        'docs.exportFeatures.customizationOptions.colors': 'Colors',
        'docs.exportFeatures.customizationOptions.numbering': 'Numbering',
        'docs.exportFeatures.customizationOptions.strokeWidth': 'Stroke Width',
        'docs.exportFeatures.customizationOptions.fontSize': 'Font Size',
        'docs.exportFeatures.customizationOptions.transparency': 'Transparency',
        'docs.exportFeatures.howToExport': 'How to Export',
        'docs.exportFeatures.exportSteps.step1': 'Open project',
        'docs.exportFeatures.exportSteps.step2': 'Click Export',
        'docs.exportFeatures.exportSteps.step3': 'Select format',
        'docs.exportFeatures.exportSteps.step4': 'Configure',
        'docs.exportFeatures.exportSteps.step5': 'Preview',
        'docs.exportFeatures.exportSteps.step6': 'Download',
        'docs.exportFeatures.exportNote': 'Export note:',
        'docs.exportFeatures.exportNoteText': 'Zip file created.',
        'docs.sharedProjects.title': 'Shared Projects',
        'docs.sharedProjects.description': 'Collaborate with colleagues.',
        'docs.sharedProjects.sharingFeatures': 'Sharing Features',
        'docs.sharedProjects.features.readOnly': 'Read-only access',
        'docs.sharedProjects.features.emailInvite': 'Email invite',
        'docs.sharedProjects.features.revokeAccess': 'Revoke access',
        'docs.sharedProjects.features.multipleCollaborators':
          'Multiple collaborators',
        'docs.sharedProjects.howToShare': 'How to Share',
        'docs.sharedProjects.shareSteps.step1': 'Open project',
        'docs.sharedProjects.shareSteps.step2': 'Share button',
        'docs.sharedProjects.shareSteps.step3': 'Enter email',
        'docs.sharedProjects.shareSteps.step4': 'Set permissions',
        'docs.sharedProjects.shareSteps.step5': 'Send invite',
        'docs.sharedProjects.permissionsNote': 'Permissions note:',
        'docs.sharedProjects.permissionsNoteText': 'Read-only by default.',
        'docs.footer.backToHome': 'Back to Home',
        'docs.footer.backToTop': 'Back to Top',
        'docs.backTo': 'Back to Dashboard',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated.value,
    user: null,
    loading: false,
  }),
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('lucide-react', () => ({
  FileText: () => null,
  Info: () => null,
  BookOpen: () => null,
  Microscope: () => null,
  ArrowRight: () => null,
  Download: () => null,
  Edit3: () => null,
  Cpu: () => null,
  Layers: () => null,
  Users: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

import Documentation from '../Documentation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDocs(
  opts: { authenticated?: boolean; locationState?: object } = {}
) {
  mockIsAuthenticated.value = opts.authenticated ?? false;
  const state = opts.locationState ?? null;
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/documentation', state }]}>
      <Documentation />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Documentation — header and badge', () => {
  beforeEach(() => {
    mockScrollToSection.mockReset();
    mockNavigate.mockReset();
    mockActiveSection.value = '';
  });

  it('renders the Documentation badge', () => {
    renderDocs();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('renders the page title h1', () => {
    renderDocs();
    expect(
      screen.getByRole('heading', { name: 'SpheroSeg Documentation', level: 1 })
    ).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    renderDocs();
    expect(
      screen.getByText(
        'Comprehensive guide to using our spheroid segmentation platform'
      )
    ).toBeInTheDocument();
  });
});

describe('Documentation — navigation sidebar', () => {
  beforeEach(() => {
    mockScrollToSection.mockReset();
    mockActiveSection.value = '';
  });

  it('renders all 8 nav buttons', () => {
    renderDocs();
    const expectedLabels = [
      'Introduction',
      'Getting Started',
      'Uploading Images',
      'Model Selection',
      'Segmentation Process',
      'Segmentation Editor',
      'Export Features',
      'Shared Projects',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('clicking Introduction nav button calls scrollToSection("introduction")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Introduction' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('introduction');
  });

  it('clicking Getting Started calls scrollToSection("getting-started")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Getting Started' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('getting-started');
  });

  it('clicking Uploading Images calls scrollToSection("upload-images")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Uploading Images' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('upload-images');
  });

  it('clicking Model Selection calls scrollToSection("models-selection")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Model Selection' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('models-selection');
  });

  it('clicking Segmentation Process calls scrollToSection("segmentation")', () => {
    renderDocs();
    fireEvent.click(
      screen.getByRole('button', { name: 'Segmentation Process' })
    );
    expect(mockScrollToSection).toHaveBeenCalledWith('segmentation');
  });

  it('clicking Segmentation Editor calls scrollToSection("segmentation-editor")', () => {
    renderDocs();
    fireEvent.click(
      screen.getByRole('button', { name: 'Segmentation Editor' })
    );
    expect(mockScrollToSection).toHaveBeenCalledWith('segmentation-editor');
  });

  it('clicking Export Features calls scrollToSection("export-features")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Export Features' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('export-features');
  });

  it('clicking Shared Projects calls scrollToSection("shared-projects")', () => {
    renderDocs();
    fireEvent.click(screen.getByRole('button', { name: 'Shared Projects' }));
    expect(mockScrollToSection).toHaveBeenCalledWith('shared-projects');
  });

  it('active nav button uses blue active class when activeSection matches', () => {
    mockActiveSection.value = 'introduction';
    renderDocs();
    const introBtn = screen.getByRole('button', { name: 'Introduction' });
    // The active button gets text-blue-600 applied (as a class-name fragment).
    expect(introBtn.className).toContain('text-blue-600');
  });

  it('inactive nav button does NOT have active class when activeSection is different', () => {
    mockActiveSection.value = 'segmentation';
    renderDocs();
    const introBtn = screen.getByRole('button', { name: 'Introduction' });
    // Should NOT have the active-button style; should have hover style
    expect(introBtn.className).not.toContain('bg-blue-50');
  });
});

describe('Documentation — content sections', () => {
  beforeEach(() => {
    mockScrollToSection.mockReset();
    mockActiveSection.value = '';
  });

  const sections = [
    'Introduction',
    'Getting Started',
    'Uploading Images',
    'Model Selection',
    'Segmentation Process',
    'Segmentation Editor',
    'Export Features',
    'Shared Projects',
  ];

  for (const title of sections) {
    it(`renders the "${title}" section heading`, () => {
      renderDocs();
      // Each section has an h2 with the translated title
      const headings = screen.getAllByRole('heading', { name: title });
      // There may be both the nav label and the section heading; at least one h2
      const h2 = headings.find(h => h.tagName === 'H2');
      expect(h2).toBeTruthy();
    });
  }
});

describe('Documentation — footer navigation', () => {
  beforeEach(() => {
    mockScrollToSection.mockReset();
    mockActiveSection.value = '';
  });

  it('renders Back to Home link pointing to /', () => {
    renderDocs();
    const link = screen.getByRole('link', { name: /back to home/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('renders Back to Top button that calls scrollToSection("introduction")', () => {
    renderDocs();
    const topBtn = screen.getByRole('button', { name: /back to top/i });
    fireEvent.click(topBtn);
    expect(mockScrollToSection).toHaveBeenCalledWith('introduction');
  });
});

describe('Documentation — Navbar visibility', () => {
  beforeEach(() => {
    mockScrollToSection.mockReset();
    mockNavigate.mockReset();
    mockActiveSection.value = '';
  });

  it('shows Navbar for unauthenticated user', () => {
    renderDocs({ authenticated: false });
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('shows Navbar for authenticated user WITHOUT referrer state', () => {
    renderDocs({ authenticated: true });
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('hides Navbar for authenticated user WITH referrer state', () => {
    renderDocs({
      authenticated: true,
      locationState: { from: 'Dashboard', path: '/dashboard' },
    });
    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
  });

  it('shows Back-to button for authenticated user with referrer, navigates on click', () => {
    renderDocs({
      authenticated: true,
      locationState: { from: 'Dashboard', path: '/dashboard' },
    });
    // The back button text comes from the 'docs.backTo' key
    const backBtn = screen.getByRole('button', { name: /back to dashboard/i });
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
