export default {
  common: {
    appName: 'SpheroSeg',
    loading: 'Laden...',
    save: 'Speichern',
    cancel: 'Abbrechen',
    apply: 'Anwenden',
    dismiss: 'Schließen',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    actions: 'Aktionen',
    show: 'Anzeigen',
    hide: 'Ausblenden',
    create: 'Erstellen',
    search: 'Suchen',
    error: 'Fehler',
    success: 'Erfolg',
    back: 'Zurück',
    signIn: 'Anmelden',
    signUp: 'Registrieren',
    signOut: 'Abmelden',
    settings: 'Einstellungen',
    profile: 'Profil',
    dashboard: 'Dashboard',
    project: 'Projekt',
    projects: 'Projekte',
    polygon: 'Polygon',
    newProject: 'Neues Projekt',
    upload: 'Hochladen',
    uploadImages: 'Bilder hochladen',
    recentAnalyses: 'Aktuelle Analysen',
    noProjects: 'Keine Projekte gefunden',
    noImages: 'Keine Bilder gefunden',
    createYourFirst: 'Erstellen Sie Ihr erstes Projekt, um zu beginnen',
    tryAgain: 'Erneut versuchen',
    cancelling: 'Wird abgebrochen...',
    deleting: 'Wird gelöscht...',
    retry: 'Erneut versuchen',
    retrying: 'Neuer Versuch...',
    retryAttempt: 'Versuch {{attempt}} von {{max}}',
    retryingIn: 'Neuer Versuch in {{seconds}} Sekunden...',
    nextRetryIn: 'Nächster Versuch in {{seconds}}s',
    operationFailed: 'Vorgang fehlgeschlagen',
    unexpectedError: 'Ein unerwarteter Fehler ist aufgetreten',
    failedToLoad: 'Laden fehlgeschlagen',
    loadingFailed: 'Laden fehlgeschlagen. Bitte versuchen Sie es erneut.',
    networkError: 'Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.',
    refreshPage: 'Seite aktualisieren',
    tryAgainLater: 'Bitte versuchen Sie es später erneut',
    email: 'E-Mail',
    password: 'Passwort',
    name: 'Name',
    description: 'Beschreibung',
    date: 'Datum',
    status: 'Status',
    images: 'Bilder',
    image: 'Bild',
    projectName: 'Projektname',
    projectDescription: 'Projektbeschreibung',
    theme: 'Design',
    language: 'Sprache',
    light: 'Hell',
    dark: 'Dunkel',
    system: 'System',
    welcome: 'Willkommen bei der Mikroskopie-Segmentierungsplattform',
    account: 'Konto',
    notifications: 'Benachrichtigungen',
    passwordConfirm: 'Passwort bestätigen',
    manageAccount: 'Konto verwalten',
    documentation: 'Dokumentation',
    changePassword: 'Passwort ändern',
    deleteAccount: 'Konto löschen',
    termsOfService: 'Nutzungsbedingungen',
    privacyPolicy: 'Datenschutzerklärung',
    createAccount: 'Konto erstellen',
    signInToAccount: 'Bei Ihrem Konto anmelden',
    sort: 'Sortieren',
    no_preview: 'Keine Vorschau',
    openMenu: 'Menü öffnen',
    logOut: 'Abmelden',
    pageNotFound: 'Ups! Seite nicht gefunden',
    returnToHome: 'Zurück zur Startseite',
    next: 'Weiter',
    copy: 'Kopieren',
    noImage: 'Kein Bild',
    untitledImage: 'Unbenanntes Bild',
    rename: 'Umbenennen',
    getStarted: 'Erste Schritte',
    learnMore: 'Mehr erfahren',
    close: 'Schließen',
    redirectingToDashboard: 'Weiterleitung zum Dashboard...',
  },
  landing: {
    hero: {
      eyebrow:
        'Segmentierung biomedizinischer Bilder · ÚTIA, Tschechische Akademie der Wissenschaften',
      title: 'Segmentierung für jede Probe, die Sie aufnehmen.',
      subtitle:
        'Sphäroide und ihr Zerfall, Wunden aus dem Scratch-Assay, Spermienmorphologie, Mikrotubuli-Filamente, Mikrokapseln — für jeden Typ ein trainiertes Modell, für alle ein Editor und ein Export, den ImageJ, COCO und YOLO bereits verstehen.',
      getStarted: 'Loslegen',
      learnMore: 'Was die Plattform kann',
    },
    specimens: {
      trayLabel: 'Probe wählen',
      spheroid: {
        label: 'Sphäroid',
        detail:
          'Hellfeld, 2048 × 2048. Ein Tumorsphäroid, von HRNet rot umrissen — genau die Kontur, die Ihnen der Editor zur Korrektur übergibt.',
        alt: 'Hellfeldaufnahme eines einzelnen Tumorsphäroids, dessen Segmentierungskontur rot eingezeichnet ist.',
      },
      disintegration: {
        label: 'Zerfallendes Sphäroid',
        detail:
          'Hellfeld, 2048 × 2048, 48 Stunden nach Beginn eines Zerfallsassays. Der dichte Kern ist grün, jede abgelöste Zelle rot. Genau aus dieser Trennung wird der Zerfallsindex berechnet.',
        alt: 'Hellfeldaufnahme eines zerfallenden Sphäroids: der dichte Kern grün umrissen, jede abgelöste Zelle rot.',
      },
      wound: {
        label: 'Wunde aus dem Scratch-Assay',
        detail:
          'Scratch-Assay, 2048 × 2048. Die offene Wunde ist die rote Grenze; die Zellinseln darin sind blau und werden von der Wundfläche abgezogen.',
        alt: 'Scratch-Assay-Aufnahme mit rot umrissener offener Wunde und vier blau umrissenen Zellinseln darin.',
      },
      sperm: {
        label: 'Spermienmorphologie',
        detail:
          'Hellfeld, 1360 × 1024. Jede Zelle wird als drei Polylinien statt als eine Fläche geführt — Kopf grün, Mittelstück bernsteinfarben, Schwanz cyan — damit sich jeder Abschnitt einzeln vermessen lässt.',
        alt: 'Hellfeldaufnahme zweier Spermien, jedes nachgezeichnet von drei farbigen Polylinien: grüner Kopf, bernsteinfarbenes Mittelstück, cyanfarbener Schwanz.',
      },
      microtubule: {
        label: 'Mikrotubuli-Filamente',
        detail:
          'IRM-Zeitraffer, Bild 30. Jedes Filament bekommt seine eigene Mittellinie, und seine Farbe stammt aus der Track-ID — die es über die gesamte Aufnahme behält, sodass ein Kymograph einem bestimmten Filament folgt und nicht dem gerade nächstgelegenen.',
        alt: 'Aufnahme von Mikrotubuli im Interferenz-Reflexions-Kontrast, jedes Filament durch eine Mittellinie in eigener Farbe nachgezeichnet.',
      },
      microcapsule: {
        label: 'Mikrokapseln',
        detail:
          'Hellfeld, 1280 × 1024. Zwei vollständige Kapseln sind rot umrissen — für genau diese gibt es Fläche, Umfang und Kompaktheit. Die vom Bildrand angeschnittenen Kapseln tragen keinen roten Umriss: das Modell markiert sie, und die Statistik lässt sie weg.',
        alt: 'Hellfeldaufnahme von Mikrokapseln, die zwei vollständigen rot umrissen, die vom Bildrand angeschnittenen ohne Umriss.',
      },
    },
    about: {
      badge: 'Wer dahintersteht',
      title: 'Woher die Plattform kommt',
      description1:
        'Unsere Plattform wurde von Bc. Michal Průšek, Student an der Fakultät für Kernwissenschaften und Physikalisches Ingenieurwesen (FJFI) an der Tschechischen Technischen Universität Prag, unter der Leitung von Ing. Adam Novozámský, Ph.D. entwickelt.',
      description2:
        'Dieses Projekt ist eine Zusammenarbeit mit der Gruppe von Ing. Silvie Rimpelová, Ph.D. vom Institut für Biochemie und Mikrobiologie der UCT Prag (VŠCHT Praha).',
      description3:
        'Es begann bei Tumorsphäroiden und wuchs mit den Experimenten, die unsere Kooperationspartner mitbrachten: Zerfallsassays, Wunden aus dem Scratch-Assay, Spermienmorphologie, Mikrotubuli-Zeitraffer und Mikrokapseln. Jeder Probentyp hat sein eigenes trainiertes Modell, seine eigenen Metriken und seinen eigenen Export — dahinter steht ein Editor.',
      contactText: 'Für Anfragen kontaktieren Sie uns bitte unter',
    },
    acknowledgments: {
      badge: 'Danksagungen',
      title: 'Besonderer Dank',
      lukasIntro: 'Wir danken',
      lukasName: 'Lukáš Veškrna',
      lukasContribution:
        'für den Beitrag des kompletten Wundheilungs-Segmentierungsmoduls zu dieser Plattform.',
      visitPage: 'Seite besuchen',
    },
    cta: {
      title: 'Bringen Sie Ihre eigenen Bilder mit.',
      subtitle:
        'Legen Sie ein Projekt an, wählen Sie den Probentyp und laden Sie eine Bildserie hoch. Das Modell läuft auf der GPU, und das Ergebnis öffnet sich direkt im Editor, bereit zur Korrektur.',
      cardDescription: 'Die Registrierung ist offen — keine Einladung nötig',
      createAccount: 'Konto erstellen',
    },
    features: {
      badge: 'Was sie leistet',
      title: 'Ein Editor, egal was auf dem Objektträger liegt',
      subtitle:
        'Jeder Probentyp bekommt sein eigenes Modell und seine eigenen Metriken. Alles danach — Bearbeiten, Verfolgen, Exportieren — ist derselbe Arbeitsablauf.',
      cards: {
        models: {
          title: 'Ein Modell je Probentyp',
          description:
            'Sie wählen den Probentyp beim Anlegen des Projekts, und es werden nur die passenden Modelle angeboten. Allein Sphäroide haben fünf, vom 200-ms-U-Net bis zum Mamba-Bottleneck für Bilder aus einem unbekannten Mikroskop.',
        },
        stacks: {
          title: 'Zeitraffer und Stapel, nicht nur Einzelbilder',
          description:
            'MP4, AVI, MOV, MKV und WebM, mehrseitige TIFFs und Nikon ND2 werden als ein Element hochgeladen und in Einzelbilder aufgefaltet. Mehrkanalige Aufnahmen behalten ihre Kanäle, und Sie bestimmen, aus welchem das Modell liest.',
        },
        tracking: {
          title: 'Identität, die den Bildregler übersteht',
          description:
            'Mikrotubuli werden von Bild zu Bild über die Kurvengeometrie zugeordnet, sodass ein Filament ID und Farbe über die gesamte Aufnahme behält — und ein Kymograph genau dieses Filament vermisst, nicht das gerade nächstgelegene.',
        },
        corrections: {
          title: 'Alles von Hand korrigierbar',
          description:
            'Stützpunkte ziehen, ein verschmolzenes Objekt teilen, Punkte auf einer Kontur ergänzen, zwei Polylinien verbinden, eine Klasse umbenennen. Änderungen werden beim Bild gespeichert, nicht nur im Browser gehalten.',
        },
        measurements: {
          title: 'Zahlen, in Dateien, die andere Werkzeuge öffnen',
          description:
            'Fläche, Umfang, Feret-Durchmesser, Polylinienlänge und Intensität pro Kanal — exportiert als XLSX sowie als COCO, YOLO, ImageJ-ROI-Sets und CVAT-Annotationen.',
        },
        batch: {
          title: 'Auf ein ganzes Experiment ausgelegt',
          description:
            'Stapel von bis zu 10 000 Bildern laufen auf der GPU, und die Warteschlange stellt zurück, wen sie gerade bedient hat — so blockiert ein 600-Bilder-Zeitraffer nicht alle anderen.',
        },
      },
    },
  },
  dashboard: {
    manageProjects: 'Verwalten Sie Ihre Forschungsprojekte und Analysen',
    projectGallery: 'Projektgalerie',
    projectGalleryDescription:
      'Durchsuchen und verwalten Sie alle Ihre Segmentierungsprojekte',
    statsOverview: 'Statistik-Übersicht',
    totalProjects: 'Projekte gesamt',
    activeProjects: 'Aktive Projekte',
    totalImages: 'Bilder gesamt',
    totalAnalyses: 'Analysen gesamt',
    lastUpdated: 'Zuletzt aktualisiert',
    noProjectsDescription:
      'Sie haben noch keine Projekte erstellt. Erstellen Sie Ihr erstes Projekt, um zu beginnen.',
    noImagesDescription: 'Laden Sie einige Bilder hoch, um zu beginnen',
    searchProjectsPlaceholder: 'Projekte suchen...',
    searchImagesPlaceholder: 'Bilder nach Namen suchen...',
    sortBy: 'Sortieren nach',
    name: 'Name',
    lastChange: 'Letzte Änderung',
    status: 'Status',
    stats: {
      totalProjects: 'Projekte gesamt',
      totalProjectsDesc: 'Aktive Studien',
      processedImages: 'Verarbeitete Bilder',
      processedImagesDesc: 'Erfolgreich segmentiert',
      uploadedToday: 'Heute hochgeladen',
      uploadedTodayDesc: 'Mikroskopiebilder',
      storageUsed: 'Genutzter Speicher',
      totalSpaceUsed: 'Gesamt genutzter Speicher',
      incompleteWarning:
        'Statistiken möglicherweise unvollständig — {{count}} Projekt(e) konnten nicht geladen werden',
    },
    completed: 'Abgeschlossen',
    processing: 'Verarbeitung',
    pending: 'Ausstehend',
    failed: 'Fehlgeschlagen',
    storageUsed: 'Genutzter Speicher',
  },
  projects: {
    createProject: 'Neues Projekt erstellen',
    createProjectDesc:
      'Fügen Sie ein neues Projekt hinzu, um Ihre Mikroskopiebilder und Analysen zu organisieren.',
    projectType: 'Projekttyp',
    projectTypeUpdated: 'Projekttyp aktualisiert',
    failedToUpdateProject: 'Projekt konnte nicht aktualisiert werden',
    changeProjectType: 'Projekttyp ändern',
    typeChangeSegmentationsWarning:
      '{{count}} bestehende Segmentierungen entsprechen möglicherweise nicht mehr dem Exportformat "{{type}}". Erneut segmentieren, um Metriken zu aktualisieren.',
    verified: 'Verifiziert',
    toggleVerified: 'Verifizierung umschalten',
    projectVerified: 'Projekt als verifiziert markiert',
    projectUnverified: 'Verifizierung des Projekts wurde entfernt',
    failedToUpdateVerified:
      'Verifizierungsstatus konnte nicht aktualisiert werden',
    types: {
      spheroid: 'Sphäroide (Standard)',
      spheroid_invasive: 'Zerfallene Sphäroide',
      wound: 'Wundheilung',
      sperm: 'Spermien',
      microtubules: 'Mikrotubuli',
      microcapsule: 'Mikrokapseln',
      neurite: 'Neuriten und Somata',
    },
    projectNamePlaceholder: 'z.B. HeLa-Zellen, Platte 3',
    projectDescPlaceholder:
      'z.B. Analyse wirkstoffbehandelter Kulturen für Resistenzstudien',
    creatingProject: 'Erstelle...',
    duplicateProject: 'Duplizieren',
    shareProject: 'Teilen',
    deleteProject: 'Löschen',
    openProject: 'Projekt öffnen',
    confirmDelete: 'Sind Sie sicher, dass Sie dieses Projekt löschen möchten?',
    projectCreated: 'Projekt erfolgreich erstellt',
    projectDeleted: 'Projekt erfolgreich gelöscht',
    viewProject: 'Projekt anzeigen',
    projectImages: 'Projektbilder',
    projectSelection: 'Projektauswahl',
    selectProject: 'Projekt auswählen',
    imageDeleted: 'Bild erfolgreich gelöscht',
    deleteImageError: 'Löschen des Bildes fehlgeschlagen',
    deleteImageFailed: 'Bildlöschung fehlgeschlagen',
    imagesQueuedForSegmentation:
      '{{count}} Bilder zur Segmentierungswarteschlange hinzugefügt',
    imageQueuedForResegmentation:
      'Bild zur Re-Segmentierung in die Warteschlange eingereiht',
    errorAddingToQueue: 'Fehler beim Hinzufügen zur Warteschlange',
    imageAlreadyProcessing: 'Bild wird bereits verarbeitet',
    processImageFailed: 'Bildverarbeitung fehlgeschlagen',
    selected: '{{count}} ausgewählt',
    deleteSelected: 'Ausgewählte löschen',
    segmentationCompleted: 'Segmentierung für Bild abgeschlossen',
    segmentationFailed: 'Segmentierung fehlgeschlagen',
    segmentationStarted: 'Segmentierung hat begonnen',
    segmentationCompleteWithCount:
      'Segmentierung abgeschlossen! {{count}} Objekte gefunden',
    failedToLoadProjects: 'Laden der Projekte fehlgeschlagen',
    projectNameRequired: 'Bitte geben Sie einen Projektnamen ein',
    mustBeLoggedIn: 'Sie müssen angemeldet sein, um ein Projekt zu erstellen',
    failedToCreateProject: 'Projekterstellung fehlgeschlagen',
    serverResponseInvalid: 'Serverantwort war ungültig',
    projectCreatedDesc: '"{{name}}" ist bereit für Bilder',
    descriptionOptional: 'Beschreibung (Optional)',
    noDescriptionProvided: 'Keine Beschreibung angegeben',
    deleteDialog: {
      title: 'Löschen bestätigen',
      description:
        'Sind Sie sicher, dass Sie {{count}} ausgewählte Bilder löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.',
    },
    selectProjectHeader: 'Projekt Auswählen',
    noProjects: 'Keine Projekte gefunden',
  },
  errors: {
    noProjectOrUser: 'Fehler: Kein Projekt oder Benutzer ausgewählt',
    unknown: 'Unbekannter Fehler',
    network:
      'Netzwerkverbindungsfehler. Bitte überprüfen Sie Ihre Internetverbindung.',
    unauthorized: 'Zugriff verweigert. Bitte melden Sie sich erneut an.',
    forbidden: 'Sie haben keine Berechtigung für diese Aktion.',
    notFound: 'Die angeforderte Ressource wurde nicht gefunden.',
    conflict:
      'Diese E-Mail ist bereits registriert. Versuchen Sie sich anzumelden oder verwenden Sie eine andere E-Mail.',
    invalidCredentials:
      'Ungültige E-Mail oder Passwort. Bitte überprüfen Sie Ihre Anmeldedaten.',
    validation: 'Validierungsfehler. Bitte überprüfen Sie Ihre Eingabe.',
    general:
      'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
    server: 'Serverfehler. Bitte versuchen Sie es später erneut.',
    timeout: 'Anfrage-Timeout. Bitte versuchen Sie es erneut.',
    sessionExpired:
      'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an, um fortzufahren.',
    tooManyRequests:
      'Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.',
    serverUnavailable:
      'Dienst vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.',
    clientError:
      'Anfragefehler. Bitte überprüfen Sie Ihre Eingabe und versuchen Sie es erneut.',
    emailAlreadyExists:
      'Diese E-Mail ist bereits registriert. Versuchen Sie sich anzumelden oder verwenden Sie eine andere E-Mail.',
    validationErrors: {
      projectNameRequired: 'Bitte geben Sie einen Projektnamen ein',
      loginRequired: 'Sie müssen angemeldet sein, um ein Projekt zu erstellen',
      emailRequired: 'E-Mail ist erforderlich',
      passwordRequired: 'Passwort ist erforderlich',
      invalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein',
      passwordTooShort: 'Das Passwort muss mindestens 6 Zeichen lang sein',
      passwordsDoNotMatch: 'Die Passwörter stimmen nicht überein',
      confirmationRequired: 'Bitte bestätigen Sie Ihre Aktion',
      fieldRequired: 'Dieses Feld ist erforderlich',
    },
    operations: {
      loadProject:
        'Das Projekt konnte nicht geladen werden. Überprüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      saveProject:
        'Projektänderungen konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.',
      uploadImage:
        'Das Bild konnte nicht hochgeladen werden. Überprüfen Sie das Dateiformat und die Größe.',
      deleteImage:
        'Das Bild kann nicht gelöscht werden. Versuchen Sie die Seite zu aktualisieren und die Aktion zu wiederholen.',
      processImage:
        'Bildverarbeitung fehlgeschlagen. Versuchen Sie ein anderes Bild oder kontaktieren Sie den Support.',
      segmentation:
        'Segmentierung fehlgeschlagen. Versuchen Sie ein anderes Modell oder passen Sie die Einstellungen an.',
      export:
        'Datenexport fehlgeschlagen. Überprüfen Sie, ob Daten verfügbar sind.',
      login:
        'Anmeldung fehlgeschlagen. Überprüfen Sie Ihre E-Mail und Ihr Passwort.',
      logout:
        'Abmeldung fehlgeschlagen. Versuchen Sie, Ihren Browser zu schließen.',
      register:
        'Registrierung fehlgeschlagen. Diese E-Mail wird möglicherweise bereits verwendet.',
      updateProfile:
        'Das Profil konnte nicht aktualisiert werden. Überprüfen Sie die angegebenen Informationen.',
      changePassword:
        'Das Passwort konnte nicht geändert werden. Überprüfen Sie Ihr aktuelles Passwort.',
      deleteAccount:
        'Das Konto konnte nicht gelöscht werden. Kontaktieren Sie den Support für Hilfe.',
      resetPassword:
        'Passwort-Reset fehlgeschlagen. Überprüfen Sie die angegebene E-Mail-Adresse.',
      updateConsent:
        'Einwilligungseinstellungen konnten nicht aktualisiert werden. Bitte versuchen Sie es erneut.',
      unshareProject:
        'Projekt konnte nicht aus geteilten Projekten entfernt werden',
      deleteProject:
        'Das Projekt kann nicht gelöscht werden. Stellen Sie sicher, dass Sie die erforderlichen Berechtigungen haben.',
    },
    deleteAnnotations: 'Anmerkungen konnten nicht gelöscht werden',
    deleteImages: 'Fehler beim Löschen der ausgewählten Bilder',
    contexts: {
      dashboard: 'Dashboard-Fehler',
      project: 'Projekt-Fehler',
      image: 'Bild-Fehler',
      segmentation: 'Segmentierung-Fehler',
      export: 'Export-Fehler',
      auth: 'Authentifizierung-Fehler',
      profile: 'Profil-Fehler',
      settings: 'Einstellungen-Fehler',
    },
  },
  images: {
    uploadImages: 'Bilder oder Videos hochladen',
    dragDrop: 'Bilder oder Videos hier hineinziehen',
    clickToSelect: 'oder klicken Sie, um Dateien auszuwählen',
    acceptedFormats:
      'Bilder: JPEG, PNG, TIFF, BMP (max. 20 MB) — Videos: MP4, AVI, MOV, MKV, WebM, ND2, mehrseitige TIFFs (max. 100 GB)',
    uploadProgress: 'Upload-Fortschritt',
    readyToUpload: 'Bereit zum Hochladen',
    uploadingTo: 'Wählen Sie zuerst ein Projekt aus',
    currentProject: 'Aktuelles Projekt',
    autoSegment: 'Bilder nach Upload automatisch segmentieren',
    uploadCompleted: 'Upload abgeschlossen',
    uploadFailed: 'Upload fehlgeschlagen',
    imagesUploaded: 'Bilder erfolgreich hochgeladen',
    imagesFailed: 'Hochladen der Bilder fehlgeschlagen',
    viewAnalyses: 'Analysen anzeigen',
    noAnalysesYet: 'Noch keine Analysen',
    runAnalysis: 'Analyse ausführen',
    viewResults: 'Ergebnisse anzeigen',
    dropImagesHere: 'Dateien hier ablegen...',
    selectProjectFirst: 'Bitte wählen Sie zuerst ein Projekt aus',
    registerChannels: {
      promptTitle: 'Kanäle registrieren?',
      help: 'Korrigiert beim Hochladen kleine Verschiebungen zwischen Kanälen, indem jeder am ersten ausgerichtet wird (nur Translation).',
      confirm: 'Registrieren & hochladen',
      decline: 'Ohne Registrierung hochladen',
    },
    projectRequired:
      'Sie müssen ein Projekt auswählen, bevor Sie Bilder hochladen können',
    pending: 'Ausstehend',
    uploading: 'Hochladen',
    processing: 'Verarbeitung',
    complete: 'Abgeschlossen',
    error: 'Fehler',
    imageDeleted: 'Bild erfolgreich gelöscht',
    deleteImageFailed: 'Löschen des Bildes fehlgeschlagen',
    deleteImageError: 'Fehler beim Löschen des Bildes',
    imageAlreadyProcessing: 'Bild wird bereits verarbeitet',
    processImageFailed: 'Bildverarbeitung fehlgeschlagen',
    upload: {
      inProgress:
        'Upload läuft. Sie können weiterarbeiten — den Fortschritt sehen Sie rechts unten.',
      uploading: '{{success}}/{{total}} Dateien werden hochgeladen',
      completed: '{{count}} Dateien erfolgreich hochgeladen',
      completedWithFailures:
        '{{success}} hochgeladen, {{failed}} fehlgeschlagen',
      failed: 'Upload fehlgeschlagen',
      cancelled: 'Upload abgebrochen',
      cancelButton: 'Upload abbrechen',
      preparing: '{{count}} Dateien werden vorbereitet...',
      alreadyInProgress: 'Für dieses Projekt läuft bereits ein Upload',
      remaining: '~{{time}} verbleibend',
      project: 'Projekt:',
      view: 'Anzeigen',
      filesProgress: '{{success}} von {{total}} Dateien ({{percent}} %)',
      chunkProgress: 'Teil {{current}}/{{total}}',
    },
  },
  settings: {
    pageTitle: 'Einstellungen',
    profile: 'Profil',
    account: 'Konto',
    models: 'Modelle',
    manageSettings: 'Ihre Kontoeinstellungen verwalten',
    appearance: 'Erscheinungsbild',
    themeSettings: 'Design-Einstellungen',
    systemDefault: 'Systemstandard',
    languageSettings: 'Spracheinstellungen',
    selectLanguage: 'Sprache auswählen',
    accountSettings: 'Kontoeinstellungen',
    notificationSettings: 'Benachrichtigungseinstellungen',
    emailNotifications: 'E-Mail-Benachrichtigungen',
    pushNotifications: 'Push-Benachrichtigungen',
    profileSettings: 'Profileinstellungen',
    profileUpdated: 'Profil erfolgreich aktualisiert',
    profileUpdateFailed: 'Profilaktualisierung fehlgeschlagen',
    saveChanges: 'Änderungen speichern',
    savingChanges: 'Speichere...',
    notifications: {
      projectUpdates: 'Projekt-Updates',
      analysisCompleted: 'Analyse abgeschlossen',
      newFeatures: 'Neue Funktionen',
      marketingEmails: 'Marketing-E-Mails',
      billing: 'Rechnungsbenachrichtigungen',
    },
    personal: 'Persönliche Informationen',
    fullName: 'Vollständiger Name',
    organization: 'Organisation',
    department: 'Abteilung',
    publicProfile: 'Öffentliches Profil',
    bio: 'Biografie',
    makeProfileVisible: 'Mein Profil für andere Forscher sichtbar machen',
    dangerZone: 'Gefahrenbereich',
    deleteAccountWarning:
      'Sobald Sie Ihr Konto löschen, gibt es kein Zurück. Alle Ihre Daten werden dauerhaft gelöscht.',
    currentPassword: 'Aktuelles Passwort',
    newPassword: 'Neues Passwort',
    confirmNewPassword: 'Neues Passwort bestätigen',
    modelSelection: {
      title: 'Modellauswahl',
      description: 'Wählen Sie das KI-Modell für die Zellsegmentierung',
      sections: {
        spheroid: 'Sphäroid-Modelle',
        spheroid_invasive: 'Modelle für zerfallene Sphäroide',
        sperm: 'Spermien-Modelle',
        wound: 'Wundheilungs-Modelle',
        microtubule: 'Mikrotubuli-Modelle',
        microcapsule: 'Mikrokapsel-Modelle',
        neurite: 'Neuriten-/Soma-Modelle',
      },
      presets: {
        fast: 'Schnell',
        accurate: 'Genau',
        robust: 'Robust',
        showMore: 'Weitere Modelle anzeigen',
        showLess: 'Weitere Modelle ausblenden',
      },
      presetDescriptions: {
        fast: 'Echtzeit-Vorschau, große Stapel, schwache GPU',
        accurate: 'Labore mit HQ-Bildern, wenn Zeit keine Rolle spielt',
        robust:
          'Externe Labore, unbekannte Optik, behandelte Proben, ungewöhnliche Morphologien',
      },
      models: {
        hrnet: {
          name: 'HRNet',
          description:
            'Schnelles und effizientes Modell für Echzeit-Segmentierung',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description:
            'Präzises Segmentierungsmodell mit Aufmerksamkeitsmechanismen',
        },
        unet_spherohq: {
          name: 'UNet (SpheroHQ)',
          description:
            'Beste Leistung auf SpheroHQ-Datensatz - optimiert für Sphäroid-Segmentierung mit ausgewogener Geschwindigkeit und Genauigkeit (~0.25s/Bild, 10 Bilder/s)',
        },
        spheroid_disintegration: {
          name: 'Sphäroid-Zerfall',
          description:
            'UNet++ mit EfficientNet-B5-Encoder — 3-Klassen-Segmentierung (Hintergrund / Korona / dichter Kern) zerfallender Sphäroide; sagt den Kern direkt für einen korrekten Zerfallsindex voraus (~0.7s/Bild)',
        },
        segformer: {
          name: 'SegFormer',
          description:
            'Transformer-basiertes Modell (SegFormer-B0) für Hellfeld-Sphäroide – höchste Genauigkeit (93% IoU) und sehr schnell (~13 ms/Bild)',
        },
        mamba_unet: {
          name: 'Mamba-UNet',
          description:
            'U-Net mit bidirektionalem Mamba (State-Space)-Bottleneck – beste Robustheit bei Out-of-Distribution-Bildern (unbekannte Optik, behandelte Proben, ungewöhnliche Morphologien)',
        },
        sperm: {
          name: 'Spermien-Morphologie',
          description:
            'Spermien-Morphologiemodell mit Skelettextraktion zur Messung von Kopf, Mittelstück und Schwanz',
        },
        wound: {
          name: 'Wundheilung (Scratch-Assay)',
          description:
            'U-Net mit MiT-B5-Encoder (SegFormer) für binäre Wundsegmentierung in Scratch-Assay-Mikroskopie (~32 ms auf A5000, 90 % IoU auf externem Testdatensatz)',
        },
        microtubule: {
          name: 'Mikrotubuli (ResEnc-M + krümmungsbegrenzter Instancer)',
          description:
            'Instanz-Segmentierung für IRM-Mikrotubuli-Zeitrafferaufnahmen. Ein nnU-Net-ResEnc-M-Netz sagt den Filament-Vordergrund vorher, ein krümmungsbegrenzter Instancer trennt ihn in einzelne Centerlines und löst jede Kreuzung unter einer harten Schranke von 0,25 rad/px. Ausschließlich auf synthetischen Bildern trainiert — ohne menschliche Annotation. ~4,5 s/Bild; einziges Modell der Plattform mit nativer Polylinien-Ausgabe.',
        },
        microcapsule: {
          name: 'Microcapsule',
          description:
            'Instanz-Segmentierung für Mikrokapseln (runde Objekte) in der Hellfeld-Mikroskopie. Ein kompaktes U-Net, das aus Meta SAM 3 destilliert wurde, liefert eine saubere Kontur in voller Auflösung pro Kapsel und trennt sich berührende Kapseln mittels Watershed; am Bildrand abgeschnittene Kapseln werden von den Metriken (Fläche, Umfang, Kompaktheit) ausgeschlossen.',
        },
        neurite_soma: {
          name: 'Neurit / Soma (nnU-Net ResEnc-M)',
          description:
            'Semantische Zwei-Klassen-Segmentierung von Neuronen in der Fluoreszenzmikroskopie — Neurit (Fortsätze) und Soma (Zellkörper) — allein aus dem Tubulin-Kanal. nnU-Net v2 ResEnc-M, Ensemble aus 3 Folds mit Spiegel-TTA und clDice-Topologieterm für die Neurit-Klasse. Dice auf Holdout-Daten 0,832 Neurit / 0,915 Soma.',
        },
      },
    },
    detectHoles: 'Löcher Erkennen',
    detectHolesDescription:
      'Erkennung von inneren Strukturen und Löchern in Zellen aktivieren',
    modelSelected: 'Modell erfolgreich ausgewählt',
    modelSettingsSaved: 'Modelleinstellungen erfolgreich gespeichert',
    modelSize: {
      small: 'Klein',
      medium: 'Mittel',
      large: 'Groß',
    },
    modelDescription: {
      hrnet:
        'Ausgewogenes Modell mit guter Geschwindigkeit und Qualität (E2E ~309ms, 4.9 Bilder/s)',
      cbam_resunet:
        'Präziseste Segmentierung mit Aufmerksamkeitsmechanismen (E2E ~482ms, 2.7 Bilder/s)',
      unet_spherohq:
        'Schnellstes Modell nach Optimierungen! Hervorragend für Echtzeitverarbeitung (E2E ~286ms, 5.5 Bilder/s)',
      spheroid_disintegration:
        'UNet++ / EfficientNet-B5-Modell mit 3 Klassen (Hintergrund / Korona / Kern) für zerfallende Sphäroide; sagt den dichten Kern direkt für einen korrekten Zerfallsindex voraus (30,7M Parameter)',
      segformer:
        'Transformer-basiertes SegFormer-B0-Modell, trainiert auf dem SpheroMix-Datensatz. Höchste Sphäroid-Genauigkeit der Plattform (93% IoU) bei gleichzeitig kleinstem und schnellstem Modell (~13 ms/Bild).',
      mamba_unet:
        'U-Net mit bidirektionalem Mamba (State-Space)-Bottleneck (90,75M Parameter). Beste Out-of-Distribution-Generalisierung der Plattform (HTS-Seg IoU 0,587) – für externe Labore, unbekannte Optik, behandelte Proben und ungewöhnliche Sphäroid-Morphologien.',
      sperm:
        'Spermienmorphologie-Modell mit Skelettextraktion zur Messung von Kopf, Mittelstück und Schwanz',
      wound:
        'U-Net + MiT-B5 (SegFormer-Encoder) Modell für die Wundsegmentierung in Scratch-Assay-Mikroskopie. Eine binäre Wundregion pro Bild; ideal für Heilungsverlauf-Timelapses.',
      microtubule:
        'Instanz-Segmentierung für Mikrotubuli in der IRM-Mikroskopie. nnU-Net-ResEnc-M-Netz, krümmungsbegrenzter Instancer, native Polylinien-Ausgabe mit geometrischem frameübergreifendem Tracking.',
      microcapsule:
        'Kompaktes U-Net (destilliert aus Meta SAM 3) zur Instanz-Segmentierung von Mikrokapseln — Fläche, Umfang und Kompaktheit je Kapsel; am Bildrand abgeschnittene Kapseln werden von den Metriken ausgeschlossen.',
      neurite_soma:
        'nnU-Net v2 ResEnc-M (2D, Ensemble aus 3 Folds) zur Segmentierung von Neuriten und Somata in der Fluoreszenzmikroskopie. Liest den Tubulin-Kanal; Dice auf Holdout-Daten 0,832 Neurit / 0,915 Soma. Trainiert auf Leica-Konfokaldaten bei ~0,180 µm/px — Soma-Zahlen bei anderer Pixelgröße prüfen.',
    },
    dataUsageTitle: 'Datennutzung und Datenschutz',
    dataUsageDescription:
      'Kontrollieren Sie, wie Ihre Daten für maschinelles Lernen und Forschung verwendet werden',
    allowMLTraining: {
      label: 'ML-Modell-Training erlauben',
      description:
        'Erlauben Sie die Nutzung Ihrer Daten zum Training und zur Verbesserung unserer Segmentierungsmodelle',
    },
    consent: {
      privacyNotice:
        'Ihr Datenschutz ist uns wichtig. Diese Einstellungen steuern, wie Ihre hochgeladenen Bilder und Segmentierungsdaten zur Verbesserung unserer ML-Modelle verwendet werden können. Sie können diese Präferenzen jederzeit ändern.',
      dataUsageNote:
        'Daten von Benutzern, die sich abgemeldet haben, werden nicht in Trainingspipelines aufgenommen.',
      algorithmImprovement: {
        label: 'Algorithmus-Verbesserung',
        description:
          'Daten zur Verbesserung der Segmentierungsgenauigkeit und -geschwindigkeit verwenden',
      },
      featureDevelopment: {
        label: 'Funktionsentwicklung',
        description:
          'Helfen Sie bei der Entwicklung neuer Funktionen und Fähigkeiten',
      },
      lastUpdated: 'Zuletzt aktualisiert',
      savePreferences: 'Einwilligungspräferenzen speichern',
      savingPreferences: 'Speichere...',
    },
    cancel: 'Abbrechen',
    deleting: 'Lösche...',
    deleteAccount: 'Konto Löschen',
    accountDeleted: 'Konto erfolgreich gelöscht',
    deleteAccountError: 'Fehler beim Löschen des Kontos',
    deleteAccountDialog: {
      title: 'Konto löschen',
      description:
        'Diese Aktion kann nicht rückgängig gemacht werden. Dies wird Ihr Konto dauerhaft löschen und alle Ihre Daten von unseren Servern entfernen.',
      whatWillBeDeleted: 'Was wird gelöscht:',
      deleteItems: {
        account: 'Ihr Benutzerkonto und Profil',
        projects: 'Alle Ihre Projekte und Bilder',
        segmentation: 'Alle Segmentierungsdaten und Ergebnisse',
        settings: 'Kontoeinstellungen und Präferenzen',
      },
      confirmationLabel: 'Bitte tippen Sie {email} zur Bestätigung:',
      confirmationPlaceholder: '{email}',
    },
    fillAllFields: 'Bitte füllen Sie alle erforderlichen Felder aus',
    passwordsDoNotMatch: 'Passwörter stimmen nicht überein',
    passwordTooShort: 'Passwort muss mindestens 6 Zeichen lang sein',
    passwordChanged: 'Passwort erfolgreich geändert',
    passwordsMatch: 'Passwörter stimmen überein',
    changingPassword: 'Passwort wird geändert...',
    changePassword: 'Passwort Ändern',
    languageUpdated: 'Sprache erfolgreich aktualisiert',
    themeUpdated: 'Design erfolgreich aktualisiert',
    appearanceDescription: 'Passen Sie das Erscheinungsbild der Anwendung an',
    language: 'Sprache',
    languageDescription: 'Wählen Sie Ihre bevorzugte Sprache',
    theme: 'Design',
    themeDescription: 'Wählen Sie helles, dunkles oder System-Design',
    light: 'Hell',
    dark: 'Dunkel',
    system: 'System',
  },
  auth: {
    signIn: 'Anmelden',
    signUp: 'Registrieren',
    redirectingToDashboard: 'Weiterleitung zum Dashboard...',
    signOut: 'Abmelden',
    forgotPassword: 'Passwort vergessen?',
    resetPassword: 'Passwort zurücksetzen',
    dontHaveAccount: 'Sie haben kein Konto?',
    alreadyHaveAccount: 'Sie haben bereits ein Konto?',
    signInWith: 'Anmelden mit',
    signUpWith: 'Registrieren mit',
    orContinueWith: 'oder fortfahren mit',
    rememberMe: 'Angemeldet bleiben',
    emailRequired: 'E-Mail ist erforderlich',
    passwordRequired: 'Passwort ist erforderlich',
    invalidEmail: 'Ungültige E-Mail-Adresse',
    passwordTooShort: 'Passwort muss mindestens 6 Zeichen lang sein',
    passwordsDontMatch: 'Passwörter stimmen nicht überein',
    successfulSignIn: 'Erfolgreich angemeldet',
    successfulSignUp: 'Registrierung erfolgreich',
    verifyEmail: 'Bitte überprüfen Sie Ihre E-Mail, um Ihr Konto zu bestätigen',
    successfulSignOut: 'Erfolgreich abgemeldet',
    signOutFailed: 'Abmeldung fehlgeschlagen. Bitte erneut versuchen.',
    checkingAuthentication: 'Authentifizierung prüfen...',
    loadingAccount: 'Ihr Konto wird geladen...',
    processingRequest: 'Ihre Anfrage wird bearbeitet...',
    signInToAccount: 'Bei Ihrem Konto anmelden',
    accessPlatform: 'Zugang zur Mikroskopie-Segmentierungsplattform',
    emailAddress: 'E-Mail-Adresse',
    emailPlaceholder: 'sie@beispiel.com',
    password: 'Passwort',
    passwordPlaceholder: '••••••••',
    signingIn: 'Anmeldung läuft...',
    fillAllFields: 'Bitte füllen Sie alle Felder aus',
    signInSuccess: 'Erfolgreich angemeldet',
    signInFailed: 'Anmeldung fehlgeschlagen',
    registrationSuccess: 'Registrierung erfolgreich',
    registrationFailed: 'Registrierung fehlgeschlagen',
    logoutFailed: 'Abmeldung fehlgeschlagen',
    profileUpdateFailed: 'Profilaktualisierung fehlgeschlagen',
    welcomeMessage: 'Willkommen bei der Mikroskopie-Segmentierungsplattform',
    confirmationRequired:
      'Bestätigungstext ist erforderlich und muss Ihrer E-Mail-Adresse entsprechen',
    agreeToTerms: 'Durch die Anmeldung stimmen Sie unseren',
    termsOfService: 'Nutzungsbedingungen',
    and: 'und',
    privacyPolicy: 'Datenschutzrichtlinie',
    createAccount: 'Erstellen Sie Ihr Konto',
    signUpPlatform:
      'Registrieren Sie sich, um die Mikroskopie-Segmentierungsplattform zu nutzen',
    confirmPassword: 'Passwort bestätigen',
    passwordsMatch: 'Passwörter stimmen überein',
    passwordsDoNotMatch: 'Passwörter stimmen nicht überein',
    agreeToTermsCheckbox: 'Ich stimme den',
    mustAgreeToTerms:
      'Sie müssen den Allgemeinen Geschäftsbedingungen zustimmen',
    creatingAccount: 'Konto wird erstellt...',
    alreadyLoggedIn: 'Sie sind bereits angemeldet',
    alreadySignedUp: 'Sie sind bereits registriert und angemeldet.',
    goToDashboard: 'Zum Dashboard gehen',
    signUpFailed: 'Registrierung fehlgeschlagen',
    enterEmailForReset: 'E-Mail-Adresse für Passwort-Reset eingeben',
    sending: 'Senden...',
    sendNewPassword: 'Neues Passwort senden',
    emailSent: 'E-Mail gesendet',
    checkEmailForNewPassword:
      'Überprüfen Sie Ihre E-Mail für den Passwort-Reset-Link',
    resetPasswordEmailSent: 'Passwort-Reset-E-Mail gesendet',
    resetPasswordError: 'Fehler beim Zurücksetzen des Passworts',
    backToSignIn: 'Zurück zur Anmeldung',
    didntReceiveEmail: 'E-Mail nicht erhalten?',
    rememberPassword: 'Passwort wieder eingefallen?',
    redirectingToSignIn: 'Redirecting to sign-in...',
    tryAgain: 'Erneut versuchen',
    tokenMissing: 'Authentifizierungstoken fehlt',
    tokenExpired: 'Authentifizierungstoken abgelaufen',
    pleaseSignInAgain: 'Bitte melden Sie sich erneut an',
    enterNewPassword: 'Geben Sie Ihr neues Passwort ein',
    newPassword: 'Neues Passwort',
    confirmPasswordPlaceholder: 'Passwort bestätigen',
    passwordRequirements: 'Das Passwort muss mindestens 8 Zeichen lang sein',
    resettingPassword: 'Passwort wird zurückgesetzt...',
    passwordResetSuccess: 'Passwort erfolgreich zurückgesetzt',
    passwordResetSuccessMessage:
      'Ihr Passwort wurde erfolgreich zurückgesetzt. Sie können sich jetzt mit Ihrem neuen Passwort anmelden.',
    invalidResetToken: 'Ungültiger Zurücksetz-Link',
    invalidResetTokenMessage:
      'Dieser Passwort-Zurücksetz-Link ist ungültig oder abgelaufen. Bitte fordern Sie ein neues Zurücksetzen an.',
    requestNewReset: 'Neues Zurücksetzen anfordern',
  },
  profile: {
    title: 'Profil',
    about: 'Über',
    activity: 'Aktivität',
    projects: 'Projekte',
    papers: 'Artikel',
    analyses: 'Analysen',
    recentProjects: 'Aktuelle Projekte',
    recentAnalyses: 'Aktuelle Analysen',
    accountDetails: 'Kontodetails',
    accountType: 'Kontotyp',
    joinDate: 'Beitrittsdatum',
    lastActive: 'Zuletzt aktiv',
    projectsCreated: 'Erstellte Projekte',
    imagesUploaded: 'Hochgeladene Bilder',
    segmentationsCompleted: 'Abgeschlossene Segmentierungen',
    editProfile: 'Profil bearbeiten',
    joined: 'Beigetreten',
    copyApiKey: 'API-Schlüssel kopieren',
    collaborators: 'Mitarbeiter',
    noCollaborators: 'Keine Mitarbeiter',
    connectedAccounts: 'Verbundene Konten',
    connect: 'Verbinden',
    recentActivity: 'Aktuelle Aktivität',
    noRecentActivity: 'Keine aktuelle Aktivität',
    statistics: 'Statistiken',
    totalImagesProcessed: 'Verarbeitete Bilder gesamt',
    averageProcessingTime: 'Durchschnittliche Verarbeitungszeit',
    fromLastMonth: 'vom letzten Monat',
    storageUsed: 'Verwendeter Speicher',
    of: 'von',
    apiRequests: 'API-Anfragen',
    thisMonth: 'diesen Monat',
    recentPublications: 'Aktuelle Veröffentlichungen',
    viewAll: 'Alle anzeigen',
    noPublications: 'Noch keine Veröffentlichungen',
    today: 'heute',
    yesterday: 'gestern',
    daysAgo: 'Tage her',
    completionRate: 'Abschlussrate',
    createdProject: 'Projekt erstellt',
    completedSegmentation: 'Segmentierung abgeschlossen für',
    uploadedImage: 'Bild hochgeladen',
    avatar: {
      uploadButton: 'Avatar hochladen',
      selectFile: 'Avatar-Bild auswählen',
      cropTitle: 'Avatar zuschneiden',
      cropDescription:
        'Schneiden Sie Ihr Avatar-Bild für die perfekte Darstellung zu',
      zoomLevel: 'Zoomstufe',
      cropInstructions:
        'Ziehen zum Verschieben, Schieberegler zum Zoomen verwenden',
      applyChanges: 'Änderungen übernehmen',
      processing: 'Verarbeitung läuft...',
      invalidFileType: 'Ungültiger Dateityp. Bitte wählen Sie eine Bilddatei.',
      fileTooLarge: 'Datei zu groß. Maximale Größe ist 5MB.',
      cropError:
        'Fehler beim Verarbeiten des Bildes. Bitte versuchen Sie es erneut.',
      uploadSuccess: 'Avatar erfolgreich hochgeladen',
      uploadError:
        'Fehler beim Hochladen des Avatars. Bitte versuchen Sie es erneut.',
    },
  },
  segmentation: {
    selection: {
      selectAll: 'Alle auswählen',
      deselectAll: 'Auswahl aufheben',
      selected: '{{count}} ausgewählt',
    },
    trackOps: {
      propagateSelectedSuccess:
        '{{count}} Mikrotubuli in die folgenden Frames übertragen',
      propagateSelectedPartial: '{{done}} von {{total}} Mikrotubuli übertragen',
      propagateSuccess: 'Mikrotubulus in {{count}} folgende Frames übertragen',
      propagateFailed: 'Übertragung des Mikrotubulus fehlgeschlagen',
      deleteTrackSuccess: 'Track aus {{count}} Frames entfernt',
      deleteTrackFailed: 'Löschen des Tracks fehlgeschlagen',
    },
    modelNotCompatible:
      'Modell "{{model}}" ist nicht mit dem Projekttyp "{{type}}" kompatibel. Erlaubt: {{allowed}}.',
    incompatibleModelTitle: 'Mit diesem Modell kann nicht segmentiert werden',
    incompatibleModelDesc:
      'Das ausgewählte Modell "{{model}}" ist nicht mit dem Projekttyp ({{type}}) kompatibel. Erlaubte Modelle: {{allowed}}. Bitte ändern Sie das Modell in den Einstellungen oder den Projekttyp.',
    channelPicker: {
      title: 'Kanal zur Segmentierung auswählen',
      description:
        'Dieses Projekt enthält Videoframes mit mehreren Kanälen. Wählen Sie den zu segmentierenden Kanal.',
      confirm: 'Segmentieren',
    },
    mode: {
      view: 'Anzeigen und navigieren',
      edit: 'Bearbeiten',
      editVertices: 'Eckpunkte bearbeiten',
      addPoints: 'Punkte hinzufügen',
      create: 'Erstellen',
      createPolygon: 'Polygon erstellen',
      createPolyline: 'Polylinie erstellen',
      slice: 'Schneiden',
      delete: 'Löschen',
      deletePolygon: 'Polygon löschen',
      unknown: 'Unbekannt',
    },
    modeDescription: {
      view: 'Navigieren und Polygone auswählen',
      edit: 'Eckpunkte bewegen und modifizieren',
      addPoints: 'Punkte zwischen Eckpunkten hinzufügen',
      create: 'Neue Polygone erstellen',
      createPolyline:
        'Klicken zum Setzen von Punkten, Doppelklick zum Abschließen der Polylinie',
      slice: 'Polygone mit einer Linie teilen',
      delete: 'Polygone entfernen',
    },
    toolbar: {
      mode: 'Modus',
      keyboard: 'Taste: {{key}}',
      requiresSelection: 'Erfordert Polygon-Auswahl',
      requiresPolygonSelection: 'Erfordert Polygon-Auswahl',
      resegment: 'Frame neu segmentieren',
      resegmentTooltipModel: 'Modell: {{model}} · {{threshold}}',
      resegmentSuccess: 'Frame neu segmentiert',
      resegmentFailed: 'Neusegmentierung fehlgeschlagen',
      resegmentConfirmTitle: 'Vorhandene Polygone ersetzen?',
      resegmentConfirmDescription:
        'Das Ausführen des Modells überschreibt die aktuelle Segmentierung. Manuelle Bearbeitungen der Polygone in diesem Frame gehen verloren.',
      select: 'Auswählen',
      undoTooltip: 'Rückgängig (Strg+Z)',
      undo: 'Rückgängig',
      redoTooltip: 'Wiederholen (Strg+Y)',
      redo: 'Wiederholen',
      zoomInTooltip: 'Vergrößern (+)',
      zoomIn: 'Vergrößern',
      zoomOutTooltip: 'Verkleinern (-)',
      zoomOut: 'Verkleinern',
      resetViewTooltip: 'Ansicht zurücksetzen (R)',
      resetView: 'Zurücksetzen',
      unsavedChanges: 'Nicht gespeicherte Änderungen',
      saving: 'Speichern...',
      save: 'Speichern',
      keyboardShortcuts:
        'V: Anzeigen • E: Bearbeiten • A: Hinzufügen • N: Neu • S: Schneiden • D: Löschen',
      nothingToSave: 'Alle Änderungen gespeichert',
    },
    status: {
      polygons: 'Polygone',
      vertices: 'Eckpunkte',
      visible: 'sichtbar',
      hidden: 'versteckt',
      selected: 'ausgewählt',
      saved: 'Gespeichert',
      unsaved: 'Nicht gespeichert',
      noPolygons: 'Keine Polygone',
      startCreating: 'Beginnen Sie mit der Erstellung eines Polygons',
      polygonList: 'Polygon-Liste',
      external: 'External',
      internal: 'Internal',
      polyline: 'Polylinie',
    },
    // Object classes of the neurite/soma model. Deliberately NOT under
    // `sperm.part` — different model, different vocabulary.
    partClass: {
      neurite: 'Neurit',
      soma: 'Soma',
    },
    shortcuts: {
      buttonText: 'Tastenkürzel',
      title: 'Tastenkürzel',
      dialogTitle: 'Tastenkürzel',
      footerNote:
        'Diese Tastenkürzel funktionieren im Segmentierungseditor für schnelleres und bequemeres Arbeiten.',

      // Categories
      categories: {
        modes: 'Bearbeitungsmodi',
        actions: 'Aktionen',
        view: 'Ansichtssteuerungen',
        navigation: 'Navigation',
      },

      // Mode shortcuts
      viewMode: 'Ansichtsmodus',
      editVertices: 'Eckpunkte bearbeiten-Modus',
      addPoints: 'Punkte hinzufügen-Modus',
      createPolygon: 'Neues Polygon erstellen',
      sliceMode: 'Schnitt-Modus',
      deleteMode: 'Lösch-Modus',

      // Action shortcuts
      save: 'Speichern',
      undo: 'Rückgängig',
      redo: 'Wiederholen',
      deleteSelected: 'Ausgewähltes Polygon löschen',
      finishShape: 'Aktuelle Form abschließen',

      // View shortcuts
      zoom: 'Vergrößern/Verkleinern',
      resetView: 'Ansicht zurücksetzen',
      fitToScreen: 'An Bildschirm anpassen',

      // Navigation shortcuts
      cycleModes: 'Modi durchschalten',
      cycleModesReverse: 'Modi durchschalten (rückwärts)',
      cancel: 'Aktuelle Operation abbrechen',
      showHelp: 'Diese Hilfe anzeigen',

      // Conditions
      requiresSelection: 'Erfordert Polygon-Auswahl',

      // Legacy keys (kept for backward compatibility)
      v: 'Ansichtsmodus',
      e: 'Eckpunkte bearbeiten-Modus',
      a: 'Punkte hinzufügen-Modus',
      n: 'Neues Polygon erstellen',
      s: 'Schnitt-Modus',
      d: 'Lösch-Modus',
      shift: 'Halten für automatisches Hinzufügen von Punkten',
      ctrlZ: 'Rückgängig',
      ctrlY: 'Wiederholen',
      delete: 'Ausgewähltes Polygon löschen',
      esc: 'Aktuelle Operation abbrechen',
      plus: 'Vergrößern',
      minus: 'Verkleinern',
      r: 'Ansicht zurücksetzen',
    },
    tips: {
      header: 'Tipps:',
      edit: {
        createPoint: 'Klicken, um einen neuen Punkt zu erstellen',
        holdShift:
          'Shift halten, um automatisch eine Punktsequenz zu erstellen',
        closePolygon: 'Polygon durch Klicken auf den ersten Punkt schließen',
      },
      slice: {
        startSlice: 'Klicken, um den Schnitt zu beginnen',
        endSlice: 'Nochmals klicken, um den Schnitt zu beenden',
        cancelSlice: 'Esc bricht den Schnitt ab',
      },
      addPoints: {
        hoverLine: 'Cursor über die Polygonlinie bewegen',
        clickAdd: 'Klicken, um Punkt zum ausgewählten Polygon hinzuzufügen',
        escCancel: 'Esc beendet den Hinzufüge-Modus',
      },
    },
    helpTips: {
      editMode: [
        'Klicken, um einen neuen Punkt zu erstellen',
        'Shift halten, um automatisch eine Punktsequenz zu erstellen',
        'Polygon durch Klicken auf den ersten Punkt schließen',
      ],
      slicingMode: [
        'Klicken, um den Schnitt zu beginnen',
        'Nochmals klicken, um den Schnitt zu beenden',
        'Esc bricht den Schnitt ab',
      ],
      pointAddingMode: [
        'Cursor über die Polygonlinie bewegen',
        'Klicken, um Punkt zum ausgewählten Polygon hinzuzufügen',
        'Esc verlässt den Hinzufüge-Modus',
      ],
    },
    loading: 'Segmentierung wird geladen...',
    noPolygons: 'Keine Polygone gefunden',
    polygonNotFound: 'Polygon nicht gefunden',
    invalidSlice: 'Ungültige Schnitt-Operation',
    sliceSuccess: 'Polygon erfolgreich geschnitten',
    sliceFailed: 'Polygon-Schnitt fehlgeschlagen',
    instructions: {
      slice: {
        selectPolygon:
          '1. Klicken Sie auf ein Polygon, um es zum Schneiden auszuwählen',
        placeFirstPoint:
          '2. Klicken Sie, um den ersten Schnittpunkt zu platzieren',
        placeSecondPoint:
          '3. Klicken Sie, um den zweiten Schnittpunkt zu platzieren und den Schnitt durchzuführen',
        cancel: 'Drücken Sie ESC zum Abbrechen',
      },
      create: {
        startPolygon:
          '1. Klicken Sie, um mit der Polygon-Erstellung zu beginnen',
        continuePoints:
          '2. Klicken Sie weiter, um mehr Punkte hinzuzufügen (mindestens 3 benötigt)',
        finishPolygon:
          '3. Fügen Sie weiter Punkte hinzu oder klicken Sie nahe dem ersten Punkt, um das Polygon zu schließen',
        holdShift: 'SHIFT halten für automatisches Hinzufügen von Punkten',
        cancel: 'Drücken Sie ESC zum Abbrechen',
      },
      createPolyline: {
        start: 'Klicken Sie, um den ersten Punkt des Mikrotubulus zu setzen',
        finish: 'Mit Enter oder Doppelklick abschließen',
        holdShift: 'SHIFT halten, um Punkte automatisch hinzuzufügen',
        cancel: 'ESC zum Abbrechen drücken',
      },
      addPoints: {
        clickVertex:
          'Klicken Sie auf einen beliebigen Eckpunkt, um mit dem Hinzufügen von Punkten zu beginnen',
        clickVertexMt:
          'Klicken Sie auf ein Mikrotubulus-Ende, um es zu verlängern',
        addPointsMt:
          'Klicken zum Hinzufügen von Punkten, dann Enter zum Abschließen',
        addPoints:
          'Klicken Sie, um Punkte hinzuzufügen, dann klicken Sie auf einen anderen Eckpunkt zum Abschließen. Klicken Sie direkt auf einen anderen Eckpunkt ohne Punkte hinzuzufügen, um alle Punkte dazwischen zu entfernen.',
        holdShift: 'SHIFT halten für automatisches Hinzufügen von Punkten',
        cancel: 'Drücken Sie ESC zum Abbrechen',
        joinHint:
          'Klicke auf den Endpunkt einer anderen Polylinie derselben Klasse, um sie zu verbinden',
      },
      editVertices: {
        selectPolygon:
          'Klicken Sie auf ein Polygon, um es zur Bearbeitung auszuwählen',
        dragVertices: 'Klicken und ziehen Sie Eckpunkte, um sie zu bewegen',
        addPoints:
          'SHIFT halten und auf einen Eckpunkt klicken, um Punkte hinzuzufügen',
        deleteVertex: 'Doppelklick auf einen Eckpunkt, um ihn zu löschen',
      },
      deletePolygon: {
        clickToDelete: 'Klicken Sie auf ein Polygon, um es zu löschen',
      },
      view: {
        selectPolygon: 'Klicken Sie auf ein Polygon, um es auszuwählen',
        navigation: 'Ziehen zum Schwenken • Scrollen zum Zoomen',
      },
      modes: {
        slice: 'Schnitt-Modus',
        create: 'Polygon-Erstellungs-Modus',
        createPolyline: 'Mikrotubulus-Erstellmodus',
        addPoints: 'Punkte-Hinzufüge-Modus',
        editVertices: 'Eckpunkt-Bearbeitungs-Modus',
        deletePolygon: 'Polygon-Lösch-Modus',
        view: 'Ansichts-Modus',
      },
      shiftIndicator: '⚡ SHIFT: Automatisches Hinzufügen von Punkten',
    },
  },
  status: {
    segmented: 'Segmentiert',
    processing: 'Verarbeitung',
    queued: 'In Warteschlange',
    failed: 'Fehlgeschlagen',
    no_segmentation: 'Keine Segmentierung',
    disconnected: 'Vom Server getrennt',
    error: 'ML-Service-Fehler',
    ready: 'Bereit für Segmentierung',
    online: 'Online',
    offline: 'Offline',
    noPolygons: 'Keine Polygone',
  },
  queue: {
    title: 'Segmentierungs-Warteschlange',
    connected: 'Verbunden',
    disconnected: 'Getrennt',
    waiting: 'wartend',
    processing: 'verarbeitend',
    totalProgress: 'Gesamtfortschritt',
    images: 'Bilder',
    loadingStats: 'Statistiken werden geladen...',
    connectingMessage:
      'Verbindung zum Server... Echtzeit-Updates werden bald verfügbar sein.',
    emptyMessage:
      'Keine Bilder in der Warteschlange. Laden Sie Bilder hoch und fügen Sie sie zur Segmentierung hinzu.',
    addingToQueue: 'Zur Warteschlange hinzufügen...',
    resegmentSelected: 'Ausgewählte re-segmentieren ({{count}})',
    segmentSelected: 'Ausgewählte segmentieren',
    segmentSelectedWithCount: 'Ausgewählte segmentieren ({{count}})',
    selectNothingTooltip: 'Bilder zum Segmentieren auswählen',
    segmentMixed:
      'Segmentiere {{new}} + Re-segmentiere {{resegment}} ({{total}} gesamt)',
    segmentTooltip:
      '{{new}} neue Bilder werden segmentiert, {{resegment}} ausgewählte Bilder werden re-segmentiert',
    cancelSegmentation: 'Segmentierung Abbrechen',
    segmentationCancelled: '{{count}} Segmentierung abgebrochen',
    segmentationCancelled_other: '{{count}} Segmentierungen abgebrochen',
    cancelFailed: 'Segmentierung konnte nicht abgebrochen werden',
    // Cancel All functionality
    cancelAll: 'Alle Abbrechen',
    cancelAllTooltip: 'Alle {{count}} Segmentierungsaufgabe(n) abbrechen',
    confirmCancelAll: 'Alle Segmentierungen Abbrechen?',
    confirmCancelAllDescription:
      'Sie sind dabei, {{count}} Segmentierungsaufgabe(n) in allen Ihren Projekten abzubrechen.',
    processingTasks: '{{count}} Aufgabe(n) werden derzeit verarbeitet',
    queuedTasks: '{{count}} Aufgabe(n) in der Warteschlange',
    cancelAllWarning:
      'Diese Aktion kann nicht rückgängig gemacht werden. Abgebrochene Aufgaben müssen erneut übermittelt werden.',
    confirmCancelAllButton: 'Ja, {{count}} Aufgabe(n) Abbrechen',
    cancellingAllSegmentations: 'Alle Segmentierungen werden abgebrochen...',
    allSegmentationsCancelled:
      '{{count}} Segmentierung(en) erfolgreich abgebrochen',
    affectedProjects: '{{count}} Projekt(e) betroffen',
    cancelAllFailed: 'Fehler beim Abbrechen der Segmentierungen',
    cancelAllError: 'Fehler beim Abbrechen der Segmentierungen',
    cancelling: 'Wird abgebrochen...',
    processingSlots: 'Verarbeitungsslots',
    parallel: 'parallel',
    users: 'Benutzer',
    active: 'aktiv',
    you: 'Sie',
    yourSlot: 'Ihr Slot: #{{slot}}',
    concurrentUsers: 'Auch in Verarbeitung: {{users}}',
    availableSlots: '{{count}} Slot verfügbar',
    availableSlots_other: '{{count}} Slots verfügbar',
    yourPosition: 'Ihre Position',
    estimatedWait: 'Gesch. Wartezeit',
    allSlotsActive:
      'Alle Verarbeitungsslots sind aktiv – maximale parallele Verarbeitungskapazität erreicht',
    slotAvailable:
      'Verarbeitungsslot verfügbar! Position #{{position}} (~{{waitTime}} Min. Wartezeit)',
  },
  toast: {
    error: 'Ein Fehler ist aufgetreten',
    success: 'Operation erfolgreich',
    info: 'Information',
    warning: 'Warnung',
    loading: 'Lädt...',
    failedToUpdate:
      'Aktualisierung der Daten fehlgeschlagen. Bitte erneut versuchen.',
    fillAllFields: 'Bitte füllen Sie alle Felder aus',
    operationFailed: 'Operation fehlgeschlagen. Bitte erneut versuchen.',
    unexpectedError: 'Unerwarteter Fehler',
    somethingWentWrong:
      'Etwas ist schiefgelaufen. Bitte versuchen Sie es später erneut.',
    somethingWentWrongPage:
      'Beim Laden dieser Seite ist ein Fehler aufgetreten.',
    returnToHome: 'Zurück zur Startseite',
    operationCompleted: 'Operation erfolgreich abgeschlossen',
    dataSaved: 'Daten erfolgreich gespeichert',
    dataUpdated: 'Daten erfolgreich aktualisiert',
    reconnecting: 'Verbinde erneut mit Server...',
    reconnected: 'Verbindung zum Server wiederhergestellt',
    connectionFailed: 'Wiederherstellung der Serververbindung fehlgeschlagen',
    segmentationRequested: 'Segmentierungsanfrage übermittelt',
    segmentationCompleted: 'Bildsegmentierung abgeschlossen',
    segmentationFailed: 'Segmentierung fehlgeschlagen',
    segmentationResultFailed:
      'Abrufen des Segmentierungsergebnisses fehlgeschlagen',
    segmentationStatusFailed:
      'Überprüfung des Segmentierungsstatus fehlgeschlagen',
    exportCompleted: 'Export erfolgreich abgeschlossen!',
    exportFailed: 'Export fehlgeschlagen. Bitte erneut versuchen.',
    project: {
      created: 'Projekt erfolgreich erstellt',
      createFailed: 'Projekt konnte nicht erstellt werden',
      deleted: 'Projekt erfolgreich gelöscht',
      deleteFailed: 'Projekt konnte nicht gelöscht werden',
      urlCopied: 'Projekt-URL in die Zwischenablage kopiert',
      unshared: 'Projekt aus Geteilten entfernt',
      notFound: 'Projekt nicht gefunden',
      invalidResponse: 'Serverantwort war ungültig',
      readyForImages: 'ist bereit für Bilder',
      selected: '{{count}} Bild ausgewählt',
      selected_other: '{{count}} Bilder ausgewählt',
      deleteSelected: 'Ausgewählte löschen',
    },
    profile: {
      consentUpdated: 'Einverständniseinstellungen erfolgreich aktualisiert',
      loadFailed: 'Laden der Profildaten fehlgeschlagen',
    },
    upload: {
      failed: 'Aktualisierung der Bilder nach Upload fehlgeschlagen',
      cancelUpload: 'Upload abbrechen',
      uploadCancelled: 'Upload abgebrochen',
      uploadCancelledSuccess: 'Upload erfolgreich abgebrochen',
      redirectingToGallery: 'Weiterleitung zur Bildergalerie...',
    },
    segmentation: {
      saved: 'Segmentierung erfolgreich gespeichert',
      failed: 'Segmentierung fehlgeschlagen',
      deleted: 'Polygon gelöscht',
      cannotDeleteVertex:
        'Kann Scheitelpunkt nicht löschen - Polygon benötigt mindestens 3 Punkte',
      vertexDeleted: 'Scheitelpunkt erfolgreich gelöscht',
      started: 'Segmentierung hat begonnen',
      completed: 'Segmentierung erfolgreich abgeschlossen',
      completedWithCount:
        'Segmentierung abgeschlossen! {{count}} Objekte gefunden',
      batchStarted: 'Segmentierung gestartet für {{count}} Bilder',
      batchCompleted:
        '✅ {{count}} Bilder erfolgreich segmentiert ({{duration}}s)',
      batchCompletedWithErrors:
        '⚠️ Batch abgeschlossen: {{successful}} erfolgreich, {{failed}} fehlgeschlagen ({{duration}}s)',
      noPolygons: 'Keine Segmentierungspolygone erkannt',
      reloadFailed:
        'Laden der Segmentierungsergebnisse fehlgeschlagen. Bitte Seite aktualisieren.',
      autosaveFailed:
        'Automatisches Speichern fehlgeschlagen - Änderungen können verloren gehen',
    },
    // Multi-channel canvas actions
    multiChannel: {
      allChannelsFailed: 'Bildkanäle konnten nicht geladen werden',
      someChannelsFailed: 'Einige Bildkanäle konnten nicht geladen werden',
    },
  },
  project: {
    selected: '{{count}} Bild ausgewählt',
    selected_other: '{{count}} Bilder ausgewählt',
    deleteSelected: 'Ausgewählte löschen',
    deleteAnnotations: 'Anmerkungen löschen',
    addChannel: 'Kanal hinzufügen',
    addChannelSuccess: 'Kanal {{channels}} zu {{frames}} Bild(ern) hinzugefügt',
    addChannelAlignWarning:
      'Ausrichtung bei {{failed}} von {{frames}} Bild(ern) fehlgeschlagen — nur {{shifted}} wurden registriert. Die Kanäle konnten nicht korreliert werden (keine gemeinsame Struktur); die Bilder wurden unverschoben hinzugefügt.',
    addChannelAlignWarningImplausible:
      'Ausrichtung bei {{failed}} von {{frames}} Bild(ern) fehlgeschlagen — nur {{shifted}} wurden registriert. Ein deutlicher Versatz wurde gefunden, war aber zu groß, um plausibel zu sein, und wurde verworfen; die Bilder wurden unverschoben hinzugefügt. Prüfen Sie, ob der hinzugefügte Kanal aus demselben Sichtfeld stammt und gegenüber dem Zielvideo nicht beschnitten oder verschoben ist.',
    addChannelAlignWarningShape:
      'Ausrichtung bei {{failed}} von {{frames}} Bild(ern) fehlgeschlagen — nur {{shifted}} wurden registriert. Der hinzugefügte Kanal und die Zielbilder haben unterschiedliche Pixelmaße und konnten daher nicht ausgerichtet werden; die Bilder wurden unverschoben hinzugefügt.',
    addChannelFailed: 'Kanal konnte nicht hinzugefügt werden',
    addChannelDialog: {
      title: 'Kanal hinzufügen',
      description:
        'Fügen Sie den ausgewählten Bildern einen zusätzlichen Kanal hinzu, indem Sie ein Video/Stapel mit gleicher Bildanzahl oder ein einzelnes Bild hochladen, das auf jedes ausgewählte Bild angewendet wird.',
      selectionSummary:
        '{{frames}} Bild(er) in {{videos}} Video(s) ausgewählt.',
      sourceLabel: 'Quelldatei (Video / Stapel / Bild)',
      dropPrompt: 'Datei hierher ziehen und ablegen oder klicken zum Auswählen',
      dropInvalidType: 'Nicht unterstützter Dateityp.',
      dropTooManyFiles: 'Es kann nur eine Datei auf einmal hinzugefügt werden.',
      removeFile: 'Datei entfernen',
      imageHint: 'Einzelnes Bild → wird auf jedes ausgewählte Bild angewendet.',
      videoHint:
        'Video/Stapel → muss genau {{frames}} Bild(er) haben und zu einem einzigen Video gehören.',
      nameLabel: 'Kanalname',
      namePlaceholder: 'z. B. GFP',
      alignLabel: 'Am Segmentierungskanal ausrichten',
      alignHint:
        'Phasenkorrelations-Registrierung, die eine kleine Tischdrift korrigiert.',
      multiVideoError:
        'Ein Video/Stapel kann nur zu Bildern eines einzigen Videos hinzugefügt werden. Wählen Sie Bilder aus einem Video oder laden Sie ein einzelnes Bild hoch.',
      uploading: 'Wird hochgeladen… {{percent}} %',
      adding: 'Wird hinzugefügt…',
      confirm: 'Kanal hinzufügen',
    },
    annotationsDeleted: 'Anmerkungen für {{count}} Bild(er) gelöscht',
    annotationsDeleteFailed:
      'Anmerkungen für {{count}} Bild(er) konnten nicht gelöscht werden',
    deleteAnnotationsDialog: {
      title: 'Anmerkungen löschen?',
      description:
        'Dies löscht die Segmentierungsanmerkungen für {{count}} ausgewählte Bild(er). Die Bilder bleiben erhalten, ihre Segmentierungsergebnisse werden jedoch entfernt. Dies kann nicht rückgängig gemacht werden.',
    },
    imagesDeleted: '{{count}} Bild gelöscht',
    imagesDeleted_other: '{{count}} Bilder gelöscht',
  },
  export: {
    mtKymographs: {
      title: 'Kymograph-Geschwindigkeitsanalyse',
      description:
        'Erkennt bewegte Partikel auf einem Kymographen für jeden Mikrotubulus und exportiert ihre Geschwindigkeiten.',
      enable: 'Kymograph-Analyse einbeziehen',
      velocityMetrics: 'Geschwindigkeitsmetriken (CSV)',
      segmentedImages: 'Segmentierte Kymograph-Bilder (PNG)',
      modeKymograph: 'Kymograph (Raum × Zeit)',
      modeProfiles: 'Intensitätsprofile (pro Bild)',
      singleFrameHint:
        'Einzelbild — ein Kymograph benötigt eine Zeitreihe, daher wird nur das Intensitätsprofil exportiert.',
      profilesHint:
        'Exportiert pro Bild ein matplotlib-Diagramm der Intensität gegen die Position sowie die Intensitäts-CSV.',
    },
    mt: {
      sectionTitle: 'Mikrotubuli-Metriken',
      sectionDescription:
        'Pro-MT-Länge, -Fläche und kanalweise Intensität aus der rohen ND2/TIFF-Datei. Hintergrundkorrektur über den Median außerhalb der dilatierten MT-Maske.',
      intensityNote:
        'Die kanalweise Signalintensität — einschließlich der summierten (integrierten) Intensität — wird immer für jeden Kanal berechnet und in die Metriktabelle geschrieben. Keine Auswahl erforderlich.',
      wideNote:
        'Jeder Kanal erhält in metrics.csv eine eigene Zeile (siehe Spalte „channel“). Die Begleitdatei metrics_wide.csv — ein zusätzliches Blatt in metrics.xlsx — stellt alle Kanäle desselben Mikrotubulus in eine Zeile, mit einem Spaltensatz pro Kanal.',
      thicknessLabel: 'MT-Dicke (px)',
      thicknessHelp:
        'Breite des Abtastbands entlang jeder Polyline. 5 px entspricht dem typischen Mikrotubulus-Durchmesser bei 100× Widefield.',
      marginLabel: 'Hintergrundrand (× Dicke)',
      marginHelp:
        'Pixel innerhalb dieses Radius (Dicke × Multiplikator) von einem MT werden vom Hintergrund ausgeschlossen. Höher = konservativer.',
    },
    advancedExport: 'Erweiterter Export',
    advancedOptions: 'Erweiterte Export-Optionen',
    configureSettings:
      'Konfigurieren Sie Ihre Export-Einstellungen, um ein umfassendes Datenpaket zu erstellen',
    general: 'Allgemein',
    visualization: 'Visualisierung',
    exportContents: 'Export-Inhalte',
    selectContent:
      'Wählen Sie aus, welche Inhaltstypen in Ihren Export einbezogen werden sollen',
    includeOriginal: 'Originalbilder einschließen',
    includeVisualizations:
      'Visualisierungen mit nummerierten Polygonen einschließen',
    includeDocumentation: 'Dokumentation und Metadaten einschließen',
    selectedImages: 'Ausgewählte Bilder',
    imagesSelected: '{{count}} von {{total}} Bildern ausgewählt',
    selectAll: 'Alle Auswählen',
    allSelected: 'Alle {{count}} Bilder ausgewählt',
    selectAllProject: 'Alle {{count}} Bilder auswählen',
    selectNone: 'Nichts Auswählen',
    imageSelection: 'Bildauswahl',
    chooseImages:
      'Wählen Sie aus, welche Bilder in den Export einbezogen werden sollen',
    searchImages: 'Bilder suchen...',
    sortBy: 'Sortieren nach',
    sortOptions: {
      date: 'Datum',
      name: 'Name',
      status: 'Status',
    },
    showingImages: 'Zeige {{start}}-{{end}} von {{total}}',
    noImagesFound: 'Keine Bilder gefunden',
    qualitySettings: 'Qualitätseinstellungen',
    imageQuality: 'Bildqualität',
    compressionLevel: 'Komprimierungsgrad',
    outputResolution: 'Ausgabeauflösung',
    colorSettings: 'Farbeinstellungen',
    backgroundColor: 'Hintergrundfarbe',
    strokeColor: 'Strichfarbe',
    strokeWidth: 'Strichbreite',
    fontSize: 'Schriftgröße',
    showNumbers: 'Polygon-Nummern anzeigen',
    showLabels: 'Beschriftungen anzeigen',
    scaleConversion: 'Skalierungskonvertierung',
    pixelToMicrometerScale: 'Pixelgröße',
    scaleDescription:
      'Geben Sie an, wie viele Mikrometer ein Pixel repräsentiert, um Messungen umzurechnen',
    scalePlaceholder: 'z.B. 0.5 (1 Pixel = 0.5 µm)',
    scaleUnit: 'µm/Pixel',
    scaleWarning:
      'Hinweis: Skalierungswert über 1 µm/Pixel deutet auf sehr geringe Vergrößerung hin. Bitte überprüfen.',
    outputSettings: 'Ausgabeeinstellungen',
    exportFormatsLabel: 'Exportformate',
    exportFormats: {
      yolo: 'YOLO-Format',
      excel: 'Excel-Format',
      json: 'JSON-Format',
    },
    // Progress panel specific
    title: 'Export-Fortschritt',
    readyToDownload: 'Export bereit zum Download',
    fallbackMode: 'Abruf-Modus',
    fallbackMessage:
      'Verwende Abruf für Fortschrittsaktualisierungen aufgrund von Verbindungsproblemen',
    exportToZip: 'Als ZIP-Archiv exportieren',
    generateExcel: 'Excel-Metriken generieren',
    includeCocoFormat: 'COCO-Format-Annotationen einschließen',
    includeJsonMetadata: 'JSON-Metadaten einschließen',
    microtubuleAnnotationsNote:
      'Mikrotubuli-Projekte exportieren Annotationen als ImageJ RoiSet + CVAT 1.1 (immer enthalten), jeweils mit der Tubulin-Typklasse. COCO/YOLO/JSON werden für Mikrotubuli nicht verwendet.',
    preparing: 'Export wird vorbereitet...',
    processing: 'Verarbeitung {{current}} von {{total}}',
    processingExport: 'Verarbeitung...',
    packaging: 'Paket wird erstellt...',
    completed: 'Export abgeschlossen',
    downloading: 'Herunterladen...',
    cancelling: 'Wird abgebrochen...',
    cancelled: 'Export abgebrochen',
    cancelExport: 'Export abbrechen',
    connected: 'Verbunden',
    disconnected: 'Getrennt',
    reconnecting: 'Verbinde neu...',
    startExport: 'Export Starten',
    cancel: 'Abbrechen',
    download: 'Herunterladen',
    retry: 'Wiederholen',
    close: 'Schließen',
    exportError: 'Export fehlgeschlagen',
    exportFailed: 'Export fehlgeschlagen',
    exportComplete: 'Export abgeschlossen',
    metricsExportComplete: 'Metriken-Export abgeschlossen',
    connectionError: 'Verbindung während Export verloren',
    serverError: 'Server-Fehler aufgetreten',
    invalidSelection: 'Bitte wählen Sie mindestens ein Bild aus',
    noData: 'Keine Daten für Export verfügbar',
    segmentationData: 'Segmentierungsdaten',
    spheroidMetrics: 'Sphäroid-Metriken',
    spermMetrics: 'Spermien-Metriken',
    cocoFormat: 'COCO-Format',
    cocoFormatTitle: 'COCO-Format-Export',
    downloadJson: 'JSON herunterladen',
    formatsTab: 'Formate',
  },
  imageDeleted: 'Bild erfolgreich gelöscht',
  deleteImageFailed: 'Löschen des Bildes fehlgeschlagen',
  deleteImageError: 'Fehler beim Löschen des Bildes',
  imageAlreadyProcessing: 'Bild wird bereits verarbeitet',
  processImageFailed: 'Bildverarbeitung fehlgeschlagen',
  exportDialog: {
    title: 'Export-Optionen',
    includeMetadata: 'Metadaten einschließen',
    includeSegmentation: 'Segmentierung einschließen',
    includeObjectMetrics: 'Objekt-Metriken einschließen',
    exportMetricsOnly: 'Nur Metriken exportieren (XLSX)',
    selectImages: 'Bilder für Export auswählen',
    selectAll: 'Alle Auswählen',
    selectNone: 'Alle Abwählen',
    noImagesAvailable: 'Keine Bilder verfügbar',
  },
  docs: {
    // Kopfbereich
    badge: 'Dokumentation',
    title: 'SpheroSeg-Dokumentation',
    subtitle:
      'Alles, was die Plattform kann, für alle sechs Projekttypen — durchsuchbar',
    backTo: 'Zurück zu {{page}}',

    // Suche
    search: {
      placeholder: 'Dokumentation durchsuchen…',
      hint: 'Drücken Sie /, um zu suchen. Passende Abschnitte werden gefiltert und hervorgehoben.',
      results: '{{count}} passende(r) Abschnitt(e)',
      noResults: 'Keine Treffer',
      noResultsHint:
        'Versuchen Sie eine kürzere Suchanfrage oder einen Begriff wie „Kanal“, „Kymograf“, „Export“ oder „Schwellwert“.',
      clear: 'Suche zurücksetzen',
    },

    // Navigation
    navigation: 'Navigation',
    nav: {
      introduction: 'Einführung',
      gettingStarted: 'Erste Schritte',
      projectTypes: 'Projekttypen',
      uploadingImages: 'Daten hochladen',
      videosChannels: 'Videos & Kanäle',
      modelSelection: 'Modelle',
      segmentationProcess: 'Segmentierung',
      segmentationEditor: 'Editor',
      exportFeatures: 'Export',
      automatedEssays: 'Automatisierte Assays',
      segmenter: 'Segmenter',
      sharedProjects: 'Freigabe',
      troubleshooting: 'Fehlerbehebung',
    },

    // Einführung
    introduction: {
      title: 'Einführung',
      whatIs: 'Was ist SpheroSeg?',
      description:
        'SpheroSeg ist eine Plattform für KI-gestützte Segmentierung und Vermessung mikroskopischer Bilder und Zeitrafferaufnahmen. Sie bietet sechs Projekttypen auf Basis von zehn Segmentierungsmodellen, einen Editor für Polygone und Polylinien, bildübergreifendes Mikrotubuli-Tracking und einen Stapel-Export.',
      developedBy:
        'Die Plattform wurde von Bc. Michal Průšek an der Fakultät für Nuklearwissenschaften und Physikalische Ingenieurwissenschaften der Tschechischen Technischen Universität Prag unter der Betreuung von Ing. Adam Novozámský, Ph.D. entwickelt, in Zusammenarbeit mit dem Institut für Biochemie und Mikrobiologie der UCT Prag.',
      addresses:
        'Ausgangspunkt war die schwierige Aufgabe, Sphäroidgrenzen in der Mikroskopie zu bestimmen. Heute deckt die Plattform auch zerfallende Sphäroide, Wundheilungsassays, Spermienmorphologie, Mikrotubuli-Zeitraffer und Mikrokapseln ab — jeweils mit eigenem Modell, eigenen Messgrößen und eigenem Exportformat.',
    },

    // Erste Schritte
    gettingStarted: {
      title: 'Erste Schritte',
      accountCreation: 'Konto anlegen',
      accountDescription:
        'Die Registrierung ist offen — es gibt keine Freigabewarteschlange. Ein Konto hält Ihre Projekte, Bilder und Ergebnisse zusammen.',
      accountSteps: {
        step1: 'Öffnen Sie die Registrierungsseite',
        step2: 'Geben Sie Ihre E-Mail-Adresse ein und wählen Sie ein Passwort',
        step3: 'Vervollständigen Sie Ihr Profil mit Name und Einrichtung',
        step4:
          'Legen Sie in den Einstellungen Modell, Standardschwellwert, Sprache und Design fest',
      },
      firstProject: 'Ihr erstes Projekt',
      projectDescription:
        'Ein Projekt enthält Bilder und die daraus erzeugten Segmentierungen. Sein Typ bestimmt, welche Modelle laufen, was der Editor zeigt und wie exportiert wird — wählen Sie ihn also bewusst.',
      projectSteps: {
        step1: 'Klicken Sie im Dashboard auf „Neues Projekt“',
        step2: 'Geben Sie einen Namen und optional eine Beschreibung ein',
        step3:
          'Wählen Sie den zu Ihrer Probe passenden Projekttyp (siehe Projekttypen unten)',
        step4:
          'Klicken Sie auf „Projekt erstellen“ und laden Sie Ihre Daten hoch',
      },
    },

    // Projekttypen
    projectTypes: {
      title: 'Projekttypen',
      description:
        'Jedes Projekt hat einen Typ, den Sie beim Anlegen wählen. Er ist keine bloße Bezeichnung: Er bestimmt die verfügbaren Modelle, die erzeugte Geometrie, die Panels im Editor und die Dateien, die Sie beim Export erhalten.',
      types: {
        spheroid: {
          name: 'Sphäroide (Standard)',
          bestFor:
            'Für: Zellsphäroide in Hellfeld oder Phasenkontrast. Der einzige Typ mit Modellauswahl — gleich fünf davon.',
          output: 'Ergebnis: geschlossene Polygone mit optionalen Löchern.',
        },
        spheroidInvasive: {
          name: 'Zerfallende Sphäroide',
          bestFor:
            'Für: Sphäroide, die in eine Matrix auswandern. Die zentrale Kennzahl ist der kernverankerte Zerfallsindex.',
          output:
            'Ergebnis: geschlossene Polygone; der dichte Kern wird als eigene Klasse vorhergesagt und grün gezeichnet.',
        },
        wound: {
          name: 'Wundheilung',
          bestFor:
            'Für: Zeitraffer von Scratch-Assays. Ergänzt eine Verschlusskurve über die gesamte Serie.',
          output:
            'Ergebnis: geschlossene Polygone über der offenen Wunde sowie ein Blatt mit der Wundfläche über die Zeit samt Diagramm.',
        },
        sperm: {
          name: 'Spermien',
          bestFor:
            'Für: Spermienmorphologie, gemessen als drei Teile je Zelle — Kopf, Mittelstück und Schwanz.',
          output:
            'Ergebnis: offene Polylinien mit Teilklasse und Instanz-ID, farblich als Grün, Orange und Cyan unterschieden.',
        },
        microtubules: {
          name: 'Mikrotubuli',
          bestFor:
            'Für: IRM-Zeitraffer von Mikrotubuli, mit bildübergreifendem Tracking, Intensität je Kanal und Kymografen.',
          output:
            'Ergebnis: offene Polylinien mit stabiler Track-ID; exportiert als ImageJ-ROIs und CVAT statt COCO oder YOLO.',
        },
        microcapsule: {
          name: 'Mikrokapseln',
          bestFor:
            'Für: runde Mikrokapseln im Hellfeld, auch wenn sie einander berühren.',
          output:
            'Ergebnis: ein geschlossenes Polygon je Kapsel. Vom Bildrand angeschnittene Kapseln fließen nicht in die Messwerte ein.',
        },
      },
      note: 'Wählen Sie den Typ vor dem Hochladen.',
      noteText:
        'Die Modellkompatibilität richtet sich nach dem Projekttyp; eine spätere Änderung bedeutet, dass vorhandene Ergebnisse nicht mehr mit dem Modell neu berechnet werden können, das sie erzeugt hat.',
    },

    // Daten hochladen
    uploadImages: {
      title: 'Daten hochladen',
      description:
        'Die Plattform nimmt sowohl Einzelbilder als auch Zeitrafferdaten an. Ein Video, eine ND2-Datei oder ein mehrseitiges TIFF wird zu einem Container mit einem Eintrag je Einzelbild.',
      formats: 'Unterstützte Formate und Grenzen',
      formatsTable: {
        kind: 'Art',
        extensions: 'Formate',
        limit: 'Maximale Größe',
        imagesLabel: 'Einzelbilder',
        imagesLimit: '20 MB pro Datei',
        videosLabel: 'Videos und Stapel',
        videosLimit: '100 GB pro Datei',
      },
      methods: 'Wege zum Hochladen',
      methodsDescription: 'Drei gleichwertige Möglichkeiten:',
      methodsList: {
        dragDrop: 'Dateien auf den Upload-Bereich ziehen',
        browse: 'Auf den Upload-Bereich klicken und Dateien auswählen',
        batch:
          'Einen ganzen Ordner ablegen — er wird rekursiv durchlaufen, bis zu 10 000 Dateien je Stapel',
        autoSegment:
          'Mit „Nach dem Hochladen automatisch segmentieren“ wandert alles direkt in die Warteschlange',
      },
      tiffNote: 'Ein TIFF kann beides sein.',
      tiffNoteText:
        'Ein TIFF wird als Stapel behandelt, wenn es größer als 20 MB ist oder tatsächlich mehrere Seiten enthält — der Dateikopf wird geprüft, sodass auch ein kleines Mehrkanal-TIFF korrekt verarbeitet wird.',
      note: 'Für beste Ergebnisse:',
      noteText:
        'achten Sie auf guten Kontrast zwischen Objekt und Hintergrund und darauf, dass die Datei ihre Pixelkalibrierung mitbringt, wenn Sie Messwerte in Mikrometern möchten. Ein Video-Upload ist eine einzige lange Anfrage — Übertragung und Einzelbildextraktion laufen gemeinsam, eine große ND2-Datei braucht also Zeit.',
    },

    // Videos & Kanäle
    videosChannels: {
      title: 'Videos, Einzelbilder und Kanäle',
      description:
        'Zeitraffer- und Mehrkanaldaten werden eigens behandelt: ein Container für die Aufnahme, ein Eintrag je Einzelbild und eine Kanalliste, die Sie im Editor steuern.',
      containers: 'Container und Einzelbilder',
      containerFacts: {
        frames:
          'Ein Upload wird zu einem Container plus einem Eintrag je Einzelbild; in der Oberfläche werden Einzelbilder ab 1 gezählt.',
        hidden:
          'Der Container selbst erscheint nie in der Galerie und wird nie segmentiert — nur die Einzelbilder.',
        positions:
          'Eine an mehreren Tischpositionen aufgenommene ND2-Datei wird zu einem Projekteintrag je Position.',
        calibration:
          'Pixelgröße und Bildabstand werden aus der Datei gelesen, sofern vorhanden, und zur automatischen Umrechnung genutzt.',
      },
      channels: 'Kanäle',
      channelsDescription:
        'Jeder Kanal wird je Einzelbild als eigenes Bild gespeichert. Genau ein Kanal kann die Segmentierungsquelle sein — der Kanal, den das Modell liest.',
      channelControls: {
        visibility:
          'Ein Kontrollkästchen nimmt den Kanal in die Überlagerung auf',
        color: 'Ein Farbfeld legt seinen Farbton fest',
        rename: 'Ein Doppelklick auf den Namen benennt ihn um',
        opacity: 'Ein Regler stellt die Deckkraft von 0 bis 100 % ein',
        source: 'Die Segmentierungsquelle ist mit „● src“ markiert',
      },
      sourceNote: 'Prüfen Sie die Segmentierungsquelle.',
      sourceNoteText:
        'Ist kein Kanalname erkennbar, wird keine Quelle markiert und der erste Kanal verwendet. Bei Mikrotubuli hat das Folgen: Das Modell arbeitet nur mit IRM, auf einem Fluoreszenzkanal erzeugt es überzeugend aussehende Polylinien, unter denen nichts liegt.',
      windowLevel: '16-Bit-Daten darstellen',
      windowLevelDescription:
        'Bilder mit hoher Bittiefe werden über die Regler Min und Max dargestellt, ergänzt um Helligkeit und Kontrast. Das Fenster gilt je Kanal und nicht gemeinsam: Ein Kanal wird beim ersten Anzeigen automatisch an seine eigenen Daten angepasst, behält danach Ihre Grenzen und erweitert seinen Bereich nur, wenn hellere Bilder auftauchen. Diese Einstellungen gelten für die Sitzung; Kanalfarben und Deckkraft werden gespeichert.',
      navigation: 'Durch Einzelbilder navigieren',
      keys: {
        step: 'Vorheriges / nächstes Einzelbild',
        play: 'Abspielen oder anhalten — feste 10 Bilder pro Sekunde, Stopp beim letzten Bild',
      },
      mtExtras: 'Zusätzlich bei Mikrotubuli-Projekten',
      mtExtrasList: {
        registration:
          'Kanalregistrierung beim Hochladen: richtet jeden Kanal per ganzzahliger Pixelverschiebung am ersten aus, sodass nichts interpoliert wird.',
        addChannel:
          'Kanal hinzufügen: hängt nachträglich einen weiteren Kanal an ausgewählte Einzelbilder an — entweder ein Bild auf alle geprägt oder ein Video Bild für Bild zugeordnet.',
        tracking:
          'Bildübergreifendes Tracking läuft automatisch, sobald alle Einzelbilder fertig sind, und gibt jedem Filament eine stabile Identität und Farbe.',
      },
    },

    // Modelle
    modelSelection: {
      title: 'Modelle',
      description:
        'Zehn Modelle, jedes an die Projekttypen gebunden, für die es trainiert wurde. Die Auswahl zeigt nur kompatible Modelle, und eine echte Wahl haben nur Standard-Sphäroidprojekte — alle anderen Typen haben genau eines.',
      spheroidModels: 'Sphäroidmodelle — Sie haben die Wahl',
      specialisedModels: 'Spezialmodelle — eines je Projekttyp',
      models: {
        hrnet: {
          name: 'HRNet (ausgewogen)',
          inferenceTime: 'Etwa 0,20 s pro Bild',
          bestFor:
            'Am besten für: ein Modell, kein Nachdenken. Die Standardwahl der Plattform.',
          description:
            'Behält im gesamten Netz einen hochauflösenden Zweig bei, statt erst zu kodieren und dann zu dekodieren, und bewahrt so Randdetails.',
        },
        cbam: {
          name: 'CBAM-ResUNet (präzise)',
          inferenceTime: 'Etwa 0,38 s pro Bild',
          bestFor:
            'Am besten für: Publikationsabbildungen und schwierige Ränder, bei rund doppeltem Aufwand gegenüber HRNet.',
          description:
            'Residual-U-Net mit Kanal- und Raumaufmerksamkeit auf jeder Stufe — die präzisesten Ränder der fünf.',
        },
        unet: {
          name: 'UNet (am schnellsten)',
          inferenceTime: 'Etwa 0,18 s pro Bild',
          bestFor:
            'Am besten für: große Stapel, bei denen Durchsatz wichtiger ist als das letzte Prozent Genauigkeit.',
          description:
            'Ein schlichtes U-Net, trainiert auf dem SpheroHQ-Datensatz und auf Durchsatz optimiert.',
        },
        segformer: {
          name: 'SegFormer',
          inferenceTime: 'Etwa 0,20 s pro Bild',
          bestFor:
            'Am besten für: die höchste gemessene Genauigkeit auf Hellfeld-Sphäroiden — 93 % IoU.',
          description:
            'Transformer-basiert (SegFormer-B0): hierarchischer Encoder mit leichtgewichtigem MLP-Decoder.',
        },
        mamba: {
          name: 'Mamba-UNet',
          inferenceTime: 'Etwa 0,24 s pro Bild',
          bestFor:
            'Am besten für: Bilder, die den Trainingsdaten nicht ähneln — anderes Labor, unbekannte Optik, wirkstoffbehandelt oder ungewöhnliche Morphologien.',
          description:
            'U-Net mit bidirektionalem State-Space-Flaschenhals, gewählt wegen seiner Robustheit außerhalb der Trainingsverteilung.',
        },
        disintegration: {
          name: 'Sphäroid-Zerfall',
          inferenceTime: 'Etwa 0,70 s pro Bild · Standardschwellwert 0,2',
          bestFor: 'Verwendet von: Projekten mit zerfallenden Sphäroiden.',
          description:
            'UNet++ mit EfficientNet-B5-Encoder, das drei Klassen vorhersagt — Hintergrund, Korona und dichter Kern. Der Kern wird direkt vorhergesagt statt abgeleitet, und erst das macht den Zerfallsindex belastbar.',
        },
        wound: {
          name: 'Wundheilung',
          inferenceTime: 'Etwa 0,03 s pro Bild',
          bestFor: 'Verwendet von: Wundheilungsprojekten.',
          description:
            'U-Net mit MiT-B5-Encoder für binäre Wundsegmentierung, 90 % IoU auf einem externen Testsatz. Intern arbeitet es mit 256×256 und skaliert hoch — daher die Geschwindigkeit und die Glättung feiner Randdetails.',
        },
        sperm: {
          name: 'Spermienmorphologie',
          inferenceTime: 'Etwa 0,30 s pro Bild',
          bestFor: 'Verwendet von: Spermienprojekten.',
          description:
            'Mehrklassige Instanzsegmentierung, die Kopf, Mittelstück und Schwanz direkt als Polylinien erzeugt — über Skelettextraktion statt über geschwellte Flecken.',
        },
        microtubule: {
          name: 'Mikrotubuli (v5H)',
          inferenceTime:
            'Etwa 4,5 s pro Bild · Schwellwert fest auf 0,97, nicht einstellbar',
          bestFor: 'Verwendet von: Mikrotubuli-Projekten. Nur IRM-Bilder.',
          description:
            'Ein nnU-Net-ResEnc-M-Netz sagt den Filamentvordergrund vorher; ein krümmungsbegrenzter Instancer trennt ihn anschließend in einzelne Mittellinien und löst jede Kreuzung unter einer festen Krümmungsschranke auf. Ausschließlich auf synthetischen Bildern trainiert. Die Laufzeit skaliert mit der Zahl der Filamente, nicht nur mit der Bildgröße.',
        },
        microcapsule: {
          name: 'Mikrokapseln',
          inferenceTime: 'Etwa 0,30 s pro Bild',
          bestFor: 'Verwendet von: Mikrokapselprojekten.',
          description:
            'Ein kompaktes U-Net, destilliert aus Meta SAM 3, mit Watershed zum Trennen sich berührender Kapseln. Vom Bildrand angeschnittene Kapseln werden markiert und aus den Messwerten ausgenommen.',
        },
      },
      howToSelect: 'Ein Modell wählen',
      selectionSteps: {
        step1:
          'Legen Sie Standardmodell und Schwellwert in den Einstellungen fest — sie gelten überall dort, wo der Projekttyp eine Wahl zulässt',
        step2:
          'Öffnen Sie ein Projekt und wählen Sie die zu verarbeitenden Bilder',
        step3:
          'Klicken Sie auf Segmentieren; der Dialog bietet nur kompatible Modelle an',
        step4:
          'Passen Sie den Konfidenzschwellwert an und wägen Sie so Trefferzahl gegen Evidenz ab',
        step5:
          'Wählen Sie bei einem Mehrkanalvideo, welchen Kanal das Modell lesen soll',
      },
      thresholdNote: 'Der Mikrotubuli-Schwellwert ist bewusst fest.',
      thresholdNoteText:
        'Dieses Modell verwendet seinen eigenen angepassten Schnitt von 0,97 und ignoriert den Regler. Ein niedrigerer Wert findet nicht mehr echte Filamente — er findet mehr mit schwächerer Evidenz, und auf einem Nicht-IRM-Kanal folgt die Ausgabe bei keiner Einstellung dem Bild. Fehlen Treffer, prüfen Sie stattdessen den Eingangskanal.',
      tip: 'Tipp:',
      tipText:
        'Beginnen Sie mit dem Standardmodell. Greifen Sie zu CBAM-ResUNet, wenn Ränder wichtiger sind als Geschwindigkeit, und zu Mamba-UNet, wenn Ihre Bilder niemandes Trainingsdaten ähneln.',
    },

    // Segmentierungsablauf
    segmentationProcess: {
      title: 'Der Segmentierungsablauf',
      description:
        'Die Segmentierung läuft im Hintergrund über eine Warteschlange, sodass Sie während eines Stapels weiterarbeiten können. Den Fortschritt sehen Sie live.',
      queueBased: 'Verarbeitung über eine Warteschlange',
      queueDescription: 'Die Warteschlange ist für große Stapel gebaut:',
      queueFeatures: {
        realTime:
          'Live-Status: Der Fortschritt kommt über WebSocket, abgesichert durch HTTP-Abfragen, sodass ein Verbindungsabbruch keinen Auftrag hängen lässt',
        batch: 'Stapelverarbeitung: bis zu 10 000 Bilder in einem Vorgang',
        priority:
          'Faire Reihenfolge: Kürzlich bediente Nutzer werden zurückgestuft, damit ein langes Video nicht die gesamte GPU belegt',
        recovery:
          'Wiederaufnahme: Unterbrochene Arbeit wird wiederholt statt verworfen, mit ausgewiesener Fehlermeldung',
      },
      workflow: 'Der Ablauf',
      workflowSteps: {
        step1: 'Laden Sie Bilder oder Videos in ein Projekt',
        step2:
          'Wählen Sie die zu verarbeitenden Bilder, oder keines, um alle zu verarbeiten',
        step3: 'Wählen Sie Modell und Konfidenzschwellwert',
        step4:
          'Wählen Sie bei einem Mehrkanalvideo den Kanal, den das Modell lesen soll',
        step5: 'Verfolgen Sie den Fortschritt über die Statusanzeigen',
        step6:
          'Öffnen Sie ein Bild im Editor, um das Ergebnis zu prüfen und zu korrigieren',
      },
      polygonTypes: 'Was die Modelle erzeugen',
      polygonDescription: 'Je nach Modell zwei Arten von Geometrie:',
      polygonTypesList: {
        external:
          'Äußere Polygone: der Objektumriss — Sphäroide, Wunden, Kapseln',
        internal:
          'Innere Polygone: Löcher innerhalb eines Objekts, die von seiner Fläche abgezogen werden',
        polyline:
          'Polylinien: offene Pfade mit Länge, aber ohne Fläche, erzeugt von den Mikrotubuli- und Spermienmodellen',
      },
      processingNote: 'Die Rechenzeit hängt vom Modell ab:',
      processingTimes:
        'Das Wundmodell braucht rund 0,03 s pro Bild und die Sphäroidmodelle 0,2–0,4 s, während das Mikrotubuli-Modell etwa 4,5 s pro Bild benötigt, weil das Trennen einzelner Filamente der teure Teil ist.',
    },

    // Editor
    segmentationEditor: {
      title: 'Der Segmentierungseditor',
      description:
        'Hier prüfen und korrigieren Sie Ergebnisse. Sieben Bearbeitungsmodi, vollständige Tastatursteuerung und Panels, die sich mit dem Projekttyp ändern.',
      editingModes: 'Bearbeitungsmodi',
      modes: {
        view: {
          title: 'Ansicht (V)',
          description:
            'Auswählen, verschieben, zoomen. Ein Klick auf eine Form wählt sie aus und wechselt zur Knotenbearbeitung.',
        },
        editVertices: {
          title: 'Knoten bearbeiten (E)',
          description:
            'Ziehen Sie Knoten, um einen Rand zu verfeinern. Ein Rechtsklick löscht einen Knoten. Erfordert eine ausgewählte Form.',
        },
        addPoints: {
          title: 'Punkte hinzufügen (A)',
          description:
            'Fügt Knoten ein, verlängert eine Polylinie am näheren Ende oder verbindet zwei Polylinien Ende an Ende. Erfordert eine ausgewählte Form.',
        },
        createPolygon: {
          title: 'Polygon erstellen (N)',
          description:
            'Klicken Sie eine geschlossene Form; ein Klick nahe dem ersten Punkt schließt sie. Mindestens drei Punkte.',
        },
        createPolyline: {
          title: 'Polylinie erstellen (P)',
          description:
            'Klicken Sie einen offenen Pfad für ein Mikrotubulus oder ein Spermienteil. Abschluss mit Enter oder Doppelklick.',
        },
        sliceMode: {
          title: 'Schneiden (S)',
          description:
            'Teilt eine Form mit einer Linie aus zwei Klicks. Funktioniert bei geschlossenen Polygonen und bei Polylinien.',
        },
        deletePolygon: {
          title: 'Polygon löschen (D)',
          description:
            'Klicken Sie Formen an, um sie zu entfernen. Der Modus bleibt aktiv, und es wird nichts bestätigt.',
        },
      },
      keyFeatures: 'Was der Editor bietet',
      features: {
        undoRedo:
          'Rückgängig und Wiederholen für Geometrie und Eigenschaften. Die Historie gilt je Einzelbild und wird beim Bildwechsel zurückgesetzt.',
        saving:
          'Speichern auf Zuruf: Schaltfläche Speichern, Strg+S, oder automatisch beim Wechsel zu einem anderen Bild.',
        zoomPan:
          'Zoom am Mauszeiger, Verschieben per Ziehen und Einpassen mit R oder 0.',
        polygonManagement:
          'Eine Formenliste mit Mehrfachauswahl, Ein- und Ausblenden, Umbenennen und Löschen.',
        keyboardShortcuts:
          'Vollständige Tastatursteuerung — H oder ? zeigt die Liste in der App.',
        realTimeFeedback:
          'Modusbezogene Hinweise auf der Zeichenfläche und eine laufende Zählung von Formen und Knoten.',
      },
      shortcuts: 'Tastenkürzel',
      shortcutCategories: {
        modes: 'Modi',
        actions: 'Aktionen',
        view: 'Ansicht',
      },
      shortcutsList: {
        v: 'Ansichtsmodus',
        e: 'Knoten bearbeiten',
        a: 'Punkte hinzufügen',
        n: 'Polygon erstellen',
        p: 'Polylinie erstellen',
        s: 'Schneiden',
        d: 'Polygon löschen',
        tab: 'Durch die Modi blättern',
        ctrlZ: 'Rückgängig',
        ctrlY: 'Wiederholen',
        ctrlS: 'Speichern',
        delete: 'Ausgewählte Form löschen',
        enter: 'Begonnene Polylinie abschließen',
        escape: 'Abbrechen und zur Ansicht zurückkehren',
        zoom: 'Vergrößern und verkleinern',
        reset: 'Bild ins Fenster einpassen',
        pan: 'Gedrückt halten und ziehen, um in jedem Modus zu verschieben',
        help: 'Kürzelliste anzeigen',
      },
      workingWithPolygons: 'Mit Formen arbeiten',
      polygonSteps: {
        step1: 'Klicken Sie eine Form an, um sie auszuwählen',
        step2: 'Wechseln Sie in den Modus, der zu Ihrer Änderung passt',
        step3: 'Nehmen Sie die Änderung mit der Maus vor',
        step4:
          'Blenden Sie Formen über die Liste rechts aus, benennen Sie sie um, wählen Sie mehrere aus oder löschen Sie sie',
        step5: 'Speichern Sie mit Strg+S',
      },
      saveNote: 'Es gibt kein fortlaufendes automatisches Speichern.',
      saveNoteText:
        'Gespeichert wird beim Klick auf Speichern oder mit Strg+S sowie im Hintergrund beim Wechsel zu einem anderen Bild. Ein Klick in der Brotkrumennavigation wechselt sofort und speichert im Hintergrund — drücken Sie bei umfangreichen Änderungen also zuerst Strg+S. Bei einem Video entfernt das Löschen einer getrackten Form samt Speichern sie aus allen Einzelbildern.',
      typeSpecific: 'Was sich je nach Projekttyp ändert',
      typeSpecificList: {
        microtubules:
          'Mikrotubuli: ein Instanz-Panel mit stabilen Farben je Track, eigene Typbezeichnungen, Zuweisung für den ganzen Track, Fortschreiben und Löschen eines Tracks sowie eine Kymograf-Ansicht.',
        sperm:
          'Spermien: ein Instanz-Panel, in dem Sie vor dem Zeichnen aktive Zelle und Teil wählen, sowie Neuzuordnung über das Kontextmenü.',
        disintegration:
          'Zerfallende Sphäroide: Der dichte Kern wird grün gezeichnet. Der Zerfallsindex selbst wird beim Export berechnet.',
      },
    },

    // Export
    exportFeatures: {
      title: 'Export',
      description:
        'Exporte laufen im Hintergrund und laden sich nach Fertigstellung selbst herunter. Pro Nutzer läuft jeweils einer; das Ergebnis ist ein einzelnes ZIP.',
      packageContents: 'Was im Paket steckt',
      contents: {
        originalImages: {
          title: 'Originalbilder',
          description: 'Die von Ihnen hochgeladenen Dateien, unverändert.',
        },
        visualizations: {
          title: 'Visualisierungen',
          description:
            'Gerenderte Überlagerungen mit nummerierten Formen, in Farben, Linienstärken und Transparenz Ihrer Wahl.',
        },
        annotations: {
          title: 'Annotationen',
          description:
            'Maschinenlesbare Geometrie in den gewählten Formaten — bei Mikrotubuli-Projekten zusätzlich ImageJ- und CVAT-Dateien, die immer enthalten sind.',
        },
        metrics: {
          title: 'Messwerte',
          description:
            'Eine Arbeitsmappe, deren Blätter vom Projekttyp abhängen, als XLSX, CSV oder JSON.',
        },
      },
      annotationFormats: 'Annotationsformate',
      formats: {
        coco: 'COCO: das Standardformat für Detektions-Frameworks. Polygone mit Löchern werden als Lauflängenmasken exportiert.',
        yolo: 'YOLO: Begrenzungsrahmen, das Polygon steht in einer Kommentarzeile. Offene Polylinien lassen sich nicht darstellen und werden übersprungen.',
        json: 'Eigenes JSON: vollständige Koordinaten und Metadaten, bei Spermienprojekten mit Gruppierung je Zelle.',
        imagej:
          'ImageJ-RoiSet: ein ZIP, das sich direkt im ROI-Manager von Fiji öffnet, ein ROI je Filament und Schicht, eingefärbt nach Klasse oder Track. Nur Mikrotubuli-Projekte, immer enthalten.',
        cvat: 'CVAT 1.1: Polylinien mit ihrer Track-Identität als Attribut. Nur Mikrotubuli-Projekte, immer enthalten.',
      },
      calculatedMetrics: 'Messwerte je Projekttyp',
      metricsDescription:
        'Welche Arbeitsmappe Sie erhalten, hängt davon ab, was Sie messen:',
      metricsTable: {
        projectType: 'Projekttyp',
        sheet: 'Blatt und Inhalt',
        spheroid:
          'Polygon Metrics + Summary — Fläche, Umfang, Rundheit, Feret-Durchmesser, Solidität und mehr, eine Zeile je Form',
        spheroidInvasive:
          'Image Metrics — eine Zeile je Bild mit Zerfallsindex, Kern- und Invasionsfläche sowie dem Dispersionspanel',
        wound:
          'Polygon Metrics + Summary + WoundTimeSeries — die Verschlusskurve mit eingebettetem Diagramm',
        sperm:
          'Sperm Metrics — Länge von Kopf, Mittelstück, Schwanz und gesamt, eine Zeile je Zelle',
        microtubules:
          'Microtubule Metrics + Channel Totals — Länge und Intensität je Kanal, eine Zeile je Einzelbild, Filament und Kanal',
        microcapsule:
          'Microcapsule Metrics + Summary — eine Zeile je vollständiger Kapsel; angeschnittene Kapseln entfallen',
      },
      scaleTitle: 'Pixelgröße und Einheiten',
      scaleText:
        'Geben Sie die Pixelgröße in Mikrometern an, dann werden alle Längen und Flächen umgerechnet. Das Feld wird aus der Kalibrierung der Datei vorbelegt, sofern vorhanden. Ohne brauchbaren Wert wird in Pixeln exportiert — prüfen Sie also die Einheiten in den Spaltenüberschriften.',
      howToExport: 'So exportieren Sie',
      exportSteps: {
        step1: 'Öffnen Sie das Projekt und klicken Sie auf Export',
        step2: 'Wählen Sie die einzuschließenden Bilder oder alle',
        step3:
          'Setzen Sie die Pixelgröße, wenn Sie Mikrometer möchten, und wählen Sie die Farben der Visualisierungen',
        step4: 'Haken Sie die benötigten Annotations- und Messwertformate an',
        step5: 'Starten Sie den Export — der Fortschritt wird live angezeigt',
        step6: 'Das ZIP lädt sich nach Fertigstellung selbst herunter',
      },
      exportNote: 'Eine fehlgeschlagene Teilstufe bricht den Export nicht ab.',
      exportNoteText:
        'Optionale Stufen enden mit einer Warnung, der Rest des Pakets entsteht trotzdem. Bei der Mikrotubuli-Intensität wird ein eingeschränkter Lauf zusätzlich im Paket selbst festgehalten — in metrics_status.json und am Anfang des Messwert-Leitfadens. Prüfen Sie das, bevor Sie sich auf ein Blatt verlassen.',
    },

    // Automatisierte Assays
    automatedEssays: {
      title: 'Automatisierte Assays',
      description:
        'Ein Stapel-Assay für Mikrotubuli außerhalb des Projektsystems. Laden Sie einen Ordner mit Nikon-ND2-Aufnahmen von Vertiefungen hoch und erhalten Sie eine Zeile je Filament: Länge, Intensität entlang des Filaments und dessen lokaler Hintergrund.',
      howTo: 'Einen Stapel starten',
      steps: {
        step1:
          'Öffnen Sie Automatisierte Assays über das Menü unter Ihrem Profilbild',
        step2:
          'Ziehen Sie den Ordner mit den .nd2-Dateien auf die Seite oder nutzen Sie die Schaltfläche zur Ordnerauswahl',
        step3:
          'Warten Sie — Aufträge laufen nacheinander, und die Liste aktualisiert sich selbst, solange etwas läuft',
        step4:
          'Laden Sie das ZIP herunter, oder verarbeiten Sie dieselben Dateien mit „Erneut ausführen“ ohne zweites Hochladen',
      },
      results: 'Was Sie zurückbekommen',
      resultsList: {
        csv: 'results.csv — eine Zeile je Mikrotubulus mit Länge, Intensität entlang des Filaments und dessen Hintergrund',
        failures:
          'failures.csv — jede Vertiefung oder Position, die nicht erzeugt werden konnte, und warum. Sie wird immer geschrieben, auch wenn sie leer ist',
        overlays:
          'Zwei Überlagerungsbilder je Position: eines prüft die Segmentierung gegen ihre eigene Eingabe, das andere das Messband gegen das Signal',
        annotations:
          'Eine JSON-Datei je Position mit den verfolgten Mittellinien und ihren Längen',
      },
      channelNote: 'IRM wird segmentiert, Fluoreszenz wird gemessen.',
      channelNoteText:
        'Das Modell wurde auf IRM trainiert, daher werden die Filamente dort verfolgt und der Fluoreszenzkanal nur entlang dieser Spuren gelesen. Eine Datei ohne IRM-Kanal wird als Fehler gemeldet statt aus etwas anderem segmentiert.',
      retentionNote: 'Uploads werden aufgeräumt, Ergebnisse nicht.',
      retentionNoteText:
        'Eingabedateien werden entfernt, sobald ein Lauf sauber durchläuft, und eine Woche aufbewahrt, wenn nicht — genau der Lauf, den Sie wiederholen möchten. Das Ergebnis bleibt, bis Sie den Auftrag löschen.',
    },

    // Segmenter
    segmenter: {
      title: 'Segmenter',
      description:
        'Ein eigenständiges Werkzeug zur Polygonannotation mit eigenen Datensätzen und einer eigenen Klassenpalette, getrennt von Projekten und vom Segmentierungseditor.',
      features: {
        datasets:
          'Legen Sie Datensätze an und laden Sie Einzelbilder hinein; sie sind nur für Sie sichtbar.',
        classes:
          'Definieren Sie eigene Klassen mit Namen und Farben. Beim Löschen einer Klasse bleiben ihre Polygone erhalten und verlieren nur die Zuordnung.',
        polygons:
          'Zeichnen, bearbeiten und löschen Sie geschlossene Polygone und weisen Sie ihnen Klassen zu. Überlappende Polygone werden vollständig unterstützt.',
        saving:
          'Gespeichert wird ausdrücklich — Schaltfläche oder Strg+S — und gesperrt, wenn die vorhandene Annotation nicht geladen werden konnte, damit eine leere Zeichenfläche niemals echte Arbeit überschreibt.',
      },
      scopeNote: 'Vorerst nur manuelle Annotation.',
      scopeNoteText:
        'Der Segmenter enthält noch kein maschinelles Lernen: keine Vorannotation, kein Active Learning, kein Export. Erreichbar ist er unter /segmenter.',
    },

    // Freigabe
    sharedProjects: {
      title: 'Freigabe und Zusammenarbeit',
      description:
        'Geben Sie ein Projekt per E-Mail oder Link an Kolleginnen und Kollegen frei. Nach dem Annehmen erscheint es in deren eigenem Dashboard.',
      sharingFeatures: 'Was die Freigabe erlaubt',
      features: {
        collaborative:
          'Gemeinsamer Zugriff: Mitarbeitende können ansehen, Annotationen bearbeiten, segmentieren, exportieren und das Projekt als geprüft markieren',
        emailInvite:
          'E-Mail-Einladungen: Die Freigabe wirkt unabhängig davon, ob die E-Mail ankommt — die Zustellung kann einige Minuten dauern',
        linkShare:
          'Link-Freigaben: Der Link bindet sich an denjenigen, der ihn annimmt, optional mit Ablaufdatum',
        revokeAccess: 'Jederzeit widerrufbar, mit sofortiger Wirkung',
        multipleCollaborators:
          'Beliebig viele Mitarbeitende, die das Projekt jeweils in ihre eigenen Ordner einsortieren',
      },
      howToShare: 'So geben Sie frei',
      shareSteps: {
        step1: 'Öffnen Sie das Projekt, das Sie freigeben möchten',
        step2: 'Klicken Sie in der Projektleiste auf Freigeben',
        step3: 'Geben Sie die E-Mail-Adresse ein oder erzeugen Sie einen Link',
        step4: 'Senden Sie die Einladung',
        step5:
          'Im selben Dialog verwalten oder widerrufen Sie Freigaben; jede zeigt ihren Status',
      },
      permissionsNote:
        'Die Freigabe dient der Zusammenarbeit, nicht nur dem Lesen.',
      permissionsNoteText:
        'Mitarbeitende können Annotationen ändern, und bei einem Video haben ihre Änderungen dieselben bildübergreifenden Folgen wie Ihre. Nur die Eigentümerin oder der Eigentümer kann ein Projekt umbenennen, seinen Typ ändern, es weitergeben oder löschen.',
    },

    // Fehlerbehebung
    troubleshooting: {
      title: 'Fehlerbehebung',
      description:
        'Die Probleme, auf die man tatsächlich stößt, und woran sie liegen.',
      table: {
        symptom: 'Symptom',
        cause: 'Ursache und Abhilfe',
      },
      items: {
        uploadRejected: {
          symptom: 'Eine Datei wird schon vor dem Hochladen abgelehnt',
          cause:
            'Einzelbilder sind auf 20 MB begrenzt. Ein größeres TIFF gilt als Stapel und fällt unter die 100-GB-Grenze. Kanalnamen mit mehr als 64 Zeichen werden abgelehnt — exportieren Sie mit kürzeren Bezeichnungen neu.',
        },
        darkFrames: {
          symptom: 'Bilder wirken fast schwarz',
          cause:
            'Daten mit hoher Bittiefe brauchen ein Fenster. Nutzen Sie die Regler Min und Max für diesen Kanal; jeder Kanal hat sein eigenes Fenster.',
        },
        noDetections: {
          symptom: 'Das Modell findet sehr wenig',
          cause:
            'Prüfen Sie zuerst Kontrast und Projekttyp. Senken Sie den Konfidenzschwellwert nur dort, wo er einstellbar ist — das Mikrotubuli-Modell ignoriert ihn absichtlich.',
        },
        wrongChannel: {
          symptom: 'Viele Formen, aber sie folgen nichts im Bild',
          cause:
            'Es wird der falsche Kanal segmentiert. Legen Sie die Segmentierungsquelle in der Kanalliste ausdrücklich fest; das Mikrotubuli-Modell funktioniert nur mit IRM.',
        },
        colorsChange: {
          symptom: 'Objektfarben wechseln zwischen Einzelbildern',
          cause:
            'Das bildübergreifende Tracking ist für diesen Container nicht durchgelaufen. Farben folgen der Track-Identität, ein ungetracktes Bild bekommt daher neue.',
        },
        exportSlow: {
          symptom: 'Ein Export bleibt bei 95 % stehen',
          cause:
            'Das ist die Kompressionsstufe. Bei einem großen Projekt, besonders mit Kymografen, dauert sie tatsächlich eine Weile.',
        },
        lostEdits: {
          symptom: 'Änderungen sind verschwunden',
          cause:
            'Eine erneute Segmentierung ersetzt die Segmentierung des Bildes, und ein Klick in der Brotkrumennavigation wechselt, bevor das Speichern im Hintergrund zwingend abgeschlossen ist. Drücken Sie vor dem Verlassen Strg+S.',
        },
      },
      helpNote: 'Immer noch nicht gelöst?',
      helpNoteText:
        'Nutzen Sie die Feedback-Schaltfläche für einen Fehlerbericht oder Wunsch — er erreicht die Betreuer direkt.',
    },

    // Fußzeilennavigation
    footer: {
      backToHome: 'Zurück zur Startseite',
      backToTop: 'Nach oben',
    },
  },
  legal: {
    terms: {
      title: 'Nutzungsbedingungen',
      lastUpdated: 'Zuletzt aktualisiert: Januar 2025',
      disclaimer:
        'Durch die Nutzung von SpheroSeg stimmen Sie diesen Bedingungen zu. Bitte lesen Sie sie sorgfältig.',
      sections: {
        acceptance: {
          title: '1. Annahme der Bedingungen',
          content:
            'Durch den Zugriff auf oder die Nutzung von SpheroSeg ("der Dienst") stimmen Sie zu, an diese Nutzungsbedingungen ("Bedingungen") und alle anwendbaren Gesetze und Vorschriften gebunden zu sein. Wenn Sie mit diesen Bedingungen nicht einverstanden sind, ist Ihnen die Nutzung dieses Dienstes untersagt. Diese Bedingungen stellen eine rechtlich bindende Vereinbarung zwischen Ihnen und SpheroSeg dar.',
        },
        useLicense: {
          title: '2. Nutzungslizenz und Erlaubte Nutzung',
          content:
            'Die Berechtigung zur Nutzung von SpheroSeg wird gewährt für:',
          permittedUses: [
            'Persönliche, nicht-kommerzielle Forschungszwecke',
            'Akademische und Bildungsforschung',
            'Wissenschaftliche Publikationen und Studien',
            'Biomedizinische Forschung und Analyse',
          ],
          licenseNote:
            'Dies ist die Gewährung einer Lizenz, nicht eine Eigentumsübertragung. Sie dürfen den Dienst nicht für kommerzielle Zwecke ohne ausdrückliche schriftliche Zustimmung nutzen.',
        },
        dataUsage: {
          title: '3. Datennutzung und Maschinelles Lernen',
          importantTitle: 'Wichtig: Verwendung Ihrer Daten',
          importantContent:
            'Durch das Hochladen von Bildern und Daten zu SpheroSeg stimmen Sie zu, dass wir diese Daten verwenden, um unsere maschinellen Lernmodelle für bessere Segmentierungsgenauigkeit zu verbessern und zu trainieren.',
          ownershipTitle: 'Dateneigentum:',
          ownershipContent:
            'Sie behalten das Eigentum an allen Daten, die Sie zu SpheroSeg hochladen. Durch die Nutzung unseres Dienstes gewähren Sie uns jedoch die Berechtigung zu:',
          permissions: [
            'Verarbeitung Ihrer Bilder für Segmentierungsanalyse',
            'Verwendung hochgeladener Daten (in anonymisierter Form) zur Verbesserung unserer ML-Algorithmen',
            'Verbesserung der Modellgenauigkeit durch kontinuierliches Lernen',
            'Entwicklung neuer Funktionen und Segmentierungsfähigkeiten',
          ],
          protectionNote:
            'Alle für ML-Training verwendeten Daten werden anonymisiert und von identifizierenden Informationen befreit. Wir teilen Ihre Rohdaten nicht ohne ausdrückliche Zustimmung mit Dritten.',
        },
        userResponsibilities: {
          title: '4. Benutzerpflichten',
          content: 'Sie verpflichten sich:',
          responsibilities: [
            'Den Dienst nur für rechtmäßige Zwecke zu nutzen',
            'Rechte des geistigen Eigentums zu respektieren',
            'Nicht zu versuchen, den Dienst rückzuentwickeln oder zu kompromittieren',
            'Bei der Kontoerstellung genaue Informationen anzugeben',
            'Die Sicherheit Ihrer Kontoanmeldedaten zu wahren',
          ],
        },
        serviceAvailability: {
          title: '5. Dienstverfügbarkeit und Einschränkungen',
          content:
            'Obwohl wir uns bemühen, kontinuierliche Dienstverfügbarkeit aufrechtzuerhalten, wird SpheroSeg "wie besehen" ohne Garantien jeglicher Art bereitgestellt. Wir garantieren keinen ununterbrochenen Zugang, und der Dienst kann Wartung, Updates oder vorübergehender Nichtverfügbarkeit unterliegen.',
        },
        limitationLiability: {
          title: '6. Haftungsbeschränkung',
          content:
            'In keinem Fall haften SpheroSeg, seine Entwickler oder verbundene Unternehmen für indirekte, zufällige, besondere, Folge- oder Strafschäden, einschließlich, aber nicht beschränkt auf Datenverlust, Gewinne oder Geschäftsmöglichkeiten, die aus Ihrer Nutzung des Dienstes entstehen.',
        },
        privacy: {
          title: '7. Datenschutz und Datenschutz',
          content:
            'Ihre Privatsphäre ist uns wichtig. Bitte lesen Sie unsere Datenschutzrichtlinie, die regelt, wie wir Ihre persönlichen Informationen und Forschungsdaten sammeln, verwenden und schützen.',
        },
        changes: {
          title: '8. Änderungen der Bedingungen',
          content:
            'Wir behalten uns das Recht vor, diese Bedingungen jederzeit zu ändern. Änderungen werden sofort nach Veröffentlichung wirksam. Ihre weitere Nutzung des Dienstes stellt die Annahme der geänderten Bedingungen dar.',
        },
        termination: {
          title: '9. Kündigung',
          content:
            'Jede Partei kann diese Vereinbarung jederzeit kündigen. Nach Kündigung erlischt Ihr Recht auf Zugang zum Dienst sofort, obwohl diese Bedingungen bezüglich der vorherigen Nutzung in Kraft bleiben.',
        },
        governingLaw: {
          title: '10. Anwendbares Recht',
          content:
            'Diese Bedingungen unterliegen und werden in Übereinstimmung mit geltendem Recht ausgelegt. Alle Streitigkeiten werden durch bindende Schiedsgerichtsbarkeit oder vor zuständigen Gerichten beigelegt.',
        },
      },
      contact: {
        title: 'Kontaktinformationen:',
        content:
          'Wenn Sie Fragen zu diesen Bedingungen haben, kontaktieren Sie uns bitte unter prusek@utia.cas.cz',
      },
      navigation: {
        backToHome: 'Zurück zur Startseite',
        privacyPolicy: 'Datenschutzrichtlinie',
      },
    },
    privacy: {
      title: 'Datenschutzrichtlinie',
      lastUpdated: 'Zuletzt aktualisiert: Januar 2025',
      disclaimer:
        'Ihre Privatsphäre ist uns wichtig. Diese Richtlinie erklärt, wie wir Ihre Daten sammeln, verwenden und schützen.',
      sections: {
        introduction: {
          title: '1. Einführung',
          content:
            'Diese Datenschutzrichtlinie erklärt, wie SpheroSeg ("wir", "uns", "unser") Ihre Informationen sammelt, verwendet, schützt und teilt, wenn Sie unsere Plattform für Mikroskopie-Segmentierung und -Analyse nutzen. Durch die Nutzung unseres Dienstes stimmen Sie den in dieser Richtlinie beschriebenen Datenpraktiken zu.',
        },
        informationCollected: {
          title: '2. Informationen, die Wir Sammeln',
          content:
            'Wir sammeln Informationen, die Sie uns direkt bereitstellen, wenn Sie ein Konto erstellen, Bilder hochladen, Projekte erstellen und mit unseren Diensten interagieren.',
          personalInfo: {
            title: '2.1 Persönliche Informationen',
            items: [
              'Name und E-Mail-Adresse',
              'Institutionelle oder organisatorische Zugehörigkeit',
              'Kontoanmeldedaten und Präferenzen',
              'Kontaktinformationen für Support-Anfragen',
            ],
          },
          researchData: {
            title: '2.2 Forschungsdaten und Bilder',
            ownershipTitle: 'Ihre Forschungsdaten',
            ownershipContent:
              'Sie behalten das vollständige Eigentum an allen Bildern und Forschungsdaten, die Sie zu SpheroSeg hochladen. Wir beanspruchen niemals das Eigentum an Ihren Inhalten.',
            items: [
              'Bilder, die Sie zur Analyse hochladen',
              'Projekt-Metadaten und Einstellungen',
              'Segmentierungsergebnisse und Annotationen',
              'Analyseparameter und benutzerdefinierte Konfigurationen',
            ],
          },
          usageInfo: {
            title: '2.3 Nutzungsinformationen',
            items: [
              'Protokolldaten und Zugriffszeitstempel',
              'Geräteinformationen und Browser-Typ',
              'Nutzungsmuster und Feature-Interaktionen',
              'Leistungsmetriken und Fehlerberichte',
            ],
          },
        },
        mlTraining: {
          title: '3. Maschinelles Lernen und Datenverbesserung',
          importantTitle: 'Wichtig: Verwendung Ihrer Daten für KI-Training',
          importantIntro:
            'Um unsere Segmentierungsalgorithmen kontinuierlich zu verbessern, können wir hochgeladene Bilder und Daten verwenden, um unsere maschinellen Lernmodelle zu trainieren und zu verbessern.',
          controlTitle: 'Sie haben vollständige Kontrolle über Ihre Daten:',
          controlContent:
            'Bei der Kontoerstellung können Sie wählen, ob Sie die Verwendung Ihrer Daten für ML-Training zulassen. Sie können diese Präferenzen jederzeit ändern.',
          manageTitle: 'Um Ihre Zustimmung zu verwalten:',
          manageContent:
            'Gehen Sie zu Einstellungen → Datenschutz-Tab in Ihrem Dashboard. Dort können Sie die ML-Training-Zustimmung aktivieren oder deaktivieren und spezifische Zwecke (Algorithmusverbesserung, Feature-Entwicklung) wählen, für die Ihre Daten verwendet werden können.',
          howWeUse: {
            title: 'Wie Wir Ihre Daten für ML Verwenden:',
            items: [
              'Modelltraining: Bilder werden verwendet, um Segmentierungsalgorithmen für bessere Genauigkeit zu trainieren',
              'Algorithmusverbesserung: Ihre Segmentierungskorrekturen helfen, die automatische Erkennung zu verbessern',
              'Feature-Entwicklung: Nutzungsmuster leiten die Entwicklung neuer Analysewerkzeuge',
              'Qualitätssicherung: Daten helfen, neue Modellversionen zu validieren und zu testen',
            ],
          },
          protection: {
            title: 'Datenschutz im ML-Training:',
            items: [
              'Anonymisierung: Alle Daten werden vor der Verwendung im ML-Training anonymisiert',
              'Metadaten-Entfernung: Persönliche und institutionelle identifizierende Informationen werden entfernt',
              'Sichere Verarbeitung: Training erfolgt in sicheren, isolierten Umgebungen',
              'Keine Rohdatenverteilung: Ihre ursprünglichen Bilder werden niemals mit Dritten geteilt',
            ],
          },
        },
        howWeUse: {
          title: '4. Wie Wir Ihre Informationen Verwenden',
          content: 'Wir verwenden gesammelte Informationen für:',
          purposes: [
            'Bereitstellung und Wartung von Segmentierungsdiensten',
            'Verarbeitung Ihrer Bilder und Generierung von Analyseergebnissen',
            'Verbesserung unserer Algorithmen und Entwicklung neuer Funktionen',
            'Kommunikation mit Ihnen über Ihr Konto und Updates',
            'Bereitstellung technischer Unterstützung und Fehlerbehebung',
            'Erfüllung rechtlicher Verpflichtungen und Schutz unserer Rechte',
          ],
        },
        dataSecurity: {
          title: '5. Datensicherheit und -schutz',
          content:
            'Wir implementieren robuste Sicherheitsmaßnahmen einschließlich:',
          measures: [
            'Verschlüsselung von Daten in Transit und Ruhe',
            'Regelmäßige Sicherheitsaudits und Schwachstellenbewertungen',
            'Zugriffskontrollen und Authentifizierungssysteme',
            'Sichere Backup- und Disaster-Recovery-Verfahren',
            'Mitarbeitersicherheitsschulung und Zugriffsbeschränkungen',
          ],
        },
        dataSharing: {
          title: '6. Datenaustausch und Dritte',
          noSaleStatement:
            'Wir verkaufen Ihre persönlichen Informationen oder Forschungsdaten nicht.',
          sharingContent:
            'Wir können Informationen nur unter diesen begrenzten Umständen teilen:',
          circumstances: [
            'Mit Ihrer ausdrücklichen Zustimmung',
            'Zur Erfüllung rechtlicher Verpflichtungen oder Gerichtsbeschlüsse',
            'Mit vertrauenswürdigen Dienstleistern, die beim Betrieb unserer Plattform helfen (unter strengen Vertraulichkeitsvereinbarungen)',
            'Zum Schutz unserer Rechte, Sicherheit oder Eigentum',
            'In anonymisierter, aggregierter Form für Forschungsveröffentlichungen (mit Ihrer Zustimmung)',
          ],
        },
        privacyRights: {
          title: '7. Ihre Datenschutzrechte und Wahlmöglichkeiten',
          content: 'Sie haben das Recht auf:',
          rights: [
            'Zugang: Kopien Ihrer persönlichen Daten und Forschungsinhalte anfordern',
            'Berichtigung: Ungenaue Informationen aktualisieren oder korrigieren',
            'Löschung: Löschung Ihres Kontos und zugehöriger Daten anfordern',
            'Portabilität: Ihre Daten in einem maschinenlesbaren Format exportieren',
            'Opt-out: Ausschluss vom ML-Training anfordern. Hinweis: Dies kann folgende Funktionen einschränken: automatische Segmentierungsgenauigkeit, personalisierte Modellempfehlungen, adaptive Schwellenwertvorschläge, Batch-Verarbeitungsoptimierungen und zukünftige KI-gestützte Verbesserungen. Kontaktieren Sie den Support für spezifische Auswirkungen auf Ihr Konto.',
            'Einschränkung: Begrenzen, wie wir Ihre Informationen verarbeiten',
          ],
          contactNote:
            'Um diese Rechte auszuüben, kontaktieren Sie uns unter prusek@utia.cas.cz. Wir werden innerhalb von 30 Tagen antworten.',
        },
        dataRetention: {
          title: '8. Datenspeicherung',
          content:
            'Wir unterscheiden zwischen persönlichen Daten und ML-Trainingsdaten:',
          categories: [
            'Persönliche/Kontodaten: Alle persönlichen Identifikatoren, Profilinformationen, Kontoeinstellungen und Transaktionshistorie werden innerhalb von 90 Tagen nach Kontoschluss dauerhaft gelöscht.',
            'Forschungsdaten: Ursprüngliche Bilder und Projektdaten, die mit Ihrem Konto verknüpft sind, werden innerhalb von 90 Tagen nach Kontoschluss gelöscht.',
            'ML-Trainingsdaten: Für ML-Training verwendete Daten werden zunächst anonymisiert/pseudonymisiert, um alle persönlichen Identifikatoren zu entfernen. Diese anonymisierten Daten können unbegrenzt aufbewahrt werden, um Modellverbesserungen zu bewahren, es sei denn, Sie schließen sich spezifisch vom ML-Training aus oder fordern vollständige Löschung an.',
            'Opt-out-Optionen: Sie können vollständige Löschung aller Daten, einschließlich anonymisierter ML-Trainingsdaten, durch Kontaktierung von prusek@utia.cas.cz anfordern. Die Bearbeitungszeit beträgt typischerweise 30 Tage.',
          ],
        },
        internationalTransfers: {
          title: '9. Internationale Datenübertragungen',
          content:
            'Ihre Daten können in anderen Ländern als Ihrem eigenen verarbeitet werden. Wir sorgen für angemessene Schutzmaßnahmen und Schutz für internationale Übertragungen, einschließlich standardisierter Vertragsklauseln und Angemessenheitsentscheidungen.',
        },
        childrensPrivacy: {
          title: '10. Kinderdatenschutz',
          content:
            'Unser Dienst ist für Forscher bestimmt und richtet sich nicht an Kinder unter 16 Jahren. Wir sammeln wissentlich keine persönlichen Informationen von Kindern unter 16 Jahren. Wenn wir eine solche Sammlung entdecken, werden wir die Informationen umgehend löschen.',
        },
        policyChanges: {
          title: '11. Änderungen an Dieser Richtlinie',
          content:
            'Wir können diese Datenschutzrichtlinie aktualisieren, um Änderungen in unseren Praktiken oder rechtlichen Anforderungen widerzuspiegeln. Wir werden Sie über wesentliche Änderungen per E-Mail oder prominenten Hinweis auf unserer Website informieren. Fortgesetzte Nutzung stellt Annahme aktualisierter Bedingungen dar.',
        },
        contact: {
          title: '12. Kontaktinformationen',
          dpo: 'Datenschutzbeauftragter: prusek@utia.cas.cz',
          general: 'Allgemeine Anfragen: prusek@utia.cas.cz',
          postal: 'Postadresse:',
          address: {
            line1: 'ÚTIA AV ČR',
            line2: 'Pod Vodárenskou věží 4',
            line3: '182 08 Prag 8',
            line4: 'Tschechische Republik',
          },
        },
      },
      navigation: {
        backToHome: 'Zurück zur Startseite',
        termsOfService: 'Nutzungsbedingungen',
      },
    },
  },
  contextMenu: {
    propagateSelectedTracks: 'Ausgewählte Mikrotubuli übertragen ({{count}})',
    confirmPropagateSelected: '{{count}} ausgewählte Mikrotubuli übertragen?',
    propagateSelectedDescription:
      'Dies überschreibt die Form von {{count}} ausgewählten Mikrotubuli in allen folgenden Frames des Videos. Dies kann nicht rückgängig gemacht werden.',
    propagateTrack: 'In folgende Frames übertragen',
    confirmPropagateTrack: 'In folgende Frames übertragen?',
    propagateTrackDescription:
      'Dies überschreibt die Form dieses Mikrotubulus in allen folgenden Frames des Videos. Dies kann nicht rückgängig gemacht werden.',
    deleteTrack: 'Ganzen Track löschen',
    confirmDeleteTrack: 'Den gesamten Mikrotubulus-Track löschen?',
    deleteTrackDescription:
      'Dies entfernt diesen Mikrotubulus aus allen {{count}} Frames des Videos. Dies kann nicht rückgängig gemacht werden.',
    editPolygon: 'Polygon bearbeiten',
    splitPolygon: 'Polygon teilen',
    deletePolygon: 'Polygon löschen',
    confirmDeletePolygon:
      'Sind Sie sicher, dass Sie dieses Polygon löschen möchten?',
    deletePolygonDescription:
      'Diese Aktion ist unumkehrbar. Das Polygon wird dauerhaft aus der Segmentierung entfernt.',
    duplicateVertex: 'Eckpunkt duplizieren',
    deleteVertex: 'Eckpunkt löschen',
    editPolyline: 'Polylinie bearbeiten',
    deletePolyline: 'Polylinie löschen',
  },
  websocket: {
    reconnecting: 'Verbinde erneut mit Server...',
    reconnected: 'Verbindung zum Server wiederhergestellt',
    connected: 'Mit Echtzeit-Updates verbunden',
    disconnected: 'Von Echtzeit-Updates getrennt',
  },
  metrics: {
    info: 'Metriken werden nur für externe Polygone ausgewertet. Flächen interner Polygone (Löcher) werden automatisch von den entsprechenden externen Polygonen abgezogen.',
    spheroid: 'Sphäroid',
    area: 'Fläche',
    perimeter: 'Umfang',
    equivalentDiameter: 'Äquivalenter Durchmesser',
    circularity: 'Zirkularität',
    feretMax: 'Feret Maximum',
    feretMin: 'Feret Minimum',
    compactness: 'Kompaktheit',
    convexity: 'Konvexität',
    solidity: 'Festigkeit',
    sphericity: 'Sphärizität',
    feretAspectRatio: 'Feret-Seitenverhältnis',
    disintegrationIndex: 'Zerfallsindex',
    wassersteinW1: 'Wasserstein W1',
    referenceMode: 'Referenzmodus',
    totalSpheroidArea: 'Gesamtfläche der Sphäroide',
    coreArea: 'Kernfläche',
    invasionArea: 'Invasionsfläche',
    noPolygonsFound: 'Keine Polygone zur Analyse gefunden',
  },
  keyboardShortcuts: {
    title: 'Tastaturkürzel',
    buttonLabel: 'Kürzel',
    viewMode: 'Ansichtsmodus',
    editVertices: 'Eckpunkt-Bearbeitungsmodus',
    addPoints: 'Punkte-Hinzufügen-Modus',
    createPolygon: 'Neues Polygon erstellen',
    sliceMode: 'Schnittmodus',
    deleteMode: 'Löschmodus',
    holdToAutoAdd: 'Halten für automatisches Hinzufügen von Punkten',
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    deleteSelected: 'Ausgewähltes Polygon löschen',
    cancelOperation: 'Aktuelle Operation abbrechen',
    zoomIn: 'Hineinzoomen',
    zoomOut: 'Herauszoomen',
    resetView: 'Ansicht zurücksetzen',
    helperText:
      'Diese Kürzel funktionieren im Segmentierungseditor für schnellere und bequemere Arbeit.',
  },
  accessibility: {
    toggleSidebar: 'Seitenleiste umschalten',
    toggleMenu: 'Menü umschalten',
    selectLanguage: 'Sprache auswählen',
    selectTheme: 'Theme auswählen',
    breadcrumb: 'Brotkrümel-Navigation',
    pagination: 'Seitennummerierung',
    close: 'Schließen',
    more: 'Mehr',
    goToPreviousPage: 'Zur vorherigen Seite gehen',
    goToNextPage: 'Zur nächsten Seite gehen',
    previousPage: 'Vorherige',
    nextPage: 'Nächste',
    morePages: 'Weitere Seiten',
    previousSlide: 'Vorherige Folie',
    nextSlide: 'Nächste Folie',
    gridView: 'Rasteransicht',
    listView: 'Listenansicht',
  },
  sharing: {
    processingInvitation: 'Einladung wird verarbeitet...',
    share: 'Teilen',
    shared: 'Geteilt',
    shareProject: 'Projekt teilen',
    shareDescription:
      'Projekt "{{title}}" mit Kollegen und Mitarbeitern teilen',
    shareByEmail: 'Per E-Mail teilen',
    shareByLink: 'Per Link teilen',
    emailAddress: 'E-Mail-Adresse',
    enterEmailPlaceholder: 'E-Mail-Adresse eingeben',
    sendInvitation: 'Einladung senden',
    sending: 'Wird gesendet...',
    emailSent: 'E-Mail-Einladung gesendet!',
    emailRequired: 'E-Mail-Adresse ist erforderlich',
    emailShareFailed: 'Fehler beim Senden der E-Mail-Einladung',
    linkExpiry: 'Link-Ablauf',
    neverExpires: 'Läuft nie ab',
    hours: 'Stunden',
    days: 'Tage',
    generateLink: 'Link generieren',
    linkCopied: 'Link in die Zwischenablage kopiert!',
    sharedWithYou: 'Mit Ihnen geteilt',
    sharedBy: 'Geteilt von: {{email}}',
    sharedProjects: 'Geteilte Projekte',
    noSharedProjects: 'Es wurden keine Projekte mit Ihnen geteilt',
    removeFromShared: 'Aus Geteilten entfernen',
    acceptInvitation: 'Einladung annehmen',
    invitationAccepted:
      'Einladung angenommen! Das Projekt wurde zu Ihrem Dashboard hinzugefügt.',
    generating: 'Generiere...',
    linkGenerated: 'Freigabe-Link erstellt!',
    linkCopyFailed: 'Link konnte nicht kopiert werden',
    linkShareFailed: 'Freigabe-Link konnte nicht generiert werden',
    emailInvitations: 'E-Mail-Einladungen',
    shareLinks: 'Freigabe-Links',
    shareRevoked: 'Freigabe wurde widerrufen',
    acceptedUsers: 'Akzeptierte Benutzer',
    pendingInvitations: 'Ausstehende Einladungen',
    joinedViaLink: 'Über Link beigetreten',
    activeShareLinks: 'Aktive Freigabe-Links',
    joinedOn: 'Beigetreten am',
    sentOn: 'Gesendet am',
    joinedViaLinkOn: 'Beigetreten am',
    resendInvitation: 'Einladung erneut senden',
    invitationResent: 'Einladung erfolgreich erneut gesendet',
    resendFailed: 'Erneutes Senden der Einladung fehlgeschlagen',
    revokeAccess: 'Zugriff widerrufen',
    cancelInvitation: 'Einladung stornieren',
    revokeShareFailed: 'Widerrufen der Freigabe fehlgeschlagen',
    failedToLoadShares: 'Laden der Freigaben fehlgeschlagen',
    status: {
      pending: 'Ausstehend',
      accepted: 'Akzeptiert',
      revoked: 'Widerrufen',
    },
    invitationExpired: 'Diese Einladung ist abgelaufen',
    invitationInvalid: 'Ungültige Einladung',
    loginToAccept: 'Bitte melden Sie sich an, um diese Einladung anzunehmen',
    accepting: 'Akzeptiere',
    redirectingToProject: 'Weiterleitung zum Projekt',
    invitedEmail: 'Eingeladene E-Mail',
    loadingShare: 'Lade Freigabeinformationen...',
    projectSharedBy: 'Projekt geteilt von',
    signInRequired: 'Anmeldung erforderlich',
    signInToAccept: 'Bitte melden Sie sich an, um diese Einladung anzunehmen',
    signInButton: 'Anmelden',
    goToProject: 'Zum Projekt',
    backToHome: 'Zurück zur Startseite',
    acceptFailed: 'Annahme der Einladung fehlgeschlagen',
    differentEmail: 'Diese Einladung ist für eine andere E-Mail-Adresse',
  },
  error: 'Fehler',
  segmentationEditor: {
    reloadingSegmentation: 'Segmentierung wird neu geladen...',
    loadingFrame: 'Frame wird geladen...',
    segmenting: 'Segmentierung läuft...',
    waitingInQueue: 'Warten in der Warteschlange...',
    retryingLoad: 'Ladeprobleme. Neuer Versuch...',
    error: {
      title: 'Segmentierungsfehler',
      description:
        'Beim Laden der Segmentierungsdaten ist ein Fehler aufgetreten. Dies könnte auf Netzwerkprobleme oder Serverprobleme zurückzuführen sein.',
      errorDetails: 'Fehlerdetails',
      tryAgain: 'Erneut versuchen',
      unsavedChanges: 'Ungespeicherte Änderungen',
      imageLoadFailed:
        'Bild konnte nicht geladen werden. Bitte aktualisieren Sie die Seite und versuchen Sie es erneut.',
    },
    export: {
      exportAllMetrics: 'Alle Metriken als XLSX exportieren',
      exportUnavailable: 'Export nicht verfügbar',
      loading: 'Laden...',
    },
  },
  footer: {
    appName: 'SpheroSeg',
    description:
      'Plattform für Segmentierung und Analyse mikroskopischer Aufnahmen für biomedizinische Forscher — Sphäroide, Wundheilung, Spermien, Mikrokapseln und Mikrotubuli, mit KI-gestützten Werkzeugen vom Bild bis zur Messung.',
    contact: 'Kontakt',
    institution: 'Institution',
    institutionName: 'ÚTIA AV ČR',
    address: 'Adresse',
    addressText: 'Pod Vodárenskou věží 4, 182 08 Prag 8',
    resources: 'Ressourcen',
    documentation: 'Dokumentation',
    features: 'Funktionen',
    tutorials: 'Tutorials',
    research: 'Forschung',
    legal: 'Rechtliches',
    termsOfService: 'Nutzungsbedingungen',
    privacyPolicy: 'Datenschutzrichtlinie',
    contactUs: 'Kontaktieren Sie uns',
    developedAt: 'Entwickelt am',
    designBy: 'Design von',
  },
  microtubule: {
    instancePanel: 'Mikrotubuli-Instanzen',
    instance: 'Mikrotubulus',
    hideInstance: 'Mikrotubulus ausblenden',
    showInstance: 'Mikrotubulus einblenden',
    renameInstance: 'Mikrotubulus umbenennen',
    hideAll: 'Alle ausblenden',
    showAll: 'Alle einblenden',
    type: {
      set: 'Typ festlegen',
      setForSelected: 'Typ für {{count}} ausgewählte festlegen',
      none: 'Keiner',
      newLabel: 'Neues Label…',
      renameLabel: 'Label umbenennen',
      deleteLabel: 'Label löschen',
      manageLabels: 'Typ-Labels',
      labelName: 'Name',
      labelNamePlaceholder: 'z. B. Alpha-Tubulin',
      labelColor: 'Farbe',
      labelDialogDescription:
        'Benennen Sie den Tubulin-Typ und wählen Sie eine Farbe.',
      updated: 'Mikrotubulus-Typ aktualisiert',
      updateFailed: 'Mikrotubulus-Typ konnte nicht aktualisiert werden',
      createFailed: 'Label konnte nicht erstellt werden',
      renameFailed: 'Label konnte nicht umbenannt werden',
      deleteFailed: 'Label konnte nicht gelöscht werden',
      loadFailed: 'Typ-Labels konnten nicht geladen werden',
      duplicateName: 'Ein Label mit diesem Namen existiert bereits',
    },
    color: {
      label: 'Farbe:',
      byInstance: 'Instanz',
      byLabel: 'Label',
    },
  },
  sperm: {
    instancePanel: 'Spermien-Instanzen',
    instance: 'Spermium',
    newInstance: 'Neue Instanz',
    unassigned: 'Nicht zugewiesen',
    unclassified: 'Nicht klassifiziert',
    part: {
      head: 'Kopf',
      midpiece: 'Mittelstück',
      tail: 'Schwanz',
    },
    setAsHead: 'Als Kopf festlegen',
    setAsMidpiece: 'Als Mittelstück festlegen',
    setAsTail: 'Als Schwanz festlegen',
    assignTo: 'Zuweisen zu',
    export: {
      description:
        'Spermien-Morphologiemessungen (Kopf-, Mittelstück- und Schwanzlängen) nach Excel exportieren.',
      calibration: 'Kalibrierungsfaktor',
      instances: 'Instanzen',
      polylines: 'Polylinien',
      button: 'Spermien-Metriken exportieren',
      failed: 'Export der Spermien-Metriken fehlgeschlagen',
    },
  },
  feedback: {
    buttonTitle: 'Feedback senden',
    buttonAriaLabel: 'Feedback-Formular öffnen',
    title: 'Feedback senden',
    subtitle:
      'Einen Fehler gefunden oder eine Idee? Schreiben Sie uns — wir lesen jeden Bericht.',
    typeBug: 'Fehlerbericht',
    typeFeature: 'Funktionsanfrage',
    titleLabel: 'Titel',
    titlePlaceholder: 'Kurze Zusammenfassung',
    bodyLabel: 'Details',
    bodyPlaceholder:
      'Schritte zur Reproduktion, was Sie erwartet haben, Screenshots wenn relevant...',
    submit: 'Senden',
    submittedSuccess: 'Danke! Ihr Feedback wurde gesendet.',
    submitFailed: 'Feedback konnte nicht gesendet werden',
    submittedNoEmail:
      'Danke! Ihr Feedback wurde gespeichert (E-Mail-Benachrichtigung steht aus).',
    attachmentStoreFailed:
      'Ihr Bericht wurde gesendet, aber die angehängte Datei konnte nicht gespeichert werden — bitte erneut anhängen.',
    attachmentPrompt:
      'Datei hierher ziehen oder klicken zum Auswählen — ein Screenshot oder das Video/ND2, um das es in Ihrem Bericht geht (bis zu 50 GB)',
    attachmentTooLarge: 'Datei zu groß — Limit ist 50 GB',
    attachmentInvalidType:
      'Nicht unterstützter Dateityp (nur Bild, Video oder ND2)',
    removeAttachment: 'Anhang entfernen',
    uploading: 'Hochladen…',
  },
  editor: {
    channelSwitcher: {
      title: 'Kanäle',
      detectionSource: 'Segmentierungsquelle',
    },
    kymograph: {
      title: 'Kymograph',
      sourceChannel: 'Quellkanal',
      tracked: '🔗 Über Frames hinweg verfolgt',
      untracked: '⚠ Statische Linie (keine Verfolgung)',
      computing: 'Kymograph wird berechnet…',
      downloadPng: 'PNG',
      downloadCsv: 'CSV',
      showKymograph: 'Kymograph anzeigen',
      axisTime: 'Zeit (Frames)',
      axisAlong: 'Entlang Mikrotubulus (px) →',
      zoomIn: 'Vergrößern',
      zoomOut: 'Verkleinern',
      fit: 'Einpassen',
      zoomHint: 'ziehen zum Verschieben · Rad zum Zoomen',
      empty: 'Kymograph konnte nicht berechnet werden.',
      velocityAnalysis: 'Geschwindigkeitsanalyse',
      widthLabel: 'Intensitätsbreite',
      widthHint:
        'Breite (px) des um jede Trajektorie abgetasteten Bandes für Signal vs. Hintergrundintensität.',
      colVelocity: 'Nettogeschwindigkeit',
      colRunLength: 'Lauflänge (µm)',
      colRunTime: 'Laufzeit (s)',
      colIntensity: 'Intensität (Signal−Hintergrund)',
      colEdge: 'Rand',
      colBright: 'Helligkeit',
      brightHint:
        'Intensitäts-Ausreißer — wahrscheinlich ein Multi-Motor-Aggregat, kein einzelner Motor.',
      colSnr: 'SNR',
      edge: {
        left: 'Erreicht das linke Ende (läuft über den Mikrotubulus hinaus)',
        right: 'Erreicht das rechte Ende (läuft über den Mikrotubulus hinaus)',
        both: 'Erreicht beide Enden',
        none: 'Bleibt innerhalb des Mikrotubulus',
      },
      noBlobs: 'Keine bewegten Partikel erkannt',
      velocityFailed: 'Geschwindigkeitserkennung fehlgeschlagen.',
      filteredHidden:
        '{{count}} nicht-prozessive Trajektorie(n) unter 0.01 µm/s ausgeblendet.',
      downloadTracks: 'Geschwindigkeits-CSV',
      uncalibrated:
        'Keine Pixelgröße-/Bildintervall-Kalibrierung — Geschwindigkeiten in px/Frame.',
    },
    channels: {
      toggleVisibility: 'Kanal-Sichtbarkeit umschalten',
      editColor: 'Farbe bearbeiten',
      opacity: 'Kanal-Deckkraft',
      renameHint: 'Doppelklick zum Umbenennen',
      renameFailed: 'Umbenennen fehlgeschlagen',
      renameTooLong: 'Name zu lang (max 128 Zeichen)',
      colorDialog: {
        title: 'Kanal-Farbe:',
        description:
          'Wählen Sie, wie dieser Kanal das zusammengesetzte Overlay einfärbt. Weiß lässt die zugrundeliegende Graustufe unverändert.',
        customLabel: 'Benutzerdefiniert',
      },
    },
    windowLevel: {
      title: 'Anzeige',
      channel: 'Kanal',
      min: 'Min',
      max: 'Max',
      brightness: 'Helligkeit',
      contrast: 'Kontrast',
      reset: 'Zurücksetzen',
    },
    frameNavigation: {
      frame: 'Bild',
      play: 'Abspielen',
      pause: 'Pause',
    },
  },

  folders: {
    folder: 'Ordner',
    home: 'Start',
    newFolder: 'Neuer Ordner',
    createFolder: 'Ordner erstellen',
    create: 'Erstellen',
    folderName: 'Ordnername',
    folderNamePlaceholder: 'z. B. Experiment A',
    rename: 'Umbenennen',
    renameFolder: 'Ordner umbenennen',
    deleteFolder: 'Ordner löschen',
    deleteFolderConfirm:
      'Ordner „{{name}}" löschen? {{projects}} Projekt(e) und {{subfolders}} Unterordner werden dauerhaft entfernt. {{shared}} geteilte Projekte kehren ins Stammverzeichnis zurück.',
    moveTo: 'Verschieben nach…',
    moveToRoot: 'Stamm (kein Ordner)',
    openFolder: 'Ordner {{name}} öffnen',
    empty: 'Leerer Ordner',
    created: 'Ordner erstellt',
    renamed: 'Ordner umbenannt',
    deleted: 'Ordner gelöscht',
    moved: 'Erfolgreich verschoben',
    moveSkipped: 'Verschieben übersprungen — kein Zugriff auf das Projekt',
    movePartial:
      '{{moved}} Projekt(e) verschoben; {{skipped}} übersprungen (kein Zugriff)',
    moveAllSkipped: '{{count}} Projekt(e) übersprungen — kein Zugriff',
    deletePartial:
      '{{deleted}} Projekt(e) gelöscht; {{failed}} fehlgeschlagen. Ordner behalten; bitte erneut versuchen.',
    duplicateName: 'Ein Ordner mit diesem Namen existiert hier bereits',
    cannotMoveIntoSelf:
      'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner verschoben werden',
  },
  automatedEssays: {
    rerun: 'Erneut ausführen',
    rerunHint:
      'Führt diesen Ordner erneut mit den bereits auf dem Server gespeicherten Dateien aus — kein erneutes Hochladen nötig.',
    rerunStarted: 'Der Lauf wurde erneut in die Warteschlange gestellt.',
    rerunFailed: 'Der Lauf konnte nicht erneut gestartet werden.',
    rerunConfirm:
      'Diesen Ordner erneut ausführen? Es werden die bereits auf dem Server gespeicherten Dateien verwendet.',
    rerunConfirmReplace:
      'Diesen Ordner erneut ausführen? Das aktuelle Ergebnis wird ersetzt — laden Sie es zuerst herunter, wenn Sie es behalten möchten.',
    navLabel: 'Automatisierte Assays',
    title: 'Automatisierte Assays',
    subtitle:
      'Laden Sie einen Ordner mit .nd2-Well-Aufnahmen hoch, um Länge und Intensität der Mikrotubuli für jedes Well zu messen.',
    dragFolder: 'Ziehen Sie einen Ordner mit .nd2-Wells hierher',
    dropHere: 'Ordner ablegen, um ihn hinzuzufügen',
    selectFolder: 'Ordner auswählen',
    onlyNd2: 'Es werden nur .nd2-Well-Aufnahmen verarbeitet.',
    filesSelected: '{{count}} .nd2-Datei(en) ausgewählt',
    clear: 'Leeren',
    uploadAndProcess: 'Hochladen & verarbeiten',
    uploading: 'Hochladen… {{percent}} %',
    jobStarted: 'Upload abgeschlossen – Verarbeitung gestartet',
    uploadFailed: 'Upload fehlgeschlagen',
    downloadFailed: 'Download konnte nicht gestartet werden',
    yourRuns: 'Ihre Läufe',
    noRuns: 'Noch keine Läufe. Laden Sie einen Ordner hoch, um zu beginnen.',
    fileCount: '{{count}} Datei(en)',
    mtCount: '{{count}} Mikrotubuli',
    deviceDegraded: 'CPU (GPU nicht verfügbar)',
    deviceDegradedHint:
      'Dieser Lauf sollte die GPU verwenden, konnte sie aber nicht erreichen, lief daher auf der CPU und dauerte wesentlich länger. Bitte melden Sie dies.',
    deviceBusy: 'CPU (GPU belegt)',
    deviceBusyHint:
      'Die gemeinsam genutzte GPU war während der gesamten Wartezeit belegt, daher lief dieser Durchlauf auf der CPU und dauerte länger. Es liegt kein Fehler vor, eine Meldung ist nicht nötig.',
    download: 'Herunterladen',
    delete: 'Löschen',
    deleteFailed: 'Der Lauf konnte nicht gelöscht werden',
    noNd2Found: 'In diesem Ordner wurden keine .nd2-Aufnahmen gefunden',
    someIgnored:
      'Verwende {{kept}} von {{total}} Dateien (nur .nd2 wird verarbeitet)',
    status: {
      queued: 'In Warteschlange',
      running: 'Verarbeitung',
      completed: 'Abgeschlossen',
      failed: 'Fehlgeschlagen',
    },
  },
  segmenter: {
    dashboard: {
      title: 'Segmentierer',
      subtitle: 'Few-Shot-Datensätze zur Polygon-Annotation mit Selbsttraining',
      newDataset: 'Neuer Datensatz',
      noDatasets: 'Noch keine Datensätze.',
      createFirst: 'Ersten Datensatz erstellen',
      deleteDataset: 'Datensatz löschen',
      imageCount: '{{count}} Bild(er)',
      createDialogTitle: 'Neuer Datensatz',
      createDialogDescription:
        'Datensätze gruppieren unbeschriftete Bilder, die Sie mit eigenen Klassen annotieren.',
      nameLabel: 'Name des Datensatzes',
      namePlaceholder: 'z. B. Zellkerne — Runde 1',
      creating: 'Wird erstellt…',
      create: 'Erstellen',
      deleteConfirmTitle: 'Datensatz löschen?',
      deleteConfirmDescription:
        'Dies löscht „{{name}}“ sowie alle zugehörigen Bilder, Klassen und Annotationen dauerhaft. Dies kann nicht rückgängig gemacht werden.',
      cancel: 'Abbrechen',
      deleting: 'Wird gelöscht…',
      delete: 'Löschen',
      loadFailed: 'Datensätze konnten nicht geladen werden',
      created: 'Datensatz erstellt',
      createFailed: 'Datensatz konnte nicht erstellt werden',
      deleted: 'Datensatz gelöscht',
      deleteFailed: 'Datensatz konnte nicht gelöscht werden',
    },
    datasetDetail: {
      backLabel: 'Zurück zu den Datensätzen',
      loading: 'Wird geladen…',
      imageCount: '{{count}} Bild(er)',
      noImages:
        'Noch keine Bilder. Ziehen Sie welche oben hinein, um zu beginnen.',
      annotated: 'Annotiert',
      deleteImage: 'Bild löschen',
      deleteConfirmTitle: 'Bild löschen?',
      deleteConfirmDescription:
        'Dies löscht „{{name}}“ und seine Annotation dauerhaft. Dies kann nicht rückgängig gemacht werden.',
      cancel: 'Abbrechen',
      deleting: 'Wird gelöscht…',
      delete: 'Löschen',
      loadFailed: 'Datensatz konnte nicht geladen werden',
      deleteFailed: 'Bild konnte nicht gelöscht werden',
    },
    upload: {
      skippedVideo:
        '{{count}} Datei(en) übersprungen — der Segmentierer akzeptiert nur statische Bilder',
      success: '{{count}} Bild(er) hochgeladen',
      partialFail:
        '{{uploaded}} hochgeladen, {{failed}} fehlgeschlagen — Format/Größe prüfen',
      failed: 'Upload fehlgeschlagen',
    },
    classes: {
      panelTitle: 'Klassen',
      newClass: 'Neue Klasse',
      loading: 'Klassen werden geladen…',
      empty:
        'Noch keine Klassen. Erstellen Sie eine, um mit dem Annotieren zu beginnen.',
      renameLabel: 'Klasse umbenennen',
      deleteLabel: 'Klasse löschen',
      unclassified: 'Nicht klassifiziert',
      unknown: 'Unbekannte Klasse',
      activeClass: 'Aktive Klasse',
      pickerEmpty: 'Noch keine Klassen — erstellen Sie vor dem Zeichnen eine.',
      dialogTitleCreate: 'Neue Klasse',
      dialogTitleRename: 'Klasse umbenennen',
      dialogDescription:
        'Geben Sie der Klasse einen Namen und eine Farbe, mit der ihre Polygone gezeichnet werden.',
      nameLabel: 'Klassenname',
      namePlaceholder: 'z. B. Zellkern',
      colorLabel: 'Farbe',
      cancel: 'Abbrechen',
      create: 'Erstellen',
      save: 'Speichern',
      loadFailed: 'Klassen konnten nicht geladen werden',
      createFailed: 'Klasse konnte nicht erstellt werden',
      nameClash: 'Eine Klasse mit diesem Namen existiert bereits',
      renameFailed: 'Klasse konnte nicht umbenannt werden',
      deleteFailed: 'Klasse konnte nicht gelöscht werden',
    },
    editor: {
      missingRouteParams: 'In der Route fehlt die Datensatz- oder Bild-ID.',
      back: 'Zurück',
      selectMode: 'Auswählen',
      drawPolygon: 'Polygon zeichnen',
      editVertices: 'Eckpunkte bearbeiten',
      deletePolygon: 'Polygon löschen',
      undo: 'Rückgängig',
      redo: 'Wiederholen',
      zoomOut: 'Verkleinern',
      zoomIn: 'Vergrößern',
      resetView: 'Ansicht zurücksetzen',
      save: 'Speichern',
      saveUnsaved: 'Speichern*',
      saved: 'Annotation gespeichert',
      saveFailed: 'Annotation konnte nicht gespeichert werden',
      loadFailed: 'Annotation konnte nicht geladen werden',
      saveDisabledLoadError:
        'Das Speichern ist deaktiviert, bis die Annotation dieses Bildes erfolgreich geladen wurde — so wird verhindert, dass Ihre gespeicherte Arbeit durch eine leere Annotation überschrieben wird.',
      retry: 'Erneut versuchen',
      imageLoadFailed: 'Bild konnte nicht geladen werden',
      imageAlt: 'Zu annotierendes Bild',
      minVertices: 'Ein Polygon benötigt mindestens 3 Punkte',
    },
    polygonList: {
      title: 'Polygone ({{count}})',
      empty:
        'Noch keine Polygone. Wechseln Sie zu „Polygon zeichnen“ und klicken Sie auf das Bild.',
      instance: 'Instanz {{id}}',
      points: '{{count}} Punkte',
      changeClass: 'Klasse ändern',
      delete: 'Polygon löschen',
    },
  },
};
