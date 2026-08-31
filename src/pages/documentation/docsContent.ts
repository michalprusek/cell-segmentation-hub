/**
 * Content model for the in-app documentation page.
 *
 * The page used to be ~900 lines of hand-written JSX with one `t()` call per
 * paragraph. That made it impossible to search (the text existed only inside
 * the render tree) and painful to extend. Content now lives here as data:
 * `buildDocsSections()` resolves every string through `t()` once, the page
 * renders the blocks generically, and the same array feeds the client-side
 * search index in `useDocsSearch`.
 *
 * Adding a section = add an entry here + its keys in all six locale files.
 * `scripts/check-i18n.cjs` enforces the second half.
 */

import {
  BookOpen,
  Cpu,
  Download,
  Edit3,
  FileText,
  FlaskConical,
  HelpCircle,
  Info,
  Microscope,
  PenTool,
  Shapes,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

/** Visual tone shared by notes and card grids. */
export type DocsTone = 'info' | 'warning' | 'success' | 'neutral';

export type DocsBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered?: boolean; items: string[] }
  | {
      kind: 'note';
      tone: Exclude<DocsTone, 'neutral'>;
      label: string;
      text: string;
    }
  | {
      kind: 'cards';
      items: { title: string; lines: string[]; tone?: DocsTone }[];
    }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | {
      kind: 'shortcuts';
      groups: { title: string; items: { keys: string; label: string }[] }[];
    };

export interface DocsSection {
  id: string;
  icon: LucideIcon;
  navLabel: string;
  title: string;
  blocks: DocsBlock[];
}

/** The `t` signature exposed by LanguageContext. */
type Translate = (
  key: string,
  options?: Record<string, unknown>
) => string | string[];

/**
 * Build the whole documentation tree for the active locale.
 *
 * Every string is resolved eagerly so the search index and the renderer see
 * exactly the same text. `t()` may return an array (i18n list values); those
 * are flattened to a single string for display and indexing.
 */
