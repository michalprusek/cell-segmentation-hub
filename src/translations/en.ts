export default {
  common: {
    appName: 'SpheroSeg',
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    cancelling: 'Cancelling...',
    deleting: 'Deleting...',
    apply: 'Apply',
    dismiss: 'Dismiss',
    delete: 'Delete',
    edit: 'Edit',
    actions: 'Actions',
    show: 'Show',
    hide: 'Hide',
    create: 'Create',
    search: 'Search',
    error: 'Error',
    success: 'Success',
    back: 'Back',
    signIn: 'Sign In',
    signUp: 'Sign Up',
    signOut: 'Sign Out',
    settings: 'Settings',
    profile: 'Profile',
    dashboard: 'Dashboard',
    project: 'Project',
    projects: 'Projects',
    polygon: 'Polygon',
    newProject: 'New Project',
    upload: 'Upload',
    uploadImages: 'Upload Images',
    recentAnalyses: 'Recent Analyses',
    noProjects: 'No Projects Found',
    noImages: 'No Images Found',
    createYourFirst: 'Create your first project to get started',
    tryAgain: 'Try Again',
    email: 'Email',
    password: 'Password',
    name: 'Name',
    description: 'Description',
    date: 'Date',
    status: 'Status',
    images: 'Images',
    image: 'Image',
    projectName: 'Project Name',
    projectDescription: 'Project Description',
    theme: 'Theme',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    account: 'Account',
    notifications: 'Notifications',
    passwordConfirm: 'Confirm Password',
    manageAccount: 'Manage your account',
    getStarted: 'Get Started',
    learnMore: 'Learn More',
    documentation: 'Documentation',
    changePassword: 'Change Password',
    deleteAccount: 'Delete Account',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    createAccount: 'Create Account',
    signInToAccount: 'Sign in to your account',
    sort: 'Sort',
    no_preview: 'No preview',
    // Navigation and UI
    openMenu: 'Open menu',
    logOut: 'Log out',
    // Error pages
    pageNotFound: 'Oops! Page not found',
    returnToHome: 'Return to Home',
    // Navigation
    next: 'Next',
    copy: 'Copy',
    close: 'Close',
    noImage: 'No Image',
    untitledImage: 'Untitled Image',
    rename: 'Rename',
    redirectingToDashboard: 'Redirecting to dashboard...',

    // Retry mechanism
    retry: 'Retry',
    retrying: 'Retrying...',
    retryAttempt: 'Retry attempt {{attempt}} of {{max}}',
    retryingIn: 'Retrying in {{seconds}} seconds...',
    nextRetryIn: 'Next retry in {{seconds}}s',
    operationFailed: 'Operation failed',
    unexpectedError: 'An unexpected error occurred',
    failedToLoad: 'Failed to load',
    loadingFailed: 'Loading failed. Please try again.',
    networkError: 'Network error. Please check your connection.',
    refreshPage: 'Refresh Page',
    tryAgainLater: 'Please try again later',
  },

  landing: {
    hero: {
      eyebrow:
        'Biomedical image segmentation · ÚTIA, Czech Academy of Sciences',
      title: 'Segmentation for every specimen you image.',
      subtitle:
        'Spheroids and their disintegration, scratch-assay wounds, sperm morphology, microtubule filaments, microcapsules — a trained model for each, one editor for all of them, and exports that ImageJ, COCO and YOLO already understand.',
      getStarted: 'Get started',
      learnMore: 'See what it handles',
    },
    specimens: {
      trayLabel: 'Pick a specimen',
      spheroid: {
        label: 'Spheroid',
        detail:
          'Bright-field, 2048 × 2048. One tumour spheroid, outlined in red by HRNet — the same contour the editor hands you to correct.',
        alt: 'Bright-field micrograph of a single tumour spheroid with its segmentation contour drawn around it in red.',
      },
      disintegration: {
        label: 'Disintegrating spheroid',
        detail:
          'Bright-field, 2048 × 2048, 48 hours into a disintegration assay. The dense core is green; every cell that has broken away from it is red. The Disintegration Index is computed from exactly this split.',
        alt: 'Bright-field micrograph of a spheroid breaking apart, its dense core outlined in green and each detached cell outlined in red.',
      },
      wound: {
        label: 'Scratch-assay wound',
        detail:
          'Scratch assay, 2048 × 2048. The open wound is the red boundary; the islands of cells inside it are blue and are subtracted from the wound area.',
        alt: 'Scratch-assay micrograph with the open wound outlined in red and four islands of cells inside it outlined in blue.',
      },
      sperm: {
        label: 'Sperm morphology',
        detail:
          'Bright-field, 1360 × 1024. Each cell is traced as three polylines instead of one blob — head in green, midpiece in amber, tail in cyan — so every segment can be measured on its own.',
        alt: 'Bright-field micrograph of two sperm cells, each traced by three coloured polylines: green head, amber midpiece, cyan tail.',
      },
      microtubule: {
        label: 'Microtubule filaments',
        detail:
          'IRM time-lapse, frame 30. Every filament gets its own centreline, and its colour comes from the track id — so it keeps that colour across the whole acquisition and a kymograph follows one filament rather than whatever is nearest.',
        alt: 'Interference-reflection micrograph of microtubules, each filament traced by a centreline in its own colour.',
      },
      microcapsule: {
        label: 'Microcapsules',
        detail:
          'Bright-field, 1280 × 1024. Two whole capsules are outlined in red — those are the ones that get an area, a perimeter and a compactness. The capsules the frame cuts off carry no red outline: the model flags them and the statistics leave them out.',
        alt: 'Bright-field micrograph of microcapsules, the two whole ones outlined in red and the ones cut off by the frame edge left without an outline.',
      },
    },
    about: {
      badge: 'Who builds it',
      title: 'Where the platform comes from',
      description1:
        'Our platform was developed by Bc. Michal Průšek, a student at the Faculty of Nuclear Sciences and Physical Engineering (FJFI) at Czech Technical University in Prague, under the supervision of Ing. Adam Novozámský, Ph.D.',
      description2:
        'This project is a collaboration with the group of Ing. Silvie Rimpelová, Ph.D. from the Institute of Biochemistry and Microbiology at UCT Prague (VŠCHT Praha).',
      description3:
        'It began with tumour spheroids and grew with the experiments our collaborators brought us: disintegration assays, scratch-assay wounds, sperm morphology, microtubule time-lapses and microcapsules. Each specimen type has its own trained model, its own metrics and its own export — behind one editor.',
      contactText: 'For inquiries, please contact us at',
    },
    acknowledgments: {
      badge: 'Acknowledgments',
      title: 'Special Thanks',
      lukasIntro: 'We thank',
      lukasName: 'Lukáš Veškrna',
      lukasContribution:
        'for contributing the complete wound-healing segmentation module to this platform.',
      visitPage: 'Visit page',
    },
    cta: {
      title: 'Bring your own images.',
      subtitle:
        'Create a project, choose the specimen type and upload a stack. The model runs on GPU and the result opens straight in the editor, ready to correct.',
      cardDescription: 'Sign-up is open — no invitation needed',
      createAccount: 'Create your account',
    },
    features: {
      badge: 'What it does',
      title: 'One editor, whatever is on the slide',
      subtitle:
        'Each specimen type gets its own model and its own metrics. Everything after that — editing, tracking, export — is the same workflow.',
      cards: {
        models: {
          title: 'A model per specimen type',
          description:
            'Choose the specimen type when you create the project and only the models that fit it are offered. Spheroids alone have five, from a 200 ms U-Net to a Mamba bottleneck for images from an unfamiliar microscope.',
        },
        stacks: {
          title: 'Time-lapses and stacks, not just stills',
          description:
            'MP4, AVI, MOV, MKV and WebM, multi-page TIFF and Nikon ND2 upload as a single item and expand into frames. Multi-channel acquisitions keep their channels, and you choose which one the model reads.',
        },
        tracking: {
          title: 'Identity that survives the frame slider',
          description:
            'Microtubules are matched from frame to frame by curve geometry, so a filament keeps its id and its colour across the whole acquisition — and a kymograph measures that filament, not whatever was nearest.',
        },
        corrections: {
          title: 'Correct anything by hand',
          description:
            'Drag vertices, slice a merged object in two, add points along a contour, join two polylines, relabel a class. Edits are saved with the image, not held in the browser.',
        },
        measurements: {
          title: 'Numbers, in files other tools open',
          description:
            'Area, perimeter, Feret diameter, polyline length and per-channel intensity, exported as XLSX alongside COCO, YOLO, ImageJ ROI sets and CVAT annotations.',
        },
        batch: {
          title: 'Sized for a whole experiment',
          description:
            'Batches of up to 10 000 images run on GPU, and the queue deprioritises whoever it just served, so one 600-frame time-lapse cannot hold up everyone else.',
        },
      },
    },
  },

  dashboard: {
    manageProjects: 'Manage your research projects and analyses',
    projectGallery: 'Project Gallery',
    projectGalleryDescription:
      'Browse and manage all your segmentation projects',
    statsOverview: 'Statistics Overview',
    totalProjects: 'Total Projects',
    activeProjects: 'Active Projects',
    totalImages: 'Total Images',
    totalAnalyses: 'Total Analyses',
    lastUpdated: 'Last Updated',
    noProjectsDescription:
      "You haven't created any projects yet. Create your first project to get started.",
    noImagesDescription: 'Upload some images to get started',
    searchProjectsPlaceholder: 'Search projects...',
    searchImagesPlaceholder: 'Search images by name...',
    sortBy: 'Sort by',
    name: 'Name',
    lastChange: 'Last Change',
    status: 'Status',
    // Stats overview
    stats: {
      totalProjects: 'Total Projects',
      totalProjectsDesc: 'Active studies',
      processedImages: 'Processed Images',
      processedImagesDesc: 'Successfully segmented',
      uploadedToday: 'Uploaded Today',
      uploadedTodayDesc: 'Microscopy images',
      storageUsed: 'Storage Used',
      totalSpaceUsed: 'Total space used',
      incompleteWarning:
        "Stats may be incomplete — couldn't load {{count}} project(s)",
    },
    completed: 'Completed',
    processing: 'Processing',
    pending: 'Pending',
    failed: 'Failed',
    storageUsed: 'Storage Used',
  },
  projects: {
    createProject: 'Create New Project',
    createProjectDesc:
      'Add a new project to organize your microscopy images and analyses.',
    projectType: 'Project Type',
    projectTypeUpdated: 'Project type updated',
    failedToUpdateProject: 'Failed to update project',
    changeProjectType: 'Change project type',
    typeChangeSegmentationsWarning:
      '{{count}} existing segmentation(s) may no longer match the new "{{type}}" export format. Re-segment to refresh metrics.',
    verified: 'Verified',
    toggleVerified: 'Toggle verified',
    projectVerified: 'Project marked as verified',
    projectUnverified: 'Project verification removed',
    failedToUpdateVerified: 'Failed to update verification status',
    types: {
      spheroid: 'Spheroids (standard)',
      spheroid_invasive: 'Disintegrated spheroids',
      wound: 'Wound healing',
      sperm: 'Sperm',
      microtubules: 'Microtubules',
      microcapsule: 'Microcapsules',
      neurite: 'Neurites & somas',
    },
    projectNamePlaceholder: 'e.g., HeLa cells, plate 3',
    projectDescPlaceholder: 'e.g., Drug-resistance screen, 48 h time course',
    creatingProject: 'Creating...',
    duplicateProject: 'Duplicate',
    shareProject: 'Share',
    deleteProject: 'Delete',
    openProject: 'Open Project',
    confirmDelete: 'Are you sure you want to delete this project?',
    projectCreated: 'Project created successfully',
    projectDeleted: 'Project deleted successfully',
    viewProject: 'View Project',
    projectImages: 'Project Images',
    noProjects: 'No projects found',
    projectSelection: 'Project Selection',
    selectProjectHeader: 'Select Project',
    selectProject: 'Select a project',
    imageDeleted: 'Image deleted successfully',
    deleteImageError: 'Failed to delete image',
    deleteImageFailed: 'Image deletion failed',
    imagesQueuedForSegmentation: '{{count}} images added to segmentation queue',
    imageQueuedForResegmentation: 'Image added to queue for re-segmentation',
    errorAddingToQueue: 'Error adding images to queue',
    imageAlreadyProcessing: 'Image is already being processed',
    processImageFailed: 'Failed to process image',
    selected: '{{count}} selected',
    deleteSelected: 'Delete Selected',
    segmentationCompleted: 'Segmentation completed for image',
    segmentationFailed: 'Segmentation failed',
    segmentationStarted: 'Segmentation has started',
    segmentationCompleteWithCount:
      'Segmentation complete! Found {{count}} objects',
    // Project management errors and messages
    failedToLoadProjects: 'Failed to load projects',
    projectNameRequired: 'Please enter a project name',
    mustBeLoggedIn: 'You must be logged in to create a project',
    failedToCreateProject: 'Failed to create project',
    serverResponseInvalid: 'Server response was invalid',
    projectCreatedDesc: '"{{name}}" is ready for images',
    descriptionOptional: 'Description (Optional)',
    noDescriptionProvided: 'No description provided',
    deleteDialog: {
      title: 'Confirm Deletion',
      description:
        'Are you sure you want to delete {{count}} selected images? This action cannot be undone.',
    },
  },
  errors: {
    noProjectOrUser:
      'No project or user selected. Please select a project from the list.',
    unknown: 'An unexpected error occurred. Please try again.',
    network:
      'Cannot connect to server. Check your internet connection and try again.',
    unauthorized: 'Your session has expired. Please sign in again.',
    forbidden:
      'You do not have permission for this action. Contact an administrator if you believe this is an error.',
    notFound:
      'The requested content was not found. It may have been deleted or moved.',
    conflict:
      'This email is already registered. Try signing in or use a different email.',
    invalidCredentials:
      'Invalid email or password. Please check your credentials.',
    validation:
      'The information provided is incorrect. Please check the form and correct any errors.',
    general: 'Something went wrong. Please try again in a moment.',
    server: 'The server is currently unavailable. Please try again later.',
    timeout: 'The request took too long. Check your connection and try again.',
    sessionExpired:
      'Your session has expired. Please sign in again to continue.',
    tooManyRequests: 'Too many requests. Please wait a moment and try again.',
    serverUnavailable:
      'Service temporarily unavailable. Please try again in a few minutes.',
    clientError: 'Request error. Please check your input and try again.',
    emailAlreadyExists:
      'This email is already registered. Try signing in or use a different email.',
    validationErrors: {
      projectNameRequired: 'Please enter a project name',
      loginRequired: 'You must be logged in to create a project',
      emailRequired: 'Email is required',
      passwordRequired: 'Password is required',
      invalidEmail: 'Please enter a valid email address',
      passwordTooShort: 'Password must be at least 6 characters',
      passwordsDoNotMatch: 'Passwords do not match',
      confirmationRequired: 'Please confirm your action',
      fieldRequired: 'This field is required',
    },
    operations: {
      loadProject:
        'Could not load the project. Check your connection and try again.',
      saveProject: 'Could not save project changes. Please try again.',
      uploadImage: 'Could not upload image. Check the file format and size.',
      deleteImage:
        'Cannot delete image. Try refreshing the page and repeating the action.',
      processImage:
        'Image processing failed. Try a different image or contact support.',
      segmentation:
        'Segmentation failed. Try using a different model or adjusting settings.',
      export: 'Data export failed. Check that data is available.',
      login: 'Sign in failed. Check your email and password.',
      logout: 'Sign out failed. Try closing your browser.',
      register: 'Registration failed. This email may already be in use.',
      updateProfile:
        'Could not update profile. Check the information provided.',
      changePassword: 'Could not change password. Check your current password.',
      deleteAccount:
        'Could not delete account. Contact support for assistance.',
      resetPassword: 'Password reset failed. Check the email address provided.',
      updateConsent: 'Could not update consent preferences. Please try again.',
      unshareProject: 'Failed to remove project from shared projects',
      deleteProject: 'Failed to delete project',
    },
    contexts: {
      dashboard: 'Dashboard error',
      project: 'Project error',
      image: 'Image error',
      segmentation: 'Segmentation error',
      export: 'Export error',
      auth: 'Authentication error',
      profile: 'Profile error',
      settings: 'Settings error',
    },
    deleteImages: 'Failed to delete selected images',
    deleteAnnotations: 'Failed to delete annotations',
  },
  images: {
    uploadImages: 'Upload Images or Videos',
    dragDrop: 'Drag & drop images or videos here',
    clickToSelect: 'or click to select files',
    acceptedFormats:
      'Images: JPEG, PNG, TIFF, BMP (max 20 MB) — Videos: MP4, AVI, MOV, MKV, WebM, ND2, multi-page TIFF (max 100 GB)',
    uploadProgress: 'Upload Progress',
    readyToUpload: 'Ready to Upload',
    uploadingTo: 'Select a project first',
    currentProject: 'current project',
    autoSegment: 'Auto-segment images after upload',
    uploadCompleted: 'Upload Completed',
    uploadFailed: 'Upload Failed',
    imagesUploaded: 'Images uploaded successfully',
    imagesFailed: 'Failed to upload images',
    viewAnalyses: 'View Analyses',
    noAnalysesYet: 'No analyses yet',
    runAnalysis: 'Run Analysis',
    viewResults: 'View Results',
    dropImagesHere: 'Drop the files here...',
    selectProjectFirst: 'Please select a project first',
    registerChannels: {
      promptTitle: 'Register channels?',
      help: 'Correct small shifts between channels at upload by aligning each to the first (translation only).',
      confirm: 'Register & upload',
      decline: 'Upload without registering',
    },
    projectRequired: 'You must select a project before you can upload images',
    pending: 'Pending',
    uploading: 'Uploading',
    processing: 'Processing',
    complete: 'Complete',
    error: 'Error',
    imageDeleted: 'Image deleted successfully',
    deleteImageFailed: 'Failed to delete image',
    deleteImageError: 'Error deleting image',
    imageAlreadyProcessing: 'Image is already being processed',
    processImageFailed: 'Failed to process image',
    upload: {
      inProgress:
        'Upload in progress. You can navigate away — check progress in the bottom-right corner.',
      uploading: 'Uploading {{success}}/{{total}} files',
      completed: '{{count}} files uploaded successfully',
      completedWithFailures: '{{success}} uploaded, {{failed}} failed',
      failed: 'Upload failed',
      cancelled: 'Upload cancelled',
      cancelButton: 'Cancel Upload',
      preparing: 'Preparing to upload {{count}} files...',
      alreadyInProgress: 'An upload is already in progress for this project',
      remaining: '~{{time}} remaining',
      project: 'Project:',
      view: 'View',
      filesProgress: '{{success}} of {{total}} files ({{percent}}%)',
      chunkProgress: 'Chunk {{current}}/{{total}}',
    },
  },
  settings: {
    pageTitle: 'Settings',
    profile: 'Profile',
    account: 'Account',
    manageSettings: 'Manage your account preferences',
    appearance: 'Appearance',
    themeSettings: 'Theme Settings',
    systemDefault: 'System Default',
    languageSettings: 'Language Settings',
    selectLanguage: 'Select Language',
    accountSettings: 'Account Settings',
    notificationSettings: 'Notification Settings',
    emailNotifications: 'Email Notifications',
    pushNotifications: 'Push Notifications',
    profileSettings: 'Profile Settings',
    profileUpdated: 'Profile updated successfully',
    profileUpdateFailed: 'Failed to update profile',
    saveChanges: 'Save Changes',
    savingChanges: 'Saving...',
    notifications: {
      projectUpdates: 'Project Updates',
      analysisCompleted: 'Analysis Completed',
      newFeatures: 'New Features',
      marketingEmails: 'Marketing Emails',
      billing: 'Billing Notifications',
    },
    personal: 'Personal Information',
    fullName: 'Full Name',
    organization: 'Organization',
    department: 'Department',
    publicProfile: 'Public Profile',
    bio: 'Bio',
    makeProfileVisible: 'Make my profile visible to other researchers',
    dangerZone: 'Danger Zone',
    deleteAccountWarning:
      'Once you delete your account, there is no going back. All your data will be permanently deleted.',
    currentPassword: 'Current Password',
    newPassword: 'New Password',
    confirmNewPassword: 'Confirm New Password',
    models: 'Models',
    modelSelection: {
      title: 'Model Selection',
      description: 'Choose the AI model to use for cell segmentation',
      sections: {
        spheroid: 'Spheroid Models',
        spheroid_invasive: 'Disintegrated Spheroid Models',
        sperm: 'Sperm Models',
        wound: 'Wound Healing Models',
        microtubule: 'Microtubule Models',
        microcapsule: 'Microcapsule Models',
        neurite: 'Neurite / Soma Models',
      },
      presets: {
        fast: 'Fast',
        accurate: 'Accurate',
        robust: 'Robust',
        showMore: 'Show additional models',
        showLess: 'Hide additional models',
      },
      presetDescriptions: {
        fast: 'Real-time preview, large batches, weak GPU',
        accurate: 'Labs with HQ-like images, when time is not critical',
        robust:
          'External labs, unknown optics, drug-treated, unusual morphologies',
      },
      models: {
        hrnet: {
          name: 'HRNet',
          description:
            'Fast and efficient model (~0.2s/image, 5.5 img/s throughput)',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description:
            'Precise segmentation with attention (~0.3s/image, 3.0 img/s throughput)',
        },
        unet_spherohq: {
          name: 'UNet (SpheroHQ)',
          description:
            'Best performance on SpheroHQ dataset - optimized for spheroid segmentation with balanced speed and accuracy (~0.25s/image, 10 img/s)',
        },
        spheroid_disintegration: {
          name: 'Spheroid Disintegration',
          description:
            'UNet++ with an EfficientNet-B5 encoder — 3-class segmentation (background / corona / dense core) of disintegrating spheroids; predicts the core directly for a correct Disintegration Index (~0.7s/image)',
        },
        segformer: {
          name: 'SegFormer',
          description:
            'Transformer-based model (SegFormer-B0) for bright-field spheroids — highest accuracy (93% IoU) and very fast (~13 ms/image)',
        },
        mamba_unet: {
          name: 'Mamba-UNet',
          description:
            'U-Net with a bidirectional Mamba (state-space) bottleneck — best robustness on out-of-distribution images (unknown optics, drug-treated, unusual morphologies)',
        },
        sperm: {
          name: 'Sperm Morphology',
          description:
            'Sperm morphology model with skeleton extraction for head/midpiece/tail measurement',
        },
        wound: {
          name: 'Wound Healing (Scratch Assay)',
          description:
            'U-Net with MiT-B5 (SegFormer) encoder for binary wound segmentation in scratch-assay microscopy (~32 ms on A5000, 90% IoU on external test set)',
        },
        microtubule: {
          name: 'Microtubule (ResEnc-M + curvature instancer)',
          description:
            'Instance segmentation for IRM microtubule time-lapses. An nnU-Net ResEnc-M network predicts the filament foreground, then a curvature-bounded instancer separates it into individual centerlines, resolving every crossing under a hard 0.25 rad/px bound. Trained entirely on synthetic frames — no human annotation. ~4.5 s/frame; the only model in the platform with native polyline output.',
        },
        microcapsule: {
          name: 'Microcapsule',
          description:
            'Instance segmentation for microcapsules (round objects) in bright-field microscopy. A compact U-Net distilled from Meta SAM 3 returns one clean, full-resolution boundary per capsule and separates touching capsules with a watershed; capsules cut off by the image border are excluded from the metrics (area, perimeter, compactness).',
        },
        neurite_soma: {
          name: 'Neurite / Soma (nnU-Net ResEnc-M)',
          description:
            'Two-class semantic segmentation of neurons in fluorescence microscopy — neurite (processes) and soma (cell body) — from the tubulin channel alone. nnU-Net v2 ResEnc-M, 3-fold ensemble with mirroring TTA and a clDice topology term on the neurite class. Held-out Dice 0.832 neurite / 0.915 soma.',
        },
      },
    },
    detectHoles: 'Detect Holes',
    detectHolesDescription:
      'Enable detection of internal structures and holes within cells',
    modelSelected: 'Model selected successfully',
    modelSettingsSaved: 'Model settings saved successfully',
    modelSize: {
      small: 'Small',
      medium: 'Medium',
      large: 'Large',
    },
    modelDescription: {
      hrnet:
        'Balanced model with good speed and quality (E2E ~309ms, 4.9 img/s)',
      cbam_resunet:
        'Most precise segmentation with attention mechanisms (E2E ~482ms, 2.7 img/s)',
      unet_spherohq:
        'Fastest model after optimizations! Excellent for real-time processing (E2E ~286ms, 5.5 img/s)',
      spheroid_disintegration:
        'UNet++ / EfficientNet-B5 3-class model (background / corona / core) for disintegrating spheroids; predicts the dense core directly for a correct Disintegration Index (30.7M params)',
      segformer:
        'Transformer-based SegFormer-B0 model trained on the SpheroMix dataset. Highest spheroid accuracy in the platform (93% IoU) while being the smallest and fastest model (~13 ms/image).',
      mamba_unet:
        'U-Net with a bidirectional Mamba (state-space) bottleneck (90.75M params). Best out-of-distribution generalization in the platform (HTS-Seg IoU 0.587) — built for external labs, unknown optics, drug-treated and unusual spheroid morphologies.',
      sperm:
        'Sperm morphology model with skeleton extraction for head, midpiece, and tail measurement',
      wound:
        'U-Net + MiT-B5 (SegFormer encoder) model for wound segmentation in scratch-assay microscopy. Single binary wound region per image; ideal for healing-rate timelapses.',
      microtubule:
        'Microtubule instance segmentation for IRM microscopy. nnU-Net ResEnc-M network, curvature-bounded instancer, native polyline output with geometric cross-frame tracking.',
      microcapsule:
        'Compact U-Net (distilled from Meta SAM 3) for microcapsule instance segmentation — area, perimeter and compactness per capsule, with border-cut capsules excluded from metrics.',
      neurite_soma:
        'nnU-Net v2 ResEnc-M (2D, 3-fold ensemble) for neurite and soma segmentation in fluorescence microscopy. Reads the tubulin channel; held-out Dice 0.832 neurite / 0.915 soma. Trained on Leica confocal data at ~0.180 µm/px — validate soma counts on a different pixel size.',
    },
    dataUsageTitle: 'Data Usage & Privacy',
    dataUsageDescription:
      'Control how your data is used for machine learning and research',
    allowMLTraining: {
      label: 'Allow ML Model Training',
      description:
        'Allow your data to be used for training and improving our segmentation models',
    },
    consent: {
      privacyNotice:
        'Your data privacy is important to us. These settings control how your uploaded images and segmentation data may be used to improve our ML models. You can change these preferences at any time.',
      dataUsageNote:
        'Data from users who opt out will not be included in any training pipelines.',
      algorithmImprovement: {
        label: 'Algorithm Improvement',
        description: 'Use data to enhance segmentation accuracy and speed',
      },
      featureDevelopment: {
        label: 'Feature Development',
        description: 'Help develop new features and capabilities',
      },
      lastUpdated: 'Last updated',
      savePreferences: 'Save Consent Preferences',
      savingPreferences: 'Saving...',
    },
    cancel: 'Cancel',
    deleting: 'Deleting...',
    deleteAccount: 'Delete Account',
    accountDeleted: 'Account deleted successfully',
    deleteAccountError: 'Failed to delete account',
    deleteAccountDialog: {
      title: 'Delete Account',
      description:
        'This action cannot be undone. This will permanently delete your account and remove all of your data from our servers.',
      whatWillBeDeleted: 'What will be deleted:',
      deleteItems: {
        account: 'Your user account and profile',
        projects: 'All your projects and images',
        segmentation: 'All segmentation data and results',
        settings: 'Account settings and preferences',
      },
      confirmationLabel: 'Please type {email} to confirm:',
      confirmationPlaceholder: 'Enter email to confirm',
    },
    fillAllFields: 'Please fill in all required fields',
    passwordsDoNotMatch: 'Passwords do not match',
    passwordTooShort: 'Password must be at least 6 characters',
    passwordChanged: 'Password changed successfully',
    passwordsMatch: 'Passwords match',
    changingPassword: 'Changing password...',
    changePassword: 'Change Password',
    languageUpdated: 'Language updated successfully',
    themeUpdated: 'Theme updated successfully',
    appearanceDescription: 'Customize the appearance of the application',
    language: 'Language',
    languageDescription: 'Select your preferred language',
    theme: 'Theme',
    themeDescription: 'Choose light, dark, or system theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
  segmentation: {
    selection: {
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      selected: '{{count}} selected',
    },
    trackOps: {
      propagateSelectedSuccess:
        'Propagated {{count}} microtubules to the following frames',
      propagateSelectedPartial: '{{done}} of {{total}} microtubules propagated',
      propagateSuccess:
        'Microtubule propagated to {{count}} following frame(s)',
      propagateFailed: 'Failed to propagate the microtubule',
      deleteTrackSuccess: 'Track removed from {{count}} frame(s)',
      deleteTrackFailed: 'Failed to delete the track',
    },
    modelNotCompatible:
      'Model "{{model}}" is not compatible with project type "{{type}}". Allowed: {{allowed}}.',
    incompatibleModelTitle: 'Cannot segment with this model',
    incompatibleModelDesc:
      'The currently selected model "{{model}}" is not compatible with this project\'s type ({{type}}). Allowed models for this type: {{allowed}}. Please change the model in Settings or change the project type.',
    channelPicker: {
      title: 'Select channel to segment',
      description:
        'This project contains video frames with multiple channels. Choose which channel to segment.',
      confirm: 'Segment',
    },
    mode: {
      view: 'View and navigate',
      edit: 'Edit',
      editVertices: 'Edit vertices',
      addPoints: 'Add points',
      create: 'Create',
      createPolygon: 'Create polygon',
      createPolyline: 'Create Polyline',
      slice: 'Slice',
      delete: 'Delete',
      deletePolygon: 'Delete polygon',
      unknown: 'Unknown',
    },
    shortcuts: {
      buttonText: 'Shortcuts',
      title: 'Keyboard Shortcuts',
      dialogTitle: 'Keyboard Shortcuts',
      footerNote:
        'These shortcuts work within the segmentation editor for faster and more convenient work.',

      // Categories
      categories: {
        modes: 'Edit Modes',
        actions: 'Actions',
        view: 'View Controls',
        navigation: 'Navigation',
      },

      // Mode shortcuts
      viewMode: 'View mode',
      editVertices: 'Edit vertices mode',
      addPoints: 'Add points mode',
      createPolygon: 'Create new polygon',
      sliceMode: 'Slice mode',
      deleteMode: 'Delete mode',

      // Action shortcuts
      save: 'Save',
      undo: 'Undo',
      redo: 'Redo',
      deleteSelected: 'Delete selected polygon',
      finishShape: 'Finish the current shape',

      // View shortcuts
      zoom: 'Zoom in/out',
      resetView: 'Reset view',
      fitToScreen: 'Fit to screen',

      // Navigation shortcuts
      cycleModes: 'Cycle through modes',
      cycleModesReverse: 'Cycle modes (reverse)',
      cancel: 'Cancel current operation',
      showHelp: 'Show this help',

      // Conditions
      requiresSelection: 'Requires polygon selection',

      // Legacy keys (kept for backward compatibility)
      v: 'View mode',
      e: 'Edit vertices mode',
      a: 'Add points mode',
      n: 'Create new polygon',
      s: 'Slice mode',
      d: 'Delete mode',
      shift: 'Hold for automatic point addition',
      ctrlZ: 'Undo',
      ctrlY: 'Redo',
      delete: 'Delete selected polygon',
      esc: 'Cancel current operation',
      plus: 'Zoom in',
      minus: 'Zoom out',
      r: 'Reset view',
    },
    tips: {
      header: 'Tips:',
      edit: {
        createPoint: 'Click to create a new point',
        holdShift: 'Hold Shift to automatically create sequence of points',
        closePolygon: 'Close polygon by clicking on the first point',
      },
      slice: {
        startSlice: 'Click to start slice',
        endSlice: 'Click again to complete slice',
        cancelSlice: 'Esc cancels slicing',
      },
      addPoints: {
        hoverLine: 'Hover cursor over polygon line',
        clickAdd: 'Click to add point to selected polygon',
        escCancel: 'Esc ends add mode',
      },
    },
    helpTips: {
      editMode:
        'Click to create a new point. Hold Shift to automatically create sequence of points. Close polygon by clicking on the first point.',
      slicingMode:
        'Click to start slice. Click again to finish slice. Esc cancels slicing.',
      pointAddingMode:
        'Hover cursor over polygon line. Click to add point to selected polygon. Esc exits adding mode.',
    },
    modeDescription: {
      view: 'Navigate and select polygons',
      edit: 'Move and modify vertices',
      addPoints: 'Add points between vertices',
      create: 'Create new polygons',
      createPolyline: 'Click to place points, double-click to finish polyline',
      slice: 'Split polygons with a line',
      delete: 'Remove polygons',
    },
    toolbar: {
      mode: 'Mode',
      keyboard: 'Key: {{key}}',
      requiresSelection: 'Requires polygon selection',
      requiresPolygonSelection: 'Requires polygon selection',
      resegment: 'Resegment frame',
      resegmentTooltipModel: 'Model: {{model}} · {{threshold}}',
      resegmentSuccess: 'Frame resegmented',
      resegmentFailed: 'Resegmentation failed',
      resegmentConfirmTitle: 'Replace existing polygons?',
      resegmentConfirmDescription:
        'Running the model will overwrite the current segmentation. Manual edits to polygons on this frame will be lost.',
      select: 'Select',
      undoTooltip: 'Undo (Ctrl+Z)',
      undo: 'Undo',
      redoTooltip: 'Redo (Ctrl+Y)',
      redo: 'Redo',
      zoomInTooltip: 'Zoom In (+)',
      zoomIn: 'Zoom In',
      zoomOutTooltip: 'Zoom Out (-)',
      zoomOut: 'Zoom Out',
      resetViewTooltip: 'Reset View (R)',
      resetView: 'Reset',
      unsavedChanges: 'Unsaved changes',
      saving: 'Saving...',
      save: 'Save',
      keyboardShortcuts:
        'V: View • E: Edit • A: Add • N: New • S: Slice • D: Delete',
      nothingToSave: 'All changes saved',
    },
    status: {
      polygons: 'polygons',
      vertices: 'vertices',
      visible: 'visible',
      hidden: 'hidden',
      selected: 'selected',
      saved: 'Saved',
      unsaved: 'Unsaved',
      noPolygons: 'No polygons',
      startCreating: 'Start by creating a polygon',
      polygonList: 'Polygon List',
      external: 'External',
      internal: 'Internal',
      polyline: 'Polyline',
    },
    // Object classes of the neurite/soma model. Deliberately NOT under
    // `sperm.part` — different model, different vocabulary.
    partClass: {
      neurite: 'Neurite',
      soma: 'Soma',
    },
    loading: 'Loading segmentation...',
    noPolygons: 'No polygons found',
    polygonNotFound: 'Polygon not found',
    invalidSlice: 'Invalid slice operation',
    sliceSuccess: 'Polygon sliced successfully',
    sliceFailed: 'Failed to slice polygon',
    instructions: {
      slice: {
        selectPolygon: '1. Click on a polygon to select it for slicing',
        placeFirstPoint: '2. Click to place the first slice point',
        placeSecondPoint:
          '3. Click to place the second slice point and perform slice',
        cancel: 'Press ESC to cancel',
      },
      create: {
        startPolygon: '1. Click to start creating a polygon',
        continuePoints:
          '2. Continue clicking to add more points (at least 3 needed)',
        finishPolygon:
          '3. Continue adding points or click near the first point to close the polygon',
        holdShift: 'Hold SHIFT to automatically add points',
        cancel: 'Press ESC to cancel',
      },
      createPolyline: {
        start: 'Click to place the first point of the microtubule',
        finish: 'Press Enter or double-click to finish the microtubule',
        holdShift: 'Hold SHIFT to add points automatically',
        cancel: 'Press ESC to cancel',
      },
      addPoints: {
        clickVertex: 'Click on any vertex to start adding points',
        clickVertexMt: 'Click a microtubule endpoint to start extending it',
        addPointsMt: 'Click to add points, then press Enter to finish',
        addPoints:
          'Click to add points, then click on another vertex to complete. Click directly on another vertex without adding points to remove all points between them.',
        holdShift: 'Hold SHIFT to automatically add points',
        cancel: 'Press ESC to cancel',
        joinHint:
          'Click another polyline endpoint of the same class to join them',
      },
      editVertices: {
        selectPolygon: 'Click on a polygon to select it for editing',
        dragVertices: 'Click and drag vertices to move them',
        addPoints: 'Hold SHIFT and click a vertex to add points',
        deleteVertex: 'Double-click a vertex to delete it',
      },
      deletePolygon: {
        clickToDelete: 'Click on a polygon to delete it',
      },
      view: {
        selectPolygon: 'Click on a polygon to select it',
        navigation: 'Drag to pan • Scroll to zoom',
      },
      modes: {
        slice: 'Slice Mode',
        create: 'Create Polygon Mode',
        createPolyline: 'Create Microtubule Mode',
        addPoints: 'Add Points Mode',
        editVertices: 'Edit Vertices Mode',
        deletePolygon: 'Delete Polygon Mode',
        view: 'View Mode',
      },
      shiftIndicator: '⚡ SHIFT: Auto-adding points',
    },
  },
  auth: {
    signIn: 'Sign In',
    signUp: 'Sign Up',
    redirectingToDashboard: 'Redirecting to dashboard...',
    signOut: 'Sign Out',
    forgotPassword: 'Forgot Password?',
    resetPassword: 'Reset Password',
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: 'Already have an account?',
    signInWith: 'Sign in with',
    signUpWith: 'Sign up with',
    orContinueWith: 'or continue with',
    rememberMe: 'Remember me',
    emailRequired: 'Email is required',
    passwordRequired: 'Password is required',
    invalidEmail: 'Invalid email address',
    passwordTooShort: 'Password must be at least 6 characters',
    passwordsDontMatch: "Passwords don't match",
    successfulSignIn: 'Successfully signed in',
    successfulSignUp: 'Registration successful',
    verifyEmail: 'Please check your email to confirm your account',
    successfulSignOut: 'Signed out successfully',
    signOutFailed: 'Could not sign out. Please try again.',
    checkingAuthentication: 'Checking authentication...',
    loadingAccount: 'Loading your account...',
    processingRequest: 'Processing your request...',
    // SignIn page specific
    signInToAccount: 'Sign in to your account',
    accessPlatform: 'Access the microscopy segmentation platform',
    emailAddress: 'Email address',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: '••••••••',
    signingIn: 'Signing in...',
    redirectingToSignIn: 'Redirecting to sign-in...',
    fillAllFields: 'Please fill in all fields',
    // Toast messages
    signInSuccess: 'Successfully signed in',
    signInFailed: 'Sign in failed',
    registrationSuccess: 'Registration successful',
    registrationFailed: 'Registration failed',
    logoutFailed: 'Logout failed',
    profileUpdateFailed: 'Profile update failed',
    tokenMissing: 'Authentication token missing',
    tokenExpired: 'Authentication token expired',
    pleaseSignInAgain: 'Please sign in again',
    welcomeMessage: 'Welcome to the microscopy segmentation platform',
    confirmationRequired:
      'Confirmation text is required and must match your email address',
    agreeToTerms: 'By signing in, you agree to our',
    termsOfService: 'Terms of Service',
    and: 'and',
    privacyPolicy: 'Privacy Policy',
    // SignUp page specific
    createAccount: 'Create your account',
    signUpPlatform: 'Sign up to use the microscopy segmentation platform',
    confirmPassword: 'Confirm Password',
    passwordsMatch: 'Passwords match',
    passwordsDoNotMatch: 'Passwords do not match',
    agreeToTermsCheckbox: 'I agree to the',
    mustAgreeToTerms: 'You must agree to the terms and conditions',
    creatingAccount: 'Creating account...',
    alreadyLoggedIn: "You're already logged in",
    alreadySignedUp: "You're already signed up and logged in.",
    goToDashboard: 'Go to Dashboard',
    signUpFailed: 'Sign up failed',
    // Forgot Password specific
    enterEmailForReset: 'Enter your email address to reset password',
    sending: 'Sending...',
    sendNewPassword: 'Send New Password',
    emailSent: 'Email Sent',
    checkEmailForNewPassword: 'Check your email for new password',
    resetPasswordEmailSent:
      'If email exists, an email with new password was sent',
    resetPasswordError: 'Failed to send password reset email',
    backToSignIn: 'Back to Sign In',
    didntReceiveEmail: "Didn't receive email?",
    rememberPassword: 'Remember your password?',
    tryAgain: 'Try Again',
    // Reset Password page specific
    enterNewPassword: 'Enter your new password',
    newPassword: 'New Password',
    confirmPasswordPlaceholder: 'Confirm your password',
    passwordRequirements: 'Password must be at least 8 characters long',
    resettingPassword: 'Resetting password...',
    passwordResetSuccess: 'Password Reset Successful',
    passwordResetSuccessMessage:
      'Your password has been successfully reset. You can now sign in with your new password.',
    invalidResetToken: 'Invalid Reset Link',
    invalidResetTokenMessage:
      'This password reset link is invalid or has expired. Please request a new password reset.',
    requestNewReset: 'Request New Reset',
  },
  profile: {
    title: 'Profile',
    about: 'About',
    activity: 'Activity',
    projects: 'Projects',
    papers: 'Papers',
    analyses: 'Analyses',
    recentProjects: 'Recent Projects',
    recentAnalyses: 'Recent Analyses',
    accountDetails: 'Account Details',
    accountType: 'Account Type',
    joinDate: 'Join Date',
    lastActive: 'Last Active',
    projectsCreated: 'Projects Created',
    imagesUploaded: 'Images Uploaded',
    segmentationsCompleted: 'Segmentations Completed',
    editProfile: 'Edit Profile',
    joined: 'Joined',
    copyApiKey: 'Copy API Key',
    collaborators: 'Collaborators',
    noCollaborators: 'No collaborators',
    connectedAccounts: 'Connected Accounts',
    connect: 'Connect',
    recentActivity: 'Recent Activity',
    noRecentActivity: 'No recent activity',
    statistics: 'Statistics',
    totalImagesProcessed: 'Total Images Processed',
    averageProcessingTime: 'Average Processing Time',
    fromLastMonth: 'from last month',
    storageUsed: 'Storage Used',
    of: 'of',
    apiRequests: 'API Requests',
    thisMonth: 'this month',
    recentPublications: 'Recent Publications',
    viewAll: 'View All',
    noPublications: 'No publications yet',
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: 'days ago',
    completionRate: 'completion rate',
    createdProject: 'Created project',
    completedSegmentation: 'Completed segmentation for',
    uploadedImage: 'Uploaded image',
    avatar: {
      uploadButton: 'Upload Avatar',
      selectFile: 'Select avatar image',
      cropTitle: 'Crop Your Avatar',
      cropDescription: 'Crop your avatar image to fit perfectly',
      zoomLevel: 'Zoom Level',
      cropInstructions: 'Drag to reposition, use slider to zoom',
      applyChanges: 'Apply Changes',
      processing: 'Processing...',
      invalidFileType: 'Invalid file type. Please select an image file.',
      fileTooLarge: 'File too large. Maximum size is 5MB.',
      cropError: 'Error processing image. Please try again.',
      uploadSuccess: 'Avatar uploaded successfully',
      uploadError: 'Failed to upload avatar. Please try again.',
    },
  },
  status: {
    segmented: 'Segmented',
    processing: 'Processing',
    queued: 'Queued',
    failed: 'Failed',
    no_segmentation: 'No segmentation',
    disconnected: 'Disconnected from server',
    error: 'ML service error',
    ready: 'Ready for segmentation',
    online: 'Online',
    offline: 'Offline',
    noPolygons: 'No polygons',
  },
  queue: {
    title: 'Segmentation Queue',
    connected: 'Connected',
    disconnected: 'Disconnected',
    waiting: 'waiting',
    processing: 'processing',
    resegmentSelected: 'Re-segment Selected ({{count}})',
    segmentSelected: 'Segment Selected',
    segmentSelectedWithCount: 'Segment Selected ({{count}})',
    selectNothingTooltip: 'Select images to segment',
    segmentMixed:
      'Segment {{new}} + Re-segment {{resegment}} ({{total}} total)',
    segmentTooltip:
      '{{new}} new images will be segmented, {{resegment}} selected images will be re-segmented',
    totalProgress: 'Total Progress',
    images: 'images',
    loadingStats: 'Loading statistics...',
    connectingMessage:
      'Connecting to server... Real-time updates will be available soon.',
    emptyMessage:
      'No images in queue. Upload images and add them to the queue for segmentation.',
    addingToQueue: 'Adding to queue...',
    cancelSegmentation: 'Cancel Segmentation',
    segmentationCancelled: '{{count}} segmentation cancelled',
    segmentationCancelled_other: '{{count}} segmentations cancelled',
    cancelFailed: 'Failed to cancel segmentation',
    // Cancel All functionality
    cancelAll: 'Cancel All',
    cancelAllTooltip: 'Cancel all {{count}} segmentation task(s)',
    confirmCancelAll: 'Cancel All Segmentations?',
    confirmCancelAllDescription:
      'You are about to cancel {{count}} segmentation task(s) across all your projects.',
    processingTasks: '{{count}} task(s) currently processing',
    queuedTasks: '{{count}} task(s) queued',
    cancelAllWarning:
      'This action cannot be undone. Cancelled tasks will need to be resubmitted.',
    confirmCancelAllButton: 'Yes, Cancel {{count}} Task(s)',
    cancellingAllSegmentations: 'Cancelling all segmentations...',
    allSegmentationsCancelled:
      'Successfully cancelled {{count}} segmentation(s)',
    affectedProjects: 'Affected {{count}} project(s)',
    cancelAllFailed: 'Failed to cancel segmentations',
    cancelAllError: 'Error cancelling segmentations',
    cancelling: 'Cancelling...',
    // Parallel processing
    processingSlots: 'Processing Slots',
    parallel: 'parallel',
    users: 'users',
    active: 'active',
    you: 'You',
    yourSlot: 'Your slot: #{{slot}}',
    concurrentUsers: 'Also processing: {{users}}',
    availableSlots: '{{count}} slot available',
    availableSlots_other: '{{count}} slots available',
    yourPosition: 'Your position',
    estimatedWait: 'Est. wait',
    allSlotsActive:
      'All processing slots are active - maximum parallel processing capacity reached',
    slotAvailable:
      'Processing slot available! Position #{{position}} (~{{waitTime}}m wait)',
  },
  toast: {
    // Generic messages
    error: 'An error occurred',
    success: 'Operation successful',
    info: 'Information',
    warning: 'Warning',
    loading: 'Loading...',
    // Common errors
    failedToUpdate: 'Failed to update data. Please try again.',
    fillAllFields: 'Please fill in all fields',
    operationFailed: 'Operation failed. Please try again.',
    // Error boundary
    unexpectedError: 'Unexpected Error',
    somethingWentWrong: 'Something went wrong. Please try again later.',
    somethingWentWrongPage: 'Something went wrong while loading this page.',
    returnToHome: 'Return to Home',
    // Project actions
    project: {
      created: 'Project created successfully',
      createFailed: 'Failed to create project',
      deleted: 'Project deleted successfully',
      deleteFailed: 'Failed to delete project',
      urlCopied: 'Project URL copied to clipboard',
      unshared: 'Project removed from shared',
      notFound: 'Project not found',
      invalidResponse: 'Server response was invalid',
      readyForImages: 'is ready for images',
      selected: '{{count}} image selected',
      selected_other: '{{count}} images selected',
      deleteSelected: 'Delete Selected',
    },
    // Profile actions
    profile: {
      consentUpdated: 'Consent preferences updated successfully',
      loadFailed: 'Failed to load profile data',
    },
    // Upload actions
    upload: {
      failed: 'Failed to refresh images after upload',
      cancelUpload: 'Cancel Upload',
      uploadCancelled: 'Upload cancelled',
      uploadCancelledSuccess: 'Upload cancelled successfully',
      redirectingToGallery: 'Redirecting to image gallery...',
    },
    // Segmentation actions
    segmentation: {
      saved: 'Segmentation saved successfully',
      failed: 'Segmentation failed',
      deleted: 'Polygon deleted',
      cannotDeleteVertex:
        'Cannot delete vertex - polygon needs at least 3 points',
      vertexDeleted: 'Vertex deleted successfully',
      started: 'Segmentation has started',
      completed: 'Segmentation completed successfully',
      completedWithCount: 'Segmentation complete! Found {{count}} objects',
      batchStarted: 'Segmentation started for {{count}} images',
      batchCompleted:
        '✅ {{count}} images segmented successfully ({{duration}}s)',
      batchCompletedWithErrors:
        '⚠️ Batch completed: {{successful}} successful, {{failed}} failed ({{duration}}s)',
      noPolygons: 'No segmentation polygons detected',
      reloadFailed:
        'Failed to load segmentation results. Please refresh the page.',
      autosaveFailed: 'Autosave failed - changes may be lost',
    },
    // Multi-channel canvas actions
    multiChannel: {
      allChannelsFailed: 'Failed to load image channels',
      someChannelsFailed: 'Some image channels failed to load',
    },
    // Success messages
    operationCompleted: 'Operation completed successfully',
    dataSaved: 'Data saved successfully',
    dataUpdated: 'Data updated successfully',
    // Connection messages
    reconnecting: 'Reconnecting to server...',
    reconnected: 'Connection to server restored',
    connectionFailed: 'Failed to restore connection to server',
    // Segmentation messages
    segmentationRequested: 'Segmentation request submitted',
    segmentationCompleted: 'Image segmentation completed',
    segmentationFailed: 'Segmentation failed',
    segmentationResultFailed: 'Failed to get segmentation result',
    segmentationStatusFailed: 'Failed to check segmentation status',
    // Export messages
    exportCompleted: 'Export completed successfully!',
    exportFailed: 'Export failed. Please try again.',
  },
  project: {
    selected: '{{count}} image selected',
    selected_other: '{{count}} images selected',
    deleteSelected: 'Delete Selected',
    deleteAnnotations: 'Delete Annotations',
    addChannel: 'Add channel',
    addChannelSuccess: 'Added channel {{channels}} to {{frames}} frame(s)',
    addChannelAlignWarning:
      'Alignment failed on {{failed}} of {{frames}} frame(s) — only {{shifted}} were registered. The channels could not be correlated (no shared structure); the frames were added unshifted.',
    addChannelAlignWarningImplausible:
      'Alignment failed on {{failed}} of {{frames}} frame(s) — only {{shifted}} were registered. A clear offset was found but it was too large to be plausible, so it was discarded and the frames were added unshifted. Check that the added channel comes from the same field of view and is not cropped or shifted relative to the target video.',
    addChannelAlignWarningShape:
      'Alignment failed on {{failed}} of {{frames}} frame(s) — only {{shifted}} were registered. The added channel and the target frames have different pixel dimensions, so they could not be aligned; the frames were added unshifted.',
    addChannelFailed: 'Failed to add channel',
    addChannelDialog: {
      title: 'Add channel',
      description:
        'Add an extra channel to the selected frames by uploading a video/stack with the same number of frames, or a single image stamped onto every selected frame.',
      selectionSummary:
        '{{frames}} frame(s) across {{videos}} video(s) selected.',
      sourceLabel: 'Source file (video / stack / image)',
      dropPrompt: 'Drag & drop a file here, or click to select',
      dropInvalidType: 'Unsupported file type.',
      dropTooManyFiles: 'Only one file can be added at a time.',
      removeFile: 'Remove file',
      imageHint: 'Single image → stamped onto every selected frame.',
      videoHint:
        'Video/stack → must have exactly {{frames}} frame(s) and belong to a single video.',
      nameLabel: 'Channel name',
      namePlaceholder: 'e.g. GFP',
      alignLabel: 'Align to segmentation channel',
      alignHint:
        'Phase-correlation registration that corrects small stage drift.',
      multiVideoError:
        'A video/stack can only be added to frames of a single video. Select frames from one video, or upload a single image.',
      uploading: 'Uploading… {{percent}}%',
      adding: 'Adding…',
      confirm: 'Add channel',
    },
    annotationsDeleted: 'Annotations deleted for {{count}} image(s)',
    annotationsDeleteFailed:
      'Failed to delete annotations for {{count}} image(s)',
    deleteAnnotationsDialog: {
      title: 'Delete annotations?',
      description:
        'This deletes the segmentation annotations for {{count}} selected image(s). The images are kept but their segmentation results are removed. This cannot be undone.',
    },
    imagesDeleted: '{{count}} image deleted',
    imagesDeleted_other: '{{count}} images deleted',
  },
  export: {
    // Microtubule-only metric controls.
    mtKymographs: {
      title: 'Kymograph velocity analysis',
      description:
        'Detect moving particles on a kymograph for each microtubule and export their velocities.',
      enable: 'Include kymograph analysis',
      velocityMetrics: 'Velocity metrics (CSV)',
      segmentedImages: 'Segmented kymograph images (PNG)',
      modeKymograph: 'Kymograph (space × time)',
      modeProfiles: 'Intensity profiles (per image)',
      singleFrameHint:
        'Single frame — a kymograph needs a time series, so only the intensity profile is exported.',
      profilesHint:
        'Exports one matplotlib plot of intensity vs. position per frame, plus the intensity CSV.',
    },
    mt: {
      sectionTitle: 'Microtubule metrics',
      sectionDescription:
        'Per-MT length, area, and per-channel intensity from the raw ND2/TIFF file. Background-corrected using the median of pixels outside the dilated MT mask.',
      intensityNote:
        'Per-channel signal intensity — including the summed (integrated) intensity — is always computed for every channel and written to the metrics spreadsheet. No selection needed.',
      wideNote:
        'Each channel gets its own row in metrics.csv (see the "channel" column). A companion metrics_wide.csv — an extra sheet in metrics.xlsx — puts all channels of the same microtubule on one row, one column set per channel.',
      thicknessLabel: 'MT thickness (px)',
      thicknessHelp:
        'Width of the sampling band along each polyline. 5 px matches typical microtubule diameter in 100x widefield.',
      marginLabel: 'Background margin (× thickness)',
      marginHelp:
        'Excludes pixels within this radius (thickness × multiplier) of any MT from the background. Higher = more conservative.',
    },
    // Dialog headers
    advancedExport: 'Advanced Export',
    advancedOptions: 'Advanced Export Options',
    configureSettings:
      'Configure your export settings to create a comprehensive dataset package',
    // Tabs
    general: 'General',
    visualization: 'Visualization',
    formatsTab: 'Formats',
    // Content selection
    exportContents: 'Export Contents',
    selectContent: 'Select which content types to include in your export',
    includeOriginal: 'Include original images',
    includeVisualizations: 'Include visualizations with numbered polygons',
    includeDocumentation: 'Include documentation and metadata',
    // Image selection
    selectedImages: 'Selected Images',
    imagesSelected: '{{count}} of {{total}} images selected',
    selectAll: 'Select All',
    allSelected: 'All {{count}} images selected',
    selectAllProject: 'Select All {{count}} images',
    selectNone: 'Select None',
    imageSelection: 'Image Selection',
    chooseImages: 'Choose which images to include in the export',
    searchImages: 'Search images...',
    sortBy: 'Sort by',
    sortOptions: {
      date: 'Date',
      name: 'Name',
      status: 'Status',
    },
    showingImages: 'Showing {{start}}-{{end}} of {{total}}',
    noImagesFound: 'No images found',
    // Quality settings
    qualitySettings: 'Quality Settings',
    imageQuality: 'Image Quality',
    compressionLevel: 'Compression Level',
    outputResolution: 'Output Resolution',
    // Visualization settings
    colorSettings: 'Color Settings',
    backgroundColor: 'Background Color',
    strokeColor: 'Stroke Color',
    strokeWidth: 'Stroke Width',
    fontSize: 'Font Size',
    showNumbers: 'Show polygon numbers',
    showLabels: 'Show labels',
    // Scale conversion
    scaleConversion: 'Scale Conversion',
    pixelToMicrometerScale: 'Pixel Size',
    scaleDescription:
      'Specify how many micrometers one pixel represents to convert measurements',
    scalePlaceholder: 'e.g., 0.5 (1 pixel = 0.5 µm)',
    scaleUnit: 'µm/pixel',
    scaleWarning:
      'Note: Scale value above 1 µm/pixel indicates very low magnification. Please verify.',
    // Format options
    outputSettings: 'Output Settings',
    exportFormatsLabel: 'Export Formats',
    exportToZip: 'Export to ZIP archive',
    generateExcel: 'Generate Excel metrics',
    includeCocoFormat: 'Include COCO format annotations',
    includeJsonMetadata: 'Include JSON metadata',
    microtubuleAnnotationsNote:
      'Microtubule projects export annotations as ImageJ RoiSet + CVAT 1.1 (always included), each carrying the tubulin type class. COCO/YOLO/JSON are not used for microtubules.',
    // Progress and status
    preparing: 'Preparing export...',
    processing: 'Processing {{current}} of {{total}}',
    processingExport: 'Processing...',
    packaging: 'Creating package...',
    completed: 'Export completed',
    downloading: 'Downloading...',
    cancelling: 'Cancelling...',
    cancelled: 'Export cancelled',
    cancelExport: 'Cancel Export',
    // Connection status
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
    // Buttons
    startExport: 'Start Export',
    cancel: 'Cancel',
    download: 'Download',
    retry: 'Retry',
    close: 'Close',
    // Error messages
    exportError: 'Export failed',
    exportFailed: 'Export failed',
    exportComplete: 'Export completed',
    metricsExportComplete: 'Metrics export completed',
    connectionError: 'Connection lost during export',
    serverError: 'Server error occurred',
    invalidSelection: 'Please select at least one image',
    noData: 'No data available for export',
    segmentationData: 'Segmentation Data',
    spheroidMetrics: 'Spheroid Metrics',
    spermMetrics: 'Sperm Metrics',
    cocoFormat: 'COCO Format',
    cocoFormatTitle: 'COCO Format Export',
    downloadJson: 'Download JSON',
    exportFormats: {
      yolo: 'YOLO Format',
      excel: 'Excel Format',
      json: 'JSON Format',
    },
    // Progress panel specific
    title: 'Export Progress',
    readyToDownload: 'Export ready for download',
    fallbackMode: 'Polling mode',
    fallbackMessage:
      'Using polling for progress updates due to connection issues',
  },
  // Export dialog
  // Standalone image action messages (used without prefix)
  imageDeleted: 'Image deleted successfully',
  deleteImageFailed: 'Failed to delete image',
  deleteImageError: 'Error deleting image',
  imageAlreadyProcessing: 'Image is already being processed',
  processImageFailed: 'Failed to process image',

  exportDialog: {
    title: 'Export Options',
    includeMetadata: 'Include metadata',
    includeSegmentation: 'Include segmentation',
    includeObjectMetrics: 'Include object metrics',
    exportMetricsOnly: 'Export only metrics (XLSX)',
    selectImages: 'Select images to export',
    selectAll: 'Select All',
    selectNone: 'Deselect All',
    noImagesAvailable: 'No images are available',
  },
  docs: {
    // Header
    badge: 'Documentation',
    title: 'SpheroSeg Documentation',
    subtitle:
      'Everything the platform does, for all six project types — searchable',
    backTo: 'Back to {{page}}',

    // Search
    search: {
      placeholder: 'Search the documentation…',
      hint: 'Press / to search. Matching sections are filtered and highlighted.',
      results: '{{count}} matching section(s)',
      noResults: 'Nothing matches your search',
      noResultsHint:
        'Try a shorter query, or a term such as "channel", "kymograph", "export" or "threshold".',
      clear: 'Clear search',
    },

    // Navigation
    navigation: 'Navigation',
    nav: {
      introduction: 'Introduction',
      gettingStarted: 'Getting started',
      projectTypes: 'Project types',
      uploadingImages: 'Uploading data',
      videosChannels: 'Videos & channels',
      modelSelection: 'Models',
      segmentationProcess: 'Segmentation',
      segmentationEditor: 'Editor',
      exportFeatures: 'Export',
      automatedEssays: 'Automated Essays',
      segmenter: 'Segmenter',
      sharedProjects: 'Sharing',
      troubleshooting: 'Troubleshooting',
    },

    // Introduction
    introduction: {
      title: 'Introduction',
      whatIs: 'What is SpheroSeg?',
      description:
        'SpheroSeg is a platform for AI-assisted segmentation and measurement of microscopy images and time-lapse videos. It ships six project types backed by ten segmentation models, a polygon and polyline editor, cross-frame microtubule tracking, and a batch export pipeline.',
      developedBy:
        'The platform was developed by Bc. Michal Průšek at the Faculty of Nuclear Sciences and Physical Engineering, Czech Technical University in Prague, under the supervision of Ing. Adam Novozámský, Ph.D., in collaboration with researchers from the Institute of Biochemistry and Microbiology at UCT Prague.',
      addresses:
        'It began with the hard problem of delineating spheroid boundaries in microscopy, and now covers disintegrating spheroids, wound-healing assays, sperm morphology, microtubule time-lapses and microcapsules — each with its own model, measurements and export format.',
    },

    // Getting started
    gettingStarted: {
      title: 'Getting started',
      accountCreation: 'Creating an account',
      accountDescription:
        'Sign-up is open — there is no approval queue. An account keeps your projects, images and results together.',
      accountSteps: {
        step1: 'Go to the sign-up page',
        step2: 'Enter your email address and choose a password',
        step3: 'Complete your profile with your name and institution',
        step4:
          'In Settings, set your preferred model, default threshold, language and theme',
      },
      firstProject: 'Creating your first project',
      projectDescription:
        'A project holds images and the segmentations made from them. Its type decides which models you can run, what the editor shows and how results are exported — so choose it deliberately.',
      projectSteps: {
        step1: 'From your dashboard, click "New Project"',
        step2: 'Enter a name and an optional description',
        step3:
          'Pick the project type that matches your specimen (see Project types below)',
        step4: 'Click "Create Project", then upload your data',
      },
    },

    // Project types
    projectTypes: {
      title: 'Project types',
      description:
        'Every project has a type, chosen when you create it. The type is not a label: it decides which models are available, what geometry they produce, which panels the editor shows and which files you get on export.',
      types: {
        spheroid: {
          name: 'Spheroids (standard)',
          bestFor:
            'For: cellular spheroids in bright field or phase contrast. The only type offering a choice of model — five of them.',
          output: 'Output: closed polygons with optional holes.',
        },
        spheroidInvasive: {
          name: 'Disintegrated spheroids',
          bestFor:
            'For: spheroids dispersing into a matrix. The headline number is the core-anchored Disintegration Index.',
          output:
            'Output: closed polygons, with the dense core predicted as its own class and drawn green.',
        },
        wound: {
          name: 'Wound healing',
          bestFor:
            'For: scratch-assay time-lapses. Adds a closure curve over the whole series.',
          output:
            'Output: closed polygons covering the open wound, plus a wound-area-over-time sheet and chart.',
        },
        sperm: {
          name: 'Sperm',
          bestFor:
            'For: sperm morphology, measured as three parts per cell — head, midpiece and tail.',
          output:
            'Output: open polylines carrying a part class and an instance id, colour-coded green, orange and cyan.',
        },
        microtubules: {
          name: 'Microtubules',
          bestFor:
            'For: IRM microtubule time-lapses, with cross-frame tracking, per-channel intensity and kymographs.',
          output:
            'Output: open polylines with a stable track id; exported as ImageJ ROIs and CVAT rather than COCO or YOLO.',
        },
        microcapsule: {
          name: 'Microcapsules',
          bestFor:
            'For: round microcapsules in bright field, including capsules that touch each other.',
          output:
            'Output: one closed polygon per capsule. Capsules cut off by the image border are excluded from the metrics.',
        },
      },
      note: 'Pick the type before you upload.',
      noteText:
        'Model compatibility follows the project type, so changing it later means existing results cannot be re-run with the model that produced them.',
    },

    // Uploading data
    uploadImages: {
      title: 'Uploading data',
      description:
        'The platform accepts both still images and time-lapse data. A video, ND2 or multi-page TIFF becomes a container with one entry per frame.',
      formats: 'Accepted formats and limits',
      formatsTable: {
        kind: 'Kind',
        extensions: 'Formats',
        limit: 'Maximum size',
        imagesLabel: 'Still images',
        imagesLimit: '20 MB per file',
        videosLabel: 'Videos and stacks',
        videosLimit: '100 GB per file',
      },
      methods: 'How to upload',
      methodsDescription: 'Three equivalent ways:',
      methodsList: {
        dragDrop: 'Drag and drop files onto the upload area',
        browse: 'Click the upload area to browse for files',
        batch:
          'Drop a whole folder — it is walked recursively, up to 10 000 files per batch',
        autoSegment:
          'Tick "Auto-segment images after upload" to queue everything as it lands',
      },
      tiffNote: 'A TIFF can be either.',
      tiffNoteText:
        'A TIFF is handled as a stack when it is larger than 20 MB or actually contains more than one page — the file header is inspected, so even a small multi-channel TIFF is handled correctly.',
      note: 'For the best results:',
      noteText:
        'make sure your images have good contrast between the object and the background, and that the file carries its pixel calibration if you want measurements in micrometres. A video upload is one long request — transfer and frame extraction happen together, so a large ND2 takes time.',
    },

    // Videos & channels
    videosChannels: {
      title: 'Videos, frames and channels',
      description:
        'Time-lapse and multi-channel data get their own handling: a container row for the recording, one entry per frame, and a channel list you control from the editor.',
      containers: 'Containers and frames',
      containerFacts: {
        frames:
          'One upload becomes one container plus one entry per frame; frames are numbered from 1 in the interface.',
        hidden:
          'The container itself is never shown in the gallery and is never segmented — only frames are.',
        positions:
          'An ND2 recorded at several stage positions becomes one project entry per position.',
        calibration:
          'Pixel size and frame interval are read from the file when present and used to convert measurements automatically.',
      },
      channels: 'Channels',
      channelsDescription:
        'Each channel is stored as its own image per frame. Exactly one channel can be the segmentation source — the channel the model reads.',
      channelControls: {
        visibility: 'A checkbox includes the channel in the composite view',
        color: 'A colour swatch sets its overlay tint',
        rename: 'Double-click the name to rename it',
        opacity: 'A slider sets its opacity from 0 to 100 %',
        source: 'The segmentation source is marked with "● src"',
      },
      sourceNote: 'Check the segmentation source.',
      sourceNoteText:
        'When no channel name is recognisable, none is marked as the source and the first channel is used. For microtubule work that matters: the model is IRM-only, so pointing it at a fluorescence channel produces confident polylines with nothing underneath them.',
      windowLevel: 'Displaying 16-bit data',
      windowLevelDescription:
        'High-bit-depth frames are windowed for display with Min and Max sliders, plus Brightness and Contrast. The window is per channel, not shared: a channel is auto-fitted to its own data the first time you see it, keeps your cutoffs afterwards, and only widens its range as brighter frames arrive. These settings last for the session; channel colours and opacities are remembered.',
      navigation: 'Moving through frames',
      keys: {
        step: 'Previous / next frame',
        play: 'Play or pause — a fixed 10 fps that stops at the last frame',
      },
      mtExtras: 'Extras for microtubule projects',
      mtExtrasList: {
        registration:
          'Channel registration at upload: aligns every channel to the first by a whole-pixel translation, so nothing is interpolated.',
        addChannel:
          'Add channel: attach another channel to selected frames afterwards, either one image stamped onto every frame or a video paired frame by frame.',
        tracking:
          'Cross-frame tracking runs automatically once every frame is finished, giving each filament a stable identity and colour.',
      },
    },

    // Models
    modelSelection: {
      title: 'Models',
      description:
        'Ten models, each locked to the project types it was trained for. The picker only offers compatible models, and only standard spheroid projects have a real choice — every other type has exactly one.',
      spheroidModels: 'Spheroid models — choose one',
      specialisedModels: 'Specialised models — one per project type',
      models: {
        hrnet: {
          name: 'HRNet (Balanced)',
          inferenceTime: 'About 0.20 s per image',
          bestFor: 'Best for: one model, no thinking. The platform default.',
          description:
            'Keeps a high-resolution branch throughout the network instead of encoding then decoding, which preserves boundary detail.',
        },
        cbam: {
          name: 'CBAM-ResUNet (Precise)',
          inferenceTime: 'About 0.38 s per image',
          bestFor:
            'Best for: publication figures and difficult boundaries, at roughly twice HRNet’s cost.',
          description:
            'Residual U-Net with channel and spatial attention at every stage — the most precise boundaries of the five.',
        },
        unet: {
          name: 'UNet (Fastest)',
          inferenceTime: 'About 0.18 s per image',
          bestFor:
            'Best for: large batches where turnaround matters more than the last percent of accuracy.',
          description:
            'A plain U-Net trained on the SpheroHQ dataset and optimised for throughput.',
        },
        segformer: {
          name: 'SegFormer',
          inferenceTime: 'About 0.20 s per image',
          bestFor:
            'Best for: highest reported accuracy on bright-field spheroids — 93 % IoU.',
          description:
            'Transformer-based (SegFormer-B0): a hierarchical encoder with a lightweight all-MLP decoder.',
        },
        mamba: {
          name: 'Mamba-UNet',
          inferenceTime: 'About 0.24 s per image',
          bestFor:
            'Best for: images unlike the training data — another lab, unknown optics, drug-treated or unusual morphologies.',
          description:
            'U-Net with a bidirectional state-space bottleneck, chosen for out-of-distribution robustness.',
        },
        disintegration: {
          name: 'Spheroid Disintegration',
          inferenceTime: 'About 0.70 s per image · default threshold 0.2',
          bestFor: 'Used by: Disintegrated spheroid projects.',
          description:
            'UNet++ with an EfficientNet-B5 encoder predicting three classes — background, corona and dense core. The core is predicted directly rather than inferred, which is what makes the Disintegration Index trustworthy.',
        },
        wound: {
          name: 'Wound Healing',
          inferenceTime: 'About 0.03 s per image',
          bestFor: 'Used by: Wound healing projects.',
          description:
            'U-Net with a MiT-B5 encoder for binary wound segmentation, 90 % IoU on an external test set. It works at 256×256 internally and upsamples, which is why it is fast and why very fine edge detail is smoothed.',
        },
        sperm: {
          name: 'Sperm Morphology',
          inferenceTime: 'About 0.30 s per image',
          bestFor: 'Used by: Sperm projects.',
          description:
            'Multi-class instance segmentation producing head, midpiece and tail as polylines natively, via skeleton extraction rather than thresholded blobs.',
        },
        microtubule: {
          name: 'Microtubule (v5H)',
          inferenceTime:
            'About 4.5 s per frame · threshold fixed at 0.97 and not user-settable',
          bestFor: 'Used by: Microtubule projects. IRM images only.',
          description:
            'An nnU-Net ResEnc-M network predicts the filament foreground, then a curvature-bounded instancer separates it into individual centerlines, resolving every crossing under a hard curvature bound. Trained entirely on synthetic frames. Runtime scales with the number of filaments, not just frame size.',
        },
        microcapsule: {
          name: 'Microcapsule',
          inferenceTime: 'About 0.30 s per image',
          bestFor: 'Used by: Microcapsule projects.',
          description:
            'A compact U-Net distilled from Meta SAM 3, with a watershed to separate touching capsules. Capsules cut off by the image border are flagged and left out of the metrics.',
        },
      },
      howToSelect: 'Choosing a model',
      selectionSteps: {
        step1:
          'Set your default model and threshold in Settings — they are used wherever the project type allows a choice',
        step2: 'Open a project and select the images you want to process',
        step3: 'Click Segment; the dialog offers only compatible models',
        step4:
          'Adjust the confidence threshold to trade detections against evidence',
        step5:
          'On a multi-channel video, choose which channel the model should read',
      },
      thresholdNote: 'The microtubule threshold is deliberately fixed.',
      thresholdNoteText:
        'That model applies its own fitted cut of 0.97 and ignores the slider. Lowering it does not find more real filaments — it finds more with weaker evidence, and on a non-IRM channel the output does not follow the image at any setting. If detections are missing, check the input channel instead.',
      tip: 'Tip:',
      tipText:
        'Start with the default model. Reach for CBAM-ResUNet when boundaries matter more than speed, and for Mamba-UNet when your images do not look like anyone’s training set.',
    },

    // Segmentation process
    segmentationProcess: {
      title: 'The segmentation process',
      description:
        'Segmentation runs in the background on a queue, so you can keep working while a batch processes. Progress arrives live.',
      queueBased: 'Queue-based processing',
      queueDescription: 'The queue is built for large batches:',
      queueFeatures: {
        realTime:
          'Live status: progress arrives over a WebSocket, with an HTTP fallback so a dropped connection never strands a job',
        batch: 'Batch processing: up to 10 000 images in one submission',
        priority:
          'Fair scheduling: users who were recently served are deprioritised, so one long video cannot monopolise the GPU',
        recovery:
          'Recovery: interrupted work is retried rather than lost, with the error reported',
      },
      workflow: 'The workflow',
      workflowSteps: {
        step1: 'Upload your images or videos into a project',
        step2: 'Select the images to process, or none to process all of them',
        step3: 'Choose the model and confidence threshold',
        step4:
          'On a multi-channel video, pick the channel the model should read',
        step5: 'Watch progress on the status indicators',
        step6: 'Open any image in the editor to review and correct the result',
      },
      polygonTypes: 'What the models produce',
      polygonDescription: 'Two kinds of geometry, depending on the model:',
      polygonTypesList: {
        external:
          'External polygons: the object outline — spheroids, wounds, capsules',
        internal:
          'Internal polygons: holes inside an object, subtracted from its area',
        polyline:
          'Polylines: open paths with a length but no area, produced by the microtubule and sperm models',
      },
      processingNote: 'Processing time depends on the model:',
      processingTimes:
        'the wound model takes about 0.03 s per image and the spheroid models about 0.2–0.4 s, while the microtubule model takes around 4.5 s per frame because separating individual filaments is the expensive part.',
    },

    // Editor
    segmentationEditor: {
      title: 'The segmentation editor',
      description:
        'Where you review and correct results. Seven edit modes, full keyboard control, and panels that change with the project type.',
      editingModes: 'Edit modes',
      modes: {
        view: {
          title: 'View (V)',
          description:
            'Select, pan and zoom. Clicking a shape selects it and switches to Edit vertices.',
        },
        editVertices: {
          title: 'Edit vertices (E)',
          description:
            'Drag vertices to refine a boundary. Right-click a vertex to delete it. Needs a shape selected.',
        },
        addPoints: {
          title: 'Add points (A)',
          description:
            'Insert vertices, extend a polyline from its nearer end, or join two polylines end to end. Needs a shape selected.',
        },
        createPolygon: {
          title: 'Create polygon (N)',
          description:
            'Click out a closed shape; click near the first point to close it. Minimum three points.',
        },
        createPolyline: {
          title: 'Create polyline (P)',
          description:
            'Click out an open path for a microtubule or a sperm part. Finish with Enter or a double-click.',
        },
        sliceMode: {
          title: 'Slice (S)',
          description:
            'Cut a shape with a two-click line. Works on closed polygons and on polylines.',
        },
        deletePolygon: {
          title: 'Delete polygon (D)',
          description:
            'Click shapes to remove them. The mode stays active, and there is no confirmation.',
        },
      },
      keyFeatures: 'What the editor gives you',
      features: {
        undoRedo:
          'Undo and redo over shape geometry and fields. History is per frame and resets when you change image.',
        saving:
          'Saving on demand: the Save button, Ctrl+S, or automatically when you move to another image.',
        zoomPan:
          'Zoom at the mouse pointer, pan with a drag, and fit the image with R or 0.',
        polygonManagement:
          'A shape list with multi-select, hide and show, rename and delete.',
        keyboardShortcuts:
          'Full keyboard control — press H or ? for the in-app list.',
        realTimeFeedback:
          'Per-mode instructions on the canvas and a live count of shapes and vertices.',
      },
      shortcuts: 'Keyboard shortcuts',
      shortcutCategories: {
        modes: 'Modes',
        actions: 'Actions',
        view: 'View',
      },
      shortcutsList: {
        v: 'View mode',
        e: 'Edit vertices',
        a: 'Add points',
        n: 'Create polygon',
        p: 'Create polyline',
        s: 'Slice',
        d: 'Delete polygon',
        tab: 'Cycle through the modes',
        ctrlZ: 'Undo',
        ctrlY: 'Redo',
        ctrlS: 'Save',
        delete: 'Delete the selected shape',
        enter: 'Finish the polyline being drawn',
        escape: 'Cancel and return to View',
        zoom: 'Zoom in and out',
        reset: 'Fit the image to the view',
        pan: 'Hold and drag to pan in any mode',
        help: 'Show the shortcut list',
      },
      workingWithPolygons: 'Working with shapes',
      polygonSteps: {
        step1: 'Click a shape to select it',
        step2: 'Switch to the mode that matches what you want to change',
        step3: 'Make the change with the mouse',
        step4:
          'Use the list on the right to hide, rename, multi-select or delete shapes',
        step5: 'Press Ctrl+S to save',
      },
      saveNote: 'There is no continuous autosave.',
      saveNoteText:
        'Your work is saved when you press Save or Ctrl+S, and in the background when you move to another image or frame. Clicking a breadcrumb navigates immediately and saves in the background, so press Ctrl+S first if you have substantial edits. On a video, deleting a tracked shape and saving removes it from every frame.',
      typeSpecific: 'What changes with the project type',
      typeSpecificList: {
        microtubules:
          'Microtubules: an instance panel with stable per-track colours, your own type labels, whole-track assignment, propagate and delete-track, and a kymograph view.',
        sperm:
          'Sperm: an instance panel where you pick the active cell and part before drawing, plus reassignment from the right-click menu.',
        disintegration:
          'Disintegrated spheroids: the dense core is drawn green. The Disintegration Index itself is computed at export time.',
      },
    },

    // Export
    exportFeatures: {
      title: 'Export',
      description:
        'Exports run in the background and download themselves when finished. One export at a time per user; the result is a single ZIP.',
      packageContents: 'What is in the package',
      contents: {
        originalImages: {
          title: 'Original images',
          description: 'The files you uploaded, unchanged.',
        },
        visualizations: {
          title: 'Visualizations',
          description:
            'Rendered overlays with numbered shapes, in colours, line widths and transparency you choose.',
        },
        annotations: {
          title: 'Annotations',
          description:
            'Machine-readable geometry in the formats you tick — and, for microtubule projects, ImageJ and CVAT files that are always included.',
        },
        metrics: {
          title: 'Metrics',
          description:
            'A workbook whose sheets depend on the project type, as XLSX, CSV or JSON.',
        },
      },
      annotationFormats: 'Annotation formats',
      formats: {
        coco: 'COCO: the standard format for detection frameworks. Polygons with holes are exported as run-length masks.',
        yolo: 'YOLO: bounding boxes, with the polygon on a comment line. Open polylines cannot be represented and are skipped.',
        json: 'Custom JSON: full coordinates and metadata, including per-cell grouping for sperm projects.',
        imagej:
          'ImageJ RoiSet: a ZIP that opens straight into Fiji’s ROI Manager, one ROI per filament per slice, coloured by class or track. Microtubule projects only, always included.',
        cvat: 'CVAT 1.1: polylines with their track identity as an attribute. Microtubule projects only, always included.',
      },
      calculatedMetrics: 'Metrics by project type',
      metricsDescription:
        'The workbook you get depends on what you are measuring:',
      metricsTable: {
        projectType: 'Project type',
        sheet: 'Sheet and contents',
        spheroid:
          'Polygon Metrics + Summary — area, perimeter, circularity, Feret diameters, solidity and more, one row per shape',
        spheroidInvasive:
          'Image Metrics — one row per image with the Disintegration Index, core and invasion areas, and the dispersion panel',
        wound:
          'Polygon Metrics + Summary + WoundTimeSeries — the closure curve, with the chart embedded',
        sperm:
          'Sperm Metrics — head, midpiece, tail and total length, one row per cell',
        microtubules:
          'Microtubule Metrics + Channel Totals — length and per-channel intensity, one row per frame, filament and channel',
        microcapsule:
          'Microcapsule Metrics + Summary — one row per complete capsule; border-cut capsules are excluded',
      },
      scaleTitle: 'Pixel size and units',
      scaleText:
        'Enter a pixel size in micrometres per pixel and every length and area is converted for you. The field is filled in automatically from the file’s own calibration when it has one. Without a usable value the export falls back to pixels, so check the units in the column headers.',
      howToExport: 'How to export',
      exportSteps: {
        step1: 'Open the project and click Export',
        step2: 'Choose which images to include, or all of them',
        step3:
          'Set the pixel size if you want micrometres, and pick your visualization colours',
        step4: 'Tick the annotation and metrics formats you need',
        step5: 'Start the export and let it run — progress is shown live',
        step6: 'The ZIP downloads itself when it is finished',
      },
      exportNote: 'A failed stage does not fail the export.',
      exportNoteText:
        'Optional stages degrade to a warning and the rest of the package is still produced. For microtubule intensity a degraded run is also recorded in the package itself, in metrics_status.json and at the top of the metrics guide — so check those before relying on a sheet.',
    },

    // Automated Essays
    automatedEssays: {
      title: 'Automated Essays',
      description:
        'A batch microtubule assay that lives outside the project system. Upload a folder of Nikon ND2 well recordings and get one row per filament back: length, intensity along it, and its local background.',
      howTo: 'Running a batch',
      steps: {
        step1: 'Open Automated Essays from the menu under your profile picture',
        step2:
          'Drag the folder of .nd2 files onto the page, or use the Select folder button',
        step3:
          'Wait — jobs run one at a time and the list refreshes itself while anything is running',
        step4:
          'Download the ZIP, or use Run again to reprocess the same files without uploading them a second time',
      },
      results: 'What you get back',
      resultsList: {
        csv: 'results.csv — one row per microtubule, with its length, the intensity along it and its background',
        failures:
          'failures.csv — every well or position that could not be produced, and why. It is always written, even when empty',
        overlays:
          'Two overlay images per position: one checking the segmentation against its own input, one checking the measured band against the signal',
        annotations:
          'A JSON file per position with the traced centerlines and their lengths',
      },
      channelNote: 'IRM is segmented, fluorescence is measured.',
      channelNoteText:
        'The model was trained on IRM, so the filaments are traced there and the fluorescence channel is only read along those traces. A file with no IRM channel is reported as a failure rather than segmented from something else.',
      retentionNote: 'Uploads are cleaned up, results are not.',
      retentionNoteText:
        'Input files are removed once a run finishes cleanly, and kept for a week if it did not — which is exactly the run you may want to repeat. The result stays until you delete the job.',
    },

    // Segmenter
    segmenter: {
      title: 'Segmenter',
      description:
        'A standalone polygon annotation tool with its own datasets and class palette, separate from projects and from the segmentation editor.',
      features: {
        datasets:
          'Create datasets and upload still images into them; they are private to you.',
        classes:
          'Define your own classes with names and colours. Deleting a class keeps its polygons and simply unassigns them.',
        polygons:
          'Draw, edit and delete closed polygons and assign each a class. Overlapping polygons are fully supported.',
        saving:
          'Saving is explicit — the Save button or Ctrl+S — and is blocked if the existing annotation failed to load, so an empty canvas can never overwrite real work.',
      },
      scopeNote: 'Manual annotation only, for now.',
      scopeNoteText:
        'The Segmenter has no machine learning in it yet: no pre-labelling, no active learning and no export. It is reachable by URL at /segmenter.',
    },

    // Sharing
    sharedProjects: {
      title: 'Sharing and collaboration',
      description:
        'Share a project with colleagues by email or by link. Recipients see it in their own dashboard once they accept.',
      sharingFeatures: 'What sharing gives them',
      features: {
        collaborative:
          'Collaborative access: a collaborator can view, edit annotations, run segmentation, export, and mark the project reviewed',
        emailInvite:
          'Email invitations: the share works whether or not the email arrives, since delivery can take several minutes',
        linkShare:
          'Link shares: a link that binds to whoever accepts it, optionally with an expiry',
        revokeAccess: 'Revocable at any time, taking effect immediately',
        multipleCollaborators:
          'Any number of collaborators, each filing the project in their own folders',
      },
      howToShare: 'How to share',
      shareSteps: {
        step1: 'Open the project you want to share',
        step2: 'Click Share in the project toolbar',
        step3: 'Enter your collaborator’s email address, or create a link',
        step4: 'Send the invitation',
        step5:
          'Manage or revoke shares from the same dialog, where each one shows its status',
      },
      permissionsNote: 'Sharing is collaborative, not read-only.',
      permissionsNoteText:
        'Collaborators can change annotations, and on a video their edits carry the same cross-frame consequences as yours. Only the owner can rename a project, change its type, share it further or delete it.',
    },

    // Troubleshooting
    troubleshooting: {
      title: 'Troubleshooting',
      description:
        'The problems people actually run into, and what causes them.',
      table: {
        symptom: 'Symptom',
        cause: 'Cause and fix',
      },
      items: {
        uploadRejected: {
          symptom: 'A file is rejected before the upload starts',
          cause:
            'Still images are capped at 20 MB. A larger TIFF is treated as a stack instead and gets the 100 GB limit. Channel names longer than 64 characters are refused outright — re-export with shorter labels.',
        },
        darkFrames: {
          symptom: 'Frames look almost black',
          cause:
            'High-bit-depth data needs windowing. Use the Min and Max sliders for that channel; each channel has its own window.',
        },
        noDetections: {
          symptom: 'The model finds very little',
          cause:
            'Check contrast and the project type first. Lower the confidence threshold only where it is adjustable — the microtubule model ignores it by design.',
        },
        wrongChannel: {
          symptom:
            'Plenty of shapes, but they do not follow anything in the image',
          cause:
            'The wrong channel is being segmented. Set the segmentation source explicitly in the channel list; the microtubule model only works on IRM.',
        },
        colorsChange: {
          symptom: 'Object colours change between frames',
          cause:
            'Cross-frame tracking has not completed for that container. Colours follow the track identity, so an untracked frame gets new ones.',
        },
        exportSlow: {
          symptom: 'An export sits at 95 %',
          cause:
            'That is the compression stage. On a large project, especially with kymographs, it genuinely takes a while.',
        },
        lostEdits: {
          symptom: 'Edits disappeared',
          cause:
            'Resegmenting replaces the frame’s segmentation, and clicking a breadcrumb navigates before the background save necessarily finishes. Press Ctrl+S before leaving.',
        },
      },
      helpNote: 'Still stuck?',
      helpNoteText:
        'Use the feedback button to send a bug report or a feature request — it reaches the maintainers directly.',
    },

    // Footer navigation
    footer: {
      backToHome: 'Back to Home',
      backToTop: 'Back to Top',
    },
  },
  legal: {
    terms: {
      title: 'Terms of Service',
      lastUpdated: 'Last updated: January 2025',
      disclaimer:
        'By using SpheroSeg, you agree to these terms. Please read them carefully.',
      sections: {
        acceptance: {
          title: '1. Acceptance of Terms',
          content:
            'By accessing or using SpheroSeg ("the Service"), you agree to be bound by these Terms of Service ("Terms") and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using this service. These Terms constitute a legally binding agreement between you and SpheroSeg.',
        },
        useLicense: {
          title: '2. Use License and Permitted Use',
          content: 'Permission is granted to use SpheroSeg for:',
          permittedUses: [
            'Personal, non-commercial research purposes',
            'Academic and educational research',
            'Scientific publications and studies',
            'Biomedical research and analysis',
          ],
          licenseNote:
            'This is the grant of a license, not a transfer of title. You may not use the service for commercial purposes without explicit written consent.',
        },
        dataUsage: {
          title: '3. Data Usage and Machine Learning',
          importantTitle: 'Important: Use of Your Data',
          importantContent:
            'By uploading images and data to SpheroSeg, you consent to us using this data to improve and train our machine learning models for better segmentation accuracy.',
          ownershipTitle: 'Data ownership:',
          ownershipContent:
            'You retain ownership of all data you upload to SpheroSeg. However, by using our service, you grant us permission to:',
          permissions: [
            'Process your images for segmentation analysis',
            'Use uploaded data (in anonymized form) to improve our ML algorithms',
            'Enhance model accuracy through continuous learning',
            'Develop new features and segmentation capabilities',
          ],
          protectionNote:
            'All data used for ML training is anonymized and stripped of identifying information. We do not share your raw data with third parties without explicit consent.',
        },
        userResponsibilities: {
          title: '4. User Responsibilities',
          content: 'You agree to:',
          responsibilities: [
            'Use the service only for lawful purposes',
            'Respect intellectual property rights',
            'Not attempt to reverse engineer or compromise the service',
            'Provide accurate information when creating an account',
            'Maintain the security of your account credentials',
          ],
        },
        serviceAvailability: {
          title: '5. Service Availability and Limitations',
          content:
            'While we strive to maintain continuous service availability, SpheroSeg is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, and the service may be subject to maintenance, updates, or temporary unavailability.',
        },
        limitationLiability: {
          title: '6. Limitation of Liability',
          content:
            'In no event shall SpheroSeg, its developers, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, profits, or business opportunities, arising out of your use of the service.',
        },
        privacy: {
          title: '7. Privacy and Data Protection',
          content:
            'Your privacy is important to us. Please review our Privacy Policy, which governs how we collect, use, and protect your personal information and research data.',
        },
        changes: {
          title: '8. Changes to Terms',
          content:
            'We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting. Your continued use of the service constitutes acceptance of modified Terms.',
        },
        termination: {
          title: '9. Termination',
          content:
            'Either party may terminate this agreement at any time. Upon termination, your right to access the service will cease immediately, though these Terms will remain in effect regarding prior use.',
        },
        governingLaw: {
          title: '10. Governing Law',
          content:
            'These Terms are governed by and construed in accordance with applicable laws. Any disputes shall be resolved through binding arbitration or in courts of competent jurisdiction.',
        },
      },
      contact: {
        title: 'Contact Information:',
        content:
          'If you have questions about these Terms, please contact us at prusek@utia.cas.cz',
      },
      navigation: {
        backToHome: 'Back to Home',
        privacyPolicy: 'Privacy Policy',
      },
    },
    privacy: {
      title: 'Privacy Policy',
      lastUpdated: 'Last updated: January 2025',
      disclaimer:
        'Your privacy is important to us. This policy explains how we collect, use, and protect your data.',
      sections: {
        introduction: {
          title: '1. Introduction',
          content:
            'This Privacy Policy explains how SpheroSeg ("we", "us", "our") collects, uses, protects, and shares your information when you use our platform for microscopy segmentation and analysis. By using our service, you consent to the data practices described in this policy.',
        },
        informationCollected: {
          title: '2. Information We Collect',
          content:
            'We collect information you provide directly to us when you create an account, upload images, create projects, and interact with our services.',
          personalInfo: {
            title: '2.1 Personal Information',
            items: [
              'Name and email address',
              'Institution or organization affiliation',
              'Account credentials and preferences',
              'Contact information for support requests',
            ],
          },
          researchData: {
            title: '2.2 Research Data and Images',
            ownershipTitle: 'Your Research Data',
            ownershipContent:
              'You retain full ownership of all images and research data you upload to SpheroSeg. We never claim ownership of your content.',
            items: [
              'Images you upload for analysis',
              'Project metadata and settings',
              'Segmentation results and annotations',
              'Analysis parameters and custom configurations',
            ],
          },
          usageInfo: {
            title: '2.3 Usage Information',
            items: [
              'Log data and access timestamps',
              'Device information and browser type',
              'Usage patterns and feature interactions',
              'Performance metrics and error reports',
            ],
          },
        },
        mlTraining: {
          title: '3. Machine Learning and Data Improvement',
          importantTitle: 'Important: Use of Your Data for AI Training',
          importantIntro:
            'To continuously improve our segmentation algorithms, we may use uploaded images and data to train and enhance our machine learning models.',
          controlTitle: 'You have full control over your data:',
          controlContent:
            'During account creation, you can choose whether to allow your data to be used for ML training. You can change these preferences at any time.',
          manageTitle: 'To manage your consent:',
          manageContent:
            'Go to Settings → Privacy tab in your dashboard. There you can enable or disable ML training consent and choose specific purposes (algorithm improvement, feature development) for which your data may be used.',
          howWeUse: {
            title: 'How We Use Your Data for ML:',
            items: [
              'Model Training: Images are used to train segmentation algorithms for better accuracy',
              'Algorithm Enhancement: Your segmentation corrections help improve automated detection',
              'Feature Development: Usage patterns guide development of new analysis tools',
              'Quality Assurance: Data helps validate and test new model versions',
            ],
          },
          protection: {
            title: 'Data Protection in ML Training:',
            items: [
              'Anonymization: All data is anonymized before use in ML training',
              'Metadata Removal: Personal and institutional identifying information is stripped',
              'Secure Processing: Training occurs in secure, isolated environments',
              'No Raw Distribution: Your original images are never shared with third parties',
            ],
          },
        },
        howWeUse: {
          title: '4. How We Use Your Information',
          content: 'We use collected information to:',
          purposes: [
            'Provide and maintain segmentation services',
            'Process your images and generate analysis results',
            'Improve our algorithms and develop new features',
            'Communicate with you about your account and updates',
            'Provide technical support and troubleshooting',
            'Comply with legal obligations and protect our rights',
          ],
        },
        dataSecurity: {
          title: '5. Data Security and Protection',
          content: 'We implement robust security measures including:',
          measures: [
            'Encryption of data in transit and at rest',
            'Regular security audits and vulnerability assessments',
            'Access controls and authentication systems',
            'Secure backup and disaster recovery procedures',
            'Employee security training and access limitations',
          ],
        },
        dataSharing: {
          title: '6. Data Sharing and Third Parties',
          noSaleStatement:
            'We do not sell your personal information or research data.',
          sharingContent:
            'We may share information only in these limited circumstances:',
          circumstances: [
            'With your explicit consent',
            'To comply with legal obligations or court orders',
            'With trusted service providers who help operate our platform (under strict confidentiality agreements)',
            'To protect our rights, safety, or property',
            'In anonymized, aggregated form for research publications (with your consent)',
          ],
        },
        privacyRights: {
          title: '7. Your Privacy Rights and Choices',
          content: 'You have the right to:',
          rights: [
            'Access: Request copies of your personal data and research content',
            'Rectification: Update or correct inaccurate information',
            'Deletion: Request deletion of your account and associated data',
            'Portability: Export your data in a machine-readable format',
            'Opt-out: Request exclusion from ML training. Note: This may limit the following features: automated segmentation accuracy, personalized model recommendations, adaptive threshold suggestions, batch processing optimizations, and future AI-powered enhancements. Contact support for specific impacts on your account.',
            'Restriction: Limit how we process your information',
          ],
          contactNote:
            'To exercise these rights, contact us at prusek@utia.cas.cz. We will respond within 30 days.',
        },
        dataRetention: {
          title: '8. Data Retention',
          content: 'We distinguish between personal data and ML training data:',
          categories: [
            'Personal/Account Data: All personal identifiers, profile information, account settings, and transaction history will be permanently deleted within 90 days of account closure.',
            'Research Data: Original images and project data linked to your account will be deleted within 90 days of account closure.',
            'ML Training Data: Data used for ML training is first anonymized/pseudonymized to remove all personal identifiers. This anonymized data may be retained indefinitely to preserve model improvements, unless you specifically opt out of ML training or request full deletion.',
            'Opt-out Options: You can request complete deletion of all data, including anonymized ML training data, by contacting prusek@utia.cas.cz. Processing time is typically 30 days.',
          ],
        },
        internationalTransfers: {
          title: '9. International Data Transfers',
          content:
            'Your data may be processed in countries other than your own. We ensure appropriate safeguards and protections are in place for international transfers, including standard contractual clauses and adequacy decisions.',
        },
        childrensPrivacy: {
          title: "10. Children's Privacy",
          content:
            'Our service is intended for researchers and is not directed at children under 16. We do not knowingly collect personal information from children under 16. If we discover such collection, we will delete the information promptly.',
        },
        policyChanges: {
          title: '11. Changes to This Policy',
          content:
            'We may update this Privacy Policy to reflect changes in our practices or legal requirements. We will notify you of material changes via email or prominent notice on our website. Continued use constitutes acceptance of updated terms.',
        },
        contact: {
          title: '12. Contact Information',
          dpo: 'Data Protection Officer: prusek@utia.cas.cz',
          general: 'General Inquiries: prusek@utia.cas.cz',
          postal: 'Postal Address:',
          address: {
            line1: 'ÚTIA AV ČR',
            line2: 'Pod Vodárenskou věží 4',
            line3: '182 08 Prague 8',
            line4: 'Czech Republic',
          },
        },
      },
      navigation: {
        backToHome: 'Back to Home',
        termsOfService: 'Terms of Service',
      },
    },
  },

  // WebSocket messages
  websocket: {
    reconnecting: 'Reconnecting to server...',
    reconnected: 'Connection to server restored',
    connected: 'Connected to real-time updates',
    disconnected: 'Disconnected from real-time updates',
  },

  // Context menu
  contextMenu: {
    propagateSelectedTracks: 'Propagate selected microtubules ({{count}})',
    confirmPropagateSelected: 'Propagate {{count}} selected microtubules?',
    propagateSelectedDescription:
      'This overwrites the shape of {{count}} selected microtubules in all following frames of the video. This cannot be undone.',
    propagateTrack: 'Propagate to following frames',
    confirmPropagateTrack: 'Propagate to following frames?',
    propagateTrackDescription:
      "This overwrites this microtubule's shape in all following frames of the video. This cannot be undone.",
    deleteTrack: 'Delete whole track',
    confirmDeleteTrack: 'Delete the whole microtubule track?',
    deleteTrackDescription:
      'This removes this microtubule from all {{count}} frames of the video. This cannot be undone.',
    editPolygon: 'Edit polygon',
    splitPolygon: 'Split polygon',
    deletePolygon: 'Delete polygon',
    confirmDeletePolygon: 'Are you sure you want to delete this polygon?',
    deletePolygonDescription:
      'This action is irreversible. The polygon will be permanently removed from the segmentation.',
    duplicateVertex: 'Duplicate vertex',
    deleteVertex: 'Delete vertex',
    editPolyline: 'Edit Polyline',
    deletePolyline: 'Delete Polyline',
  },

  // Metrics display
  metrics: {
    info: 'Metrics are evaluated only for external polygons. Areas of internal polygons (holes) are automatically subtracted from the corresponding external polygons.',
    spheroid: 'Spheroid',
    area: 'Area',
    perimeter: 'Perimeter',
    equivalentDiameter: 'Equivalent Diameter',
    circularity: 'Circularity',
    feretMax: 'Feret Maximum',
    feretMin: 'Feret Minimum',
    compactness: 'Compactness',
    convexity: 'Convexity',
    solidity: 'Solidity',
    sphericity: 'Sphericity',
    feretAspectRatio: 'Feret Aspect Ratio',
    disintegrationIndex: 'Disintegration Index',
    wassersteinW1: 'Wasserstein W1',
    referenceMode: 'Reference Mode',
    totalSpheroidArea: 'Total Spheroid Area',
    coreArea: 'Core Area',
    invasionArea: 'Invasion Area',
    noPolygonsFound: 'No polygons found for analysis',
  },

  // Keyboard shortcuts
  keyboardShortcuts: {
    title: 'Keyboard Shortcuts',
    buttonLabel: 'Shortcuts',
    viewMode: 'View mode',
    editVertices: 'Edit vertices mode',
    addPoints: 'Add points mode',
    createPolygon: 'Create new polygon',
    sliceMode: 'Slice mode',
    deleteMode: 'Delete mode',
    holdToAutoAdd: 'Hold for automatic point addition',
    undo: 'Undo',
    redo: 'Redo',
    deleteSelected: 'Delete selected polygon',
    cancelOperation: 'Cancel current operation',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetView: 'Reset view',
    helperText:
      'These shortcuts work within the segmentation editor for faster and more convenient work.',
  },

  // Accessibility and screen reader labels
  accessibility: {
    // Navigation
    toggleSidebar: 'Toggle Sidebar',
    toggleMenu: 'Toggle menu',
    selectLanguage: 'Select language',
    selectTheme: 'Select theme',
    breadcrumb: 'breadcrumb',
    pagination: 'pagination',

    // Actions
    close: 'Close',
    more: 'More',

    // Pagination
    goToPreviousPage: 'Go to previous page',
    goToNextPage: 'Go to next page',
    previousPage: 'Previous',
    nextPage: 'Next',
    morePages: 'More pages',

    // Carousel
    previousSlide: 'Previous slide',
    nextSlide: 'Next slide',

    // View options
    gridView: 'Grid view',
    listView: 'List view',
  },

  // Footer section
  footer: {
    appName: 'SpheroSeg',
    description:
      'Microscopy segmentation and analysis platform for biomedical researchers — spheroids, wounds, sperm, microcapsules and microtubules, with AI-powered tools for every stage from image to measurement.',
    contact: 'Contact',
    institution: 'Institution',
    institutionName: 'ÚTIA AV ČR',
    address: 'Address',
    addressText: 'Pod Vodárenskou věží 4, 182 08 Prague 8',
    resources: 'Resources',
    documentation: 'Documentation',
    features: 'Features',
    tutorials: 'Tutorials',
    research: 'Research',
    legal: 'Legal',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    contactUs: 'Contact Us',
    developedAt: 'Developed at',
    designBy: 'Design by',
  },

  // Project sharing
  sharing: {
    processingInvitation: 'Processing invitation...',
    share: 'Share',
    shared: 'Shared',
    shareProject: 'Share project',
    shareDescription:
      'Share project "{{title}}" with colleagues and collaborators',
    shareByEmail: 'Share by email',
    shareByLink: 'Share by link',
    emailAddress: 'Email address',
    enterEmailPlaceholder: 'Enter email address',
    sendInvitation: 'Send invitation',
    sending: 'Sending...',
    emailSent: 'Email invitation sent!',
    emailRequired: 'Email address is required',
    emailShareFailed: 'Failed to send email invitation',

    linkExpiry: 'Link expiry',
    neverExpires: 'Never expires',
    hours: 'hours',
    days: 'days',
    generateLink: 'Generate link',
    generating: 'Generating...',
    linkGenerated: 'Share link created!',
    linkCopied: 'Link copied to clipboard',
    linkCopyFailed: 'Failed to copy link',
    linkShareFailed: 'Failed to generate share link',

    emailInvitations: 'Email invitations',
    shareLinks: 'Share links',
    shareRevoked: 'Share has been revoked',
    acceptedUsers: 'Accepted users',
    pendingInvitations: 'Pending invitations',
    joinedViaLink: 'Joined via link',
    activeShareLinks: 'Active share links',
    joinedOn: 'Joined',
    sentOn: 'Sent',
    joinedViaLinkOn: 'Joined via link',
    resendInvitation: 'Resend invitation',
    invitationResent: 'Invitation resent successfully',
    resendFailed: 'Failed to resend invitation',
    revokeAccess: 'Revoke access',
    cancelInvitation: 'Cancel invitation',
    revokeShareFailed: 'Failed to revoke share',
    failedToLoadShares: 'Failed to load shares',

    status: {
      pending: 'Pending',
      accepted: 'Accepted',
      revoked: 'Revoked',
    },

    sharedWithYou: 'Shared with you',
    sharedBy: 'Shared by: {{email}}',
    sharedProjects: 'Shared projects',
    noSharedProjects: 'No projects have been shared with you',
    removeFromShared: 'Remove from shared',
    acceptInvitation: 'Accept invitation',
    invitationAccepted:
      'Invitation accepted! The project has been added to your dashboard.',
    invitationExpired: 'This invitation has expired',
    invitationInvalid: 'Invalid invitation',
    loginToAccept: 'Please log in to accept this invitation',
    accepting: 'Accepting',
    redirectingToProject: 'Redirecting to project',
    invitedEmail: 'Invited email',
    loadingShare: 'Loading share information...',
    projectSharedBy: 'Project shared by',
    signInRequired: 'Sign in required',
    signInToAccept: 'Please sign in to accept this invitation',
    signInButton: 'Sign in',
    goToProject: 'Go to Project',
    backToHome: 'Back to Home',
    acceptFailed: 'Failed to accept invitation',
    differentEmail: 'This invitation is for a different email address',
  },
  error: 'Error',
  segmentationEditor: {
    reloadingSegmentation: 'Reloading segmentation...',
    loadingFrame: 'Loading frame...',
    segmenting: 'Segmenting...',
    waitingInQueue: 'Waiting in queue...',
    retryingLoad: 'Having trouble loading. Retrying...',
    error: {
      title: 'Segmentation Error',
      description:
        'An error occurred while loading segmentation data. This might be due to network issues or server problems.',
      errorDetails: 'Error Details',
      tryAgain: 'Try Again',
      unsavedChanges: 'Unsaved changes',
      imageLoadFailed: 'Failed to load image. Please refresh to try again.',
    },
    export: {
      exportAllMetrics: 'Export all metrics as XLSX',
      exportUnavailable: 'Export Unavailable',
      loading: 'Loading...',
    },
  },
  microtubule: {
    instancePanel: 'Microtubule Instances',
    instance: 'Microtubule',
    hideInstance: 'Hide microtubule',
    showInstance: 'Show microtubule',
    renameInstance: 'Rename microtubule',
    hideAll: 'Hide all',
    showAll: 'Show all',
    type: {
      set: 'Set type',
      setForSelected: 'Set type for {{count}} selected',
      none: 'None',
      newLabel: 'New label…',
      renameLabel: 'Rename label',
      deleteLabel: 'Delete label',
      manageLabels: 'Type labels',
      labelName: 'Name',
      labelNamePlaceholder: 'e.g. alpha-tubulin',
      labelColor: 'Colour',
      labelDialogDescription: 'Name the tubulin type and pick a colour.',
      updated: 'Microtubule type updated',
      updateFailed: 'Failed to update microtubule type',
      createFailed: 'Failed to create label',
      renameFailed: 'Failed to rename label',
      deleteFailed: 'Failed to delete label',
      loadFailed: 'Failed to load type labels',
      duplicateName: 'A label with this name already exists',
    },
    color: {
      label: 'Colour:',
      byInstance: 'Instance',
      byLabel: 'Label',
    },
  },
  sperm: {
    instancePanel: 'Sperm Instances',
    instance: 'Sperm',
    newInstance: 'New Instance',
    unassigned: 'Unassigned',
    unclassified: 'Unclassified',
    part: {
      head: 'Head',
      midpiece: 'Midpiece',
      tail: 'Tail',
    },
    setAsHead: 'Set as Head',
    setAsMidpiece: 'Set as Midpiece',
    setAsTail: 'Set as Tail',
    assignTo: 'Assign to',
    export: {
      description:
        'Export sperm morphology measurements (head, midpiece, tail lengths) to Excel.',
      calibration: 'Calibration Factor',
      instances: 'instances',
      polylines: 'polylines',
      button: 'Export Sperm Metrics',
      failed: 'Failed to export sperm metrics',
    },
  },
  feedback: {
    buttonTitle: 'Send feedback',
    buttonAriaLabel: 'Open feedback form',
    title: 'Send feedback',
    subtitle: 'Found a bug or have an idea? Tell us — we read every report.',
    typeBug: 'Bug report',
    typeFeature: 'Feature request',
    titleLabel: 'Title',
    titlePlaceholder: 'Short summary',
    bodyLabel: 'Details',
    bodyPlaceholder:
      'Steps to reproduce, what you expected, screenshots if relevant...',
    submit: 'Submit',
    submittedSuccess: 'Thanks! Your feedback was sent.',
    submitFailed: "Couldn't send feedback",
    submittedNoEmail:
      'Thanks! Your feedback was recorded (email notification is pending).',
    attachmentStoreFailed:
      "Your report was sent, but the attached file couldn't be stored — please try attaching it again.",
    attachmentPrompt:
      'Drag a file here, or click to select — a screenshot or the video/ND2 your report is about (up to 50 GB)',
    attachmentTooLarge: 'File too large — limit is 50 GB',
    attachmentInvalidType: 'Unsupported file type (image, video or ND2 only)',
    removeAttachment: 'Remove attachment',
    uploading: 'Uploading…',
  },
  editor: {
    channelSwitcher: {
      title: 'Channels',
      detectionSource: 'Segmentation source',
    },
    kymograph: {
      title: 'Kymograph',
      sourceChannel: 'Source channel',
      tracked: '🔗 Tracked across frames',
      untracked: '⚠ Static line (no tracking)',
      computing: 'Computing kymograph…',
      downloadPng: 'PNG',
      downloadCsv: 'CSV',
      showKymograph: 'Show kymograph',
      axisTime: 'Time (frames)',
      axisAlong: 'Along microtubule (px) →',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit to view',
      zoomHint: 'drag to pan · scroll to zoom',
      empty: 'Kymograph could not be computed.',
      velocityAnalysis: 'Velocity analysis',
      widthLabel: 'Intensity width',
      widthHint:
        'Width (px) of the band sampled around each trajectory for signal vs. background intensity.',
      colVelocity: 'Net velocity',
      colRunLength: 'Run length (µm)',
      colRunTime: 'Run time (s)',
      colIntensity: 'Intensity (signal−bg)',
      colEdge: 'Edge',
      colBright: 'Bright',
      brightHint:
        'Intensity outlier — likely a multi-motor aggregate, not a single motor.',
      colSnr: 'SNR',
      edge: {
        left: 'Reaches the left end (continues off the microtubule)',
        right: 'Reaches the right end (continues off the microtubule)',
        both: 'Reaches both ends',
        none: 'Stays within the microtubule',
      },
      noBlobs: 'No moving particles detected',
      velocityFailed: 'Velocity detection failed.',
      filteredHidden:
        '{{count}} non-processive trajectory(ies) below 0.01 µm/s hidden.',
      downloadTracks: 'Velocity CSV',
      uncalibrated:
        'No pixel-size / frame-interval calibration — velocities shown in px/frame.',
    },
    channels: {
      toggleVisibility: 'Toggle channel visibility',
      editColor: 'Edit colour',
      opacity: 'Channel opacity',
      renameHint: 'Double-click to rename',
      renameFailed: 'Rename failed',
      renameTooLong: 'Name too long (max 128 chars)',
      colorDialog: {
        title: 'Channel colour:',
        description:
          'Pick how this channel tints the composite overlay. White renders the underlying grayscale unchanged.',
        customLabel: 'Custom',
      },
    },
    windowLevel: {
      title: 'Display',
      channel: 'Channel',
      min: 'Min',
      max: 'Max',
      brightness: 'Brightness',
      contrast: 'Contrast',
      reset: 'Reset',
    },
    frameNavigation: {
      frame: 'Frame',
      play: 'Play',
      pause: 'Pause',
    },
  },

  // Project folder hierarchy (file-explorer-style organisation of the gallery)
  folders: {
    folder: 'Folder',
    home: 'Home',
    newFolder: 'New folder',
    createFolder: 'Create folder',
    create: 'Create',
    folderName: 'Folder name',
    folderNamePlaceholder: 'e.g. Experiment A',
    rename: 'Rename',
    renameFolder: 'Rename folder',
    deleteFolder: 'Delete folder',
    deleteFolderConfirm:
      'Delete folder "{{name}}"? This will permanently delete {{projects}} project(s) and {{subfolders}} subfolder(s). {{shared}} shared project(s) will return to root.',
    moveTo: 'Move to…',
    moveToRoot: 'Root (no folder)',
    openFolder: 'Open folder {{name}}',
    empty: 'Empty folder',
    created: 'Folder created',
    renamed: 'Folder renamed',
    deleted: 'Folder deleted',
    moved: 'Moved successfully',
    moveSkipped: 'Move skipped — no access to that project',
    movePartial: 'Moved {{moved}} project(s); {{skipped}} skipped (no access)',
    moveAllSkipped: '{{count}} project(s) skipped — no access',
    deletePartial:
      'Deleted {{deleted}} project(s); {{failed}} failed. Folder kept; retry the failures.',
    duplicateName: 'A folder with this name already exists here',
    cannotMoveIntoSelf:
      'A folder cannot be moved into itself or its own subfolder',
  },
  automatedEssays: {
    rerun: 'Run again',
    rerunHint:
      'Run this folder again using the files already on the server — no re-upload needed.',
    rerunStarted: 'The run has been queued again.',
    rerunFailed: 'Could not start the run again.',
    rerunConfirm:
      'Run this folder again? It uses the files already stored on the server.',
    rerunConfirmReplace:
      'Run this folder again? The current result will be replaced — download it first if you want to keep it.',
    navLabel: 'Automated Essays',
    title: 'Automated Essays',
    subtitle:
      'Upload a folder of .nd2 well recordings to measure microtubule length and intensity for every well.',
    dragFolder: 'Drag a folder of .nd2 wells here',
    dropHere: 'Drop the folder to add it',
    selectFolder: 'Select folder',
    onlyNd2: 'Only .nd2 well recordings are processed.',
    filesSelected: '{{count}} .nd2 file(s) selected',
    clear: 'Clear',
    uploadAndProcess: 'Upload & process',
    uploading: 'Uploading… {{percent}}%',
    jobStarted: 'Upload complete — processing started',
    uploadFailed: 'Upload failed',
    downloadFailed: 'Could not start the download',
    yourRuns: 'Your runs',
    noRuns: 'No runs yet. Upload a folder to get started.',
    fileCount: '{{count}} file(s)',
    mtCount: '{{count}} microtubules',
    deviceDegraded: 'CPU (GPU unavailable)',
    deviceDegradedHint:
      'This run was supposed to use the GPU but could not reach it, so it ran on the CPU and took far longer. Please report this.',
    deviceBusy: 'CPU (GPU busy)',
    deviceBusyHint:
      'The shared GPU was busy for the whole wait, so this ran on the CPU and took longer. Nothing is wrong — no need to report it.',
    download: 'Download',
    delete: 'Delete',
    deleteFailed: 'Could not delete the run',
    noNd2Found: 'No .nd2 well recordings found in that folder',
    someIgnored: 'Using {{kept}} of {{total}} files (only .nd2 is processed)',
    status: {
      queued: 'Queued',
      running: 'Processing',
      completed: 'Completed',
      failed: 'Failed',
    },
  },
  segmenter: {
    dashboard: {
      title: 'Segmenter',
      subtitle: 'Few-shot, self-trained polygon annotation datasets',
      newDataset: 'New dataset',
      noDatasets: 'No datasets yet.',
      createFirst: 'Create your first dataset',
      deleteDataset: 'Delete dataset',
      imageCount: '{{count}} image(s)',
      createDialogTitle: 'New dataset',
      createDialogDescription:
        "Datasets group unlabeled images you'll annotate with your own classes.",
      nameLabel: 'Dataset name',
      namePlaceholder: 'e.g. Nuclei — round 1',
      creating: 'Creating…',
      create: 'Create',
      deleteConfirmTitle: 'Delete dataset?',
      deleteConfirmDescription:
        'This permanently deletes "{{name}}", all of its images, classes, and annotations. This cannot be undone.',
      cancel: 'Cancel',
      deleting: 'Deleting…',
      delete: 'Delete',
      loadFailed: 'Failed to load datasets',
      created: 'Dataset created',
      createFailed: 'Failed to create dataset',
      deleted: 'Dataset deleted',
      deleteFailed: 'Failed to delete dataset',
    },
    datasetDetail: {
      backLabel: 'Back to datasets',
      loading: 'Loading…',
      imageCount: '{{count}} image(s)',
      noImages: 'No images yet. Drop some above to get started.',
      annotated: 'Annotated',
      deleteImage: 'Delete image',
      deleteConfirmTitle: 'Delete image?',
      deleteConfirmDescription:
        'This permanently deletes "{{name}}" and its annotation. This cannot be undone.',
      cancel: 'Cancel',
      deleting: 'Deleting…',
      delete: 'Delete',
      loadFailed: 'Failed to load dataset',
      deleteFailed: 'Failed to delete image',
    },
    upload: {
      skippedVideo:
        '{{count}} file(s) skipped — the segmenter accepts static images only',
      success: '{{count}} image(s) uploaded',
      partialFail:
        '{{uploaded}} uploaded, {{failed}} failed — check format/size',
      failed: 'Upload failed',
    },
    classes: {
      panelTitle: 'Classes',
      newClass: 'New class',
      loading: 'Loading classes…',
      empty: 'No classes yet. Create one to start annotating.',
      renameLabel: 'Rename class',
      deleteLabel: 'Delete class',
      unclassified: 'Unclassified',
      unknown: 'Unknown class',
      activeClass: 'Active class',
      pickerEmpty: 'No classes yet — create one below before drawing.',
      dialogTitleCreate: 'New class',
      dialogTitleRename: 'Rename class',
      dialogDescription:
        'Give the class a name and a colour used to render its polygons.',
      nameLabel: 'Class name',
      namePlaceholder: 'e.g. Nucleus',
      colorLabel: 'Colour',
      cancel: 'Cancel',
      create: 'Create',
      save: 'Save',
      loadFailed: 'Failed to load classes',
      createFailed: 'Failed to create class',
      nameClash: 'A class with that name already exists',
      renameFailed: 'Failed to rename class',
      deleteFailed: 'Failed to delete class',
    },
    editor: {
      missingRouteParams: 'Missing dataset or image id in the route.',
      back: 'Back',
      selectMode: 'Select',
      drawPolygon: 'Draw polygon',
      editVertices: 'Edit vertices',
      deletePolygon: 'Delete polygon',
      undo: 'Undo',
      redo: 'Redo',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      resetView: 'Reset view',
      save: 'Save',
      saveUnsaved: 'Save*',
      saved: 'Annotation saved',
      saveFailed: 'Failed to save annotation',
      loadFailed: 'Failed to load annotation',
      saveDisabledLoadError:
        "Saving is disabled until this image's annotation loads successfully, to avoid overwriting your saved work with an empty one.",
      retry: 'Retry',
      imageLoadFailed: 'Failed to load image',
      imageAlt: 'Image to annotate',
      minVertices: 'A polygon needs at least 3 points',
    },
    polygonList: {
      title: 'Polygons ({{count}})',
      empty:
        'No polygons yet. Switch to "Draw polygon" and click on the image.',
      instance: 'Instance {{id}}',
      points: '{{count}} pts',
      changeClass: 'Change class',
      delete: 'Delete polygon',
    },
  },
};
