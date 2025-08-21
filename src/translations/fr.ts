export default {
  common: {
    appName: 'Segmentation de Sphéroïdes',
    loading: 'Chargement...',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    create: 'Créer',
    search: 'Rechercher',
    error: 'Erreur',
    success: 'Succès',
    back: 'Retour',
    signIn: 'Se connecter',
    signUp: "S'inscrire",
    signOut: 'Se déconnecter',
    settings: 'Paramètres',
    profile: 'Profil',
    dashboard: 'Tableau de bord',
    project: 'Projet',
    projects: 'Projets',
    polygon: 'Polygone',
    newProject: 'Nouveau projet',
    upload: 'Télécharger',
    uploadImages: 'Télécharger des images',
    recentAnalyses: 'Analyses récentes',
    noProjects: 'Aucun projet trouvé',
    noImages: 'Aucune image trouvée',
    createYourFirst: 'Créez votre premier projet pour commencer',
    tryAgain: 'Réessayer',
    email: 'Email',
    password: 'Mot de passe',
    name: 'Nom',
    description: 'Description',
    date: 'Date',
    status: 'Statut',
    images: 'Images',
    image: 'Image',
    projectName: 'Nom du projet',
    projectDescription: 'Description du projet',
    theme: 'Thème',
    language: 'Langue',
    light: 'Clair',
    dark: 'Sombre',
    system: 'Système',
    welcome: 'Bienvenue sur la plateforme de segmentation de sphéroïdes',
    account: 'Compte',
    notifications: 'Notifications',
    passwordConfirm: 'Confirmer le mot de passe',
    manageAccount: 'Gérer votre compte',
    documentation: 'Documentation',
    changePassword: 'Changer le mot de passe',
    deleteAccount: 'Supprimer le compte',
    termsOfService: 'Conditions de service',
    privacyPolicy: 'Politique de confidentialité',
    createAccount: 'Créer un compte',
    signInToAccount: 'Connectez-vous à votre compte',
    sort: 'Trier',
    no_preview: 'Aucun aperçu',
    // Navigation and UI
    openMenu: 'Ouvrir le menu',
    logOut: 'Se déconnecter',
    // Error pages
    pageNotFound: 'Oups ! Page introuvable',
    returnToHome: "Retour à l'accueil",
    // Navigation
    next: 'Suivant',
    copy: 'Copier',
    noImage: 'Aucune image',
    untitledImage: 'Image sans titre',
    rename: 'Renommer',
  },
  landing: {
    hero: {
      badge: 'Plateforme Avancée de Segmentation de Sphéroïdes',
      title: 'Analyse Cellulaire par IA pour la Recherche Biomédicale',
      subtitle:
        "Améliorez votre analyse d'images cellulaires microscopiques avec notre plateforme de segmentation de sphéroïdes de pointe. Conçue pour les chercheurs recherchant précision et efficacité.",
      getStarted: 'Commencer',
      learnMore: 'En savoir plus',
    },
    about: {
      badge: 'Notre Mission',
      title: 'Faire Progresser la Recherche Biomédicale par la Technologie',
      description1:
        "Notre plateforme a été développée par Bc. Michal Průšek, étudiant à la Faculté des Sciences Nucléaires et d'Ingénierie Physique (FJFI) de l'Université Technique Tchèque de Prague, sous la supervision d'Ing. Adam Novozámský, Ph.D.",
      description2:
        "Ce projet est une collaboration avec des chercheurs de l'Institut de Biochimie et de Microbiologie de l'UCT Prague (VŠCHT Praha).",
      description3:
        "Nous combinons des modèles d'IA de pointe avec une interface intuitive pour fournir aux chercheurs des outils puissants pour l'analyse d'images microscopiques, en nous concentrant sur la segmentation de sphéroïdes avec une précision inégalée.",
      contactText: 'Pour toute demande, veuillez nous contacter à',
    },
    cta: {
      title: "Prêt à Transformer Votre Flux de Travail d'Analyse Cellulaire ?",
      subtitle:
        'Rejoignez les chercheurs de premier plan qui utilisent déjà notre plateforme pour accélérer leurs découvertes.',
      cardTitle: "Commencez Aujourd'hui",
      cardDescription:
        "Inscrivez-vous pour un compte gratuit et découvrez la puissance de la segmentation de sphéroïdes pilotée par l'IA.",
      createAccount: 'Créer Votre Compte',
    },
  },
  dashboard: {
    manageProjects: 'Gérez vos projets de recherche et analyses',
    projectGallery: 'Galerie de projets',
    projectGalleryDescription:
      'Parcourez et gérez tous vos projets de segmentation',
    statsOverview: 'Aperçu des statistiques',
    totalProjects: 'Total des projets',
    activeProjects: 'Projets actifs',
    totalImages: 'Total des images',
    totalAnalyses: 'Total des analyses',
    lastUpdated: 'Dernière mise à jour',
    noProjectsDescription:
      "Vous n'avez pas encore créé de projets. Créez votre premier projet pour commencer.",
    noImagesDescription: 'Téléchargez des images pour commencer',
    searchProjectsPlaceholder: 'Rechercher des projets...',
    searchImagesPlaceholder: 'Rechercher des images par nom...',
    sortBy: 'Trier par',
    name: 'Nom',
    lastChange: 'Dernière modification',
    status: 'Statut',
    // Stats overview
    stats: {
      totalProjects: 'Total des projets',
      totalProjectsDesc: 'Études actives de sphéroïdes',
      processedImages: 'Images traitées',
      processedImagesDesc: 'Segmentées avec succès',
      uploadedToday: "Téléchargées aujourd'hui",
      uploadedTodayDesc: 'Images de sphéroïdes',
      storageUsed: 'Stockage utilisé',
      totalSpaceUsed: 'Espace total utilisé',
    },
    completed: 'Terminé',
    processing: 'Traitement en cours',
    pending: 'En attente',
    failed: 'Échoué',
    storageUsed: 'Stockage Utilisé',
  },
  projects: {
    createProject: 'Créer un nouveau projet',
    createProjectDesc:
      'Ajoutez un nouveau projet pour organiser vos images de sphéroïdes et analyses.',
    projectNamePlaceholder: 'ex. : Sphéroïdes de cellules HeLa',
    projectDescPlaceholder:
      'ex. : Analyse des sphéroïdes tumoraux pour les études de résistance aux médicaments',
    creatingProject: 'Création...',
    duplicateProject: 'Dupliquer',
    shareProject: 'Partager',
    deleteProject: 'Supprimer',
    openProject: 'Ouvrir le projet',
    confirmDelete: 'Êtes-vous sûr de vouloir supprimer ce projet ?',
    projectCreated: 'Projet créé avec succès',
    projectDeleted: 'Projet supprimé avec succès',
    viewProject: 'Voir le projet',
    projectImages: 'Images du projet',
    projectSelection: 'Sélection de projet',
    selectProject: 'Sélectionner un projet',
    imageDeleted: 'Image supprimée avec succès',
    deleteImageError: "Échec de la suppression de l'image",
    deleteImageFailed: "Suppression de l'image échouée",
    imagesQueuedForSegmentation:
      '{{count}} images ajoutées à la file de segmentation',
    imageQueuedForResegmentation:
      'Image ajoutée à la file pour re-segmentation',
    allImagesAlreadySegmented:
      'Toutes les images sont déjà segmentées ou en file',
    errorAddingToQueue: "Erreur lors de l'ajout à la file",
    imageAlreadyProcessing: "L'image est déjà en cours de traitement",
    processImageFailed: "Échec du traitement de l'image",
    segmentationCompleted: "Segmentation terminée pour l'image",
    segmentationFailed: 'Échec de la segmentation',
    segmentationStarted: 'La segmentation a commencé',
    segmentationCompleteWithCount:
      'Segmentation terminée ! {{count}} objets trouvés',
    // Project management errors and messages
    failedToLoadProjects: 'Échec du chargement des projets',
    projectNameRequired: 'Veuillez saisir un nom de projet',
    mustBeLoggedIn: 'Vous devez être connecté pour créer un projet',
    failedToCreateProject: 'Échec de la création du projet',
    serverResponseInvalid: 'La réponse du serveur était invalide',
    projectCreatedDesc: '"{{name}}" est prêt pour les images',
    descriptionOptional: 'Description (Optionnelle)',
    noDescriptionProvided: 'Aucune description fournie',
    deleteDialog: {
      title: 'Confirmer la suppression',
      description:
        'Êtes-vous sûr de vouloir supprimer {{count}} images sélectionnées? Cette action ne peut pas être annulée.',
    },
    selectProjectHeader: 'Sélectionner un Projet',
    noProjects: 'Aucun projet trouvé',
  },
  errors: {
    noProjectOrUser: 'Erreur : Aucun projet ou utilisateur sélectionné',
    unknown: 'Erreur inconnue',
    network:
      'Erreur de connexion réseau. Veuillez vérifier votre connexion Internet.',
    unauthorized: 'Accès refusé. Veuillez vous reconnecter.',
    forbidden: "Vous n'avez pas la permission d'effectuer cette action.",
    notFound: "La ressource demandée n'a pas été trouvée.",
    conflict:
      'Cet email est déjà enregistré. Essayez de vous connecter ou utilisez un autre email.',
    invalidCredentials:
      'Email ou mot de passe invalide. Veuillez vérifier vos identifiants.',
    validation: 'Erreur de validation. Veuillez vérifier votre saisie.',
    general: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    server: 'Erreur du serveur. Veuillez réessayer plus tard.',
    timeout: "Délai d'attente de la demande dépassé. Veuillez réessayer.",
    sessionExpired:
      'Votre session a expiré. Veuillez vous reconnecter pour continuer.',
    tooManyRequests:
      'Trop de demandes. Veuillez patienter un moment et réessayer.',
    serverUnavailable:
      'Service temporairement indisponible. Veuillez réessayer dans quelques minutes.',
    clientError:
      'Erreur de demande. Veuillez vérifier votre saisie et réessayer.',
    emailAlreadyExists:
      'Cet email est déjà enregistré. Essayez de vous connecter ou utilisez un autre email.',
    validationErrors: {
      projectNameRequired: 'Veuillez saisir un nom de projet',
      loginRequired: 'Vous devez être connecté pour créer un projet',
      emailRequired: "L'e-mail est requis",
      passwordRequired: 'Le mot de passe est requis',
      invalidEmail: 'Veuillez saisir une adresse e-mail valide',
      passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
      passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
      confirmationRequired: 'Veuillez confirmer votre action',
      fieldRequired: 'Ce champ est requis',
    },
    operations: {
      loadProject:
        'Impossible de charger le projet. Vérifiez votre connexion et réessayez.',
      saveProject:
        'Impossible de sauvegarder les modifications du projet. Veuillez réessayer.',
      deleteProject:
        "Impossible de supprimer le projet. Assurez-vous d'avoir les permissions nécessaires.",
      uploadImage:
        "Impossible de télécharger l'image. Vérifiez le format et la taille du fichier.",
      deleteImage:
        "Impossible de supprimer l'image. Essayez de rafraîchir la page et de recommencer.",
      processImage:
        "Le traitement de l'image a échoué. Essayez avec une image différente ou contactez le support.",
      segmentation:
        "La segmentation a échoué. Essayez d'utiliser un modèle différent ou ajustez la configuration.",
      export:
        "L'exportation des données a échoué. Vérifiez que les données sont disponibles.",
      login: 'Erreur de connexion. Vérifiez votre e-mail et mot de passe.',
      logout: 'Erreur de déconnexion. Essayez de fermer votre navigateur.',
      register:
        "L'inscription a échoué. Cet e-mail est peut-être déjà utilisé.",
      updateProfile:
        'Impossible de mettre à jour le profil. Vérifiez les informations fournies.',
      changePassword:
        'Impossible de changer le mot de passe. Vérifiez votre mot de passe actuel.',
      resetPassword:
        "La réinitialisation du mot de passe a échoué. Vérifiez l'adresse e-mail fournie.",
      deleteAccount:
        "Impossible de supprimer le compte. Contactez le support pour obtenir de l'aide.",
      updateConsent:
        'Impossible de mettre à jour les préférences de consentement. Veuillez réessayer.',
    },
    contexts: {
      dashboard: 'Erreur du tableau de bord',
      project: 'Erreur de projet',
      image: "Erreur d'image",
      segmentation: 'Erreur de segmentation',
      export: "Erreur d'exportation",
      auth: "Erreur d'authentification",
      profile: 'Erreur de profil',
      settings: 'Erreur de paramètres',
    },
  },
  images: {
    uploadImages: 'Télécharger des images',
    dragDrop: 'Glissez et déposez les images ici',
    clickToSelect: 'ou cliquez pour sélectionner des fichiers',
    acceptedFormats: 'Formats acceptés : JPEG, PNG, TIFF, BMP (max 10MB)',
    uploadProgress: 'Progression du téléchargement',
    uploadingTo: "Sélectionnez d'abord un projet",
    currentProject: 'projet actuel',
    autoSegment: 'Segmenter automatiquement les images après téléchargement',
    uploadCompleted: 'Téléchargement terminé',
    uploadFailed: 'Téléchargement échoué',
    imagesUploaded: 'Images téléchargées avec succès',
    imagesFailed: 'Échec du téléchargement des images',
    viewAnalyses: 'Voir les analyses',
    noAnalysesYet: "Pas encore d'analyses",
    runAnalysis: "Exécuter l'analyse",
    viewResults: 'Voir les résultats',
    dropImagesHere: 'Déposez les images ici...',
    selectProjectFirst: "Veuillez d'abord sélectionner un projet",
    projectRequired:
      'Vous devez sélectionner un projet avant de pouvoir télécharger des images',
    pending: 'En attente',
    uploading: 'Téléchargement',
    processing: 'Traitement',
    complete: 'Terminé',
    error: 'Erreur',
    imageDeleted: 'Image supprimée avec succès',
    deleteImageFailed: "Échec de la suppression de l'image",
    deleteImageError: "Erreur lors de la suppression de l'image",
    imageAlreadyProcessing: "L'image est déjà en cours de traitement",
    processImageFailed: "Échec du traitement de l'image",
  },
  settings: {
    manageSettings: 'Gérer vos préférences de compte',
    appearance: 'Apparence',
    themeSettings: 'Paramètres du thème',
    systemDefault: 'Défaut du système',
    languageSettings: 'Paramètres de langue',
    selectLanguage: 'Sélectionner la langue',
    accountSettings: 'Paramètres du compte',
    notificationSettings: 'Paramètres de notification',
    emailNotifications: 'Notifications par email',
    pushNotifications: 'Notifications push',
    profileSettings: 'Paramètres du profil',
    profileUpdated: 'Profil mis à jour avec succès',
    profileUpdateFailed: 'Échec de la mise à jour du profil',
    saveChanges: 'Enregistrer les modifications',
    savingChanges: 'Enregistrement...',
    notifications: {
      projectUpdates: 'Mises à jour des projets',
      analysisCompleted: 'Analyse terminée',
      newFeatures: 'Nouvelles fonctionnalités',
      marketingEmails: 'Emails marketing',
      billing: 'Notifications de facturation',
    },
    personal: 'Informations personnelles',
    fullName: 'Nom complet',
    organization: 'Organisation',
    department: 'Département',
    publicProfile: 'Profil public',
    bio: 'Biographie',
    makeProfileVisible: 'Rendre mon profil visible aux autres chercheurs',
    dangerZone: 'Zone de danger',
    deleteAccountWarning:
      "Une fois que vous supprimez votre compte, il n'y a pas de retour en arrière. Toutes vos données seront définitivement supprimées.",
    currentPassword: 'Mot de passe actuel',
    newPassword: 'Nouveau mot de passe',
    confirmNewPassword: 'Confirmer le nouveau mot de passe',
    modelSelection: {
      title: 'Sélection de modèle',
      description:
        'Choisissez le modèle IA à utiliser pour la segmentation cellulaire',
      models: {
        hrnet: {
          name: 'HRNet',
          description:
            'Modèle rapide et efficace pour la segmentation en temps réel',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description:
            "Vitesse et précision équilibrées pour la plupart des cas d'usage",
        },
        ma: {
          name: 'MA-ResUNet',
          description: "Précision maximale avec mécanismes d'attention",
        },
      },
    },
    confidenceThreshold: 'Seuil de confiance',
    confidenceThresholdDescription:
      'Confiance minimale requise pour les prédictions de segmentation',
    currentThreshold: 'Seuil actuel',
    modelSelected: 'Modèle sélectionné avec succès',
    modelSettingsSaved: 'Paramètres du modèle enregistrés avec succès',
    modelSize: {
      small: 'Petit',
      medium: 'Moyen',
      large: 'Grand',
    },
    modelDescription: {
      hrnet: 'Modèle rapide et efficace pour la segmentation en temps réel',
      resunet_small:
        "Vitesse et précision équilibrées pour la plupart des cas d'usage",
      resunet_advanced: "Précision maximale avec mécanismes d'attention",
    },
    dataUsageTitle: 'Utilisation des données et confidentialité',
    dataUsageDescription:
      "Contrôlez comment vos données sont utilisées pour l'apprentissage automatique et la recherche",
    allowMLTraining: {
      label: "Permettre l'entraînement des modèles ML",
      description:
        "Permettre l'utilisation de vos données pour entraîner et améliorer nos modèles de segmentation",
    },
    cancel: 'Annuler',
    deleting: 'Suppression...',
    deleteAccount: 'Supprimer le Compte',
    accountDeleted: 'Compte supprimé avec succès',
    deleteAccountError: 'Échec de la suppression du compte',
    deleteAccountDialog: {
      title: 'Supprimer le compte',
      description:
        'Cette action ne peut pas être annulée. Cela supprimera définitivement votre compte et retirera toutes vos données de nos serveurs.',
      whatWillBeDeleted: 'Ce qui sera supprimé :',
      deleteItems: {
        account: 'Votre compte utilisateur et profil',
        projects: 'Tous vos projets et images',
        segmentation: 'Toutes les données de segmentation et résultats',
        settings: 'Paramètres de compte et préférences',
      },
      confirmationLabel: 'Veuillez taper {email} pour confirmer :',
      confirmationPlaceholder: '{email}',
    },
    fillAllFields: 'Veuillez remplir tous les champs requis',
    passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
    passwordChanged: 'Mot de passe changé avec succès',
    passwordsMatch: 'Les mots de passe correspondent',
    changingPassword: 'Changement du mot de passe...',
    changePassword: 'Changer le Mot de Passe',
    languageUpdated: 'Langue mise à jour avec succès',
    themeUpdated: 'Thème mis à jour avec succès',
    appearanceDescription: "Personnalisez l'apparence de l'application",
    language: 'Langue',
    languageDescription: 'Sélectionnez votre langue préférée',
    theme: 'Thème',
    themeDescription: 'Choisissez le thème clair, sombre ou système',
    light: 'Clair',
    dark: 'Sombre',
    system: 'Système',
  },
  auth: {
    signIn: 'Se connecter',
    signUp: "S'inscrire",
    signOut: 'Se déconnecter',
    forgotPassword: 'Mot de passe oublié ?',
    resetPassword: 'Réinitialiser le mot de passe',
    dontHaveAccount: "Vous n'avez pas de compte ?",
    alreadyHaveAccount: 'Vous avez déjà un compte ?',
    signInWith: 'Se connecter avec',
    signUpWith: "S'inscrire avec",
    orContinueWith: 'ou continuer avec',
    rememberMe: 'Se souvenir de moi',
    emailRequired: "L'email est requis",
    passwordRequired: 'Le mot de passe est requis',
    invalidEmail: 'Adresse email invalide',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
    passwordsDontMatch: 'Les mots de passe ne correspondent pas',
    successfulSignIn: 'Connexion réussie',
    successfulSignUp: 'Inscription réussie',
    verifyEmail: 'Veuillez vérifier votre email pour confirmer votre compte',
    successfulSignOut: 'Déconnexion réussie',
    checkingAuthentication: "Vérification de l'authentification...",
    loadingAccount: 'Chargement de votre compte...',
    processingRequest: 'Traitement de votre demande...',
    // SignIn page specific
    signInToAccount: 'Connectez-vous à votre compte',
    accessPlatform: 'Accédez à la plateforme de segmentation de sphéroïdes',
    emailAddress: 'Adresse e-mail',
    emailPlaceholder: 'vous@exemple.com',
    password: 'Mot de passe',
    passwordPlaceholder: '••••••••',
    signingIn: 'Connexion en cours...',
    redirectingToDashboard: 'Redirection vers le tableau de bord...',
    fillAllFields: 'Veuillez remplir tous les champs',
    // Toast messages
    signInSuccess: 'Connexion réussie',
    signInFailed: 'Échec de la connexion',
    registrationSuccess: 'Inscription réussie',
    registrationFailed: "Échec de l'inscription",
    logoutFailed: 'Échec de la déconnexion',
    profileUpdateFailed: 'Échec de la mise à jour du profil',
    welcomeMessage: 'Bienvenue sur la plateforme de segmentation de sphéroïdes',
    confirmationRequired:
      'Le texte de confirmation est requis et doit correspondre à votre adresse e-mail',
    agreeToTerms: 'En vous connectant, vous acceptez nos',
    termsOfService: 'Conditions de service',
    and: 'et',
    privacyPolicy: 'Politique de confidentialité',
    // SignUp page specific
    createAccount: 'Créez votre compte',
    signUpPlatform:
      'Inscrivez-vous pour utiliser la plateforme de segmentation de sphéroïdes',
    confirmPassword: 'Confirmer le mot de passe',
    passwordsMatch: 'Les mots de passe correspondent',
    passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
    agreeToTermsCheckbox: "J'accepte les",
    mustAgreeToTerms: 'Vous devez accepter les conditions générales',
    creatingAccount: 'Création du compte...',
    alreadyLoggedIn: 'Vous êtes déjà connecté',
    alreadySignedUp: 'Vous êtes déjà inscrit et connecté.',
    goToDashboard: 'Aller au tableau de bord',
    signUpFailed: "Échec de l'inscription",
    // Forgot Password specific
    enterEmailForReset: 'Entrez votre email pour réinitialiser le mot de passe',
    sending: 'Envoi...',
    sendNewPassword: 'Envoyer nouveau mot de passe',
    emailSent: 'Email envoyé',
    checkEmailForNewPassword:
      'Vérifiez votre email pour des instructions de sécurité',
    resetPasswordEmailSent:
      'Email de réinitialisation envoyé si le compte existe',
    resetPasswordError: 'Erreur lors de la réinitialisation du mot de passe',
    backToSignIn: 'Retour à la connexion',
    didntReceiveEmail: "Vous n'avez pas reçu l'email ?",
    rememberPassword: 'Vous vous souvenez de votre mot de passe ?',
  },
  profile: {
    title: 'Profil',
    about: 'À propos',
    activity: 'Activité',
    projects: 'Projets',
    papers: 'Articles',
    analyses: 'Analyses',
    recentProjects: 'Projets récents',
    recentAnalyses: 'Analyses récentes',
    accountDetails: 'Détails du compte',
    accountType: 'Type de compte',
    joinDate: "Date d'inscription",
    lastActive: 'Dernière activité',
    projectsCreated: 'Projets créés',
    imagesUploaded: 'Images téléchargées',
    segmentationsCompleted: 'Segmentations terminées',
    editProfile: 'Modifier le profil',
    joined: 'Rejoint',
    copyApiKey: 'Copier la clé API',
    collaborators: 'Collaborateurs',
    noCollaborators: 'Aucun collaborateur',
    connectedAccounts: 'Comptes connectés',
    connect: 'Connecter',
    recentActivity: 'Activité récente',
    noRecentActivity: 'Aucune activité récente',
    statistics: 'Statistiques',
    totalImagesProcessed: "Total d'images traitées",
    averageProcessingTime: 'Temps de traitement moyen',
    fromLastMonth: 'du mois dernier',
    storageUsed: 'Stockage utilisé',
    of: 'de',
    apiRequests: 'Requêtes API',
    thisMonth: 'ce mois',
    recentPublications: 'Publications récentes',
    viewAll: 'Voir tout',
    noPublications: 'Aucune publication pour le moment',
    today: "aujourd'hui",
    yesterday: 'hier',
    daysAgo: 'jours passés',
    completionRate: 'taux de completion',
    createdProject: 'A créé le projet',
    completedSegmentation: 'A terminé la segmentation pour',
    uploadedImage: "A téléchargé l'image",
    avatar: {
      uploadButton: 'Télécharger Avatar',
      selectFile: "Sélectionner l'image d'avatar",
      cropTitle: 'Recadrer votre Avatar',
      cropDescription: 'Recadrez votre avatar pour un ajustement parfait',
      zoomLevel: 'Niveau de Zoom',
      cropInstructions:
        'Glissez pour repositionner, utilisez le curseur pour zoomer',
      applyChanges: 'Appliquer les Modifications',
      processing: 'Traitement en cours...',
      invalidFileType:
        "Type de fichier invalide. Veuillez sélectionner un fichier d'image.",
      fileTooLarge: 'Fichier trop volumineux. La taille maximale est de 5MB.',
      cropError: "Erreur lors du traitement de l'image. Veuillez réessayer.",
      uploadSuccess: 'Avatar téléchargé avec succès',
      uploadError: "Échec du téléchargement de l'avatar. Veuillez réessayer.",
    },
  },
  segmentation: {
    mode: {
      view: 'Voir et naviguer',
      edit: 'Modifier',
      editVertices: 'Modifier les sommets',
      addPoints: 'Ajouter des points',
      create: 'Créer',
      createPolygon: 'Créer un polygone',
      slice: 'Découper',
      delete: 'Supprimer',
      deletePolygon: 'Supprimer le polygone',
      unknown: 'Inconnu',
    },
    modeDescription: {
      view: 'Naviguer et sélectionner les polygones',
      edit: 'Déplacer et modifier les sommets',
      addPoints: 'Ajouter des points entre les sommets',
      create: 'Créer de nouveaux polygones',
      slice: 'Diviser les polygones avec une ligne',
      delete: 'Supprimer les polygones',
    },
    toolbar: {
      mode: 'Mode',
      keyboard: 'Touche: {{key}}',
      requiresSelection: "Nécessite la sélection d'un polygone",
      requiresPolygonSelection: "Nécessite la sélection d'un polygone",
      select: 'Sélectionner',
      undoTooltip: 'Annuler (Ctrl+Z)',
      undo: 'Annuler',
      redoTooltip: 'Refaire (Ctrl+Y)',
      redo: 'Refaire',
      zoomInTooltip: 'Zoomer (+)',
      zoomIn: 'Zoomer',
      zoomOutTooltip: 'Dézoomer (-)',
      zoomOut: 'Dézoomer',
      resetViewTooltip: 'Réinitialiser la vue (R)',
      resetView: 'Réinitialiser',
      unsavedChanges: 'Modifications non sauvegardées',
      saving: 'Sauvegarde...',
      save: 'Sauvegarder',
      keyboardShortcuts:
        'V: Voir • E: Modifier • A: Ajouter • N: Nouveau • S: Découper • D: Supprimer',
      nothingToSave: 'Toutes les modifications sauvegardées',
    },
    status: {
      polygons: 'polygones',
      vertices: 'sommets',
      visible: 'visibles',
      hidden: 'cachés',
      selected: 'sélectionné',
      saved: 'Sauvegardé',
      unsaved: 'Non sauvegardé',
      noPolygons: 'Aucun polygone',
      startCreating: 'Commencez par créer un polygone',
      polygonList: 'Liste des Polygones',
    },
    shortcuts: {
      buttonText: 'Raccourcis',
      dialogTitle: 'Raccourcis clavier',
      footerNote:
        "Ces raccourcis fonctionnent dans l'éditeur de segmentation pour un travail plus rapide et pratique.",
      v: 'Mode visualisation',
      e: 'Mode édition des sommets',
      a: 'Mode ajout de points',
      n: 'Créer un nouveau polygone',
      s: 'Mode découpe',
      d: 'Mode suppression',
      shift: 'Maintenir pour ajout automatique de points',
      ctrlZ: 'Annuler',
      ctrlY: 'Rétablir',
      delete: 'Supprimer le polygone sélectionné',
      esc: "Annuler l'opération en cours",
      plus: 'Zoomer',
      minus: 'Dézoomer',
      r: 'Réinitialiser la vue',
    },
    tips: {
      header: 'Conseils :',
      edit: {
        createPoint: 'Cliquez pour créer un nouveau point',
        holdShift:
          'Maintenez Shift pour créer automatiquement une séquence de points',
        closePolygon: 'Fermez le polygone en cliquant sur le premier point',
      },
      slice: {
        startSlice: 'Cliquez pour commencer la découpe',
        endSlice: 'Cliquez à nouveau pour terminer la découpe',
        cancelSlice: 'Esc annule la découpe',
      },
      addPoints: {
        hoverLine: 'Placez le curseur sur la ligne du polygone',
        clickAdd: 'Cliquez pour ajouter un point au polygone sélectionné',
        escCancel: 'Esc termine le mode ajout',
      },
    },
    helpTips: {
      editMode: [
        'Cliquez pour créer un nouveau point',
        'Maintenez Shift pour créer automatiquement une séquence de points',
        'Fermez le polygone en cliquant sur le premier point',
      ],
      slicingMode: [
        'Cliquez pour commencer la découpe',
        'Cliquez à nouveau pour terminer la découpe',
        'Esc annule la découpe',
      ],
      pointAddingMode: [
        'Placez le curseur sur la ligne du polygone',
        'Cliquez pour ajouter un point au polygone sélectionné',
        'Esc quitte le mode ajout',
      ],
    },
    loading: 'Chargement de la segmentation...',
    noPolygons: 'Aucun polygone trouvé',
    polygonNotFound: 'Polygone introuvable',
    invalidSlice: 'Opération de découpe invalide',
    sliceSuccess: 'Polygone découpé avec succès',
    sliceFailed: 'Échec de la découpe du polygone',
    instructions: {
      slice: {
        selectPolygon:
          '1. Cliquez sur un polygone pour le sélectionner pour la découpe',
        placeFirstPoint: '2. Cliquez pour placer le premier point de découpe',
        placeSecondPoint:
          '3. Cliquez pour placer le deuxième point de découpe et effectuer la découpe',
        cancel: 'Appuyez sur ESC pour annuler',
      },
      create: {
        startPolygon: '1. Cliquez pour commencer à créer un polygone',
        continuePoints:
          '2. Continuez à cliquer pour ajouter plus de points (au moins 3 nécessaires)',
        finishPolygon:
          '3. Continuez à ajouter des points ou cliquez près du premier point pour fermer le polygone',
        holdShift: 'Maintenez SHIFT pour ajouter automatiquement des points',
        cancel: 'Appuyez sur ESC pour annuler',
      },
      addPoints: {
        clickVertex:
          "Cliquez sur n'importe quel sommet pour commencer à ajouter des points",
        addPoints:
          'Cliquez pour ajouter des points, puis cliquez sur un autre sommet pour terminer. Cliquez directement sur un autre sommet sans ajouter de points pour supprimer tous les points entre eux.',
        holdShift: 'Maintenez SHIFT pour ajouter automatiquement des points',
        cancel: 'Appuyez sur ESC pour annuler',
      },
      editVertices: {
        selectPolygon:
          "Cliquez sur un polygone pour le sélectionner pour l'édition",
        dragVertices: 'Cliquez et faites glisser les sommets pour les déplacer',
        addPoints:
          'Maintenez SHIFT et cliquez sur un sommet pour ajouter des points',
        deleteVertex: 'Double-cliquez sur un sommet pour le supprimer',
      },
      deletePolygon: {
        clickToDelete: 'Cliquez sur un polygone pour le supprimer',
      },
      view: {
        selectPolygon: 'Cliquez sur un polygone pour le sélectionner',
        navigation: 'Faites glisser pour déplacer • Défilez pour zoomer',
      },
      modes: {
        slice: 'Mode découpe',
        create: 'Mode création de polygone',
        addPoints: 'Mode ajout de points',
        editVertices: 'Mode édition des sommets',
        deletePolygon: 'Mode suppression de polygone',
        view: 'Mode visualisation',
      },
      shiftIndicator: '⚡ SHIFT : Ajout automatique de points',
    },
  },
  status: {
    segmented: 'Segmenté',
    processing: 'Traitement en cours',
    queued: 'En file',
    failed: 'Échoué',
    no_segmentation: 'Pas de segmentation',
    disconnected: 'Déconnecté du serveur',
    error: 'Erreur du service ML',
    ready: 'Prêt pour la segmentation',
    online: 'En ligne',
    offline: 'Hors ligne',
    segmenting: "Segmentation de l'image...",
    waitingInQueue: 'En attente dans la file',
    reloadingSegmentation: 'Actualisation des données de segmentation...',
  },
  queue: {
    title: 'File de Segmentation',
    connected: 'Connecté',
    disconnected: 'Déconnecté',
    waiting: 'en attente',
    processing: 'traitement en cours',
    segmentAll: 'Segmenter Tout',
    segmentAllWithCount: 'Segmenter Tout ({{count}})',
    totalProgress: 'Progression Totale',
    images: 'images',
    loadingStats: 'Chargement des statistiques...',
    connectingMessage:
      'Connexion au serveur... Les mises à jour en temps réel seront bientôt disponibles.',
    emptyMessage:
      'Aucune image dans la file. Téléchargez des images et ajoutez-les à la file pour la segmentation.',
    addingToQueue: 'Ajout à la file...',
    resegmentSelected: 'Re-segmenter Sélectionnées ({{count}})',
    segmentMixed:
      'Segmenter {{new}} + Re-segmenter {{resegment}} ({{total}} total)',
    segmentTooltip:
      '{{new}} nouvelles images seront segmentées, {{resegment}} images sélectionnées seront re-segmentées',
  },
  toast: {
    // Generic messages
    error: "Une erreur s'est produite",
    success: 'Opération réussie',
    info: 'Information',
    warning: 'Avertissement',
    loading: 'Chargement...',
    // Common errors
    failedToUpdate: 'Échec de la mise à jour des données. Veuillez réessayer.',
    fillAllFields: 'Veuillez remplir tous les champs',
    operationFailed: "L'opération a échoué. Veuillez réessayer.",
    // Error boundary
    unexpectedError: 'Erreur Inattendue',
    somethingWentWrong:
      "Quelque chose s'est mal passé. Veuillez réessayer plus tard.",
    somethingWentWrongPage:
      "Quelque chose s'est mal passé lors du chargement de cette page.",
    returnToHome: "Retour à l'Accueil",
    // Success messages
    operationCompleted: 'Opération terminée avec succès',
    dataSaved: 'Données sauvegardées avec succès',
    dataUpdated: 'Données mises à jour avec succès',
    // Connection messages
    reconnecting: 'Reconnexion au serveur...',
    reconnected: 'Connexion au serveur rétablie',
    connectionFailed: 'Échec du rétablissement de la connexion au serveur',
    // Segmentation messages
    segmentationRequested: 'Demande de segmentation soumise',
    segmentationCompleted: "Segmentation d'image terminée",
    segmentationFailed: 'La segmentation a échoué',
    segmentationResultFailed:
      "Échec de l'obtention du résultat de segmentation",
    segmentationStatusFailed:
      'Échec de la vérification du statut de segmentation',
    // Export messages
    exportCompleted: 'Exportation terminée avec succès !',
    exportFailed: "L'exportation a échoué. Veuillez réessayer.",
    // Project actions
    project: {
      created: 'Projet créé avec succès',
      createFailed: 'Échec de la création du projet',
      deleted: 'Projet supprimé avec succès',
      deleteFailed: 'Échec de la suppression du projet',
      urlCopied: 'URL du projet copiée dans le presse-papiers',
      notFound: 'Projet introuvable',
      invalidResponse: 'La réponse du serveur était invalide',
      readyForImages: 'est prêt pour les images',
    },
    // Profile actions
    profile: {
      consentUpdated: 'Préférences de consentement mises à jour avec succès',
      loadFailed: 'Échec du chargement des données de profil',
    },
    // Upload actions
    upload: {
      failed: "Échec de l'actualisation des images après téléchargement",
    },
    // Segmentation actions
    segmentation: {
      saved: 'Segmentation sauvegardée avec succès',
      failed: 'Échec de la sauvegarde de la segmentation',
      deleted: 'Polygone supprimé',
      cannotDeleteVertex:
        'Impossible de supprimer le sommet - le polygone a besoin d\u2019au moins 3 points',
      vertexDeleted: 'Sommet supprimé avec succès',
    },
    autosaveFailed:
      'Échec de la sauvegarde automatique - les modifications peuvent être perdues',
  },
  export: {
    advancedExport: 'Export Avancé',
    // Dialog headers
    advancedOptions: "Options d'Exportation Avancées",
    configureSettings:
      "Configurez vos paramètres d'exportation pour créer un package de données complet",
    // Tabs
    general: 'Général',
    visualization: 'Visualisation',
    formats: 'Formats',
    // Content selection
    exportContents: "Contenu d'Exportation",
    selectContent:
      'Sélectionnez les types de contenu à inclure dans votre exportation',
    includeOriginal: 'Inclure les images originales',
    includeVisualizations:
      'Inclure les visualisations avec polygones numérotés',
    includeDocumentation: 'Inclure la documentation et les métadonnées',
    // Image selection
    selectedImages: 'Images Sélectionnées',
    imagesSelected: '{{count}} sur {{total}} images sélectionnées',
    selectAll: 'Tout Sélectionner',
    selectNone: 'Ne Rien Sélectionner',
    imageSelection: "Sélection d'Images",
    chooseImages: "Choisissez quelles images inclure dans l'exportation",
    searchImages: 'Rechercher des images...',
    sortBy: 'Trier par',
    sortOptions: {
      date: 'Date',
      name: 'Nom',
      status: 'Statut',
    },
    showingImages: 'Affichage {{start}}-{{end}} sur {{total}}',
    noImagesFound: 'Aucune image trouvée',
    // Quality settings
    qualitySettings: 'Paramètres de Qualité',
    imageQuality: "Qualité d'Image",
    compressionLevel: 'Niveau de Compression',
    outputResolution: 'Résolution de Sortie',
    // Visualization settings
    colorSettings: 'Paramètres de Couleur',
    backgroundColor: "Couleur d'Arrière-plan",
    strokeColor: 'Couleur de Trait',
    strokeWidth: 'Épaisseur de Trait',
    fontSize: 'Taille de Police',
    showNumbers: 'Afficher les numéros de polygones',
    showLabels: 'Afficher les étiquettes',
    // Scale conversion
    scaleConversion: "Conversion d'Échelle",
    pixelToMicrometerScale: 'Échelle Pixel vers Micromètre',
    scaleDescription:
      'Spécifiez combien de micromètres équivalent à un pixel pour convertir les mesures',
    scalePlaceholder: 'ex. 0,5 (1 pixel = 0,5 µm)',
    scaleUnit: 'µm/pixel',
    // Format options
    outputSettings: 'Paramètres de Sortie',
    exportFormats: "Formats d'Exportation",
    exportToZip: 'Exporter vers archive ZIP',
    generateExcel: 'Générer les métriques Excel',
    includeCocoFormat: 'Inclure les annotations au format COCO',
    includeJsonMetadata: 'Inclure les métadonnées JSON',
    // Progress and status
    preparing: "Préparation de l'exportation...",
    processing: 'Traitement {{current}} sur {{total}}',
    packaging: 'Création du package...',
    completed: 'Exportation terminée',
    downloading: 'Téléchargement...',
    cancelled: 'Exportation annulée',
    // Connection status
    connected: 'Connecté',
    disconnected: 'Déconnecté',
    reconnecting: 'Reconnexion...',
    // Buttons
    startExport: "Démarrer l'Exportation",
    cancel: 'Annuler',
    download: 'Télécharger',
    retry: 'Réessayer',
    close: 'Fermer',
    // Error messages
    exportError: "L'exportation a échoué",
    exportFailed: 'Exportation échouée',
    exportComplete: 'Exportation terminée',
    metricsExportComplete: 'Exportation des métriques terminée',
    connectionError: "Connexion perdue pendant l'exportation",
    serverError: 'Erreur serveur survenue',
    invalidSelection: 'Veuillez sélectionner au moins une image',
    noData: "Aucune donnée disponible pour l'exportation",
  },
  // Standalone image action messages (used without prefix)
  imageDeleted: 'Image supprimée avec succès',
  deleteImageFailed: "Échec de la suppression de l'image",
  deleteImageError: "Erreur lors de la suppression de l'image",
  imageAlreadyProcessing: "L'image est déjà en cours de traitement",
  processImageFailed: "Échec du traitement de l'image",

  exportDialog: {
    title: "Options d'Exportation",
    includeMetadata: 'Inclure les métadonnées',
    includeSegmentation: 'Inclure la segmentation',
    includeObjectMetrics: "Inclure les métriques d'objets",
    exportMetricsOnly: 'Exporter uniquement les métriques (XLSX)',
    selectImages: 'Sélectionner les images à exporter',
    selectAll: 'Sélectionner Tout',
    selectNone: 'Désélectionner Tout',
    noImagesAvailable: 'Aucune image disponible',
  },
  docs: {
    badge: 'Documentation',
    title: 'Documentation SpheroSeg',
    subtitle:
      "Guide complet d'utilisation de notre plateforme de segmentation de sphéroïdes",
    backTo: 'Retour à {{page}}',
    navigation: 'Navigation',
    nav: {
      introduction: 'Introduction',
      gettingStarted: 'Commencer',
      uploadingImages: 'Télécharger Images',
      modelSelection: 'Sélection Modèle',
      segmentationProcess: 'Processus Segmentation',
      segmentationEditor: 'Éditeur Segmentation',
      exportFeatures: 'Fonctions Export',
    },
    introduction: {
      title: 'Introduction',
      whatIs: "Qu'est-ce que SpheroSeg ?",
      description:
        "SpheroSeg est une plateforme avancée conçue spécifiquement pour la segmentation et l'analyse de sphéroïdes cellulaires dans les images microscopiques.",
      developedBy:
        "Cette plateforme a été développée par Bc. Michal Průšek, étudiant à la Faculté des Sciences Nucléaires et d'Ingénierie Physique de l'Université Technique Tchèque de Prague.",
      addresses:
        "SpheroSeg aborde la tâche difficile d'identifier et de segmenter avec précision les limites des sphéroïdes dans les images microscopiques.",
    },
    gettingStarted: {
      title: 'Commencer',
      accountCreation: 'Création de Compte',
      accountDescription:
        'Pour utiliser SpheroSeg, vous devez créer un compte.',
      accountSteps: {
        step1: "Accédez à la page d'inscription",
        step2: 'Entrez votre adresse e-mail institutionnelle',
        step3: 'Complétez votre profil',
        step4: 'Vérifiez votre adresse e-mail',
      },
      firstProject: 'Créer Votre Premier Projet',
      projectDescription: 'Les projets vous aident à organiser votre travail.',
      projectSteps: {
        step1: 'Cliquez sur "Nouveau Projet"',
        step2: 'Entrez un nom et une description',
        step3: 'Sélectionnez le type de projet',
        step4: 'Cliquez sur "Créer Projet"',
      },
    },
    uploadImages: {
      title: 'Télécharger Images',
      description: "SpheroSeg prend en charge divers formats d'image.",
      methods: 'Méthodes de Téléchargement',
      methodsDescription: 'Plusieurs façons de télécharger vos images :',
      methodsList: {
        dragDrop: 'Glisser-déposer les fichiers',
        browse: 'Cliquer pour parcourir',
        batch: 'Téléchargement par lots',
      },
      note: 'Note :',
      noteText: 'Assurez-vous que vos images ont un bon contraste.',
    },
    modelSelection: {
      title: 'Sélection de Modèle',
      description: 'SpheroSeg offre trois modèles IA différents.',
      models: {
        hrnet: {
          name: 'HRNet (Petit)',
          inferenceTime: "Temps d'inférence : ~3,1 secondes",
          bestFor: 'Optimal pour : Traitement en temps réel',
          description: 'Modèle rapide et efficace.',
        },
        cbam: {
          name: 'CBAM-ResUNet (Moyen)',
          inferenceTime: "Temps d'inférence : ~6,9 secondes",
          bestFor: 'Optimal pour : Équilibre vitesse/précision',
          description: 'Équilibre optimal entre vitesse et qualité.',
        },
        ma: {
          name: 'MA-ResUNet (Grand)',
          inferenceTime: "Temps d'inférence : ~18,1 secondes",
          bestFor: 'Optimal pour : Précision maximale',
          description: "Modèle le plus précis avec mécanismes d'attention.",
        },
      },
      howToSelect: 'Comment Sélectionner un Modèle',
      selectionSteps: {
        step1: 'Ouvrez votre projet',
        step2: 'Trouvez le menu de sélection de modèle',
        step3: 'Choisissez votre modèle',
        step4: 'Ajustez le seuil de confiance',
        step5: 'Votre sélection est sauvegardée',
      },
      tip: 'Conseil :',
      tipText: 'Commencez avec CBAM-ResUNet pour la plupart des cas.',
    },
    segmentationProcess: {
      title: 'Processus de Segmentation',
      description: 'Le processus utilise des modèles IA avancés.',
      queueBased: 'Traitement par File',
      queueDescription: 'SpheroSeg utilise un système de file de traitement.',
      queueFeatures: {
        realTime: 'État en temps réel avec WebSocket',
        batch: 'Traitement par lots',
        priority: 'Gestion des priorités',
        recovery: "Récupération d'erreurs automatique",
      },
      workflow: 'Flux de Travail Automatique',
      workflowSteps: {
        step1: 'Téléchargez vos images',
        step2: 'Sélectionnez votre modèle IA',
        step3: 'Ajustez le seuil de confiance',
        step4: 'Cliquez sur "Auto-Segmenter"',
        step5: 'Surveillez le progrès en temps réel',
        step6: 'Examinez les résultats',
      },
      polygonTypes: 'Types de Polygones',
      polygonDescription: 'Le système détecte deux types :',
      polygonTypesList: {
        external: 'Polygones externes (vert)',
        internal: 'Polygones internes (rouge)',
      },
      processingNote: 'Les temps varient selon le modèle :',
      processingTimes: 'HRNet (~3s), CBAM-ResUNet (~7s), MA-ResUNet (~18s).',
    },
    segmentationEditor: {
      title: 'Éditeur de Segmentation',
      description: 'Outil puissant pour affiner les segmentations.',
      editingModes: "Modes d'Édition",
      modes: {
        view: {
          title: 'Mode Visualisation',
          description: 'Naviguer et inspecter sans modifications.',
        },
        editVertices: {
          title: 'Éditer Sommets',
          description: 'Faire glisser les sommets individuels.',
        },
        addPoints: {
          title: 'Ajouter Points',
          description: 'Insérer de nouveaux sommets.',
        },
        createPolygon: {
          title: 'Créer Polygone',
          description: 'Dessiner de nouveaux polygones.',
        },
        sliceMode: {
          title: 'Mode Découpe',
          description: 'Couper les polygones en parties.',
        },
        deletePolygon: {
          title: 'Supprimer Polygone',
          description: 'Retirer les polygones non désirés.',
        },
      },
      keyFeatures: 'Fonctionnalités Clés',
      features: {
        undoRedo: 'Système Annuler/Rétablir',
        autoSave: 'Sauvegarde automatique',
        zoomPan: 'Zoom et panoramique',
        polygonManagement: 'Gestion des polygones',
        keyboardShortcuts: 'Raccourcis clavier',
        realTimeFeedback: 'Retour en temps réel',
      },
      shortcuts: 'Raccourcis Clavier Essentiels',
      shortcutCategories: {
        navigation: 'Navigation :',
        actions: 'Actions :',
      },
      shortcutsList: {
        v: 'Mode visualisation',
        e: 'Éditer sommets',
        a: 'Ajouter points',
        n: 'Créer polygone',
        ctrlZ: 'Annuler',
        ctrlY: 'Rétablir',
        ctrlS: 'Sauvegarder',
        delete: 'Supprimer sélectionné',
      },
      workingWithPolygons: 'Travailler avec les Polygones',
      polygonSteps: {
        step1: 'Sélectionnez un polygone',
        step2: 'Passez au mode approprié',
        step3: 'Effectuez vos modifications',
        step4: 'Utilisez le panneau de droite',
        step5: 'Sauvegardez périodiquement',
      },
    },
    exportFeatures: {
      title: "Fonctions d'Export",
      description: "Capacités d'export complètes.",
      packageContents: 'Contenu du Package',
      contents: {
        originalImages: {
          title: 'Images Originales',
          description: 'Images microscopiques haute qualité.',
        },
        visualizations: {
          title: 'Visualisations',
          description: 'Images annotées avec polygones numérotés.',
        },
      },
      annotationFormats: "Formats d'Annotation",
      formats: {
        coco: 'Format COCO : Standard pour PyTorch et TensorFlow',
        yolo: 'Format YOLO : Optimisé pour modèles YOLO',
        json: 'JSON Personnalisé : Format structuré détaillé',
      },
      calculatedMetrics: 'Métriques Calculées',
      metricsDescription: 'SpheroSeg calcule automatiquement des métriques.',
      metricsCategories: {
        basic: {
          title: 'Mesures de Base :',
          items: {
            area: 'Surface',
            perimeter: 'Périmètre',
            diameter: 'Diamètre équivalent',
            circularity: 'Circularité',
          },
        },
        advanced: {
          title: 'Métriques Avancées :',
          items: {
            feret: 'Diamètres de Feret',
            majorMinor: 'Diamètre majeur/mineur',
            compactness: 'Compacité, convexité',
            sphericity: 'Index de sphéricité',
          },
        },
      },
      exportFormats: "Formats d'Export des Métriques",
      exportFormatsList: {
        excel: 'Excel (.xlsx) : Feuille de calcul formatée',
        csv: 'CSV : Valeurs séparées par virgules',
        jsonExport: 'JSON : Format structuré',
      },
      visualizationCustomization: 'Personnalisation Visualisation',
      customizationOptions: {
        colors: 'Couleurs des polygones personnalisables',
        numbering: 'Numérotation affichable/masquable',
        strokeWidth: 'Épaisseur de trait ajustable',
        fontSize: 'Taille de police contrôlable',
        transparency: 'Transparence réglable',
      },
      howToExport: 'Comment Exporter',
      exportSteps: {
        step1: 'Accédez au tableau de bord',
        step2: 'Sélectionnez les images',
        step3: 'Cliquez sur "Export Avancé"',
        step4: 'Configurez les paramètres',
        step5: 'Examinez le résumé',
        step6: 'Cliquez sur "Démarrer Export"',
      },
      exportNote: 'Les packages sont complets :',
      exportNoteText: 'Chaque export inclut documentation et métadonnées.',
    },
    footer: {
      backToHome: 'Retour Accueil',
      backToTop: 'Retour Haut',
    },
  },
  legal: {
    terms: {
      title: "Conditions d'Utilisation",
      lastUpdated: 'Dernière mise à jour : janvier 2025',
      disclaimer:
        'En utilisant SpheroSeg, vous acceptez ces conditions. Veuillez les lire attentivement.',
      sections: {
        acceptance: {
          title: '1. Acceptation des Conditions',
          content:
            'En accédant ou en utilisant SpheroSeg ("le Service"), vous acceptez d\'être lié par ces Conditions d\'Utilisation ("Conditions") et toutes les lois et règlements applicables. Si vous n\'acceptez pas ces conditions, il vous est interdit d\'utiliser ce service. Ces Conditions constituent un accord juridiquement contraignant entre vous et SpheroSeg.',
        },
        useLicense: {
          title: "2. Licence d'Utilisation et Usage Autorisé",
          content: "L'autorisation d'utiliser SpheroSeg est accordée pour :",
          permittedUses: [
            'Fins de recherche personnelle et non commerciale',
            'Recherche académique et éducative',
            'Publications et études scientifiques',
            'Recherche et analyse biomédicale',
          ],
          licenseNote:
            "Il s'agit de l'octroi d'une licence, non d'un transfert de propriété. Vous ne pouvez pas utiliser le service à des fins commerciales sans consentement écrit explicite.",
        },
        dataUsage: {
          title: '3. Utilisation des Données et Apprentissage Automatique',
          importantTitle: 'Important : Utilisation de Vos Données',
          importantContent:
            "En téléchargeant des images et des données vers SpheroSeg, vous consentez à ce que nous utilisions ces données pour améliorer et entraîner nos modèles d'apprentissage automatique pour une meilleure précision de segmentation.",
          ownershipTitle: 'Propriété des données :',
          ownershipContent:
            "Vous conservez la propriété de toutes les données que vous téléchargez vers SpheroSeg. Cependant, en utilisant notre service, vous nous accordez l'autorisation de :",
          permissions: [
            "Traiter vos images pour l'analyse de segmentation",
            'Utiliser les données téléchargées (sous forme anonymisée) pour améliorer nos algorithmes ML',
            "Améliorer la précision du modèle grâce à l'apprentissage continu",
            'Développer de nouvelles fonctionnalités et capacités de segmentation',
          ],
          protectionNote:
            "Toutes les données utilisées pour l'entraînement ML sont anonymisées et dépouillées d'informations d'identification. Nous ne partageons pas vos données brutes avec des tiers sans consentement explicite.",
        },
        userResponsibilities: {
          title: "4. Responsabilités de l'Utilisateur",
          content: 'Vous acceptez de :',
          responsibilities: [
            'Utiliser le service uniquement à des fins légales',
            'Respecter les droits de propriété intellectuelle',
            "Ne pas tenter de faire de l'ingénierie inverse ou de compromettre le service",
            "Fournir des informations exactes lors de la création d'un compte",
            'Maintenir la sécurité de vos identifiants de compte',
          ],
        },
        serviceAvailability: {
          title: '5. Disponibilité du Service et Limitations',
          content:
            "Bien que nous nous efforcions de maintenir la disponibilité continue du service, SpheroSeg est fourni \"tel quel\" sans garanties d'aucune sorte. Nous ne garantissons pas un accès ininterrompu, et le service peut faire l'objet de maintenance, de mises à jour ou d'indisponibilité temporaire.",
        },
        limitationLiability: {
          title: '6. Limitation de Responsabilité',
          content:
            "En aucun cas SpheroSeg, ses développeurs ou affiliés ne seront responsables de dommages indirects, accessoires, spéciaux, consécutifs ou punitifs, y compris mais sans s'y limiter à la perte de données, de profits ou d'opportunités commerciales, découlant de votre utilisation du service.",
        },
        privacy: {
          title: '7. Confidentialité et Protection des Données',
          content:
            'Votre vie privée est importante pour nous. Veuillez consulter notre Politique de Confidentialité, qui régit la façon dont nous collectons, utilisons et protégeons vos informations personnelles et données de recherche.',
        },
        changes: {
          title: '8. Modifications des Conditions',
          content:
            "Nous nous réservons le droit de modifier ces Conditions à tout moment. Les modifications prendront effet immédiatement après publication. Votre utilisation continue du service constitue l'acceptation des Conditions modifiées.",
        },
        termination: {
          title: '9. Résiliation',
          content:
            "Chaque partie peut résilier cet accord à tout moment. Après résiliation, votre droit d'accéder au service cessera immédiatement, bien que ces Conditions restent en vigueur concernant l'utilisation antérieure.",
        },
        governingLaw: {
          title: '10. Loi Applicable',
          content:
            'Ces Conditions sont régies et interprétées conformément aux lois applicables. Tout litige sera résolu par arbitrage contraignant ou devant les tribunaux de juridiction compétente.',
        },
      },
      contact: {
        title: 'Informations de Contact :',
        content:
          'Si vous avez des questions concernant ces Conditions, veuillez nous contacter à spheroseg@utia.cas.cz',
      },
      navigation: {
        backToHome: "Retour à l'Accueil",
        privacyPolicy: 'Politique de Confidentialité',
      },
    },
    privacy: {
      title: 'Politique de Confidentialité',
      lastUpdated: 'Dernière mise à jour : janvier 2025',
      disclaimer:
        'Votre vie privée est importante pour nous. Cette politique explique comment nous collectons, utilisons et protégeons vos données.',
      sections: {
        introduction: {
          title: '1. Introduction',
          content:
            'Cette Politique de Confidentialité explique comment SpheroSeg ("nous", "notre") collecte, utilise, protège et partage vos informations lorsque vous utilisez notre plateforme pour la segmentation et l\'analyse de sphéroïdes. En utilisant notre service, vous consentez aux pratiques de données décrites dans cette politique.',
        },
        informationCollected: {
          title: '2. Informations que Nous Collectons',
          content:
            'Nous collectons les informations que vous nous fournissez directement lorsque vous créez un compte, téléchargez des images, créez des projets et interagissez avec nos services.',
          personalInfo: {
            title: '2.1 Informations Personnelles',
            items: [
              'Nom et adresse e-mail',
              'Affiliation institutionnelle ou organisationnelle',
              'Identifiants de compte et préférences',
              'Informations de contact pour les demandes de support',
            ],
          },
          researchData: {
            title: '2.2 Données de Recherche et Images',
            ownershipTitle: 'Vos Données de Recherche',
            ownershipContent:
              'Vous conservez la propriété complète de toutes les images et données de recherche que vous téléchargez vers SpheroSeg. Nous ne revendiquons jamais la propriété de votre contenu.',
            items: [
              'Images que vous téléchargez pour analyse',
              'Métadonnées de projets et paramètres',
              'Résultats de segmentation et annotations',
              "Paramètres d'analyse et configurations personnalisées",
            ],
          },
          usageInfo: {
            title: "2.3 Informations d'Utilisation",
            items: [
              "Données de journal et horodatages d'accès",
              "Informations sur l'appareil et type de navigateur",
              "Modèles d'utilisation et interactions avec les fonctionnalités",
              "Métriques de performance et rapports d'erreur",
            ],
          },
        },
        mlTraining: {
          title: '3. Apprentissage Automatique et Amélioration des Données',
          importantTitle:
            "Important : Utilisation de Vos Données pour l'Entraînement IA",
          importantIntro:
            "Pour améliorer continuellement nos algorithmes de segmentation, nous pouvons utiliser les images téléchargées et les données pour entraîner et améliorer nos modèles d'apprentissage automatique.",
          controlTitle: 'Vous avez un contrôle total sur vos données :',
          controlContent:
            "Lors de la création de compte, vous pouvez choisir d'autoriser l'utilisation de vos données pour l'entraînement ML. Vous pouvez modifier ces préférences à tout moment.",
          manageTitle: 'Pour gérer votre consentement :',
          manageContent:
            "Allez dans Paramètres → onglet Confidentialité dans votre tableau de bord. Là, vous pouvez activer ou désactiver le consentement d'entraînement ML et choisir des objectifs spécifiques (amélioration d'algorithme, développement de fonctionnalités) pour lesquels vos données peuvent être utilisées.",
          howWeUse: {
            title: 'Comment Nous Utilisons Vos Données pour ML :',
            items: [
              'Entraînement de Modèle : Les images sont utilisées pour entraîner les algorithmes de segmentation pour une meilleure précision',
              "Amélioration d'Algorithmes : Vos corrections de segmentation aident à améliorer la détection automatique",
              "Développement de Fonctionnalités : Les modèles d'utilisation guident le développement de nouveaux outils d'analyse",
              'Assurance Qualité : Les données aident à valider et tester de nouvelles versions de modèles',
            ],
          },
          protection: {
            title: "Protection des Données dans l'Entraînement ML :",
            items: [
              "Anonymisation : Toutes les données sont anonymisées avant utilisation dans l'entraînement ML",
              "Suppression de Métadonnées : Les informations d'identification personnelles et institutionnelles sont supprimées",
              "Traitement Sécurisé : L'entraînement se déroule dans des environnements sécurisés et isolés",
              'Aucune Distribution de Données Brutes : Vos images originales ne sont jamais partagées avec des tiers',
            ],
          },
        },
        howWeUse: {
          title: '4. Comment Nous Utilisons Vos Informations',
          content: 'Nous utilisons les informations collectées pour :',
          purposes: [
            'Fournir et maintenir les services de segmentation',
            "Traiter vos images et générer des résultats d'analyse",
            'Améliorer nos algorithmes et développer de nouvelles fonctionnalités',
            'Communiquer avec vous concernant votre compte et les mises à jour',
            'Fournir un support technique et un dépannage',
            'Se conformer aux obligations légales et protéger nos droits',
          ],
        },
        dataSecurity: {
          title: '5. Sécurité et Protection des Données',
          content:
            'Nous mettons en œuvre des mesures de sécurité robustes incluant :',
          measures: [
            'Chiffrement des données en transit et au repos',
            'Audits de sécurité réguliers et évaluations de vulnérabilité',
            "Contrôles d'accès et systèmes d'authentification",
            'Procédures de sauvegarde sécurisée et de récupération après sinistre',
            "Formation à la sécurité des employés et limitations d'accès",
          ],
        },
        dataSharing: {
          title: '6. Partage de Données et Tiers',
          noSaleStatement:
            'Nous ne vendons pas vos informations personnelles ou données de recherche.',
          sharingContent:
            'Nous ne pouvons partager des informations que dans ces circonstances limitées :',
          circumstances: [
            'Avec votre consentement explicite',
            'Pour se conformer aux obligations légales ou ordonnances judiciaires',
            'Avec des fournisseurs de services de confiance qui aident à faire fonctionner notre plateforme (sous des accords de confidentialité stricts)',
            'Pour protéger nos droits, sécurité ou propriété',
            'Sous forme anonymisée et agrégée pour les publications de recherche (avec votre consentement)',
          ],
        },
        privacyRights: {
          title: '7. Vos Droits de Confidentialité et Choix',
          content: 'Vous avez le droit de :',
          rights: [
            'Accès : Demander des copies de vos données personnelles et contenu de recherche',
            'Rectification : Mettre à jour ou corriger des informations inexactes',
            'Suppression : Demander la suppression de votre compte et données associées',
            'Portabilité : Exporter vos données dans un format lisible par machine',
            "Exclusion : Demander l'exclusion de l'entraînement ML. Note : Cela peut limiter les fonctionnalités suivantes : précision de segmentation automatique, recommandations de modèle personnalisées, suggestions de seuil adaptatif, optimisations de traitement par lots et futures améliorations alimentées par IA. Contactez le support pour les impacts spécifiques sur votre compte.",
            'Restriction : Limiter comment nous traitons vos informations',
          ],
          contactNote:
            'Pour exercer ces droits, contactez-nous à spheroseg@utia.cas.cz. Nous répondrons dans les 30 jours.',
        },
        dataRetention: {
          title: '8. Conservation des Données',
          content:
            "Nous distinguons entre les données personnelles et les données d'entraînement ML :",
          categories: [
            'Données Personnelles/de Compte : Tous les identifiants personnels, informations de profil, paramètres de compte et historique de transaction seront définitivement supprimés dans les 90 jours de la fermeture du compte.',
            'Données de Recherche : Les images originales et données de projet liées à votre compte seront supprimées dans les 90 jours de la fermeture du compte.',
            "Données d'Entraînement ML : Les données utilisées pour l'entraînement ML sont d'abord anonymisées/pseudonymisées pour supprimer tous les identifiants personnels. Ces données anonymisées peuvent être conservées indéfiniment pour préserver les améliorations du modèle, sauf si vous vous excluez spécifiquement de l'entraînement ML ou demandez une suppression complète.",
            "Options d'Exclusion : Vous pouvez demander la suppression complète de toutes les données, y compris les données anonymisées d'entraînement ML, en contactant spheroseg@utia.cas.cz. Le temps de traitement est typiquement de 30 jours.",
          ],
        },
        internationalTransfers: {
          title: '9. Transferts Internationaux de Données',
          content:
            "Vos données peuvent être traitées dans des pays autres que le vôtre. Nous assurons des protections et garanties appropriées pour les transferts internationaux, y compris des clauses contractuelles standard et des décisions d'adéquation.",
        },
        childrensPrivacy: {
          title: '10. Confidentialité des Enfants',
          content:
            "Notre service est destiné aux chercheurs et ne s'adresse pas aux enfants de moins de 16 ans. Nous ne collectons pas sciemment d'informations personnelles auprès d'enfants de moins de 16 ans. Si nous découvrons une telle collecte, nous supprimerons promptement les informations.",
        },
        policyChanges: {
          title: '11. Modifications de Cette Politique',
          content:
            "Nous pouvons mettre à jour cette Politique de Confidentialité pour refléter les changements dans nos pratiques ou exigences légales. Nous vous informerons des changements importants par e-mail ou avis proéminent sur notre site web. L'utilisation continue constitue l'acceptation des conditions mises à jour.",
        },
        contact: {
          title: '12. Informations de Contact',
          dpo: 'Délégué à la Protection des Données : spheroseg@utia.cas.cz',
          general: 'Demandes Générales : spheroseg@utia.cas.cz',
          postal: 'Adresse Postale :',
          address: {
            line1: 'ÚTIA AV ČR',
            line2: 'Pod Vodárenskou věží 4',
            line3: '182 08 Prague 8',
            line4: 'République Tchèque',
          },
        },
      },
      navigation: {
        backToHome: "Retour à l'Accueil",
        termsOfService: "Conditions d'Utilisation",
      },
    },
  },

  // Menu contextuel
  contextMenu: {
    editPolygon: 'Modifier le polygone',
    splitPolygon: 'Diviser le polygone',
    deletePolygon: 'Supprimer le polygone',
    confirmDeletePolygon: 'Êtes-vous sûr de vouloir supprimer ce polygone ?',
    deletePolygonDescription:
      'Cette action est irréversible. Le polygone sera définitivement supprimé de la segmentation.',
    duplicateVertex: 'Dupliquer le sommet',
    deleteVertex: 'Supprimer le sommet',
  },

  // WebSocket messages
  websocket: {
    reconnecting: 'Reconnexion au serveur...',
    reconnected: 'Connexion au serveur rétablie',
    reconnectFailed: 'Échec du rétablissement de la connexion au serveur',
    connectionLost: 'Connexion au serveur perdue',
    connected: 'Connecté aux mises à jour en temps réel',
    disconnected: 'Déconnecté des mises à jour en temps réel',
  },

  // Affichage des métriques
  metrics: {
    info: 'Les métriques sont évaluées uniquement pour les polygones externes. Les surfaces des polygones internes (trous) sont automatiquement soustraites des polygones externes correspondants.',
    spheroid: 'Sphéroïde',
    area: 'Surface',
    perimeter: 'Périmètre',
    equivalentDiameter: 'Diamètre Équivalent',
    circularity: 'Circularité',
    feretMax: 'Feret Maximum',
    feretMin: 'Feret Minimum',
    compactness: 'Compacité',
    convexity: 'Convexité',
    solidity: 'Solidité',
    sphericity: 'Sphéricité',
    feretAspectRatio: "Rapport d'Aspect de Feret",
    noPolygonsFound: "Aucun polygone trouvé pour l'analyse",
  },

  // Raccourcis clavier
  keyboardShortcuts: {
    title: 'Raccourcis Clavier',
    buttonLabel: 'Raccourcis',
    viewMode: 'Mode visualisation',
    editVertices: 'Mode édition des sommets',
    addPoints: 'Mode ajout de points',
    createPolygon: 'Créer un nouveau polygone',
    sliceMode: 'Mode découpage',
    deleteMode: 'Mode suppression',
    holdToAutoAdd: 'Maintenir pour ajout automatique de points',
    undo: 'Annuler',
    redo: 'Rétablir',
    deleteSelected: 'Supprimer le polygone sélectionné',
    cancelOperation: "Annuler l'opération actuelle",
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    resetView: 'Réinitialiser la vue',
    helperText:
      "Ces raccourcis fonctionnent dans l'éditeur de segmentation pour un travail plus rapide et plus pratique.",
  },

  // Accessibilité et étiquettes pour lecteurs d'écran
  accessibility: {
    // Navigation
    toggleSidebar: 'Basculer la barre latérale',
    toggleMenu: 'Basculer le menu',
    selectLanguage: 'Sélectionner la langue',
    selectTheme: 'Sélectionner le thème',
    breadcrumb: "fil d'Ariane",
    pagination: 'pagination',

    // Actions
    close: 'Fermer',
    more: 'Plus',

    // Pagination
    goToPreviousPage: 'Aller à la page précédente',
    goToNextPage: 'Aller à la page suivante',
    previousPage: 'Précédent',
    nextPage: 'Suivant',
    morePages: 'Plus de pages',

    // Carrousel
    previousSlide: 'Diapositive précédente',
    nextSlide: 'Diapositive suivante',

    // Options de vue
    gridView: 'Vue en grille',
    listView: 'Vue en liste',
  },
};