export function buildDocsSections(t: Translate): DocsSection[] {
  const s = (key: string): string => {
    const value = t(key);
    return Array.isArray(value) ? value.join(' ') : value;
  };
  const list = (prefix: string, keys: string[]): string[] =>
    keys.map(key => s(`${prefix}.${key}`));

  return [
    {
      id: 'introduction',
      icon: Info,
      navLabel: s('docs.nav.introduction'),
      title: s('docs.introduction.title'),
      blocks: [
        { kind: 'heading', text: s('docs.introduction.whatIs') },
        { kind: 'paragraph', text: s('docs.introduction.description') },
        { kind: 'paragraph', text: s('docs.introduction.developedBy') },
        { kind: 'paragraph', text: s('docs.introduction.addresses') },
      ],
    },

    {
      id: 'getting-started',
      icon: BookOpen,
      navLabel: s('docs.nav.gettingStarted'),
      title: s('docs.gettingStarted.title'),
      blocks: [
        { kind: 'heading', text: s('docs.gettingStarted.accountCreation') },
        {
          kind: 'paragraph',
          text: s('docs.gettingStarted.accountDescription'),
        },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.gettingStarted.accountSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
          ]),
        },
        { kind: 'heading', text: s('docs.gettingStarted.firstProject') },
        {
          kind: 'paragraph',
          text: s('docs.gettingStarted.projectDescription'),
        },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.gettingStarted.projectSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
          ]),
        },
      ],
    },

    {
      id: 'project-types',
      icon: Shapes,
      navLabel: s('docs.nav.projectTypes'),
      title: s('docs.projectTypes.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.projectTypes.description') },
        {
          kind: 'cards',
          items: [
            'spheroid',
            'spheroidInvasive',
            'wound',
            'sperm',
            'microtubules',
            'microcapsule',
            'neurite',
          ].map(key => ({
            title: s(`docs.projectTypes.types.${key}.name`),
            lines: [
              s(`docs.projectTypes.types.${key}.bestFor`),
              s(`docs.projectTypes.types.${key}.output`),
            ],
          })),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.projectTypes.note'),
          text: s('docs.projectTypes.noteText'),
        },
      ],
    },

    {
      id: 'upload-images',
      icon: FileText,
      navLabel: s('docs.nav.uploadingImages'),
      title: s('docs.uploadImages.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.uploadImages.description') },
        { kind: 'heading', text: s('docs.uploadImages.formats') },
        {
          kind: 'table',
          headers: [
            s('docs.uploadImages.formatsTable.kind'),
            s('docs.uploadImages.formatsTable.extensions'),
            s('docs.uploadImages.formatsTable.limit'),
          ],
          rows: [
            [
              s('docs.uploadImages.formatsTable.imagesLabel'),
              'JPEG, PNG, TIFF, BMP',
              s('docs.uploadImages.formatsTable.imagesLimit'),
            ],
            [
              s('docs.uploadImages.formatsTable.videosLabel'),
              'MP4, AVI, MOV, MKV, WebM, ND2, TIFF',
              s('docs.uploadImages.formatsTable.videosLimit'),
            ],
          ],
        },
        { kind: 'heading', text: s('docs.uploadImages.methods') },
        { kind: 'paragraph', text: s('docs.uploadImages.methodsDescription') },
        {
          kind: 'list',
          items: list('docs.uploadImages.methodsList', [
            'dragDrop',
            'browse',
            'batch',
            'autoSegment',
          ]),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.uploadImages.tiffNote'),
          text: s('docs.uploadImages.tiffNoteText'),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.uploadImages.note'),
          text: s('docs.uploadImages.noteText'),
        },
      ],
    },

    {
      id: 'videos-channels',
      icon: Video,
      navLabel: s('docs.nav.videosChannels'),
      title: s('docs.videosChannels.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.videosChannels.description') },
        { kind: 'heading', text: s('docs.videosChannels.containers') },
        {
          kind: 'list',
          items: list('docs.videosChannels.containerFacts', [
            'frames',
            'hidden',
            'positions',
            'calibration',
          ]),
        },
        { kind: 'heading', text: s('docs.videosChannels.channels') },
        {
          kind: 'paragraph',
          text: s('docs.videosChannels.channelsDescription'),
        },
        {
          kind: 'list',
          items: list('docs.videosChannels.channelControls', [
            'visibility',
            'color',
            'rename',
            'opacity',
            'source',
          ]),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.videosChannels.sourceNote'),
          text: s('docs.videosChannels.sourceNoteText'),
        },
        { kind: 'heading', text: s('docs.videosChannels.windowLevel') },
        {
          kind: 'paragraph',
          text: s('docs.videosChannels.windowLevelDescription'),
        },
        { kind: 'heading', text: s('docs.videosChannels.navigation') },
        {
          kind: 'shortcuts',
          groups: [
            {
              title: s('docs.videosChannels.navigation'),
              items: [
                { keys: '←  →', label: s('docs.videosChannels.keys.step') },
                { keys: 'Space', label: s('docs.videosChannels.keys.play') },
              ],
            },
          ],
        },
        { kind: 'heading', text: s('docs.videosChannels.mtExtras') },
        {
          kind: 'list',
          items: list('docs.videosChannels.mtExtrasList', [
            'registration',
            'addChannel',
            'tracking',
          ]),
        },
      ],
    },

    {
      id: 'models-selection',
      icon: Cpu,
      navLabel: s('docs.nav.modelSelection'),
      title: s('docs.modelSelection.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.modelSelection.description') },
        { kind: 'heading', text: s('docs.modelSelection.spheroidModels') },
        {
          kind: 'cards',
          items: ['unet', 'hrnet', 'cbam', 'segformer', 'mamba'].map(key => ({
            title: s(`docs.modelSelection.models.${key}.name`),
            lines: [
              s(`docs.modelSelection.models.${key}.inferenceTime`),
              s(`docs.modelSelection.models.${key}.bestFor`),
              s(`docs.modelSelection.models.${key}.description`),
            ],
          })),
        },
        { kind: 'heading', text: s('docs.modelSelection.specialisedModels') },
        {
          kind: 'cards',
          items: [
            'disintegration',
            'wound',
            'sperm',
            'microtubule',
            'microcapsule',
            'neuriteSoma',
          ].map(key => ({
            title: s(`docs.modelSelection.models.${key}.name`),
            lines: [
              s(`docs.modelSelection.models.${key}.inferenceTime`),
              s(`docs.modelSelection.models.${key}.bestFor`),
              s(`docs.modelSelection.models.${key}.description`),
            ],
          })),
        },
        { kind: 'heading', text: s('docs.modelSelection.howToSelect') },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.modelSelection.selectionSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
            'step5',
          ]),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.modelSelection.thresholdNote'),
          text: s('docs.modelSelection.thresholdNoteText'),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.modelSelection.tip'),
          text: s('docs.modelSelection.tipText'),
        },
      ],
    },

    {
      id: 'segmentation',
      icon: Microscope,
      navLabel: s('docs.nav.segmentationProcess'),
      title: s('docs.segmentationProcess.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.segmentationProcess.description') },
        { kind: 'heading', text: s('docs.segmentationProcess.queueBased') },
        {
          kind: 'paragraph',
          text: s('docs.segmentationProcess.queueDescription'),
        },
        {
          kind: 'list',
          items: list('docs.segmentationProcess.queueFeatures', [
            'realTime',
            'batch',
            'priority',
            'recovery',
          ]),
        },
        { kind: 'heading', text: s('docs.segmentationProcess.workflow') },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.segmentationProcess.workflowSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
            'step5',
            'step6',
          ]),
        },
        { kind: 'heading', text: s('docs.segmentationProcess.polygonTypes') },
        {
          kind: 'paragraph',
          text: s('docs.segmentationProcess.polygonDescription'),
        },
        {
          kind: 'list',
          items: list('docs.segmentationProcess.polygonTypesList', [
            'external',
            'internal',
            'polyline',
          ]),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.segmentationProcess.processingNote'),
          text: s('docs.segmentationProcess.processingTimes'),
        },
      ],
    },

    {
      id: 'segmentation-editor',
      icon: Edit3,
      navLabel: s('docs.nav.segmentationEditor'),
      title: s('docs.segmentationEditor.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.segmentationEditor.description') },
        { kind: 'heading', text: s('docs.segmentationEditor.editingModes') },
        {
          kind: 'cards',
          items: [
            'view',
            'editVertices',
            'addPoints',
            'createPolygon',
            'createPolyline',
            'sliceMode',
            'deletePolygon',
          ].map(key => ({
            title: s(`docs.segmentationEditor.modes.${key}.title`),
            lines: [s(`docs.segmentationEditor.modes.${key}.description`)],
          })),
        },
        { kind: 'heading', text: s('docs.segmentationEditor.keyFeatures') },
        {
          kind: 'list',
          items: list('docs.segmentationEditor.features', [
            'undoRedo',
            'saving',
            'zoomPan',
            'polygonManagement',
            'keyboardShortcuts',
            'realTimeFeedback',
          ]),
        },
        { kind: 'heading', text: s('docs.segmentationEditor.shortcuts') },
        {
          kind: 'shortcuts',
          groups: [
            {
              title: s('docs.segmentationEditor.shortcutCategories.modes'),
              items: [
                {
                  keys: 'V',
                  label: s('docs.segmentationEditor.shortcutsList.v'),
                },
                {
                  keys: 'E',
                  label: s('docs.segmentationEditor.shortcutsList.e'),
                },
                {
                  keys: 'A',
                  label: s('docs.segmentationEditor.shortcutsList.a'),
                },
                {
                  keys: 'N',
                  label: s('docs.segmentationEditor.shortcutsList.n'),
                },
                {
                  keys: 'P',
                  label: s('docs.segmentationEditor.shortcutsList.p'),
                },
                {
                  keys: 'S',
                  label: s('docs.segmentationEditor.shortcutsList.s'),
                },
                {
                  keys: 'D',
                  label: s('docs.segmentationEditor.shortcutsList.d'),
                },
                {
                  keys: 'Tab',
                  label: s('docs.segmentationEditor.shortcutsList.tab'),
                },
              ],
            },
            {
              title: s('docs.segmentationEditor.shortcutCategories.actions'),
              items: [
                {
                  keys: 'Ctrl+Z',
                  label: s('docs.segmentationEditor.shortcutsList.ctrlZ'),
                },
                {
                  keys: 'Ctrl+Y',
                  label: s('docs.segmentationEditor.shortcutsList.ctrlY'),
                },
                {
                  keys: 'Ctrl+S',
                  label: s('docs.segmentationEditor.shortcutsList.ctrlS'),
                },
                {
                  keys: 'Delete',
                  label: s('docs.segmentationEditor.shortcutsList.delete'),
                },
                {
                  keys: 'Enter',
                  label: s('docs.segmentationEditor.shortcutsList.enter'),
                },
                {
                  keys: 'Esc',
                  label: s('docs.segmentationEditor.shortcutsList.escape'),
                },
              ],
            },
            {
              title: s('docs.segmentationEditor.shortcutCategories.view'),
              items: [
                {
                  keys: '+  −',
                  label: s('docs.segmentationEditor.shortcutsList.zoom'),
                },
                {
                  keys: 'R  0',
                  label: s('docs.segmentationEditor.shortcutsList.reset'),
                },
                {
                  keys: 'Alt / Space',
                  label: s('docs.segmentationEditor.shortcutsList.pan'),
                },
                {
                  keys: 'H  ?',
                  label: s('docs.segmentationEditor.shortcutsList.help'),
                },
              ],
            },
          ],
        },
        {
          kind: 'heading',
          text: s('docs.segmentationEditor.workingWithPolygons'),
        },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.segmentationEditor.polygonSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
            'step5',
          ]),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.segmentationEditor.saveNote'),
          text: s('docs.segmentationEditor.saveNoteText'),
        },
        { kind: 'heading', text: s('docs.segmentationEditor.typeSpecific') },
        {
          kind: 'list',
          items: list('docs.segmentationEditor.typeSpecificList', [
            'microtubules',
            'sperm',
            'disintegration',
          ]),
        },
      ],
    },

    {
      id: 'export-features',
      icon: Download,
      navLabel: s('docs.nav.exportFeatures'),
      title: s('docs.exportFeatures.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.exportFeatures.description') },
        { kind: 'heading', text: s('docs.exportFeatures.packageContents') },
        {
          kind: 'cards',
          items: [
            'originalImages',
            'visualizations',
            'annotations',
            'metrics',
          ].map(key => ({
            title: s(`docs.exportFeatures.contents.${key}.title`),
            lines: [s(`docs.exportFeatures.contents.${key}.description`)],
          })),
        },
        { kind: 'heading', text: s('docs.exportFeatures.annotationFormats') },
        {
          kind: 'list',
          items: list('docs.exportFeatures.formats', [
            'coco',
            'yolo',
            'json',
            'imagej',
            'cvat',
          ]),
        },
        { kind: 'heading', text: s('docs.exportFeatures.calculatedMetrics') },
        {
          kind: 'paragraph',
          text: s('docs.exportFeatures.metricsDescription'),
        },
        {
          kind: 'table',
          headers: [
            s('docs.exportFeatures.metricsTable.projectType'),
            s('docs.exportFeatures.metricsTable.sheet'),
          ],
          rows: [
            [
              s('docs.projectTypes.types.spheroid.name'),
              s('docs.exportFeatures.metricsTable.spheroid'),
            ],
            [
              s('docs.projectTypes.types.spheroidInvasive.name'),
              s('docs.exportFeatures.metricsTable.spheroidInvasive'),
            ],
            [
              s('docs.projectTypes.types.wound.name'),
              s('docs.exportFeatures.metricsTable.wound'),
            ],
            [
              s('docs.projectTypes.types.sperm.name'),
              s('docs.exportFeatures.metricsTable.sperm'),
            ],
            [
              s('docs.projectTypes.types.microtubules.name'),
              s('docs.exportFeatures.metricsTable.microtubules'),
            ],
            [
              s('docs.projectTypes.types.microcapsule.name'),
              s('docs.exportFeatures.metricsTable.microcapsule'),
            ],
            [
              s('docs.projectTypes.types.neurite.name'),
              s('docs.exportFeatures.metricsTable.neurite'),
            ],
          ],
        },
        { kind: 'heading', text: s('docs.exportFeatures.scaleTitle') },
        { kind: 'paragraph', text: s('docs.exportFeatures.scaleText') },
        { kind: 'heading', text: s('docs.exportFeatures.howToExport') },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.exportFeatures.exportSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
            'step5',
            'step6',
          ]),
        },
        {
          kind: 'note',
          tone: 'success',
          label: s('docs.exportFeatures.exportNote'),
          text: s('docs.exportFeatures.exportNoteText'),
        },
      ],
    },

    {
      id: 'automated-essays',
      icon: FlaskConical,
      navLabel: s('docs.nav.automatedEssays'),
      title: s('docs.automatedEssays.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.automatedEssays.description') },
        { kind: 'heading', text: s('docs.automatedEssays.howTo') },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.automatedEssays.steps', [
            'step1',
            'step2',
            'step3',
            'step4',
          ]),
        },
        { kind: 'heading', text: s('docs.automatedEssays.results') },
        {
          kind: 'list',
          items: list('docs.automatedEssays.resultsList', [
            'csv',
            'failures',
            'focus',
            'overlays',
            'annotations',
          ]),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.automatedEssays.focusNote'),
          text: s('docs.automatedEssays.focusNoteText'),
        },
        {
          kind: 'note',
          tone: 'warning',
          label: s('docs.automatedEssays.channelNote'),
          text: s('docs.automatedEssays.channelNoteText'),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.automatedEssays.retentionNote'),
          text: s('docs.automatedEssays.retentionNoteText'),
        },
      ],
    },

    {
      id: 'segmenter',
      icon: PenTool,
      navLabel: s('docs.nav.segmenter'),
      title: s('docs.segmenter.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.segmenter.description') },
        {
          kind: 'list',
          items: list('docs.segmenter.features', [
            'datasets',
            'classes',
            'polygons',
            'saving',
          ]),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.segmenter.scopeNote'),
          text: s('docs.segmenter.scopeNoteText'),
        },
      ],
    },

    {
      id: 'shared-projects',
      icon: Users,
      navLabel: s('docs.nav.sharedProjects'),
      title: s('docs.sharedProjects.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.sharedProjects.description') },
        { kind: 'heading', text: s('docs.sharedProjects.sharingFeatures') },
        {
          kind: 'list',
          items: list('docs.sharedProjects.features', [
            'collaborative',
            'emailInvite',
            'linkShare',
            'revokeAccess',
            'multipleCollaborators',
          ]),
        },
        { kind: 'heading', text: s('docs.sharedProjects.howToShare') },
        {
          kind: 'list',
          ordered: true,
          items: list('docs.sharedProjects.shareSteps', [
            'step1',
            'step2',
            'step3',
            'step4',
            'step5',
          ]),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.sharedProjects.permissionsNote'),
          text: s('docs.sharedProjects.permissionsNoteText'),
        },
      ],
    },

    {
      id: 'troubleshooting',
      icon: HelpCircle,
      navLabel: s('docs.nav.troubleshooting'),
      title: s('docs.troubleshooting.title'),
      blocks: [
        { kind: 'paragraph', text: s('docs.troubleshooting.description') },
        {
          kind: 'table',
          headers: [
            s('docs.troubleshooting.table.symptom'),
            s('docs.troubleshooting.table.cause'),
          ],
          rows: [
            'uploadRejected',
            'darkFrames',
            'noDetections',
            'wrongChannel',
            'colorsChange',
            'exportSlow',
            'lostEdits',
          ].map(key => [
            s(`docs.troubleshooting.items.${key}.symptom`),
            s(`docs.troubleshooting.items.${key}.cause`),
          ]),
        },
        {
          kind: 'note',
          tone: 'info',
          label: s('docs.troubleshooting.helpNote'),
          text: s('docs.troubleshooting.helpNoteText'),
        },
      ],
    },
  ];
}

/** Every searchable string of a section, flattened. */
export function sectionSearchText(section: DocsSection): string {
  const parts: string[] = [section.navLabel, section.title];
  for (const block of section.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        parts.push(block.text);
        break;
      case 'list':
        parts.push(...block.items);
        break;
      case 'note':
        parts.push(block.label, block.text);
        break;
      case 'cards':
        for (const item of block.items) {
          parts.push(item.title, ...item.lines);
        }
        break;
      case 'table':
        parts.push(...block.headers);
        for (const row of block.rows) parts.push(...row);
        break;
      case 'shortcuts':
        for (const group of block.groups) {
          parts.push(group.title);
          for (const item of group.items) parts.push(item.keys, item.label);
        }
        break;
    }
  }
  return parts.join('   ');
}
