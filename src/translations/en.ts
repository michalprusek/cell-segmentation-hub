export default {
  common: {
    appName: 'Spheroid Segmentation',
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
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
    welcome: 'Welcome to the Spheroid Segmentation Platform',
    account: 'Account',
    notifications: 'Notifications',
    passwordConfirm: 'Confirm Password',
    manageAccount: 'Manage your account',
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
      totalProjectsDesc: 'Active spheroid studies',
      processedImages: 'Processed Images',
      processedImagesDesc: 'Successfully segmented',
      uploadedToday: 'Uploaded Today',
      uploadedTodayDesc: 'Spheroid images',
      storageUsed: 'Storage Used',
      totalSpaceUsed: 'Total space used',
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
      'Add a new project to organize your spheroid images and analyses.',
    projectNamePlaceholder: 'e.g., HeLa Cell Spheroids',
    projectDescPlaceholder:
      'e.g., Analysis of tumor spheroids for drug resistance studies',
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
    allImagesAlreadySegmented: 'All images are already segmented or queued',
    errorAddingToQueue: 'Error adding images to queue',
    imageAlreadyProcessing: 'Image is already being processed',
    processImageFailed: 'Failed to process image',
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
  },
  errors: {
    noProjectOrUser: 'Error: No project or user selected',
    unknown: 'Unknown error',
    validation: {
      projectNameRequired: 'Please enter a project name',
      loginRequired: 'You must be logged in to create a project',
    },
  },
  images: {
    uploadImages: 'Upload Images',
    dragDrop: 'Drag & drop images here',
    clickToSelect: 'or click to select files',
    acceptedFormats: 'Accepted formats: JPEG, PNG, TIFF, BMP (max 10MB)',
    uploadProgress: 'Upload Progress',
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
    dropImagesHere: 'Drop the images here...',
    selectProjectFirst: 'Please select a project first',
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
      models: {
        hrnet: {
          name: 'HRNet',
          description: 'Fast and efficient model for real-time segmentation',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description: 'Balanced speed and accuracy for most use cases',
        },
        ma: {
          name: 'MA-ResUNet',
          description: 'Highest accuracy with attention mechanisms',
        },
      },
    },
    confidenceThreshold: 'Confidence Threshold',
    confidenceThresholdDescription:
      'Minimum confidence required for segmentation predictions',
    currentThreshold: 'Current threshold',
    modelSelected: 'Model selected successfully',
    modelSettingsSaved: 'Model settings saved successfully',
    modelSize: {
      small: 'Small',
      medium: 'Medium',
      large: 'Large',
    },
    modelDescription: {
      hrnet: 'Fast and efficient model for real-time segmentation',
      resunet_small: 'Balanced speed and accuracy for most use cases',
      resunet_advanced: 'Highest accuracy with attention mechanisms',
    },
    dataUsageTitle: 'Data Usage & Privacy',
    dataUsageDescription:
      'Control how your data is used for machine learning and research',
    allowMLTraining: {
      label: 'Allow ML Model Training',
      description:
        'Allow your data to be used for training and improving our segmentation models',
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
    mode: {
      view: 'View and navigate',
      edit: 'Edit',
      editVertices: 'Edit vertices',
      addPoints: 'Add points',
      create: 'Create',
      createPolygon: 'Create polygon',
      slice: 'Slice',
      delete: 'Delete',
      deletePolygon: 'Delete polygon',
      unknown: 'Unknown',
    },
    shortcuts: {
      buttonText: 'Shortcuts',
      dialogTitle: 'Keyboard Shortcuts',
      footerNote:
        'These shortcuts work within the segmentation editor for faster and more convenient work.',
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
      editMode: [
        'Click to create a new point',
        'Hold Shift to automatically create sequence of points',
        'Close polygon by clicking on the first point',
      ],
      slicingMode: [
        'Click to start slice',
        'Click again to finish slice',
        'Esc cancels slicing',
      ],
      pointAddingMode: [
        'Hover cursor over polygon line',
        'Click to add point to selected polygon',
        'Esc exits adding mode',
      ],
    },
    modeDescription: {
      view: 'Navigate and select polygons',
      edit: 'Move and modify vertices',
      addPoints: 'Add points between vertices',
      create: 'Create new polygons',
      slice: 'Split polygons with a line',
      delete: 'Remove polygons',
    },
    toolbar: {
      mode: 'Mode',
      keyboard: 'Key: {{key}}',
      requiresSelection: 'Requires polygon selection',
      requiresPolygonSelection: 'Requires polygon selection',
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
      addPoints: {
        clickVertex: 'Click on any vertex to start adding points',
        addPoints:
          'Click to add points, then click on another vertex to complete',
        holdShift: 'Hold SHIFT to automatically add points',
        cancel: 'Press ESC to cancel',
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
    checkingAuthentication: 'Checking authentication...',
    loadingAccount: 'Loading your account...',
    processingRequest: 'Processing your request...',
    // SignIn page specific
    signInToAccount: 'Sign in to your account',
    accessPlatform: 'Access the spheroid segmentation platform',
    emailAddress: 'Email address',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: '••••••••',
    signingIn: 'Signing in...',
    redirectingToDashboard: 'Redirecting to dashboard...',
    fillAllFields: 'Please fill in all fields',
    // Toast messages
    signInSuccess: 'Successfully signed in',
    signInFailed: 'Sign in failed',
    registrationSuccess: 'Registration successful',
    registrationFailed: 'Registration failed',
    logoutFailed: 'Logout failed',
    profileUpdateFailed: 'Profile update failed',
    welcomeMessage: 'Welcome to the Spheroid Segmentation Platform',
    confirmationRequired:
      'Confirmation text is required and must match your email address',
    agreeToTerms: 'By signing in, you agree to our',
    termsOfService: 'Terms of Service',
    and: 'and',
    privacyPolicy: 'Privacy Policy',
    // SignUp page specific
    createAccount: 'Create your account',
    signUpPlatform: 'Sign up to use the spheroid segmentation platform',
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
  },
  queue: {
    title: 'Segmentation Queue',
    connected: 'Connected',
    disconnected: 'Disconnected',
    waiting: 'waiting',
    processing: 'processing',
    segmentAll: 'Segment All',
    totalProgress: 'Total Progress',
    images: 'images',
    loadingStats: 'Loading statistics...',
    connectingMessage:
      'Connecting to server... Real-time updates will be available soon.',
    emptyMessage:
      'No images in queue. Upload images and add them to the queue for segmentation.',
    addingToQueue: 'Adding to queue...',
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
      notFound: 'Project not found',
      invalidResponse: 'Server response was invalid',
      readyForImages: 'is ready for images',
    },
    // Profile actions
    profile: {
      consentUpdated: 'Consent preferences updated successfully',
      loadFailed: 'Failed to load profile data',
    },
    // Upload actions
    upload: {
      failed: 'Failed to refresh images after upload',
    },
    // Segmentation actions
    segmentation: {
      saved: 'Segmentation saved successfully',
      failed: 'Failed to save segmentation',
      deleted: 'Polygon deleted',
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
  export: {
    // Dialog headers
    advancedOptions: 'Advanced Export Options',
    configureSettings:
      'Configure your export settings to create a comprehensive dataset package',
    // Tabs
    general: 'General',
    visualization: 'Visualization',
    formats: 'Formats',
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
    selectNone: 'Select None',
    imageSelection: 'Image Selection',
    chooseImages: 'Choose which images to include in the export',
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
    // Format options
    outputSettings: 'Output Settings',
    exportFormats: 'Export Formats',
    exportToZip: 'Export to ZIP archive',
    generateExcel: 'Generate Excel metrics',
    includeCocoFormat: 'Include COCO format annotations',
    includeJsonMetadata: 'Include JSON metadata',
    // Progress and status
    preparing: 'Preparing export...',
    processing: 'Processing {{current}} of {{total}}',
    packaging: 'Creating package...',
    completed: 'Export completed',
    downloading: 'Downloading...',
    cancelled: 'Export cancelled',
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
    // Header section
    badge: 'Documentation',
    title: 'SpheroSeg Documentation',
    subtitle: 'Comprehensive guide to using our spheroid segmentation platform',

    // Navigation
    navigation: 'Navigation',

    // Navigation items
    nav: {
      introduction: 'Introduction',
      gettingStarted: 'Getting Started',
      uploadingImages: 'Uploading Images',
      modelSelection: 'Model Selection',
      segmentationProcess: 'Segmentation Process',
      segmentationEditor: 'Segmentation Editor',
      exportFeatures: 'Export Features',
    },

    // Introduction section
    introduction: {
      title: 'Introduction',
      whatIs: 'What is SpheroSeg?',
      description:
        'SpheroSeg is an advanced platform designed specifically for the segmentation and analysis of cellular spheroids in microscopic images. Our tool combines cutting-edge AI algorithms with an intuitive interface to provide researchers with precise spheroid boundary detection and analysis capabilities.',
      developedBy:
        'This platform was developed by Bc. Michal Průšek, a student at the Faculty of Nuclear Sciences and Physical Engineering at Czech Technical University in Prague, under the supervision of Ing. Adam Novozámský, Ph.D. The project is a collaboration with researchers from the Institute of Biochemistry and Microbiology at UCT Prague.',
      addresses:
        'SpheroSeg addresses the challenging task of accurately identifying and segmenting spheroid boundaries in microscopic images, a critical step in many biomedical research workflows involving 3D cell culture models.',
    },

    // Getting Started section
    gettingStarted: {
      title: 'Getting Started',
      accountCreation: 'Account Creation',
      accountDescription:
        "To use SpheroSeg, you'll need to create an account. This allows us to store your projects and images securely.",
      accountSteps: {
        step1: 'Navigate to the sign-up page',
        step2: 'Enter your institutional email address and create a password',
        step3: 'Complete your profile with your name and institution',
        step4: 'Verify your email address through the link sent to your inbox',
      },
      firstProject: 'Creating Your First Project',
      projectDescription:
        'Projects help you organize your work. Each project can contain multiple images and their corresponding segmentation results.',
      projectSteps: {
        step1: 'From your dashboard, click "New Project"',
        step2: 'Enter a project name and description',
        step3: 'Select the project type (default: Spheroid Analysis)',
        step4: 'Click "Create Project" to proceed',
      },
    },

    // Upload Images section
    uploadImages: {
      title: 'Uploading Images',
      description:
        'SpheroSeg supports various image formats commonly used in microscopy, including TIFF, PNG, and JPEG.',
      methods: 'Upload Methods',
      methodsDescription: 'There are multiple ways to upload your images:',
      methodsList: {
        dragDrop: 'Drag and drop files directly onto the upload area',
        browse:
          'Click the upload area to browse and select files from your computer',
        batch: 'Batch upload multiple images at once',
      },
      note: 'Note:',
      noteText:
        'For optimal results, ensure your microscopic images have good contrast between the spheroid and background.',
    },

    // Model Selection section
    modelSelection: {
      title: 'Model Selection',
      description:
        'SpheroSeg offers three different AI models optimized for different use cases. Choose the model that best fits your requirements for speed vs accuracy.',
      models: {
        hrnet: {
          name: 'HRNet (Small)',
          inferenceTime: 'Inference time: ~3.1 seconds',
          bestFor: 'Best for: Real-time processing and quick results',
          description:
            'Fast and efficient model ideal for rapid segmentation when speed is prioritized over maximum accuracy.',
        },
        cbam: {
          name: 'CBAM-ResUNet (Medium)',
          inferenceTime: 'Inference time: ~6.9 seconds',
          bestFor: 'Best for: Balanced speed and accuracy',
          description:
            'Optimal balance between processing speed and segmentation quality for most use cases.',
        },
        ma: {
          name: 'MA-ResUNet (Large)',
          inferenceTime: 'Inference time: ~18.1 seconds',
          bestFor: 'Best for: Maximum precision',
          description:
            'Highest accuracy model with attention mechanisms for the most precise spheroid boundary detection.',
        },
      },
      howToSelect: 'How to Select a Model',
      selectionSteps: {
        step1: 'Open your project and navigate to any image',
        step2: 'In the project toolbar, find the model selection dropdown',
        step3: 'Choose from HRNet, CBAM-ResUNet, or MA-ResUNet',
        step4:
          'Adjust the confidence threshold (0.0-1.0) to fine-tune detection sensitivity',
        step5: 'Your selection is automatically saved for future processing',
      },
      tip: 'Tip:',
      tipText:
        'Start with CBAM-ResUNet for most cases. Use HRNet for rapid prototyping and MA-ResUNet when you need the highest possible accuracy for research or publication.',
    },

    // Segmentation Process section
    segmentationProcess: {
      title: 'Segmentation Process',
      description:
        'The segmentation process uses advanced AI models to automatically detect spheroid boundaries in your microscopic images. The system supports both automatic processing and manual refinement.',
      queueBased: 'Queue-based Processing',
      queueDescription:
        'SpheroSeg uses a processing queue system to handle multiple segmentation tasks efficiently:',
      queueFeatures: {
        realTime:
          'Real-time status: WebSocket notifications provide live updates on processing progress',
        batch: 'Batch processing: Process multiple images simultaneously',
        priority: 'Priority handling: More recent requests are processed first',
        recovery:
          'Error recovery: Failed jobs are automatically retried with detailed error reporting',
      },
      workflow: 'Automatic Segmentation Workflow',
      workflowSteps: {
        step1: 'Upload your microscopic images to a project',
        step2:
          'Select your preferred AI model (HRNet, CBAM-ResUNet, or MA-ResUNet)',
        step3: 'Adjust the confidence threshold if needed (default: 0.5)',
        step4:
          'Click "Auto-Segment" or use batch processing for multiple images',
        step5: 'Monitor real-time progress through the status indicators',
        step6:
          'Review results in the segmentation editor once processing completes',
      },
      polygonTypes: 'Polygon Types',
      polygonDescription: 'The system detects two types of polygons:',
      polygonTypesList: {
        external:
          'External polygons: Main spheroid boundaries (shown in green by default)',
        internal:
          'Internal polygons: Holes or internal structures within spheroids (shown in red by default)',
      },
      processingNote: 'Processing times vary by model:',
      processingTimes:
        'HRNet (~3s), CBAM-ResUNet (~7s), MA-ResUNet (~18s). Choose based on your accuracy requirements and time constraints.',
    },

    // Segmentation Editor section
    segmentationEditor: {
      title: 'Segmentation Editor',
      description:
        'The segmentation editor is a powerful tool for refining AI-generated segmentations and creating manual annotations. It features multiple editing modes, keyboard shortcuts, and advanced polygon manipulation tools.',
      editingModes: 'Editing Modes',
      modes: {
        view: {
          title: 'View Mode',
          description:
            'Navigate and inspect polygons without making changes. Click polygons to select them and view details.',
        },
        editVertices: {
          title: 'Edit Vertices',
          description:
            'Drag individual vertices to refine polygon boundaries. Precise control for boundary adjustments.',
        },
        addPoints: {
          title: 'Add Points',
          description:
            'Insert new vertices between existing ones. Shift+click for automatic point placement.',
        },
        createPolygon: {
          title: 'Create Polygon',
          description:
            'Draw new polygons from scratch. Click to add points, double-click to complete.',
        },
        sliceMode: {
          title: 'Slice Mode',
          description:
            'Cut polygons into multiple parts by drawing lines through them.',
        },
        deletePolygon: {
          title: 'Delete Polygon',
          description:
            'Remove unwanted polygons by clicking on them. Useful for eliminating false detections.',
        },
      },
      keyFeatures: 'Key Features',
      features: {
        undoRedo:
          'Undo/Redo System: Full history tracking with Ctrl+Z/Ctrl+Y support',
        autoSave:
          'Auto-save: Periodic saving with visual indicators showing unsaved changes',
        zoomPan: 'Zoom & Pan: Mouse wheel zooming and drag-to-pan navigation',
        polygonManagement:
          'Polygon Management: Show/hide, rename, and batch operations',
        keyboardShortcuts:
          'Keyboard Shortcuts: Comprehensive hotkeys for efficient editing',
        realTimeFeedback:
          'Real-time Feedback: Live preview of edits and status updates',
      },
      shortcuts: 'Essential Keyboard Shortcuts',
      shortcutCategories: {
        navigation: 'Navigation:',
        actions: 'Actions:',
      },
      shortcutsList: {
        v: 'View mode',
        e: 'Edit vertices',
        a: 'Add points',
        n: 'Create polygon',
        ctrlZ: 'Undo',
        ctrlY: 'Redo',
        ctrlS: 'Save',
        delete: 'Remove selected',
      },
      workingWithPolygons: 'Working with Polygons',
      polygonSteps: {
        step1:
          'Select a polygon by clicking on it (highlighted in blue when selected)',
        step2: 'Switch to the appropriate editing mode for your task',
        step3: 'Make your modifications using mouse interactions',
        step4:
          'Use the polygon panel on the right to manage visibility and properties',
        step5: 'Save your changes periodically or rely on auto-save',
      },
    },

    // Export Features section
    exportFeatures: {
      title: 'Export Features',
      description:
        'SpheroSeg provides comprehensive export capabilities to integrate with your research workflow. Export segmentation data in multiple formats suitable for machine learning frameworks and analysis tools.',
      packageContents: 'Export Package Contents',
      contents: {
        originalImages: {
          title: 'Original Images',
          description:
            'High-quality original microscopic images in their native format.',
        },
        visualizations: {
          title: 'Visualizations',
          description:
            'Annotated images with numbered polygons and customizable colors.',
        },
      },
      annotationFormats: 'Annotation Formats',
      formats: {
        coco: 'COCO Format: Common Objects in Context - standard format for object detection frameworks like PyTorch and TensorFlow',
        yolo: 'YOLO Format: You Only Look Once - optimized format for YOLO-based detection models',
        json: 'Custom JSON: Structured JSON format with detailed polygon coordinates and metadata',
      },
      calculatedMetrics: 'Calculated Metrics',
      metricsDescription:
        'SpheroSeg automatically calculates comprehensive morphological metrics for each detected spheroid:',
      metricsCategories: {
        basic: {
          title: 'Basic Measurements:',
          items: {
            area: 'Area (pixels and scaled units)',
            perimeter: 'Perimeter',
            diameter: 'Equivalent diameter',
            circularity: 'Circularity',
          },
        },
        advanced: {
          title: 'Advanced Metrics:',
          items: {
            feret: 'Feret diameters (max, min, aspect ratio)',
            majorMinor: 'Major/minor diameter through centroid',
            compactness: 'Compactness, convexity, solidity',
            sphericity: 'Sphericity index',
          },
        },
      },
      exportFormats: 'Metrics Export Formats',
      exportFormatsList: {
        excel:
          'Excel (.xlsx): Formatted spreadsheet with separate sheets for summary and detailed data',
        csv: 'CSV: Comma-separated values for easy import into statistical software',
        jsonExport: 'JSON: Structured data format for programmatic analysis',
      },
      visualizationCustomization: 'Visualization Customization',
      customizationOptions: {
        colors:
          'Polygon colors: Customize external (green) and internal (red) polygon colors',
        numbering: 'Numbering: Show/hide polygon numbers for identification',
        strokeWidth: 'Stroke width: Adjust line thickness (1-10px)',
        fontSize: 'Font size: Control text size for polygon numbers (10-30px)',
        transparency: 'Transparency: Set polygon fill transparency (0-100%)',
      },
      howToExport: 'How to Export',
      exportSteps: {
        step1: 'Navigate to your project dashboard',
        step2: 'Select the images you want to export (or export all)',
        step3: 'Click "Advanced Export" to open the export dialog',
        step4:
          'Configure your export settings across the three tabs: General, Visualization, and Formats',
        step5: 'Review the export summary',
        step6: 'Click "Start Export" to generate and download your package',
      },
      exportNote: 'Export packages are comprehensive:',
      exportNoteText:
        'Each export includes documentation, metadata, and all selected content types organized in a clear folder structure for easy use.',
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
          'If you have questions about these Terms, please contact us at spheroseg@utia.cas.cz',
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
            'This Privacy Policy explains how SpheroSeg ("we", "us", "our") collects, uses, protects, and shares your information when you use our platform for spheroid segmentation and analysis. By using our service, you consent to the data practices described in this policy.',
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
            'To exercise these rights, contact us at spheroseg@utia.cas.cz. We will respond within 30 days.',
        },
        dataRetention: {
          title: '8. Data Retention',
          content: 'We distinguish between personal data and ML training data:',
          categories: [
            'Personal/Account Data: All personal identifiers, profile information, account settings, and transaction history will be permanently deleted within 90 days of account closure.',
            'Research Data: Original images and project data linked to your account will be deleted within 90 days of account closure.',
            'ML Training Data: Data used for ML training is first anonymized/pseudonymized to remove all personal identifiers. This anonymized data may be retained indefinitely to preserve model improvements, unless you specifically opt out of ML training or request full deletion.',
            'Opt-out Options: You can request complete deletion of all data, including anonymized ML training data, by contacting spheroseg@utia.cas.cz. Processing time is typically 30 days.',
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
          dpo: 'Data Protection Officer: spheroseg@utia.cas.cz',
          general: 'General Inquiries: spheroseg@utia.cas.cz',
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
    reconnectFailed: 'Failed to restore connection to server',
    connectionLost: 'Connection to server lost',
    pollingMode: 'Connected to server (polling mode)',
    upgradedToWebSocket: 'Upgraded to real-time connection',
    connectionError: 'Unable to connect to server',
    authError: 'Authentication error',
  },
};
