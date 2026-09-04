export default {
  common: {
    appName: 'SpheroSeg',
    loading: 'Cargando...',
    save: 'Guardar',
    cancel: 'Cancelar',
    apply: 'Aplicar',
    dismiss: 'Descartar',
    delete: 'Eliminar',
    edit: 'Editar',
    actions: 'Acciones',
    show: 'Mostrar',
    hide: 'Ocultar',
    create: 'Crear',
    search: 'Buscar',
    error: 'Error',
    success: 'Éxito',
    back: 'Volver',
    signIn: 'Iniciar sesión',
    signUp: 'Registrarse',
    signOut: 'Cerrar sesión',
    settings: 'Configuración',
    profile: 'Perfil',
    dashboard: 'Panel de control',
    project: 'Proyecto',
    projects: 'Proyectos',
    polygon: 'Polígono',
    newProject: 'Nuevo proyecto',
    upload: 'Subir',
    uploadImages: 'Subir imágenes',
    recentAnalyses: 'Análisis recientes',
    noProjects: 'No se encontraron proyectos',
    noImages: 'No se encontraron imágenes',
    createYourFirst: 'Crea tu primer proyecto para comenzar',
    tryAgain: 'Intentar de nuevo',
    cancelling: 'Cancelando...',
    deleting: 'Eliminando...',
    retry: 'Reintentar',
    retrying: 'Reintentando...',
    retryAttempt: 'Intento {{attempt}} de {{max}}',
    retryingIn: 'Reintentando en {{seconds}} segundos...',
    nextRetryIn: 'Próximo intento en {{seconds}}s',
    operationFailed: 'Operación fallida',
    unexpectedError: 'Ocurrió un error inesperado',
    failedToLoad: 'Error al cargar',
    loadingFailed: 'Carga fallida. Por favor, inténtalo de nuevo.',
    networkError: 'Error de red. Por favor, verifica tu conexión.',
    refreshPage: 'Actualizar página',
    tryAgainLater: 'Por favor, inténtalo más tarde',
    email: 'Correo electrónico',
    password: 'Contraseña',
    name: 'Nombre',
    description: 'Descripción',
    date: 'Fecha',
    status: 'Estado',
    images: 'Imágenes',
    image: 'Imagen',
    projectName: 'Nombre del proyecto',
    projectDescription: 'Descripción del proyecto',
    theme: 'Tema',
    language: 'Idioma',
    light: 'Claro',
    dark: 'Oscuro',
    system: 'Sistema',
    account: 'Cuenta',
    notifications: 'Notificaciones',
    passwordConfirm: 'Confirmar contraseña',
    manageAccount: 'Administrar tu cuenta',
    getStarted: 'Comenzar',
    learnMore: 'Saber más',
    documentation: 'Documentación',
    changePassword: 'Cambiar contraseña',
    deleteAccount: 'Eliminar cuenta',
    termsOfService: 'Términos de servicio',
    privacyPolicy: 'Política de privacidad',
    createAccount: 'Crear cuenta',
    signInToAccount: 'Iniciar sesión en tu cuenta',
    sort: 'Ordenar',
    no_preview: 'Sin vista previa',
    openMenu: 'Abrir menú',
    logOut: 'Cerrar sesión',
    pageNotFound: '¡Ups! Página no encontrada',
    returnToHome: 'Volver al inicio',
    next: 'Siguiente',
    copy: 'Copiar',
    close: 'Cerrar',
    noImage: 'Sin imagen',
    untitledImage: 'Imagen sin título',
    rename: 'Renombrar',
    redirectingToDashboard: 'Redirigiendo al panel de control...',
  },
  landing: {
    hero: {
      eyebrow:
        'Segmentación de imagen biomédica · ÚTIA, Academia Checa de Ciencias',
      title: 'Segmentación para cada muestra que usted captura.',
      subtitle:
        'Esferoides y su desintegración, heridas de ensayo de rayado, morfología espermática, filamentos de microtúbulos, microcápsulas, neuronas y sus prolongaciones: un modelo entrenado para cada tipo, un único editor para todos y exportaciones que ImageJ, COCO y YOLO ya entienden.',
      getStarted: 'Comenzar',
      learnMore: 'Ver qué admite',
      backupNoticeTitle: 'Conserve su propia copia de las imágenes.',
      backupNotice:
        'Los archivos de imagen subidos no tienen copia de seguridad. Su cuenta, sus proyectos y los resultados de segmentación se respaldan a diario.',
    },
    specimens: {
      trayLabel: 'Elija una muestra',
      spheroid: {
        label: 'Esferoide',
        detail:
          'Campo claro, 2048 × 2048. Un esferoide tumoral, delineado en rojo por HRNet: exactamente el contorno que el editor le entrega para corregir.',
        alt: 'Micrografía de campo claro de un esferoide tumoral con su contorno de segmentación dibujado en rojo.',
      },
      disintegration: {
        label: 'Esferoide en desintegración',
        detail:
          'Campo claro, 2048 × 2048, 48 horas de ensayo de desintegración. El núcleo denso está en verde y cada célula desprendida en rojo. El índice de desintegración se calcula exactamente a partir de esa separación.',
        alt: 'Micrografía de campo claro de un esferoide desintegrándose, con el núcleo denso delineado en verde y cada célula desprendida en rojo.',
      },
      wound: {
        label: 'Herida de ensayo de rayado',
        detail:
          'Ensayo de rayado, 2048 × 2048. La herida abierta es el contorno rojo; las islas de células dentro de ella están en azul y se restan del área de la herida.',
        alt: 'Micrografía de ensayo de rayado con la herida abierta delineada en rojo y cuatro islas de células en su interior delineadas en azul.',
      },
      sperm: {
        label: 'Morfología espermática',
        detail:
          'Campo claro, 1360 × 1024. Cada célula se traza como tres polilíneas en vez de una sola mancha —cabeza en verde, pieza intermedia en ámbar, cola en cian— para poder medir cada segmento por separado.',
        alt: 'Micrografía de campo claro de dos espermatozoides, cada uno trazado por tres polilíneas de color: cabeza verde, pieza intermedia ámbar, cola cian.',
      },
      microtubule: {
        label: 'Filamentos de microtúbulos',
        detail:
          'Serie temporal en IRM, fotograma 30. Cada filamento tiene su propia línea central y su color procede del identificador de trayectoria, que conserva durante toda la adquisición: así el kimograma sigue un filamento concreto y no el que quede más cerca.',
        alt: 'Micrografía de microtúbulos en contraste de reflexión interferencial, con cada filamento trazado por una línea central de su propio color.',
      },
      microcapsule: {
        label: 'Microcápsulas',
        detail:
          'Campo claro, 1280 × 1024. Dos cápsulas completas están delineadas en rojo: son las que reciben área, perímetro y compacidad. Las cápsulas que corta el borde del fotograma no llevan contorno rojo; el modelo las marca y las estadísticas las dejan fuera.',
        alt: 'Micrografía de campo claro de microcápsulas, las dos completas delineadas en rojo y las cortadas por el borde del fotograma sin contorno.',
      },
      neurite: {
        label: 'Neuritas y somas',
        detail:
          'Fluorescencia confocal, canal de tubulina: un recorte de 1400 × 1400 de un fotograma de 6657 × 6664. Cada neurona se divide en dos: el cuerpo celular en magenta y cada prolongación en cian, de modo que el recuento de somas y la longitud de las prolongaciones se miden por separado y no como una sola mancha.',
        alt: 'Micrografía de fluorescencia confocal de neuronas en cultivo, con cada cuerpo celular delineado en magenta y las prolongaciones que salen de él delineadas en cian.',
      },
    },
    about: {
      badge: 'Quién lo construye',
      title: 'De dónde viene la plataforma',
      description1:
        'Nuestra plataforma fue desarrollada por Bc. Michal Průšek, estudiante de la Facultad de Ciencias Nucleares e Ingeniería Física (FJFI) en la Universidad Técnica Checa de Praga, bajo la supervisión de Ing. Adam Novozámský, Ph.D.',
      description2:
        'Este proyecto es una colaboración con el grupo de Ing. Silvie Rimpelová, Ph.D. del Instituto de Bioquímica y Microbiología de la UCT Praga (VŠCHT Praha).',
      description3:
        'Empezó con esferoides tumorales y creció con los experimentos que trajeron nuestros colaboradores: ensayos de desintegración, heridas de ensayo de rayado, morfología espermática, series temporales de microtúbulos, microcápsulas y neuronas en cultivo. Cada tipo de muestra tiene su propio modelo entrenado, sus propias métricas y su propia exportación, y detrás de todos ellos, un único editor.',
      contactText: 'Para consultas, contáctenos en',
      supportText: 'Si desea apoyar el proyecto económicamente, escríbame a',
    },
    acknowledgments: {
      badge: 'Agradecimientos',
      title: 'Agradecimientos especiales',
      lukasIntro: 'Agradecemos a',
      lukasName: 'Lukáš Veškrna',
      lukasContribution:
        'por contribuir con el módulo completo de segmentación de cicatrización de heridas a esta plataforma.',
      visitPage: 'Visitar página',
    },
    cta: {
      title: 'Traiga sus propias imágenes.',
      subtitle:
        'Cree un proyecto, elija el tipo de muestra y suba una serie. El modelo se ejecuta en GPU y el resultado se abre directamente en el editor, listo para corregir.',
      cardDescription: 'El registro está abierto: no hace falta invitación',
      createAccount: 'Crear su cuenta',
    },
    features: {
      badge: 'Qué hace',
      title: 'Un editor, sea lo que sea que haya en el portaobjetos',
      subtitle:
        'Cada tipo de muestra tiene su modelo y sus métricas. Todo lo demás —edición, seguimiento, exportación— es el mismo flujo de trabajo.',
      cards: {
        models: {
          title: 'Un modelo por tipo de muestra',
          description:
            'Elija el tipo de muestra al crear el proyecto y solo se ofrecerán los modelos que le corresponden. Los esferoides tienen cinco por sí solos, desde una U-Net de 200 ms hasta un cuello de botella Mamba para imágenes de un microscopio desconocido.',
        },
        stacks: {
          title: 'Series temporales y pilas, no solo imágenes sueltas',
          description:
            'MP4, AVI, MOV, MKV y WebM, TIFF multipágina y Nikon ND2 se suben como un único elemento y se despliegan en fotogramas. Las adquisiciones multicanal conservan sus canales y usted decide de cuál lee el modelo.',
        },
        tracking: {
          title: 'Identidad que sobrevive al deslizador de fotogramas',
          description:
            'Los microtúbulos se emparejan de un fotograma al siguiente por la geometría de la curva, de modo que un filamento mantiene su identificador y su color durante toda la adquisición, y el kimograma mide ese filamento y no el que quedase más cerca.',
        },
        corrections: {
          title: 'Corrija cualquier cosa a mano',
          description:
            'Arrastre vértices, divida en dos un objeto fusionado, añada puntos a lo largo de un contorno, una dos polilíneas, cambie la clase. Las ediciones se guardan junto a la imagen, no solo en el navegador.',
        },
        measurements: {
          title: 'Números, en archivos que otras herramientas abren',
          description:
            'Área, perímetro, diámetro de Feret, longitud de polilínea e intensidad por canal, exportados como XLSX junto con COCO, YOLO, conjuntos de ROI de ImageJ y anotaciones de CVAT.',
        },
        batch: {
          title: 'Dimensionado para un experimento entero',
          description:
            'Los lotes de hasta 10 000 imágenes se procesan en GPU y la cola posterga a quien acaba de atender, de modo que una serie temporal de 600 fotogramas no bloquea a los demás.',
        },
      },
    },
  },
  dashboard: {
    manageProjects: 'Administra tus proyectos de investigación y análisis',
    projectGallery: 'Galería de Proyectos',
    projectGalleryDescription:
      'Explora y administra todos tus proyectos de segmentación',
    statsOverview: 'Resumen de estadísticas',
    totalProjects: 'Total de proyectos',
    activeProjects: 'Proyectos activos',
    totalImages: 'Total de imágenes',
    totalAnalyses: 'Total de análisis',
    lastUpdated: 'Última actualización',
    noProjectsDescription:
      'Aún no has creado ningún proyecto. Crea tu primer proyecto para comenzar.',
    noImagesDescription: 'Sube algunas imágenes para comenzar',
    searchProjectsPlaceholder: 'Buscar proyectos...',
    searchImagesPlaceholder: 'Buscar imágenes por nombre...',
    sortBy: 'Ordenar por',
    name: 'Nombre',
    lastChange: 'Último cambio',
    status: 'Estado',
    stats: {
      totalProjects: 'Total de proyectos',
      totalProjectsDesc: 'Estudios activos',
      processedImages: 'Imágenes procesadas',
      processedImagesDesc: 'Segmentadas exitosamente',
      uploadedToday: 'Subidas hoy',
      uploadedTodayDesc: 'Imágenes de microscopía',
      storageUsed: 'Almacenamiento usado',
      totalSpaceUsed: 'Espacio total usado',
      incompleteWarning:
        'Las estadísticas pueden estar incompletas — no se pudo cargar {{count}} proyecto(s)',
    },
    completed: 'Completado',
    processing: 'Procesando',
    pending: 'Pendiente',
    failed: 'Fallido',
    storageUsed: 'Almacenamiento Usado',
  },
  projects: {
    createProject: 'Crear nuevo proyecto',
    createProjectDesc:
      'Añade un nuevo proyecto para organizar tus imágenes de microscopía y tus análisis.',
    projectType: 'Tipo de proyecto',
    renameProject: 'Renombrar proyecto',
    projectRenamed: 'Proyecto renombrado',
    projectRenameFailed: 'No se pudo renombrar el proyecto',
    projectTypeUpdated: 'Tipo de proyecto actualizado',
    failedToUpdateProject: 'Error al actualizar el proyecto',
    changeProjectType: 'Cambiar tipo de proyecto',
    typeChangeSegmentationsWarning:
      '{{count}} segmentaciones existentes pueden no coincidir con el formato de exportación "{{type}}". Vuelva a segmentar para actualizar las métricas.',
    verified: 'Verificado',
    toggleVerified: 'Alternar verificación',
    projectVerified: 'Proyecto marcado como verificado',
    projectUnverified: 'Se ha eliminado la verificación del proyecto',
    failedToUpdateVerified: 'Error al actualizar el estado de verificación',
    types: {
      spheroid: 'Esferoides (estándar)',
      spheroid_invasive: 'Esferoides desintegrados',
      wound: 'Cicatrización de heridas',
      sperm: 'Esperma',
      microtubules: 'Microtúbulos',
      microcapsule: 'Microcápsulas',
      neurite: 'Neuritas y somas',
    },
    projectNamePlaceholder: 'ej. Células HeLa, placa 3',
    projectDescPlaceholder: 'ej. Cribado de resistencia, curva de 48 h',
    creatingProject: 'Creando...',
    duplicateProject: 'Duplicar',
    shareProject: 'Compartir',
    deleteProject: 'Eliminar',
    openProject: 'Abrir proyecto',
    confirmDelete: '¿Estás seguro de que quieres eliminar este proyecto?',
    projectCreated: 'Proyecto creado con éxito',
    projectDeleted: 'Proyecto eliminado con éxito',
    viewProject: 'Ver proyecto',
    projectImages: 'Imágenes del proyecto',
    noProjects: 'No se encontraron proyectos',
    imageDeleted: 'Imagen eliminada con éxito',
    deleteImageError: 'Error al eliminar imagen',
    deleteImageFailed: 'Falló la eliminación de imagen',
    imagesQueuedForSegmentation:
      '{{count}} imágenes añadidas a la cola de segmentación',
    imageQueuedForResegmentation:
      'Imagen añadida a la cola para re-segmentación',
    errorAddingToQueue: 'Error al añadir imágenes a la cola',
    imageAlreadyProcessing: 'La imagen ya está siendo procesada',
    processImageFailed: 'Error al procesar la imagen',
    selected: '{{count}} seleccionados',
    deleteSelected: 'Eliminar seleccionados',
    segmentationCompleted: 'Segmentación completada para la imagen',
    segmentationFailed: 'La segmentación ha fallado',
    segmentationStarted: 'La segmentación ha comenzado',
    segmentationCompleteWithCount:
      'Segmentación completa! Se encontraron {{count}} objetos',
    failedToLoadProjects: 'Error al cargar proyectos',
    projectNameRequired: 'Por favor ingrese un nombre de proyecto',
    mustBeLoggedIn: 'Debe estar conectado para crear un proyecto',
    failedToCreateProject: 'Error al crear proyecto',
    serverResponseInvalid: 'La respuesta del servidor fue inválida',
    projectCreatedDesc: '"{{name}}" está listo para imágenes',
    descriptionOptional: 'Descripción (Opcional)',
    noDescriptionProvided: 'No se proporcionó descripción',
    deleteDialog: {
      title: 'Confirmar eliminación',
      description:
        '¿Está seguro de que desea eliminar {{count}} imágenes seleccionadas? Esta acción no se puede deshacer.',
    },
    selectProject: 'Seleccionar Proyecto',
    projectSelection: 'Selección de Proyecto',
    selectProjectHeader: 'Seleccionar Proyecto',
  },
  errors: {
    noProjectOrUser: 'Error: No hay proyecto o usuario seleccionado',
    unknown: 'Error desconocido',
    network:
      'Error de conexión de red. Por favor verifique su conexión a internet.',
    unauthorized: 'Acceso denegado. Por favor inicie sesión nuevamente.',
    forbidden: 'No tiene permisos para realizar esta acción.',
    notFound: 'El recurso solicitado no fue encontrado.',
    conflict:
      'Este correo ya está registrado. Intenta iniciar sesión o usa un correo diferente.',
    invalidCredentials:
      'Correo o contraseña incorrectos. Por favor verifica tus credenciales.',
    validation: 'Error de validación. Por favor verifique su entrada.',
    general: 'Ocurrió un error inesperado. Por favor intente nuevamente.',
    server: 'Error del servidor. Por favor intente más tarde.',
    timeout: 'La solicitud se agotó. Por favor intente nuevamente.',
    sessionExpired:
      'Tu sesión ha expirado. Por favor inicia sesión nuevamente para continuar.',
    tooManyRequests:
      'Demasiadas solicitudes. Por favor espera un momento e intenta de nuevo.',
    serverUnavailable:
      'Servicio temporalmente no disponible. Por favor intenta de nuevo en unos minutos.',
    clientError:
      'Error en la solicitud. Por favor verifica tu entrada e intenta de nuevo.',
    emailAlreadyExists:
      'Este correo ya está registrado. Intenta iniciar sesión o usa un correo diferente.',
    validationErrors: {
      projectNameRequired: 'Por favor ingrese un nombre de proyecto',
      loginRequired: 'Debe estar conectado para crear un proyecto',
      emailRequired: 'El correo electrónico es requerido',
      passwordRequired: 'La contraseña es requerida',
      invalidEmail:
        'Por favor ingrese una dirección de correo electrónico válida',
      passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
      passwordsDoNotMatch: 'Las contraseñas no coinciden',
      confirmationRequired: 'Por favor confirme su acción',
      fieldRequired: 'Este campo es requerido',
    },
    operations: {
      loadProject:
        'No se pudo cargar el proyecto. Verifica tu conexión e inténtalo de nuevo.',
      saveProject:
        'No se pudieron guardar los cambios del proyecto. Inténtalo de nuevo.',
      uploadImage:
        'No se pudo subir la imagen. Verifica el formato y el tamaño del archivo.',
      deleteImage:
        'No se puede eliminar la imagen. Intenta actualizar la página y repetir la acción.',
      processImage:
        'El procesamiento de la imagen falló. Prueba con una imagen diferente o contacta al soporte.',
      segmentation:
        'La segmentación falló. Intenta usar un modelo diferente o ajustar la configuración.',
      export:
        'La exportación de datos falló. Verifica que los datos estén disponibles.',
      login: 'Inicio de sesión falló. Verifica tu email y contraseña.',
      logout: 'Cerrar sesión falló. Intenta cerrar el navegador.',
      register: 'El registro falló. Este email podría estar ya en uso.',
      updateProfile:
        'No se pudo actualizar el perfil. Verifica la información proporcionada.',
      changePassword:
        'No se pudo cambiar la contraseña. Verifica tu contraseña actual.',
      deleteAccount:
        'No se pudo eliminar la cuenta. Contacta al soporte para asistencia.',
      resetPassword:
        'El restablecimiento de contraseña falló. Verifica la dirección de email proporcionada.',
      updateConsent:
        'No se pudieron actualizar las preferencias de consentimiento. Inténtalo de nuevo.',
      unshareProject:
        'No se pudo quitar el proyecto de los proyectos compartidos',
      deleteProject: 'No se pudo eliminar el proyecto',
    },
    deleteAnnotations: 'No se pudieron eliminar las anotaciones',
    deleteImages: 'Error al eliminar las imágenes seleccionadas',
    contexts: {
      dashboard: 'Error del dashboard',
      project: 'Error del proyecto',
      image: 'Error de imagen',
      segmentation: 'Error de segmentación',
      export: 'Error de exportación',
      auth: 'Error de autenticación',
      profile: 'Error de perfil',
      settings: 'Error de configuración',
    },
  },
  images: {
    uploadImages: 'Subir imágenes o vídeos',
    dragDrop: 'Arrastra y suelta imágenes o vídeos aquí',
    clickToSelect: 'o haz clic para seleccionar archivos',
    acceptedFormats:
      'Imágenes: JPEG, PNG, TIFF, BMP (máx. 20 MB) — Vídeos: MP4, AVI, MOV, MKV, WebM, ND2, TIFF multipágina (máx. 100 GB)',
    uploadProgress: 'Progreso de la carga',
    readyToUpload: 'Listo para subir',
    uploadingTo: 'Subiendo a',
    currentProject: 'Proyecto actual',
    autoSegment: 'Segmentar automáticamente las imágenes después de la carga',
    uploadCompleted: 'Carga completada',
    uploadFailed: 'Carga fallida',
    imagesUploaded: 'Imágenes subidas con éxito',
    imagesFailed: 'Error al subir imágenes',
    viewAnalyses: 'Ver análisis',
    noAnalysesYet: 'Aún no hay análisis',
    runAnalysis: 'Ejecutar análisis',
    viewResults: 'Ver resultados',
    dropImagesHere: 'Suelta los archivos aquí...',
    selectProjectFirst: 'Por favor selecciona un proyecto primero',
    registerChannels: {
      promptTitle: '¿Registrar canales?',
      help: 'Corrige pequeños desplazamientos entre canales al subir, alineando cada uno al primero (solo traslación).',
      confirm: 'Registrar y subir',
      decline: 'Subir sin registrar',
    },
    projectRequired:
      'Debes seleccionar un proyecto antes de poder subir imágenes',
    pending: 'Pendiente',
    uploading: 'Subiendo',
    processing: 'Procesando',
    complete: 'Completo',
    error: 'Error',
    imageDeleted: 'Imagen eliminada con éxito',
    deleteImageFailed: 'Error al eliminar imagen',
    deleteImageError: 'Error al eliminar imagen',
    imageAlreadyProcessing: 'La imagen ya está siendo procesada',
    processImageFailed: 'Error al procesar la imagen',
    upload: {
      inProgress:
        'Subida en progreso. Puede seguir trabajando — vea el progreso en la esquina inferior derecha.',
      uploading: 'Subiendo {{success}}/{{total}} archivos',
      completed: '{{count}} archivos subidos correctamente',
      completedWithFailures: '{{success}} subidos, {{failed}} fallidos',
      failed: 'Subida fallida',
      cancelled: 'Subida cancelada',
      cancelButton: 'Cancelar subida',
      preparing: 'Preparando subida de {{count}} archivos...',
      /** Status line under the upload bar. Composed as a KEY in the
       *  upload state machine (which lives outside LanguageProvider and
       *  therefore cannot translate) and rendered here. */
      op: {
        interrupted: 'Subida interrumpida al recargar la página',
        uploadingFile: 'Subiendo ({{index}}/{{total}})',
        processingFile: 'Procesando ({{index}}/{{total}})',
        completedSummary:
          'Subida completada: {{success}} con éxito, {{failed}} fallidos',
        preparing: 'Preparando subida de {{count}} archivos...',
        uploadingVideo: 'Subiendo vídeo {{index}}/{{total}}',
        processingOnServer: 'Procesando en el servidor',
        uploadedWithFailures: '{{uploaded}} subidos, {{failed}} fallidos',
        uploadedOk: '{{count}} archivos subidos correctamente',
        uploadingFiles: 'Subiendo {{count}} archivos...',
        countUploaded: '{{count}} subidos',
        countFailed: '{{count}} fallidos',
        countCancelled: '{{count}} cancelados',
        noFiles: 'ningún archivo procesado',
        retryingChunk: 'Reintentando bloque {{index}} (intento {{attempt}})',
        processingChunk: 'Procesando bloque {{index}} de {{total}}',
        chunksDone: 'Completados {{done}} de {{total}} bloques',
        uploadingChunk: 'Subiendo bloque {{index}} de {{total}}',
        persistingOriginal: 'Guardando el original',
        extractingFramesStart: 'Extrayendo fotogramas',
        extractingFrames: 'Extrayendo fotogramas {{current}}/{{total}}',
        extractingFramesPct: 'Extrayendo fotogramas ({{percent}} %)',
        correctingDrift: 'Corrigiendo la deriva',
        correctingDriftPosition:
          'Corrigiendo la deriva (posición {{index}}/{{total}})',
        position: 'Posición {{index}}/{{total}}',
        generatingThumbnail: 'Generando miniatura',
        persistingPositions: 'Guardando posiciones',
        videoReady: 'Vídeo listo',
      },
      alreadyInProgress: 'Ya hay una subida en progreso para este proyecto',
      remaining: '~{{time}} restante',
      project: 'Proyecto:',
      view: 'Ver',
      filesProgress: '{{success}} de {{total}} archivos ({{percent}} %)',
      chunkProgress: 'Parte {{current}}/{{total}}',
    },
  },
  specimens: {
    preview: {
      byModel:
        'Imágenes reales que este modelo segmentó, con los contornos que produjo.',
      byType:
        'Imágenes reales de proyectos de este tipo, con la segmentación que produjo su modelo.',
      alt: 'Imagen de ejemplo de tipo {{type}} con la segmentación producida por {{model}}.',
    },
  },
  settings: {
    manageSettings: 'Administra las preferencias de tu cuenta',
    appearance: 'Apariencia',
    themeSettings: 'Configuración del tema',
    systemDefault: 'Predeterminado del sistema',
    languageSettings: 'Configuración de idioma',
    selectLanguage: 'Seleccionar idioma',
    accountSettings: 'Configuración de la cuenta',
    notificationSettings: 'Configuración de notificaciones',
    emailNotifications: 'Notificaciones por correo electrónico',
    pushNotifications: 'Notificaciones push',
    profileSettings: 'Configuración del perfil',
    profileUpdated: 'Perfil actualizado con éxito',
    profileUpdateFailed: 'Error al actualizar el perfil',
    saveChanges: 'Guardar cambios',
    savingChanges: 'Guardando cambios...',
    notifications: {
      projectUpdates: 'Actualizaciones de proyectos',
      analysisCompleted: 'Análisis completado',
      newFeatures: 'Nuevas características',
      marketingEmails: 'Correos de marketing',
      billing: 'Notificaciones de facturación',
    },
    modelSelection: {
      title: 'Selección de modelo',
      description: 'Elige el modelo de IA para usar en la segmentación celular',
      sections: {
        spheroid: 'Modelos de esferoides',
        spheroid_invasive: 'Modelos de esferoides desintegrados',
        sperm: 'Modelos de espermatozoides',
        wound: 'Modelos de cicatrización',
        microtubule: 'Modelos de microtúbulos',
        microcapsule: 'Modelos de microcápsulas',
        neurite: 'Modelos de neuritas y somas',
      },
      presets: {
        fast: 'Rápido',
        accurate: 'Preciso',
        robust: 'Robusto',
        showMore: 'Mostrar modelos adicionales',
        showLess: 'Ocultar modelos adicionales',
      },
      presetDescriptions: {
        fast: 'Vista previa en tiempo real, lotes grandes, GPU débil',
        accurate:
          'Laboratorios con imágenes HQ, cuando el tiempo no es crítico',
        robust:
          'Laboratorios externos, óptica desconocida, muestras tratadas, morfologías inusuales',
      },
      models: {
        hrnet: {
          name: 'HRNet',
          description:
            'Modelo rápido y eficiente para segmentación en tiempo real',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description:
            'Modelo de segmentación preciso con mecanismos de atención',
        },
        unet_spherohq: {
          name: 'UNet (SpheroHQ)',
          description:
            'Mejor rendimiento en el conjunto de datos SpheroHQ - optimizado para segmentación de esferoides con velocidad y precisión equilibradas (~0.25s/imagen, 10 img/s)',
        },
        spheroid_disintegration: {
          name: 'Desintegración de esferoides',
          description:
            'UNet++ con codificador EfficientNet-B5 — segmentación de 3 clases (fondo / corona / núcleo denso) de esferoides en desintegración; predice el núcleo directamente para un Índice de Desintegración correcto (~0.7s/imagen)',
        },
        segformer: {
          name: 'SegFormer',
          description:
            'Modelo basado en transformador (SegFormer-B0) para esferoides de campo claro: máxima precisión (93% IoU) y muy rápido (~13 ms/imagen)',
        },
        mamba_unet: {
          name: 'Mamba-UNet',
          description:
            'U-Net con cuello de botella Mamba (state-space) bidireccional: mejor robustez en imágenes fuera de distribución (óptica desconocida, muestras tratadas, morfologías inusuales)',
        },
        sperm: {
          name: 'Morfología espermática',
          description:
            'Modelo de morfología espermática con extracción de esqueleto para medir cabeza, pieza media y cola',
        },
        wound: {
          name: 'Cicatrización de heridas (scratch assay)',
          description:
            'U-Net con codificador MiT-B5 (SegFormer) para segmentación binaria de heridas en microscopía de scratch-assay (~32 ms en A5000, 90 % IoU en conjunto de prueba externo)',
        },
        microtubule: {
          name: 'Microtúbulos (ResEnc-M + instanciador por curvatura)',
          description:
            'Segmentación de instancias para time-lapses de microtúbulos IRM. Una red nnU-Net ResEnc-M predice el primer plano de los filamentos y un instanciador acotado por curvatura lo separa en centerlines individuales, resolviendo cada cruce bajo un límite duro de 0,25 rad/px. Entrenado íntegramente con imágenes sintéticas, sin anotación humana. ~4,5 s por cuadro; único modelo de la plataforma con salida polilínea nativa.',
        },
        microcapsule: {
          name: 'Microcapsule',
          description:
            'Segmentación de instancias para microcápsulas (objetos redondos) en microscopía de campo claro. Una U-Net compacta destilada de Meta SAM 3 devuelve un contorno limpio a resolución completa por cápsula y separa las cápsulas adyacentes mediante watershed; las cápsulas cortadas por el borde de la imagen quedan excluidas de las métricas (área, perímetro, compacidad).',
        },
        neurite_soma: {
          name: 'Neurita / Soma (nnU-Net ResEnc-M)',
          description:
            'Segmentación semántica de dos clases de neuronas en microscopía de fluorescencia — neurita (prolongaciones) y soma (cuerpo celular) — solo a partir del canal de tubulina. nnU-Net v2 ResEnc-M, conjunto de 3 folds con TTA de espejo y término topológico clDice para la clase neurita. Dice en datos retenidos 0,832 neurita / 0,915 soma.',
        },
      },
    },
    detectHoles: 'Detectar Agujeros',
    detectHolesDescription:
      'Habilitar la detección de estructuras internas y agujeros dentro de las células',
    modelSelected: 'Modelo seleccionado con éxito',
    modelSettingsSaved: 'Configuración de modelo guardada con éxito',
    modelSize: {
      small: 'Pequeño',
      medium: 'Mediano',
      large: 'Grande',
    },
    modelDescription: {
      hrnet:
        'Modelo equilibrado con buena velocidad y calidad (E2E ~309ms, 4.9 img/s)',
      cbam_resunet:
        'Segmentación más precisa con mecanismos de atención (E2E ~482ms, 2.7 img/s)',
      unet_spherohq:
        '¡El modelo más rápido después de las optimizaciones! Excelente para procesamiento en tiempo real (E2E ~286ms, 5.5 img/s)',
      spheroid_disintegration:
        'Modelo UNet++ / EfficientNet-B5 de 3 clases (fondo / corona / núcleo) para esferoides en desintegración; predice el núcleo denso directamente para un Índice de Desintegración correcto (30,7M parámetros)',
      segformer:
        'Modelo SegFormer-B0 basado en transformador, entrenado con el conjunto de datos SpheroMix. La mayor precisión de segmentación de esferoides de la plataforma (93% IoU), siendo además el modelo más pequeño y rápido (~13 ms/imagen).',
      mamba_unet:
        'U-Net con cuello de botella Mamba (state-space) bidireccional (90,75M parámetros). La mejor generalización fuera de distribución de la plataforma (HTS-Seg IoU 0,587): para laboratorios externos, óptica desconocida, muestras tratadas y morfologías de esferoides inusuales.',
      sperm:
        'Modelo de morfología espermática con extracción de esqueleto para medir cabeza, pieza media y cola',
      wound:
        'Modelo U-Net + MiT-B5 (codificador SegFormer) para segmentación de heridas en microscopía de scratch-assay. Una única región de herida binaria por imagen; ideal para time-lapses de cicatrización.',
      microtubule:
        'Segmentación de instancias de microtúbulos para microscopía IRM. Red nnU-Net ResEnc-M, instanciador acotado por curvatura, salida polilínea nativa con tracking geométrico entre cuadros.',
      microcapsule:
        'U-Net compacta (destilada de Meta SAM 3) para segmentación de instancias de microcápsulas — área, perímetro y compacidad por cápsula, con las cápsulas cortadas por el borde excluidas de las métricas.',
      neurite_soma:
        'nnU-Net v2 ResEnc-M (2D, conjunto de 3 folds) para segmentar neuritas y somas en microscopía de fluorescencia. Usa el canal de tubulina; Dice en datos retenidos 0,832 neurita / 0,915 soma. Entrenado con datos confocales Leica a ~0,180 µm/px: valide los recuentos de somas con otro tamaño de píxel.',
    },
    dataUsageTitle: 'Uso de datos y privacidad',
    dataUsageDescription:
      'Controla cómo se utilizan tus datos para el aprendizaje automático y la investigación',
    allowMLTraining: {
      label: 'Permitir entrenamiento de modelos ML',
      description:
        'Permitir que tus datos se utilicen para entrenar y mejorar nuestros modelos de segmentación',
    },
    consent: {
      privacyNotice:
        'Su privacidad es importante para nosotros. Estas configuraciones controlan cómo sus imágenes cargadas y datos de segmentación pueden usarse para mejorar nuestros modelos de ML. Puede cambiar estas preferencias en cualquier momento.',
      dataUsageNote:
        'Los datos de usuarios que opten por no participar no serán incluidos en ningún pipeline de entrenamiento.',
      algorithmImprovement: {
        label: 'Mejora de Algoritmos',
        description:
          'Usar datos para mejorar la precisión y velocidad de segmentación',
      },
      featureDevelopment: {
        label: 'Desarrollo de Características',
        description:
          'Ayudar a desarrollar nuevas características y capacidades',
      },
      lastUpdated: 'Última actualización',
      savePreferences: 'Guardar Preferencias de Consentimiento',
      savingPreferences: 'Guardando...',
    },
    cancel: 'Cancelar',
    deleting: 'Eliminando...',
    deleteAccount: 'Eliminar Cuenta',
    accountDeleted: 'Cuenta eliminada con éxito',
    deleteAccountError: 'Error al eliminar la cuenta',
    deleteAccountDialog: {
      title: 'Eliminar cuenta',
      description:
        'Esta acción no se puede deshacer. Esto eliminará permanentemente tu cuenta y removerá todos tus datos de nuestros servidores.',
      whatWillBeDeleted: 'Qué será eliminado:',
      deleteItems: {
        account: 'Tu cuenta de usuario y perfil',
        projects: 'Todos tus proyectos e imágenes',
        segmentation: 'Todos los datos de segmentación y resultados',
        settings: 'Configuración de cuenta y preferencias',
      },
      confirmationLabel: 'Por favor escribe {email} para confirmar:',
      confirmationPlaceholder: '{email}',
    },
    personal: 'Información Personal',
    fullName: 'Nombre Completo',
    organization: 'Organización',
    department: 'Departamento',
    publicProfile: 'Perfil Público',
    bio: 'Biografía',
    makeProfileVisible: 'Hacer mi perfil visible para otros investigadores',
    dangerZone: 'Zona de Peligro',
    deleteAccountWarning:
      'Una vez que elimines tu cuenta, no hay vuelta atrás. Todos tus datos serán eliminados permanentemente.',
    currentPassword: 'Contraseña Actual',
    newPassword: 'Nueva Contraseña',
    confirmNewPassword: 'Confirmar Nueva Contraseña',
    fillAllFields: 'Por favor completa todos los campos requeridos',
    passwordsDoNotMatch: 'Las contraseñas no coinciden',
    passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
    passwordChanged: 'Contraseña cambiada con éxito',
    passwordsMatch: 'Las contraseñas coinciden',
    changingPassword: 'Cambiando contraseña...',
    changePassword: 'Cambiar Contraseña',
    languageUpdated: 'Idioma actualizado con éxito',
    themeUpdated: 'Tema actualizado con éxito',
    appearanceDescription: 'Personaliza la apariencia de la aplicación',
    language: 'Idioma',
    languageDescription: 'Selecciona tu idioma preferido',
    theme: 'Tema',
    themeDescription: 'Elige tema claro, oscuro o del sistema',
    light: 'Claro',
    dark: 'Oscuro',
    system: 'Sistema',
    pageTitle: 'Configuración',
    profile: 'Perfil',
    account: 'Cuenta',
    models: 'Modelos',
  },
  auth: {
    signIn: 'Iniciar sesión',
    signUp: 'Registrarse',
    redirectingToDashboard: 'Redirigiendo al panel...',
    signOut: 'Cerrar sesión',
    forgotPassword: '¿Olvidaste tu contraseña?',
    resetPassword: 'Restablecer contraseña',
    dontHaveAccount: '¿No tienes una cuenta?',
    alreadyHaveAccount: '¿Ya tienes una cuenta?',
    signInWith: 'Iniciar sesión con',
    signUpWith: 'Registrarse con',
    orContinueWith: 'o continuar con',
    rememberMe: 'Recordarme',
    emailRequired: 'El correo electrónico es obligatorio',
    passwordRequired: 'La contraseña es obligatoria',
    invalidEmail: 'Dirección de correo electrónico no válida',
    passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
    passwordsDontMatch: 'Las contraseñas no coinciden',
    successfulSignIn: 'Inicio de sesión exitoso',
    successfulSignUp: 'Registro exitoso',
    verifyEmail:
      'Por favor, verifica tu correo electrónico para confirmar tu cuenta',
    successfulSignOut: 'Cierre de sesión exitoso',
    signOutFailed: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
    checkingAuthentication: 'Verificando autenticación...',
    loadingAccount: 'Cargando tu cuenta...',
    processingRequest: 'Procesando tu solicitud...',
    signInToAccount: 'Inicia sesión en tu cuenta',
    accessPlatform:
      'Accede a la plataforma de segmentación de imágenes de microscopía',
    emailAddress: 'Dirección de correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    password: 'Contraseña',
    passwordPlaceholder: '••••••••',
    signingIn: 'Iniciando sesión...',
    redirectingToSignIn: 'Redirigiendo al inicio de sesión...',
    fillAllFields: 'Por favor, completa todos los campos',
    signInSuccess: 'Inicio de sesión exitoso',
    signInFailed: 'Error en el inicio de sesión',
    registrationSuccess: 'Registro exitoso',
    registrationFailed: 'Error en el registro',
    logoutFailed: 'Error al cerrar sesión',
    profileUpdateFailed: 'Error al actualizar el perfil',
    welcomeMessage:
      'Bienvenido a la plataforma de segmentación de imágenes de microscopía',
    confirmationRequired:
      'El texto de confirmación es obligatorio y debe coincidir con tu dirección de correo electrónico',
    agreeToTerms: 'Al iniciar sesión, aceptas nuestros',
    termsOfService: 'Términos de Servicio',
    and: 'y',
    privacyPolicy: 'Política de Privacidad',
    createAccount: 'Crea tu cuenta',
    signUpPlatform:
      'Regístrate para usar la plataforma de segmentación de imágenes de microscopía',
    confirmPassword: 'Confirmar contraseña',
    passwordsMatch: 'Las contraseñas coinciden',
    passwordsDoNotMatch: 'Las contraseñas no coinciden',
    agreeToTermsCheckbox: 'Acepto los',
    mustAgreeToTerms: 'Debes aceptar los términos y condiciones',
    creatingAccount: 'Creando cuenta...',
    alreadyLoggedIn: 'Ya has iniciado sesión',
    alreadySignedUp: 'Ya te has registrado e iniciado sesión.',
    goToDashboard: 'Ir al Panel',
    signUpFailed: 'Error en el registro',
    enterEmailForReset: 'Ingresa tu email para restablecer contraseña',
    sending: 'Enviando...',
    sendNewPassword: 'Enviar nueva contraseña',
    emailSent: 'Email enviado',
    checkEmailForNewPassword: 'Revisa tu email para la nueva contraseña',
    resetPasswordEmailSent: 'Email de restablecimiento de contraseña enviado',
    resetPasswordError: 'Error al restablecer contraseña',
    backToSignIn: 'Volver al inicio de sesión',
    didntReceiveEmail: '¿No recibiste el email?',
    rememberPassword: '¿Recordaste tu contraseña?',
    tryAgain: 'Intentar de nuevo',
    tokenMissing: 'Token de autenticación no encontrado',
    tokenExpired: 'Token de autenticación expirado',
    pleaseSignInAgain: 'Por favor, inicia sesión de nuevo',
    enterNewPassword: 'Ingresa tu nueva contraseña',
    newPassword: 'Nueva contraseña',
    confirmPasswordPlaceholder: 'Confirma tu contraseña',
    passwordRequirements: 'La contraseña debe tener al menos 8 caracteres',
    resettingPassword: 'Restableciendo contraseña...',
    passwordResetSuccess: 'Contraseña restablecida con éxito',
    passwordResetSuccessMessage:
      'Tu contraseña ha sido restablecida con éxito. Ahora puedes iniciar sesión con tu nueva contraseña.',
    invalidResetToken: 'Enlace de restablecimiento inválido',
    invalidResetTokenMessage:
      'Este enlace de restablecimiento de contraseña es inválido o ha expirado. Por favor, solicita un nuevo restablecimiento.',
    requestNewReset: 'Solicitar nuevo restablecimiento',
  },
  profile: {
    title: 'Perfil',
    about: 'Acerca de',
    activity: 'Actividad',
    projects: 'Proyectos',
    papers: 'Artículos',
    analyses: 'Análisis',
    recentProjects: 'Proyectos recientes',
    recentAnalyses: 'Análisis recientes',
    accountDetails: 'Detalles de cuenta',
    accountType: 'Tipo de cuenta',
    joinDate: 'Fecha de registro',
    lastActive: 'Última actividad',
    projectsCreated: 'Proyectos creados',
    imagesUploaded: 'Imágenes subidas',
    segmentationsCompleted: 'Segmentaciones completadas',
    editProfile: 'Editar perfil',
    joined: 'Unido',
    copyApiKey: 'Copiar clave API',
    collaborators: 'Colaboradores',
    noCollaborators: 'Sin colaboradores',
    connectedAccounts: 'Cuentas conectadas',
    connect: 'Conectar',
    recentActivity: 'Actividad reciente',
    noRecentActivity: 'Sin actividad reciente',
    statistics: 'Estadísticas',
    totalImagesProcessed: 'Total de imágenes procesadas',
    averageProcessingTime: 'Tiempo promedio de procesamiento',
    fromLastMonth: 'desde el mes pasado',
    storageUsed: 'Almacenamiento usado',
    of: 'de',
    apiRequests: 'Solicitudes API',
    thisMonth: 'este mes',
    recentPublications: 'Publicaciones recientes',
    viewAll: 'Ver todo',
    noPublications: 'Aún no hay publicaciones',
    today: 'hoy',
    yesterday: 'ayer',
    daysAgo: 'días atrás',
    completionRate: 'tasa de finalización',
    createdProject: 'Creó proyecto',
    completedSegmentation: 'Completó segmentación para',
    uploadedImage: 'Subió imagen',
    avatar: {
      uploadButton: 'Subir Avatar',
      selectFile: 'Seleccionar imagen de avatar',
      cropTitle: 'Recortar tu Avatar',
      cropDescription: 'Recorta tu avatar para que encaje perfectamente',
      zoomLevel: 'Nivel de Zoom',
      cropInstructions:
        'Arrastra para reposicionar, usa el control deslizante para hacer zoom',
      applyChanges: 'Aplicar Cambios',
      processing: 'Procesando...',
      invalidFileType:
        'Tipo de archivo inválido. Por favor selecciona un archivo de imagen.',
      fileTooLarge: 'Archivo demasiado grande. El tamaño máximo es 5MB.',
      cropError: 'Error al procesar la imagen. Por favor inténtalo de nuevo.',
      uploadSuccess: 'Avatar subido exitosamente',
      uploadError: 'Error al subir el avatar. Por favor inténtalo de nuevo.',
    },
  },
  segmentation: {
    selection: {
      selectAll: 'Seleccionar todo',
      deselectAll: 'Deseleccionar todo',
      selected: '{{count}} seleccionados',
    },
    resizeSidebar: 'Redimensionar panel',
    trackOps: {
      propagateSelectedSuccess:
        '{{count}} microtúbulos propagados a los fotogramas siguientes',
      propagateSelectedPartial: '{{done}} de {{total}} microtúbulos propagados',
      deleteSelectedPartial: '{{done}} de {{total}} microtúbulos eliminados',
      propagateSuccess:
        'Microtúbulo propagado a {{count}} fotogramas siguientes',
      propagateFailed: 'No se pudo propagar el microtúbulo',
      deleteTrackSuccess: 'Traza eliminada de {{count}} fotogramas',
      deleteTrackFailed: 'No se pudo eliminar la traza',
      deleteFrameSuccess:
        'Microtúbulo eliminado de este fotograma; el resto de su traza no cambia',
      deleteFrameFailed: 'No se pudo eliminar el microtúbulo de este fotograma',
      deleteScopeUnavailable:
        'El vídeo aún se está cargando: vuelve a eliminar este microtúbulo en un momento',
    },
    modelNotCompatible:
      'El modelo "{{model}}" no es compatible con el tipo de proyecto "{{type}}". Permitidos: {{allowed}}.',
    incompatibleModelTitle: 'No se puede segmentar con este modelo',
    incompatibleModelDesc:
      'El modelo seleccionado "{{model}}" no es compatible con el tipo de este proyecto ({{type}}). Modelos permitidos: {{allowed}}. Cambie el modelo en Configuración o cambie el tipo de proyecto.',
    channelPicker: {
      title: 'Seleccionar canal para segmentar',
      description:
        'Este proyecto contiene fotogramas de vídeo con varios canales. Elija qué canal segmentar.',
      confirm: 'Segmentar',
    },
    mode: {
      view: 'Ver y navegar',
      edit: 'Editar',
      editVertices: 'Editar vértices',
      addPoints: 'Añadir puntos',
      create: 'Crear',
      createPolygon: 'Crear polígono',
      createPolyline: 'Crear polilínea',
      slice: 'Cortar',
      delete: 'Eliminar',
      deletePolygon: 'Eliminar polígono',
      unknown: 'Desconocido',
    },
    modeDescription: {
      view: 'Navegar y seleccionar polígonos',
      edit: 'Mover y modificar vértices',
      addPoints: 'Añadir puntos entre vértices',
      create: 'Crear nuevos polígonos',
      createPolyline:
        'Haz clic para colocar puntos, doble clic para finalizar la polilínea',
      slice: 'Dividir polígonos con una línea',
      delete: 'Eliminar polígonos',
    },
    toolbar: {
      mode: 'Modo',
      keyboard: 'Tecla: {{key}}',
      requiresSelection: 'Requiere selección de polígono',
      requiresPolygonSelection: 'Requiere selección de polígono',
      resegment: 'Resegmentar fotograma',
      resegmentTooltipModel: 'Modelo: {{model}} · {{threshold}}',
      resegmentSuccess: 'Fotograma resegmentado',
      resegmentFailed: 'Falló la resegmentación',
      resegmentConfirmTitle: '¿Reemplazar polígonos existentes?',
      resegmentConfirmDescription:
        'Ejecutar el modelo sobrescribirá la segmentación actual. Las ediciones manuales de polígonos en este fotograma se perderán.',
      select: 'Seleccionar',
      undoTooltip: 'Deshacer (Ctrl+Z)',
      undo: 'Deshacer',
      redoTooltip: 'Rehacer (Ctrl+Y)',
      redo: 'Rehacer',
      zoomInTooltip: 'Acercar (+)',
      zoomIn: 'Acercar',
      zoomOutTooltip: 'Alejar (-)',
      zoomOut: 'Alejar',
      resetViewTooltip: 'Restablecer vista (R)',
      resetView: 'Restablecer',
      unsavedChanges: 'Cambios no guardados',
      saving: 'Guardando...',
      save: 'Guardar',
      keyboardShortcuts:
        'V: Ver • E: Editar • A: Añadir • N: Nuevo • S: Cortar • D: Eliminar',
      nothingToSave: 'Todos los cambios guardados',
    },
    status: {
      polygons: 'polígonos',
      vertices: 'vértices',
      visible: 'visibles',
      hidden: 'ocultos',
      selected: 'seleccionado',
      saved: 'Guardado',
      unsaved: 'No guardado',
      noPolygons: 'Sin polígonos',
      startCreating: 'Comience creando un polígono',
      polygonList: 'Lista de Polígonos',
      external: 'Externo',
      internal: 'Interno',
      polyline: 'Polilínea',
    },
    // Object classes of the neurite/soma model. Deliberately NOT under
    // `sperm.part` — different model, different vocabulary.
    partClass: {
      neurite: 'Neurita',
      soma: 'Soma',
    },
    shortcuts: {
      buttonText: 'Atajos',
      title: 'Atajos de Teclado',
      dialogTitle: 'Atajos de Teclado',
      footerNote:
        'Estos atajos funcionan dentro del editor de segmentación para un trabajo más rápido y conveniente.',

      // Categories
      categories: {
        modes: 'Modos de Edición',
        actions: 'Acciones',
        view: 'Controles de Vista',
        navigation: 'Navegación',
      },

      // Mode shortcuts
      viewMode: 'Modo vista',
      editVertices: 'Modo editar vértices',
      addPoints: 'Modo agregar puntos',
      createPolygon: 'Crear nuevo polígono',
      sliceMode: 'Modo cortar',
      deleteMode: 'Modo eliminar',

      // Action shortcuts
      save: 'Guardar',
      undo: 'Deshacer',
      redo: 'Rehacer',
      deleteSelected: 'Eliminar polígono seleccionado',
      finishShape: 'Finalizar la forma actual',

      // View shortcuts
      zoom: 'Acercar/Alejar',
      resetView: 'Restablecer vista',
      fitToScreen: 'Ajustar a pantalla',

      // Navigation shortcuts
      cycleModes: 'Alternar entre modos',
      cycleModesReverse: 'Alternar modos (reversa)',
      cancel: 'Cancelar operación actual',
      showHelp: 'Mostrar esta ayuda',

      // Conditions
      requiresSelection: 'Requiere selección de polígono',

      // Legacy keys (kept for backward compatibility)
      v: 'Modo vista',
      e: 'Modo editar vértices',
      a: 'Modo agregar puntos',
      n: 'Crear nuevo polígono',
      s: 'Modo cortar',
      d: 'Modo eliminar',
      shift: 'Mantener para adición automática de puntos',
      ctrlZ: 'Deshacer',
      ctrlY: 'Rehacer',
      delete: 'Eliminar polígono seleccionado',
      esc: 'Cancelar operación actual',
      plus: 'Acercar',
      minus: 'Alejar',
      r: 'Restablecer vista',
    },
    tips: {
      header: 'Consejos:',
      edit: {
        createPoint: 'Haz clic para crear un nuevo punto',
        holdShift:
          'Mantén Shift para crear automáticamente secuencia de puntos',
        closePolygon: 'Cierra el polígono haciendo clic en el primer punto',
      },
      slice: {
        startSlice: 'Haz clic para comenzar el corte',
        endSlice: 'Haz clic nuevamente para completar el corte',
        cancelSlice: 'Esc cancela el corte',
      },
      addPoints: {
        hoverLine: 'Sitúa el cursor sobre la línea del polígono',
        clickAdd: 'Haz clic para agregar punto al polígono seleccionado',
        escCancel: 'Esc termina el modo agregar',
      },
    },
    helpTips: {
      editMode: [
        'Haz clic para crear un nuevo punto',
        'Mantén Shift para crear automáticamente secuencia de puntos',
        'Cierra el polígono haciendo clic en el primer punto',
      ],
      slicingMode: [
        'Haz clic para comenzar el corte',
        'Haz clic nuevamente para terminar el corte',
        'Esc cancela el corte',
      ],
      pointAddingMode: [
        'Sitúa el cursor sobre la línea del polígono',
        'Haz clic para agregar punto al polígono seleccionado',
        'Esc sale del modo agregar',
      ],
    },
    loading: 'Cargando segmentación...',
    noPolygons: 'No se encontraron polígonos',
    polygonNotFound: 'Polígono no encontrado',
    invalidSlice: 'Operación de corte inválida',
    sliceSuccess: 'Polígono cortado exitosamente',
    sliceFailed: 'Error al cortar el polígono',
    instructions: {
      slice: {
        selectPolygon:
          '1. Haz clic en un polígono para seleccionarlo para cortar',
        placeFirstPoint: '2. Haz clic para colocar el primer punto de corte',
        placeSecondPoint:
          '3. Haz clic para colocar el segundo punto de corte y realizar el corte',
        cancel: 'Presiona ESC para cancelar',
      },
      create: {
        startPolygon: '1. Haz clic para comenzar a crear un polígono',
        continuePoints:
          '2. Continúa haciendo clic para agregar más puntos (se necesitan al menos 3)',
        finishPolygon:
          '3. Continúa agregando puntos o haz clic cerca del primer punto para cerrar el polígono',
        holdShift: 'Mantén SHIFT para agregar puntos automáticamente',
        cancel: 'Presiona ESC para cancelar',
      },
      createPolyline: {
        start: 'Haga clic para colocar el primer punto del microtúbulo',
        finish: 'Pulse Enter o haga doble clic para finalizar el microtúbulo',
        holdShift: 'Mantenga SHIFT para añadir puntos automáticamente',
        cancel: 'Pulse ESC para cancelar',
      },
      addPoints: {
        clickVertex:
          'Haz clic en cualquier vértice para comenzar a agregar puntos',
        clickVertexMt:
          'Haga clic en un extremo del microtúbulo para extenderlo',
        addPointsMt:
          'Haga clic para añadir puntos y pulse Enter o haga doble clic para finalizar',
        addPoints:
          'Haz clic para agregar puntos, luego haz clic en otro vértice para completar. Haz clic directamente en otro vértice sin agregar puntos para eliminar todos los puntos entre ellos.',
        holdShift: 'Mantén SHIFT para agregar puntos automáticamente',
        cancel: 'Presiona ESC para cancelar',
        joinHint:
          'Haz clic en el extremo de otra polilínea para unirlas: las etiquetas deben coincidir, salvo que una parte no tenga etiqueta',
      },
      editVertices: {
        selectPolygon: 'Haz clic en un polígono para seleccionarlo para editar',
        dragVertices: 'Haz clic y arrastra vértices para moverlos',
        addPoints: 'Mantén SHIFT y haz clic en un vértice para agregar puntos',
        deleteVertex: 'Doble clic en un vértice para eliminarlo',
      },
      deletePolygon: {
        clickToDelete: 'Haz clic en un polígono para eliminarlo',
      },
      view: {
        selectPolygon: 'Haz clic en un polígono para seleccionarlo',
        navigation: 'Arrastra para desplazar • Desplaza para acercar',
      },
      modes: {
        slice: 'Modo cortar',
        create: 'Modo crear polígono',
        createPolyline: 'Modo crear microtúbulo',
        addPoints: 'Modo agregar puntos',
        editVertices: 'Modo editar vértices',
        deletePolygon: 'Modo eliminar polígono',
        view: 'Modo vista',
      },
      shiftIndicator: '⚡ SHIFT: Agregando puntos automáticamente',
    },
  },
  status: {
    segmented: 'Segmentado',
    processing: 'Procesando',
    queued: 'En cola',
    failed: 'Fallido',
    no_segmentation: 'Sin segmentación',
    disconnected: 'Desconectado del servidor',
    error: 'Error del servicio ML',
    ready: 'Listo para segmentación',
    online: 'En línea',
    offline: 'Fuera de línea',
    noPolygons: 'Sin polígonos',
  },
  queue: {
    title: 'Cola de Segmentación',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    waiting: 'esperando',
    processing: 'procesando',
    resegmentSelected: 'Re-segmentar Seleccionadas ({{count}})',
    segmentSelected: 'Segmentar Seleccionadas',
    segmentSelectedWithCount: 'Segmentar Seleccionadas ({{count}})',
    selectNothingTooltip: 'Seleccione imágenes para segmentar',
    segmentMixed:
      'Segmentar {{new}} + Re-segmentar {{resegment}} ({{total}} total)',
    segmentTooltip:
      '{{new}} imágenes nuevas serán segmentadas, {{resegment}} imágenes seleccionadas serán re-segmentadas',
    totalProgress: 'Progreso Total',
    images: 'imágenes',
    loadingStats: 'Cargando estadísticas...',
    connectingMessage:
      'Conectando al servidor... Las actualizaciones en tiempo real estarán disponibles pronto.',
    emptyMessage:
      'No hay imágenes en cola. Sube imágenes y añádelas a la cola para segmentación.',
    addingToQueue: 'Añadiendo a la cola...',
    cancelSegmentation: 'Cancelar Segmentación',
    segmentationCancelled: '{{count}} segmentación cancelada',
    segmentationCancelled_other: '{{count}} segmentaciones canceladas',
    cancelFailed: 'No se pudo cancelar la segmentación',
    // Cancel All functionality
    cancelAll: 'Cancelar Todo',
    cancelAllTooltip: 'Cancelar las {{count}} tarea(s) de segmentación',
    confirmCancelAll: '¿Cancelar Todas las Segmentaciones?',
    confirmCancelAllDescription:
      'Estás a punto de cancelar {{count}} tarea(s) de segmentación en todos tus proyectos.',
    processingTasks: '{{count}} tarea(s) procesándose actualmente',
    queuedTasks: '{{count}} tarea(s) en cola',
    cancelAllWarning:
      'Esta acción no se puede deshacer. Las tareas canceladas necesitarán ser reenviadas.',
    confirmCancelAllButton: 'Sí, Cancelar {{count}} Tarea(s)',
    cancellingAllSegmentations: 'Cancelando todas las segmentaciones...',
    allSegmentationsCancelled:
      'Se cancelaron exitosamente {{count}} segmentación(es)',
    affectedProjects: '{{count}} proyecto(s) afectado(s)',
    cancelAllFailed: 'Error al cancelar las segmentaciones',
    cancelAllError: 'Error cancelando las segmentaciones',
    cancelling: 'Cancelando...',
    processingSlots: 'Ranuras de procesamiento',
    parallel: 'en paralelo',
    users: 'usuarios',
    active: 'activo',
    you: 'Tú',
    yourSlot: 'Tu ranura: #{{slot}}',
    concurrentUsers: 'También procesando: {{users}}',
    availableSlots: '{{count}} ranura disponible',
    availableSlots_other: '{{count}} ranuras disponibles',
    yourPosition: 'Tu posición',
    estimatedWait: 'Espera est.',
    allSlotsActive:
      'Todas las ranuras de procesamiento están activas: capacidad máxima de procesamiento paralelo alcanzada',
    slotAvailable:
      '¡Ranura de procesamiento disponible! Posición #{{position}} (~{{waitTime}} min de espera)',
  },
  toast: {
    error: 'Ha ocurrido un error',
    success: 'Operación exitosa',
    info: 'Información',
    warning: 'Advertencia',
    loading: 'Cargando...',
    failedToUpdate: 'Error al actualizar datos. Inténtalo de nuevo.',
    fillAllFields: 'Por favor, completa todos los campos',
    operationFailed: 'La operación falló. Inténtalo de nuevo.',
    unexpectedError: 'Error Inesperado',
    somethingWentWrong: 'Algo salió mal. Por favor, inténtalo más tarde.',
    somethingWentWrongPage: 'Algo salió mal al cargar esta página.',
    returnToHome: 'Volver al Inicio',
    operationCompleted: 'Operación completada exitosamente',
    dataSaved: 'Datos guardados exitosamente',
    dataUpdated: 'Datos actualizados exitosamente',
    reconnecting: 'Reconectando al servidor...',
    reconnected: 'Conexión al servidor restaurada',
    connectionFailed: 'Error al restaurar la conexión al servidor',
    segmentationRequested: 'Solicitud de segmentación enviada',
    segmentationCompleted: 'Segmentación de imagen completada',
    segmentationFailed: 'La segmentación falló',
    segmentationResultFailed: 'Error al obtener el resultado de segmentación',
    segmentationStatusFailed: 'Error al verificar el estado de segmentación',
    exportCompleted: '¡Exportación completada exitosamente!',
    exportFailed: 'La exportación falló. Inténtalo de nuevo.',
    project: {
      created: 'Proyecto creado exitosamente',
      createFailed: 'Error al crear el proyecto',
      deleted: 'Proyecto eliminado exitosamente',
      deleteFailed: 'Error al eliminar el proyecto',
      urlCopied: 'URL del proyecto copiada al portapapeles',
      unshared: 'Proyecto eliminado de compartidos',
      notFound: 'Proyecto no encontrado',
      invalidResponse: 'La respuesta del servidor fue inválida',
      readyForImages: 'está listo para imágenes',
      createdAtRootInstead: 'Proyecto creado en el nivel superior',
      moveToFolderFailed:
        'No se pudo archivar en la carpeta actual: muévelo allí manualmente.',
      selected: '{{count}} imagen seleccionada',
      selected_other: '{{count}} imágenes seleccionadas',
      deleteSelected: 'Eliminar Seleccionadas',
    },
    profile: {
      consentUpdated:
        'Preferencias de consentimiento actualizadas exitosamente',
      loadFailed: 'Error al cargar datos del perfil',
    },
    upload: {
      failed: 'Error al actualizar imágenes después de la carga',
      cancelUpload: 'Cancelar carga',
      uploadCancelled: 'Carga cancelada',
      uploadCancelledSuccess: 'Carga cancelada exitosamente',
      redirectingToGallery: 'Redirigiendo a la galería de imágenes...',
    },
    segmentation: {
      saved: 'Segmentación guardada exitosamente',
      failed: 'La segmentación falló',
      deleted: 'Polígono eliminado',
      cannotDeleteVertex:
        'No se puede eliminar vértice - el polígono necesita al menos 3 puntos',
      vertexDeleted: 'Vértice eliminado exitosamente',
      joinClassMismatch:
        'Estas polilíneas tienen etiquetas diferentes y no se pueden unir',
      started: 'La segmentación ha comenzado',
      completed: 'Segmentación completada exitosamente',
      completedWithCount:
        '¡Segmentación completa! Se encontraron {{count}} objetos',
      batchStarted: 'Segmentación iniciada para {{count}} imágenes',
      batchCompleted:
        '✅ {{count}} imágenes segmentadas exitosamente ({{duration}}s)',
      batchCompletedWithErrors:
        '⚠️ Lote completado: {{successful}} exitosas, {{failed}} fallidas ({{duration}}s)',
      noPolygons: 'No se detectaron polígonos de segmentación',
      reloadFailed:
        'Error al cargar los resultados de segmentación. Por favor, actualiza la página.',
      autosaveFailed:
        'Error en guardado automático - los cambios pueden perderse',
    },
    // Multi-channel canvas actions
    multiChannel: {
      allChannelsFailed: 'Error al cargar los canales de imagen',
      someChannelsFailed: 'Algunos canales de imagen no se pudieron cargar',
    },
  },
  project: {
    selected: '{{count}} imagen seleccionada',
    selected_other: '{{count}} imágenes seleccionadas',
    deleteSelected: 'Eliminar Seleccionadas',
    deleteAnnotations: 'Eliminar anotaciones',
    addChannel: 'Añadir canal',
    addChannelSuccess: 'Canal {{channels}} añadido a {{frames}} fotograma(s)',
    addChannelAlignWarning:
      'La alineación falló en {{failed}} de {{frames}} fotograma(s): solo se registraron {{shifted}}. No se pudieron correlacionar los canales (sin estructura común); los fotogramas se añadieron sin desplazar.',
    addChannelAlignWarningImplausible:
      'La alineación falló en {{failed}} de {{frames}} fotograma(s): solo se registraron {{shifted}}. Se encontró un desplazamiento claro, pero demasiado grande para ser plausible, así que se descartó y los fotogramas se añadieron sin desplazar. Comprueba que el canal añadido procede del mismo campo de visión y no está recortado ni desplazado respecto al vídeo de destino.',
    addChannelAlignWarningShape:
      'La alineación falló en {{failed}} de {{frames}} fotograma(s): solo se registraron {{shifted}}. El canal añadido y los fotogramas de destino tienen dimensiones en píxeles distintas, por lo que no se pudieron alinear; los fotogramas se añadieron sin desplazar.',
    addChannelFailed: 'No se pudo añadir el canal',
    addChannelDialog: {
      title: 'Añadir canal',
      description:
        'Añade un canal extra a los fotogramas seleccionados subiendo un vídeo/pila con el mismo número de fotogramas, o una sola imagen que se aplicará a cada fotograma seleccionado.',
      selectionSummary:
        '{{frames}} fotograma(s) en {{videos}} vídeo(s) seleccionados.',
      sourceLabel: 'Archivo de origen (vídeo / pila / imagen)',
      dropPrompt:
        'Arrastre y suelte un archivo aquí, o haga clic para seleccionar',
      dropInvalidType: 'Tipo de archivo no compatible.',
      dropTooManyFiles: 'Solo se puede añadir un archivo a la vez.',
      removeFile: 'Quitar archivo',
      imageHint: 'Una sola imagen → se aplica a cada fotograma seleccionado.',
      videoHint:
        'Vídeo/pila → debe tener exactamente {{frames}} fotograma(s) y pertenecer a un solo vídeo.',
      nameLabel: 'Nombre del canal',
      namePlaceholder: 'p. ej. GFP',
      alignLabel: 'Alinear con el canal de segmentación',
      alignHint:
        'Registro por correlación de fase que corrige una pequeña deriva de la platina.',
      multiVideoError:
        'Un vídeo/pila solo puede añadirse a fotogramas de un único vídeo. Selecciona fotogramas de un solo vídeo o sube una sola imagen.',
      uploading: 'Subiendo… {{percent}} %',
      adding: 'Añadiendo…',
      confirm: 'Añadir canal',
    },
    annotationsDeleted: 'Anotaciones eliminadas de {{count}} imagen(es)',
    annotationsDeleteFailed:
      'No se pudieron eliminar las anotaciones de {{count}} imagen(es)',
    deleteAnnotationsDialog: {
      title: '¿Eliminar anotaciones?',
      description:
        'Esto elimina las anotaciones de segmentación de {{count}} imagen(es) seleccionada(s). Las imágenes se conservan, pero se eliminan sus resultados de segmentación. Esta acción no se puede deshacer.',
    },
    imagesDeleted: '{{count}} imagen eliminada',
    imagesDeleted_other: '{{count}} imágenes eliminadas',
  },
  export: {
    mtKymographs: {
      title: 'Análisis de velocidad por kimografía',
      description:
        'Detecta partículas en movimiento en un kimograma para cada microtúbulo y exporta sus velocidades.',
      enable: 'Incluir análisis de kimografía',
      velocityMetrics: 'Métricas de velocidad (CSV)',
      segmentedImages: 'Imágenes de kimograma segmentadas (PNG)',
      modeKymograph: 'Kimograma (espacio × tiempo)',
      modeProfiles: 'Perfiles de intensidad (por imagen)',
      singleFrameHint:
        'Un solo fotograma: un kimograma necesita una serie temporal, por lo que solo se exporta el perfil de intensidad.',
      profilesHint:
        'Exporta un gráfico de matplotlib de intensidad frente a posición por fotograma, además del CSV de intensidad.',
      lineWidthLabel: 'Ancho de línea (px)',
      lineWidthHelp:
        'Ancho de la línea muestreada a lo largo de cada microtúbulo, medido transversalmente. 1 muestrea un solo píxel. Se aplica igual a los kimogramas y a los perfiles de intensidad.',
      lineReduceLabel: 'A lo ancho',
      lineReduceHelp:
        'Cómo los píxeles a lo ancho se convierten en un solo valor. La media coincide con ImageJ; el máximo es más brillante pero se sesga por píxeles calientes aislados.',
      lineReduceMean: 'Media',
      lineReduceMax: 'Máximo',
      minIntensityLabel: 'Intensidad mínima de trayectoria',
      minIntensityHelp:
        'Descartar trayectorias más tenues que este número de unidades de intensidad sobre su propio fondo. Absoluto, no depende del escalado de la imagen, pero no es comparable entre canales. Vacío conserva todas.',
    },
    mt: {
      sectionTitle: 'Métricas de microtúbulos',
      sectionDescription:
        'Longitud, área e intensidad por canal de cada MT desde el archivo ND2/TIFF original. Corregido con la mediana del fondo (fuera de la máscara MT dilatada).',
      intensityNote:
        'La intensidad de señal por canal —incluida la intensidad sumada (integrada)— se calcula siempre para cada canal y se escribe en la hoja de métricas. No es necesario seleccionar nada.',
      wideNote:
        'Cada canal tiene su propia fila en metrics.csv (véase la columna «channel»). El archivo complementario metrics_wide.csv —una hoja adicional en metrics.xlsx— coloca todos los canales del mismo microtúbulo en una sola fila, con un conjunto de columnas por canal.',
      thicknessLabel: 'Grosor del MT (px)',
      thicknessHelp:
        'Ancho de la banda de muestreo a lo largo de cada polilínea. 5 px corresponde al diámetro típico del microtúbulo a 100× campo amplio.',
      marginLabel: 'Margen del fondo (× grosor)',
      marginHelp:
        'Excluye píxeles dentro de este radio (grosor × multiplicador) de cualquier MT del fondo. Mayor = más conservador.',
    },
    advancedExport: 'Exportación Avanzada',
    advancedOptions: 'Opciones Avanzadas de Exportación',
    configureSettings:
      'Configure los ajustes de exportación para crear un paquete de datos integral',
    general: 'General',
    visualization: 'Visualización',
    exportContents: 'Contenido de Exportación',
    selectContent:
      'Seleccione qué tipos de contenido incluir en su exportación',
    includeOriginal: 'Incluir imágenes originales',
    includeVisualizations: 'Incluir visualizaciones con polígonos numerados',
    includeDocumentation: 'Incluir documentación y metadatos',
    selectedImages: 'Imágenes Seleccionadas',
    imagesSelected: '{{count}} de {{total}} imágenes seleccionadas',
    selectAll: 'Seleccionar Todo',
    allSelected: 'Todas las {{count}} imágenes seleccionadas',
    selectAllProject: 'Seleccionar Todas las {{count}} imágenes',
    selectNone: 'No Seleccionar Ninguna',
    imageSelection: 'Selección de Imágenes',
    chooseImages: 'Elija qué imágenes incluir en la exportación',
    searchImages: 'Buscar imágenes...',
    sortBy: 'Ordenar por',
    sortOptions: {
      date: 'Fecha',
      name: 'Nombre',
      status: 'Estado',
    },
    showingImages: 'Mostrando {{start}}-{{end}} de {{total}}',
    noImagesFound: 'No se encontraron imágenes',
    qualitySettings: 'Configuración de Calidad',
    imageQuality: 'Calidad de Imagen',
    compressionLevel: 'Nivel de Compresión',
    outputResolution: 'Resolución de Salida',
    colorSettings: 'Configuración de Color',
    backgroundColor: 'Color de Fondo',
    strokeColor: 'Color de Trazo',
    strokeWidth: 'Grosor de Trazo',
    fontSize: 'Tamaño de Fuente',
    showNumbers: 'Mostrar números de polígonos',
    showLabels: 'Mostrar etiquetas',
    scaleConversion: 'Conversión de Escala',
    pixelToMicrometerScale: 'Tamaño del Píxel',
    scaleDescription:
      'Especifique cuántos micrómetros representa un píxel para convertir mediciones',
    scalePlaceholder: 'ej. 0,5 (1 píxel = 0,5 µm)',
    scaleUnit: 'µm/píxel',
    scaleWarning:
      'Nota: Valor de escala superior a 1 µm/píxel indica magnificación muy baja. Por favor verifique.',
    outputSettings: 'Configuración de Salida',
    exportFormatsLabel: 'Formatos de exportación',
    exportFormats: {
      yolo: 'Formato YOLO',
      excel: 'Formato Excel',
      json: 'Formato JSON',
    },
    // Progress panel specific
    title: 'Progreso de Exportación',
    readyToDownload: 'Exportación lista para descargar',
    fallbackMode: 'Modo de sondeo',
    fallbackMessage:
      'Usando sondeo para actualizaciones de progreso debido a problemas de conexión',
    exportToZip: 'Exportar a archivo ZIP',
    generateExcel: 'Generar métricas de Excel',
    includeCocoFormat: 'Incluir anotaciones en formato COCO',
    includeJsonMetadata: 'Incluir metadatos JSON',
    microtubuleAnnotationsNote:
      'Los proyectos de microtúbulos exportan anotaciones como ImageJ RoiSet + CVAT 1.1 (siempre incluidas), cada una con la clase de tipo de tubulina. COCO/YOLO/JSON no se usan para microtúbulos.',
    preparing: 'Preparando exportación...',
    processing: 'Procesando {{current}} de {{total}}',
    processingExport: 'Procesando...',
    packaging: 'Creando paquete...',
    completed: 'Exportación completada',
    downloading: 'Descargando...',
    cancelling: 'Cancelando...',
    cancelled: 'Exportación cancelada',
    cancelExport: 'Cancelar exportación',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    reconnecting: 'Reconectando...',
    startExport: 'Iniciar Exportación',
    cancel: 'Cancelar',
    download: 'Descargar',
    retry: 'Reintentar',
    close: 'Cerrar',
    exportError: 'La exportación falló',
    exportFailed: 'Exportación fallida',
    exportComplete: 'Exportación completada',
    metricsExportComplete: 'Exportación de métricas completada',
    connectionError: 'Conexión perdida durante la exportación',
    serverError: 'Error del servidor ocurrido',
    invalidSelection: 'Por favor seleccione al menos una imagen',
    noData: 'No hay datos disponibles para exportar',
    segmentationData: 'Datos de segmentación',
    spermMetrics: 'Métricas de espermatozoides',
    cocoFormat: 'Formato COCO',
    cocoFormatTitle: 'Exportación de formato COCO',
    downloadJson: 'Descargar JSON',
    formatsTab: 'Formatos',
  },
  imageDeleted: 'Imagen eliminada exitosamente',
  deleteImageFailed: 'Error al eliminar imagen',
  deleteImageError: 'Error al eliminar imagen',
  imageAlreadyProcessing: 'La imagen ya está siendo procesada',
  processImageFailed: 'Error al procesar la imagen',
  exportDialog: {
    title: 'Opciones de Exportación',
    includeMetadata: 'Incluir metadatos',
    includeSegmentation: 'Incluir segmentación',
    includeObjectMetrics: 'Incluir métricas de objetos',
    exportMetricsOnly: 'Exportar solo métricas (XLSX)',
    selectImages: 'Seleccionar imágenes para exportar',
    selectAll: 'Seleccionar Todo',
    selectNone: 'Deseleccionar Todo',
    noImagesAvailable: 'No hay imágenes disponibles',
  },
  docs: {
    // Cabecera
    badge: 'Documentación',
    title: 'Documentación de SpheroSeg',
    subtitle:
      'Todo lo que hace la plataforma, para los siete tipos de proyecto — con búsqueda',
    backTo: 'Volver a {{page}}',

    // Búsqueda
    search: {
      placeholder: 'Buscar en la documentación…',
      hint: 'Pulse / para buscar. Las secciones coincidentes se filtran y resaltan.',
      results: '{{count}} sección(es) coincidente(s)',
      noResults: 'No hay coincidencias',
      noResultsHint:
        'Pruebe una consulta más corta o un término como «canal», «kimógrafo», «exportar» o «umbral».',
      clear: 'Borrar la búsqueda',
    },

    // Navegación
    navigation: 'Navegación',
    nav: {
      introduction: 'Introducción',
      gettingStarted: 'Primeros pasos',
      projectTypes: 'Tipos de proyecto',
      uploadingImages: 'Subir datos',
      videosChannels: 'Vídeos y canales',
      modelSelection: 'Modelos',
      segmentationProcess: 'Segmentación',
      segmentationEditor: 'Editor',
      exportFeatures: 'Exportación',
      automatedEssays: 'Ensayos automatizados',
      segmenter: 'Segmenter',
      sharedProjects: 'Compartir',
      troubleshooting: 'Resolución de problemas',
    },

    // Introducción
    introduction: {
      title: 'Introducción',
      whatIs: '¿Qué es SpheroSeg?',
      description:
        'SpheroSeg es una plataforma para la segmentación y medición asistidas por IA de imágenes de microscopía y vídeos de lapso de tiempo. Ofrece siete tipos de proyecto respaldados por once modelos de segmentación, un editor de polígonos y polilíneas, seguimiento de microtúbulos entre fotogramas y una canalización de exportación por lotes.',
      developedBy:
        'La plataforma fue desarrollada por Bc. Michal Průšek en la Facultad de Ciencias Nucleares e Ingeniería Física de la Universidad Técnica Checa de Praga, bajo la supervisión del Ing. Adam Novozámský, Ph.D., en colaboración con investigadores del Instituto de Bioquímica y Microbiología de la UCT de Praga.',
      addresses:
        'Empezó con el difícil problema de delimitar los bordes de los esferoides en microscopía y hoy abarca también esferoides en disgregación, ensayos de cicatrización, morfología de espermatozoides, lapsos de tiempo de microtúbulos, microcápsulas y neuronas en cultivo, cada uno con su modelo, sus medidas y su formato de exportación.',
    },

    // Primeros pasos
    gettingStarted: {
      title: 'Primeros pasos',
      accountCreation: 'Crear una cuenta',
      accountDescription:
        'El registro es abierto: no hay cola de aprobación. La cuenta mantiene juntos sus proyectos, imágenes y resultados.',
      accountSteps: {
        step1: 'Vaya a la página de registro',
        step2: 'Introduzca su correo electrónico y elija una contraseña',
        step3: 'Complete su perfil con su nombre y su institución',
        step4: 'En Configuración, elija modelo preferido, idioma y tema',
      },
      firstProject: 'Su primer proyecto',
      projectDescription:
        'Un proyecto contiene imágenes y las segmentaciones obtenidas de ellas. Su tipo decide qué modelos puede ejecutar, qué muestra el editor y cómo se exportan los resultados, así que elíjalo con criterio.',
      projectSteps: {
        step1: 'En el panel principal, pulse «Nuevo proyecto»',
        step2: 'Introduzca un nombre y, si quiere, una descripción',
        step3:
          'Elija el tipo de proyecto que corresponda a su muestra (véase Tipos de proyecto más abajo)',
        step4: 'Pulse «Crear proyecto» y suba sus datos',
      },
    },

    // Tipos de proyecto
    projectTypes: {
      title: 'Tipos de proyecto',
      description:
        'Cada proyecto tiene un tipo que se elige al crearlo. No es una simple etiqueta: determina qué modelos están disponibles, qué geometría producen, qué paneles muestra el editor y qué archivos obtiene al exportar.',
      types: {
        spheroid: {
          name: 'Esferoides (estándar)',
          bestFor:
            'Para: esferoides celulares en campo claro o contraste de fases. El único tipo que ofrece elección de modelo, y son cinco.',
          output: 'Resultado: polígonos cerrados con agujeros opcionales.',
        },
        spheroidInvasive: {
          name: 'Esferoides en disgregación',
          bestFor:
            'Para: esferoides que se dispersan en una matriz. La cifra principal es el índice de disgregación anclado al núcleo.',
          output:
            'Resultado: polígonos cerrados; el núcleo denso se predice como clase propia y se dibuja en verde.',
        },
        wound: {
          name: 'Cicatrización de heridas',
          bestFor:
            'Para: lapsos de tiempo de ensayos de arañazo. Añade una curva de cierre sobre toda la serie.',
          output:
            'Resultado: polígonos cerrados sobre la herida abierta, más una hoja con el área de la herida a lo largo del tiempo y su gráfico.',
        },
        sperm: {
          name: 'Espermatozoides',
          bestFor:
            'Para: morfología de espermatozoides, medida en tres partes por célula: cabeza, pieza intermedia y cola.',
          output:
            'Resultado: polilíneas abiertas con clase de parte e identificador de instancia, en verde, naranja y cian.',
        },
        microtubules: {
          name: 'Microtúbulos',
          bestFor:
            'Para: lapsos de tiempo IRM de microtúbulos, con seguimiento entre fotogramas, intensidad por canal y kimógrafos.',
          output:
            'Resultado: polilíneas abiertas con un identificador de traza estable; se exportan como ROIs de ImageJ y CVAT en lugar de COCO o YOLO.',
        },
        microcapsule: {
          name: 'Microcápsulas',
          bestFor:
            'Para: microcápsulas redondas en campo claro, incluidas las que se tocan entre sí.',
          output:
            'Resultado: un polígono cerrado por cápsula. Las cápsulas cortadas por el borde de la imagen quedan fuera de las métricas.',
        },
        neurite: {
          name: 'Neuritas y somas',
          bestFor:
            'Para: neuronas en cultivo en microscopía de fluorescencia, leídas del canal de tubulina. La pregunta es cuánto de la célula es cuerpo y cuánto es prolongación.',
          output:
            'Salida: polígonos cerrados en dos clases — soma (el cuerpo celular) y neurita (las prolongaciones) — dibujados en magenta y cian.',
        },
      },
      note: 'Elija el tipo antes de subir los datos.',
      noteText:
        'La compatibilidad de modelos sigue al tipo de proyecto, de modo que cambiarlo después implica que los resultados existentes ya no podrán recalcularse con el modelo que los produjo.',
    },

    // Subir datos
    uploadImages: {
      title: 'Subir datos',
      description:
        'La plataforma acepta tanto imágenes sueltas como datos de lapso de tiempo. Un vídeo, un ND2 o un TIFF de varias páginas se convierte en un contenedor con una entrada por fotograma.',
      formats: 'Formatos admitidos y límites',
      formatsTable: {
        kind: 'Tipo',
        extensions: 'Formatos',
        limit: 'Tamaño máximo',
        imagesLabel: 'Imágenes sueltas',
        imagesLimit: '20 MB por archivo',
        videosLabel: 'Vídeos y pilas',
        videosLimit: '100 GB por archivo',
      },
      methods: 'Cómo subir archivos',
      methodsDescription: 'Tres formas equivalentes:',
      methodsList: {
        dragDrop: 'Arrastre y suelte los archivos en la zona de subida',
        browse: 'Pulse en la zona de subida para buscar archivos',
        batch:
          'Suelte una carpeta entera: se recorre de forma recursiva, hasta 10 000 archivos por lote',
        autoSegment:
          'Marque «Segmentar automáticamente tras la subida» para encolarlo todo según llega',
      },
      tiffNote: 'Un TIFF puede ser cualquiera de las dos cosas.',
      tiffNoteText:
        'Un TIFF se trata como pila cuando supera los 20 MB o cuando realmente contiene más de una página: se inspecciona la cabecera del archivo, así que incluso un TIFF multicanal pequeño se procesa correctamente.',
      note: 'Para obtener los mejores resultados:',
      noteText:
        'procure un buen contraste entre el objeto y el fondo, y que el archivo lleve su calibración de píxel si quiere medidas en micrómetros. La subida de un vídeo es una única petición larga: la transferencia y la extracción de fotogramas ocurren juntas, así que un ND2 grande tarda.',
    },

    // Vídeos y canales
    videosChannels: {
      title: 'Vídeos, fotogramas y canales',
      description:
        'Los datos de lapso de tiempo y multicanal reciben un tratamiento propio: un contenedor para la grabación, una entrada por fotograma y una lista de canales que usted controla desde el editor.',
      containers: 'Contenedores y fotogramas',
      containerFacts: {
        frames:
          'Una subida produce un contenedor más una entrada por fotograma; en la interfaz los fotogramas se numeran desde 1.',
        hidden:
          'El contenedor nunca aparece en la galería y nunca se segmenta: solo se segmentan los fotogramas.',
        positions:
          'Un ND2 grabado en varias posiciones de la platina genera una entrada de proyecto por posición.',
        calibration:
          'El tamaño de píxel y el intervalo entre fotogramas se leen del archivo cuando están presentes y sirven para convertir las medidas automáticamente.',
      },
      channels: 'Canales',
      channelsDescription:
        'Cada canal se almacena como imagen propia en cada fotograma. Exactamente un canal puede ser la fuente de segmentación, el que lee el modelo.',
      channelControls: {
        visibility: 'Una casilla incluye el canal en la vista compuesta',
        color: 'Un cuadro de color fija su tono en la superposición',
        rename: 'Doble clic en el nombre para cambiarlo',
        opacity: 'Un deslizador ajusta su opacidad del 0 al 100 %',
        source: 'La fuente de segmentación se marca con «● src»',
      },
      sourceNote: 'Compruebe la fuente de segmentación.',
      sourceNoteText:
        'Cuando ningún nombre de canal resulta reconocible no se marca ninguna fuente y se usa el primer canal. Para los microtúbulos eso importa: el modelo solo funciona con IRM, así que apuntarlo a un canal de fluorescencia produce polilíneas convincentes sin nada debajo.',
      windowLevel: 'Mostrar datos de 16 bits',
      windowLevelDescription:
        'Los fotogramas de alta profundidad de bits se ajustan para su visualización con los deslizadores Mín y Máx, más Brillo y Contraste. La ventana es por canal, no compartida: un canal se ajusta automáticamente a sus propios datos la primera vez que lo ve, después conserva sus límites y solo amplía su rango cuando llegan fotogramas más brillantes. Estos ajustes duran la sesión; los colores y las opacidades de los canales sí se recuerdan.',
      navigation: 'Moverse por los fotogramas',
      keys: {
        step: 'Fotograma anterior / siguiente',
        play: 'Reproducir o pausar: 10 fotogramas por segundo fijos, se detiene en el último',
      },
      mtExtras: 'Extras para proyectos de microtúbulos',
      mtExtrasList: {
        registration:
          'Registro de canales al subir: alinea cada canal con el primero mediante una traslación de píxeles enteros, sin interpolar nada.',
        addChannel:
          'Añadir canal: adjunta después otro canal a los fotogramas seleccionados, ya sea una imagen estampada en todos ellos o un vídeo emparejado fotograma a fotograma.',
        tracking:
          'El seguimiento entre fotogramas se ejecuta automáticamente cuando todos los fotogramas han terminado, y da a cada filamento una identidad y un color estables.',
      },
    },

    // Modelos
    modelSelection: {
      title: 'Modelos',
      description:
        'Once modelos, cada uno vinculado a los tipos de proyecto para los que fue entrenado. El selector solo ofrece modelos compatibles, y solo los proyectos de esferoides estándar tienen elección real: los demás tipos tienen exactamente uno.',
      spheroidModels: 'Modelos de esferoides: elija uno',
      specialisedModels: 'Modelos especializados: uno por tipo de proyecto',
      models: {
        hrnet: {
          name: 'HRNet (equilibrado)',
          inferenceTime: 'Unos 0,20 s por imagen',
          bestFor:
            'Mejor para: un solo modelo y sin pensárselo. La opción predeterminada de la plataforma.',
          description:
            'Mantiene una rama de alta resolución a lo largo de toda la red en lugar de codificar y luego decodificar, lo que preserva el detalle de los bordes.',
        },
        cbam: {
          name: 'CBAM-ResUNet (preciso)',
          inferenceTime: 'Unos 0,38 s por imagen',
          bestFor:
            'Mejor para: figuras de publicación y bordes difíciles, a aproximadamente el doble de coste que HRNet.',
          description:
            'U-Net residual con atención de canal y espacial en cada etapa: los bordes más precisos de los cinco.',
        },
        unet: {
          name: 'UNet (el más rápido)',
          inferenceTime: 'Unos 0,18 s por imagen',
          bestFor:
            'Mejor para: lotes grandes donde el rendimiento importa más que el último punto de precisión.',
          description:
            'Una U-Net sencilla entrenada con el conjunto SpheroHQ y optimizada para el rendimiento.',
        },
        segformer: {
          name: 'SegFormer',
          inferenceTime: 'Unos 0,20 s por imagen',
          bestFor:
            'Mejor para: la mayor precisión medida en esferoides de campo claro, un 93 % de IoU.',
          description:
            'Basado en transformador (SegFormer-B0): codificador jerárquico con un decodificador ligero de solo MLP.',
        },
        mamba: {
          name: 'Mamba-UNet',
          inferenceTime: 'Unos 0,24 s por imagen',
          bestFor:
            'Mejor para: imágenes distintas de los datos de entrenamiento, de otro laboratorio, con óptica desconocida, tratadas con fármacos o de morfología inusual.',
          description:
            'U-Net con un cuello de botella de espacio de estados bidireccional, elegida por su robustez fuera de la distribución de entrenamiento.',
        },
        disintegration: {
          name: 'Disgregación de esferoides',
          inferenceTime: 'Unos 0,70 s por imagen · umbral predeterminado 0,2',
          bestFor: 'La usan: los proyectos de esferoides en disgregación.',
          description:
            'UNet++ con codificador EfficientNet-B5 que predice tres clases: fondo, corona y núcleo denso. El núcleo se predice directamente en lugar de inferirse, y eso es lo que hace fiable el índice de disgregación.',
        },
        wound: {
          name: 'Cicatrización de heridas',
          inferenceTime: 'Unos 0,03 s por imagen',
          bestFor: 'Lo usan: los proyectos de cicatrización.',
          description:
            'U-Net con codificador MiT-B5 para segmentación binaria de la herida, 90 % de IoU en un conjunto de prueba externo. Trabaja internamente a 256×256 y luego amplía, lo que explica su rapidez y el suavizado del detalle fino del borde.',
        },
        sperm: {
          name: 'Morfología de espermatozoides',
          inferenceTime: 'Unos 0,30 s por imagen',
          bestFor: 'Lo usan: los proyectos de espermatozoides.',
          description:
            'Segmentación de instancias multiclase que produce cabeza, pieza intermedia y cola directamente como polilíneas, mediante extracción del esqueleto en vez de manchas umbralizadas.',
        },
        microtubule: {
          name: 'Microtúbulos (v5H)',
          inferenceTime:
            'Unos 4,5 s por fotograma · umbral fijado en 0,97 y no configurable',
          bestFor: 'Lo usan: los proyectos de microtúbulos. Solo imágenes IRM.',
          description:
            'Una red nnU-Net ResEnc-M predice el primer plano de los filamentos y después un separador acotado por curvatura lo divide en líneas centrales individuales, resolviendo cada cruce bajo un límite estricto de curvatura. Entrenado exclusivamente con fotogramas sintéticos. El tiempo de ejecución crece con el número de filamentos, no solo con el tamaño del fotograma.',
        },
        microcapsule: {
          name: 'Microcápsulas',
          inferenceTime: 'Unos 0,30 s por imagen',
          bestFor: 'Lo usan: los proyectos de microcápsulas.',
          description:
            'Una U-Net compacta destilada de Meta SAM 3, con una divisoria de aguas para separar cápsulas en contacto. Las cápsulas cortadas por el borde se marcan y quedan fuera de las métricas.',
        },
        neuriteSoma: {
          name: 'Neurita / soma',
          inferenceTime:
            'Unos 12 s para un fotograma de 2048 × 2048 · sin umbral: la decisión es un argmax',
          bestFor:
            'Lo usan: los proyectos de neuritas y somas. Solo fluorescencia, canal de tubulina.',
          description:
            'Un conjunto de tres pliegues de nnU-Net v2 ResEnc-M, promediados en el espacio de logits, con aumento por reflexión en inferencia y un término topológico clDice que mantiene conectadas las prolongaciones finas en lugar de fragmentarlas. Dice en datos reservados: 0,832 neurita / 0,915 soma. Entrenado con datos confocales de Leica a unos 0,180 µm/px; a la mitad de ese tamaño de píxel cada soma suele volver partido en dos, así que valide primero los recuentos de somas.',
        },
      },
      howToSelect: 'Elegir un modelo',
      selectionSteps: {
        step1:
          'Fije su modelo predeterminado en Configuración: se usa allí donde el tipo de proyecto permite elegir',
        step2: 'Abra un proyecto y seleccione las imágenes a procesar',
        step3: 'Pulse Segmentar; el diálogo solo ofrece modelos compatibles',
        step4:
          'Cada modelo lleva su propio umbral de detección, fijado al validarlo: no hay nada que ajustar en cada ejecución',
        step5: 'En un vídeo multicanal, elija qué canal debe leer el modelo',
      },
      thresholdNote: 'Los umbrales de detección son fijos para cada modelo.',
      thresholdNoteText:
        'No hay ningún control de umbral en la interfaz: cada modelo aplica el corte con el que fue validado, y el de microtúbulos es 0,97. Bajar un umbral no encuentra más objetos reales: encuentra más con evidencia más débil, y en un canal que no sea IRM la salida de microtúbulos no sigue la imagen con ningún ajuste. Si faltan detecciones, revise el canal de entrada.',
      tip: 'Consejo:',
      tipText:
        'Empiece con el modelo predeterminado. Recurra a CBAM-ResUNet cuando los bordes importen más que la velocidad, y a Mamba-UNet cuando sus imágenes no se parezcan al conjunto de entrenamiento de nadie.',
    },

    // Proceso de segmentación
    segmentationProcess: {
      title: 'El proceso de segmentación',
      description:
        'La segmentación se ejecuta en segundo plano sobre una cola, de modo que puede seguir trabajando mientras se procesa un lote. El progreso llega en directo.',
      queueBased: 'Procesamiento por cola',
      queueDescription: 'La cola está pensada para lotes grandes:',
      queueFeatures: {
        realTime:
          'Estado en directo: el progreso llega por WebSocket, con respaldo HTTP para que una caída de conexión no deje un trabajo colgado',
        batch: 'Procesamiento por lotes: hasta 10 000 imágenes en un envío',
        priority:
          'Reparto justo: los usuarios atendidos recientemente pasan al final, de modo que un vídeo largo no puede acaparar la GPU',
        recovery:
          'Recuperación: el trabajo interrumpido se reintenta en lugar de perderse, y el error se informa',
      },
      workflow: 'El flujo de trabajo',
      workflowSteps: {
        step1: 'Suba sus imágenes o vídeos a un proyecto',
        step2:
          'Seleccione las imágenes a procesar, o ninguna para procesarlas todas',
        step3: 'Elija el modelo',
        step4: 'En un vídeo multicanal, elija el canal que debe leer el modelo',
        step5: 'Siga el progreso en los indicadores de estado',
        step6:
          'Abra cualquier imagen en el editor para revisar y corregir el resultado',
      },
      polygonTypes: 'Qué producen los modelos',
      polygonDescription: 'Dos clases de geometría, según el modelo:',
      polygonTypesList: {
        external:
          'Polígonos externos: el contorno del objeto (esferoides, heridas, cápsulas)',
        internal:
          'Polígonos internos: agujeros dentro de un objeto, que se restan de su área',
        polyline:
          'Polilíneas: trazados abiertos con longitud pero sin área, producidos por los modelos de microtúbulos y espermatozoides',
      },
      processingNote: 'El tiempo de proceso depende del modelo:',
      processingTimes:
        'el modelo de heridas tarda unos 0,03 s por imagen y los de esferoides entre 0,2 y 0,4 s, mientras que el de microtúbulos ronda los 4,5 s por fotograma porque separar filamentos individuales es la parte cara.',
    },

    // Editor
    segmentationEditor: {
      title: 'El editor de segmentación',
      description:
        'Donde se revisan y corrigen los resultados. Siete modos de edición, control completo por teclado y paneles que cambian según el tipo de proyecto.',
      editingModes: 'Modos de edición',
      modes: {
        view: {
          title: 'Vista (V)',
          description:
            'Seleccionar, desplazar y ampliar. Al pulsar una forma se selecciona y se pasa a Editar vértices.',
        },
        editVertices: {
          title: 'Editar vértices (E)',
          description:
            'Arrastre los vértices para afinar un borde. Con el botón derecho se borra un vértice. Requiere una forma seleccionada.',
        },
        addPoints: {
          title: 'Añadir puntos (A)',
          description:
            'Inserta vértices, prolonga una polilínea por su extremo más cercano o une dos polilíneas extremo con extremo. Requiere una forma seleccionada.',
        },
        createPolygon: {
          title: 'Crear polígono (N)',
          description:
            'Marque con clics una forma cerrada; al pulsar cerca del primer punto se cierra. Mínimo tres puntos.',
        },
        createPolyline: {
          title: 'Crear polilínea (P)',
          description:
            'Marque con clics un trazado abierto para un microtúbulo o una parte de espermatozoide. Termine con Intro o doble clic.',
        },
        sliceMode: {
          title: 'Cortar (S)',
          description:
            'Divide una forma con una línea de dos clics. Funciona en polígonos cerrados y en polilíneas.',
        },
        deletePolygon: {
          title: 'Eliminar polígono (D)',
          description:
            'Pulse las formas para eliminarlas. El modo permanece activo y no hay confirmación.',
        },
      },
      keyFeatures: 'Qué ofrece el editor',
      features: {
        undoRedo:
          'Deshacer y rehacer sobre la geometría y las propiedades de las formas. El historial es por fotograma y se reinicia al cambiar de imagen.',
        saving:
          'Guardado a petición: el botón Guardar, Ctrl+S, o automáticamente al pasar a otra imagen.',
        zoomPan:
          'Zoom en el puntero del ratón, desplazamiento arrastrando y ajuste a la vista con R o 0.',
        polygonManagement:
          'Una lista de formas con selección múltiple, mostrar y ocultar, renombrar y eliminar.',
        keyboardShortcuts:
          'Control completo por teclado: pulse H o ? para ver la lista en la aplicación.',
        realTimeFeedback:
          'Instrucciones por modo sobre el lienzo y un recuento en vivo de formas y vértices.',
      },
      shortcuts: 'Atajos de teclado',
      shortcutCategories: {
        modes: 'Modos',
        actions: 'Acciones',
        view: 'Vista',
      },
      shortcutsList: {
        v: 'Modo vista',
        e: 'Editar vértices',
        a: 'Añadir puntos',
        n: 'Crear polígono',
        p: 'Crear polilínea',
        s: 'Cortar',
        d: 'Eliminar polígono',
        tab: 'Recorrer los modos',
        ctrlZ: 'Deshacer',
        ctrlY: 'Rehacer',
        ctrlS: 'Guardar',
        delete: 'Eliminar la forma seleccionada',
        enter: 'Terminar la polilínea en curso',
        escape: 'Cancelar y volver a Vista',
        zoom: 'Acercar y alejar',
        reset: 'Ajustar la imagen a la vista',
        pan: 'Mantener pulsado y arrastrar para desplazar en cualquier modo',
        help: 'Mostrar la lista de atajos',
      },
      workingWithPolygons: 'Trabajar con formas',
      polygonSteps: {
        step1: 'Pulse una forma para seleccionarla',
        step2: 'Cambie al modo que corresponda a lo que quiere modificar',
        step3: 'Haga el cambio con el ratón',
        step4:
          'Use la lista de la derecha para ocultar, renombrar, seleccionar varias o eliminar formas',
        step5: 'Pulse Ctrl+S para guardar',
      },
      saveNote: 'No hay guardado automático continuo.',
      saveNoteText:
        'Su trabajo se guarda al pulsar Guardar o Ctrl+S, y en segundo plano al pasar a otra imagen o fotograma. Al pulsar en las migas de pan se navega de inmediato y se guarda en segundo plano, así que pulse antes Ctrl+S si ha hecho cambios importantes. En un vídeo, eliminar una forma con seguimiento y guardar la borra de todos los fotogramas.',
      typeSpecific: 'Qué cambia según el tipo de proyecto',
      typeSpecificList: {
        microtubules:
          'Microtúbulos: un panel de instancias con colores estables por traza, sus propias etiquetas de tipo, asignación a la traza completa, propagación y borrado de traza, y una vista de kimógrafo.',
        sperm:
          'Espermatozoides: un panel de instancias donde elige la célula y la parte activas antes de dibujar, además de reasignación desde el menú contextual.',
        disintegration:
          'Esferoides en disgregación: el núcleo denso se dibuja en verde. El índice de disgregación se calcula al exportar.',
      },
    },

    // Exportación
    exportFeatures: {
      title: 'Exportación',
      description:
        'Las exportaciones se ejecutan en segundo plano y se descargan solas al terminar. Una por usuario a la vez; el resultado es un único ZIP.',
      packageContents: 'Qué contiene el paquete',
      contents: {
        originalImages: {
          title: 'Imágenes originales',
          description: 'Los archivos que subió, sin modificar.',
        },
        visualizations: {
          title: 'Visualizaciones',
          description:
            'Superposiciones renderizadas con formas numeradas, en los colores, grosores de línea y transparencia que elija.',
        },
        annotations: {
          title: 'Anotaciones',
          description:
            'Geometría legible por máquina en los formatos que marque y, en los proyectos de microtúbulos, archivos de ImageJ y CVAT que se incluyen siempre.',
        },
        metrics: {
          title: 'Métricas',
          description:
            'Un libro cuyas hojas dependen del tipo de proyecto, en XLSX, CSV o JSON.',
        },
      },
      annotationFormats: 'Formatos de anotación',
      formats: {
        coco: 'COCO: el formato estándar para los marcos de detección. Los polígonos con agujeros se exportan como máscaras de longitud de secuencia.',
        yolo: 'YOLO: cajas contenedoras, con el polígono en una línea de comentario. Las polilíneas abiertas no se pueden representar y se omiten.',
        json: 'JSON propio: coordenadas y metadatos completos, con agrupación por célula en los proyectos de espermatozoides.',
        imagej:
          'RoiSet de ImageJ: un ZIP que se abre directamente en el gestor de ROI de Fiji, un ROI por filamento y corte, coloreado por clase o por traza. Solo proyectos de microtúbulos, siempre incluido.',
        cvat: 'CVAT 1.1: polilíneas con su identidad de traza como atributo. Solo proyectos de microtúbulos, siempre incluido.',
      },
      calculatedMetrics: 'Métricas por tipo de proyecto',
      metricsDescription:
        'El libro que obtiene depende de lo que esté midiendo:',
      metricsTable: {
        projectType: 'Tipo de proyecto',
        sheet: 'Hoja y contenido',
        spheroid:
          'Polygon Metrics + Summary: área, perímetro, circularidad, diámetros de Feret, solidez y más, una fila por forma',
        spheroidInvasive:
          'Image Metrics: una fila por imagen con el índice de disgregación, las áreas de núcleo e invasión y el panel de dispersión',
        wound:
          'Polygon Metrics + Summary + WoundTimeSeries: la curva de cierre, con el gráfico incrustado',
        sperm:
          'Sperm Metrics: longitud de cabeza, pieza intermedia, cola y total, una fila por célula',
        microtubules:
          'Microtubule Metrics + Channel Totals: longitud e intensidad por canal, una fila por fotograma, filamento y canal',
        microcapsule:
          'Microcapsule Metrics + Summary: una fila por cápsula completa; las cortadas por el borde se excluyen',
        neurite:
          'Polygon Metrics + Summary — el mismo informe por forma que reciben los proyectos de esferoides estándar, una fila por polígono de neurita o soma',
      },
      scaleTitle: 'Tamaño de píxel y unidades',
      scaleText:
        'Introduzca un tamaño de píxel en micrómetros y todas las longitudes y áreas se convertirán. El campo se rellena solo a partir de la calibración del archivo cuando la tiene. Sin un valor utilizable la exportación vuelve a píxeles, así que compruebe las unidades en los encabezados de columna.',
      howToExport: 'Cómo exportar',
      exportSteps: {
        step1: 'Abra el proyecto y pulse Exportar',
        step2: 'Elija qué imágenes incluir, o todas',
        step3:
          'Fije el tamaño de píxel si quiere micrómetros y elija los colores de las visualizaciones',
        step4: 'Marque los formatos de anotación y métricas que necesite',
        step5:
          'Inicie la exportación y déjela correr: el progreso se muestra en directo',
        step6: 'El ZIP se descarga solo al terminar',
      },
      exportNote: 'Que falle una etapa no hace fallar la exportación.',
      exportNoteText:
        'Las etapas opcionales degradan a un aviso y el resto del paquete se genera igualmente. En la intensidad de microtúbulos, una ejecución degradada queda además registrada en el propio paquete, en metrics_status.json y al principio de la guía de métricas: consúltelo antes de fiarse de una hoja.',
    },

    // Ensayos automatizados
    automatedEssays: {
      title: 'Ensayos automatizados',
      description:
        'Un ensayo de microtúbulos por lotes que vive fuera del sistema de proyectos. Suba una carpeta de grabaciones de pocillos en formato Nikon ND2 y recibirá una fila por filamento: su longitud, la intensidad a lo largo de él y su fondo local.',
      howTo: 'Ejecutar un lote',
      steps: {
        step1:
          'Abra Ensayos automatizados desde el menú bajo su foto de perfil',
        step2:
          'Arrastre la carpeta con los archivos .nd2 a la página, o use el botón de seleccionar carpeta',
        step3:
          'Espere: los trabajos se ejecutan de uno en uno y la lista se actualiza sola mientras haya algo en marcha',
        step4:
          'Descargue el ZIP, o use «Ejecutar de nuevo» para reprocesar los mismos archivos sin volver a subirlos',
      },
      results: 'Qué recibe',
      resultsList: {
        csv: 'results.csv: una fila por microtúbulo, con su longitud, la intensidad a lo largo de él y su fondo',
        failures:
          'failures.csv: cada pocillo o posición que no pudo producirse, y por qué. Se escribe siempre, aunque esté vacío',
        focus:
          'focus_qc.csv: una fila por posición con una puntuación de desenfoque para el canal segmentado y el medido. results.csv lleva el mismo veredicto por filamento',
        overlays:
          'Dos imágenes superpuestas por posición: una comprueba la segmentación frente a su propia entrada, la otra la banda medida frente a la señal',
        annotations:
          'Un archivo JSON por posición con las líneas centrales trazadas y sus longitudes',
      },
      focusNote: 'La marca de desenfoque es orientativa: no se descarta nada.',
      focusNoteText:
        'Mide qué parte del fotograma ocupa estructura que sobresale claramente del ruido, así que un campo densamente cubierto puede pasar aun estando desenfocado; se equivoca del lado de conservar los datos, no de tirarlos. Sus umbrales se ajustaron sobre una única adquisición, de modo que otra exposición u otra cámara se informa como out_of_calibration en la columna reason: es una nota sobre el umbral, no sobre su fotograma.',
      channelNote: 'Se segmenta IRM, se mide la fluorescencia.',
      channelNoteText:
        'El modelo se entrenó con IRM, así que los filamentos se trazan ahí y el canal de fluorescencia solo se lee a lo largo de esos trazos. Un archivo sin canal IRM se informa como fallo en lugar de segmentarse a partir de otra cosa.',
      retentionNote: 'Las subidas se limpian, los resultados no.',
      retentionNoteText:
        'Los archivos de entrada se borran cuando una ejecución termina limpiamente, y se conservan una semana si no fue así, que es justo la ejecución que quizá quiera repetir. El resultado permanece hasta que borre el trabajo.',
    },

    // Segmenter
    segmenter: {
      title: 'Segmenter',
      description:
        'Una herramienta independiente de anotación de polígonos, con sus propios conjuntos de datos y su paleta de clases, separada de los proyectos y del editor de segmentación.',
      features: {
        datasets:
          'Cree conjuntos de datos y suba imágenes fijas a ellos; son privados suyos.',
        classes:
          'Defina sus propias clases con nombre y color. Borrar una clase conserva sus polígonos y simplemente les quita la asignación.',
        polygons:
          'Dibuje, edite y borre polígonos cerrados y asigne una clase a cada uno. Los polígonos superpuestos están plenamente admitidos.',
        saving:
          'El guardado es explícito (el botón Guardar o Ctrl+S) y se bloquea si la anotación existente no pudo cargarse, para que un lienzo vacío no sobrescriba nunca trabajo real.',
      },
      scopeNote: 'Por ahora, solo anotación manual.',
      scopeNoteText:
        'Segmenter todavía no incorpora aprendizaje automático: sin pre-etiquetado, sin aprendizaje activo y sin exportación. Está disponible en /segmenter.',
    },

    // Compartir
    sharedProjects: {
      title: 'Compartir y colaborar',
      description:
        'Comparta un proyecto con colegas por correo o mediante un enlace. Los destinatarios lo verán en su propio panel en cuanto acepten.',
      sharingFeatures: 'Qué permite compartir',
      features: {
        collaborative:
          'Acceso colaborativo: quien colabora puede ver, editar anotaciones, ejecutar la segmentación, exportar y marcar el proyecto como revisado',
        emailInvite:
          'Invitaciones por correo: el acceso funciona llegue o no el mensaje, ya que la entrega puede tardar varios minutos',
        linkShare:
          'Enlaces compartidos: el enlace se vincula a quien lo acepte, con caducidad opcional',
        revokeAccess: 'Revocable en cualquier momento, con efecto inmediato',
        multipleCollaborators:
          'Cualquier número de colaboradores, cada uno archiva el proyecto en sus propias carpetas',
      },
      howToShare: 'Cómo compartir',
      shareSteps: {
        step1: 'Abra el proyecto que quiere compartir',
        step2: 'Pulse Compartir en la barra de herramientas del proyecto',
        step3: 'Introduzca el correo de su colaborador, o cree un enlace',
        step4: 'Envíe la invitación',
        step5:
          'Gestione o revoque los accesos desde el mismo diálogo, donde cada uno muestra su estado',
      },
      permissionsNote: 'Compartir es colaborar, no solo leer.',
      permissionsNoteText:
        'Los colaboradores pueden cambiar las anotaciones y, en un vídeo, sus ediciones tienen las mismas consecuencias entre fotogramas que las suyas. Solo el propietario puede renombrar un proyecto, cambiar su tipo, compartirlo con otros o borrarlo.',
    },

    // Resolución de problemas
    troubleshooting: {
      title: 'Resolución de problemas',
      description:
        'Los problemas con los que se topa la gente de verdad, y a qué se deben.',
      table: {
        symptom: 'Síntoma',
        cause: 'Causa y solución',
      },
      items: {
        uploadRejected: {
          symptom: 'Un archivo se rechaza antes de empezar la subida',
          cause:
            'Las imágenes sueltas están limitadas a 20 MB. Un TIFF mayor se trata como pila y le aplica el límite de 100 GB. Los nombres de canal de más de 64 caracteres se rechazan de plano: vuelva a exportar con etiquetas más cortas.',
        },
        darkFrames: {
          symptom: 'Los fotogramas se ven casi negros',
          cause:
            'Los datos de alta profundidad de bits necesitan una ventana. Use los deslizadores Mín y Máx de ese canal; cada canal tiene la suya.',
        },
        noDetections: {
          symptom: 'El modelo encuentra muy poco',
          cause:
            'Revise primero el contraste y el tipo de proyecto. Baje el umbral de confianza solo donde sea ajustable: el modelo de microtúbulos lo ignora por diseño.',
        },
        wrongChannel: {
          symptom: 'Hay muchas formas, pero no siguen nada de la imagen',
          cause:
            'Se está segmentando el canal equivocado. Fije explícitamente la fuente de segmentación en la lista de canales; el modelo de microtúbulos solo funciona con IRM.',
        },
        colorsChange: {
          symptom: 'Los colores de los objetos cambian entre fotogramas',
          cause:
            'El seguimiento entre fotogramas no ha terminado para ese contenedor. Los colores siguen a la identidad de la traza, así que un fotograma sin seguimiento recibe colores nuevos.',
        },
        exportSlow: {
          symptom: 'Una exportación se queda en el 95 %',
          cause:
            'Es la etapa de compresión. En un proyecto grande, sobre todo con kimógrafos, tarda realmente un rato.',
        },
        lostEdits: {
          symptom: 'Las ediciones han desaparecido',
          cause:
            'Volver a segmentar reemplaza la segmentación del fotograma, y pulsar en las migas de pan navega antes de que el guardado en segundo plano haya terminado necesariamente. Pulse Ctrl+S antes de salir.',
        },
      },
      helpNote: '¿Sigue atascado?',
      helpNoteText:
        'Use el botón de comentarios para enviar un informe de error o una sugerencia: llega directamente a quienes mantienen la plataforma.',
    },

    // Navegación del pie
    footer: {
      backToHome: 'Volver al inicio',
      backToTop: 'Volver arriba',
    },
  },
  legal: {
    terms: {
      title: 'Términos de Servicio',
      lastUpdated: 'Última actualización: enero 2025',
      disclaimer:
        'Al usar SpheroSeg, aceptas estos términos. Por favor, léelos cuidadosamente.',
      sections: {
        acceptance: {
          title: '1. Aceptación de Términos',
          content:
            'Al acceder o usar SpheroSeg ("el Servicio"), aceptas estar vinculado por estos Términos de Servicio ("Términos") y todas las leyes y reglamentos aplicables. Si no estás de acuerdo con alguno de estos términos, tienes prohibido usar este servicio. Estos Términos constituyen un acuerdo legalmente vinculante entre tú y SpheroSeg.',
        },
        useLicense: {
          title: '2. Licencia de Uso y Uso Permitido',
          content: 'Se otorga permiso para usar SpheroSeg para:',
          permittedUses: [
            'Propósitos de investigación personal y no comercial',
            'Investigación académica y educativa',
            'Publicaciones y estudios científicos',
            'Investigación y análisis biomédico',
          ],
          licenseNote:
            'Esta es la concesión de una licencia, no una transferencia de título. No puedes usar el servicio para propósitos comerciales sin consentimiento escrito explícito.',
        },
        dataUsage: {
          title: '3. Uso de Datos e Inteligencia Artificial',
          importantTitle: 'Importante: Uso de Tus Datos',
          importantContent:
            'Al subir imágenes y datos a SpheroSeg, consientes que usemos estos datos para mejorar y entrenar nuestros modelos de aprendizaje automático para una mejor precisión de segmentación.',
          ownershipTitle: 'Propiedad de datos:',
          ownershipContent:
            'Retienes la propiedad de todos los datos que subas a SpheroSeg. Sin embargo, al usar nuestro servicio, nos otorgas permiso para:',
          permissions: [
            'Procesar tus imágenes para análisis de segmentación',
            'Usar datos subidos (en forma anonimizada) para mejorar nuestros algoritmos de ML',
            'Mejorar la precisión del modelo a través del aprendizaje continuo',
            'Desarrollar nuevas características y capacidades de segmentación',
          ],
          protectionNote:
            'Todos los datos usados para entrenamiento de ML son anonimizados y despojados de información identificativa. No compartimos tus datos sin procesar con terceros sin consentimiento explícito.',
        },
        userResponsibilities: {
          title: '4. Responsabilidades del Usuario',
          content: 'Aceptas:',
          responsibilities: [
            'Usar el servicio solo para propósitos legales',
            'Respetar los derechos de propiedad intelectual',
            'No intentar hacer ingeniería inversa o comprometer el servicio',
            'Proporcionar información precisa al crear una cuenta',
            'Mantener la seguridad de tus credenciales de cuenta',
          ],
        },
        serviceAvailability: {
          title: '5. Disponibilidad del Servicio y Limitaciones',
          content:
            'Aunque nos esforzamos por mantener la disponibilidad continua del servicio, SpheroSeg se proporciona "tal como está" sin garantías de ningún tipo. No garantizamos acceso ininterrumpido, y el servicio puede estar sujeto a mantenimiento, actualizaciones o indisponibilidad temporal.',
        },
        limitationLiability: {
          title: '6. Limitación de Responsabilidad',
          content:
            'En ningún caso SpheroSeg, sus desarrolladores o afiliados serán responsables de daños indirectos, incidentales, especiales, consecuentes o punitivos, incluyendo pero no limitado a pérdida de datos, ganancias u oportunidades de negocio, que surjan del uso del servicio.',
        },
        privacy: {
          title: '7. Privacidad y Protección de Datos',
          content:
            'Tu privacidad es importante para nosotros. Por favor, revisa nuestra Política de Privacidad, que gobierna cómo recopilamos, usamos y protegemos tu información personal y datos de investigación.',
        },
        changes: {
          title: '8. Cambios en los Términos',
          content:
            'Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios serán efectivos inmediatamente después de la publicación. Tu uso continuado del servicio constituye aceptación de los Términos modificados.',
        },
        termination: {
          title: '9. Terminación',
          content:
            'Cualquier parte puede terminar este acuerdo en cualquier momento. Tras la terminación, tu derecho a acceder al servicio cesará inmediatamente, aunque estos Términos permanecerán en efecto con respecto al uso previo.',
        },
        governingLaw: {
          title: '10. Ley Aplicable',
          content:
            'Estos Términos se rigen e interpretan de acuerdo con las leyes aplicables. Cualquier disputa será resuelta a través de arbitraje vinculante o en tribunales de jurisdicción competente.',
        },
      },
      contact: {
        title: 'Información de Contacto:',
        content:
          'Si tienes preguntas sobre estos Términos, por favor contáctanos en prusek@utia.cas.cz',
      },
      navigation: {
        backToHome: 'Volver al Inicio',
        privacyPolicy: 'Política de Privacidad',
      },
    },
    privacy: {
      title: 'Política de Privacidad',
      lastUpdated: 'Última actualización: enero 2025',
      disclaimer:
        'Tu privacidad es importante para nosotros. Esta política explica cómo recopilamos, usamos y protegemos tus datos.',
      sections: {
        introduction: {
          title: '1. Introducción',
          content:
            'Esta Política de Privacidad explica cómo SpheroSeg ("nosotros", "nos", "nuestro") recopila, usa, protege y comparte tu información cuando usas nuestra plataforma para segmentación y análisis de imágenes de microscopía. Al usar nuestro servicio, consientes a las prácticas de datos descritas en esta política.',
        },
        informationCollected: {
          title: '2. Información que Recopilamos',
          content:
            'Recopilamos información que nos proporcionas directamente cuando creas una cuenta, subes imágenes, creas proyectos e interactúas con nuestros servicios.',
          personalInfo: {
            title: '2.1 Información Personal',
            items: [
              'Nombre y dirección de correo electrónico',
              'Afiliación institucional u organizacional',
              'Credenciales de cuenta y preferencias',
              'Información de contacto para solicitudes de soporte',
            ],
          },
          researchData: {
            title: '2.2 Datos de Investigación e Imágenes',
            ownershipTitle: 'Tus Datos de Investigación',
            ownershipContent:
              'Retienes la propiedad completa de todas las imágenes y datos de investigación que subas a SpheroSeg. Nunca reclamamos propiedad de tu contenido.',
            items: [
              'Imágenes que subes para análisis',
              'Metadatos de proyectos y configuraciones',
              'Resultados de segmentación y anotaciones',
              'Parámetros de análisis y configuraciones personalizadas',
            ],
          },
          usageInfo: {
            title: '2.3 Información de Uso',
            items: [
              'Datos de registro y marcas de tiempo de acceso',
              'Información del dispositivo y tipo de navegador',
              'Patrones de uso e interacciones con características',
              'Métricas de rendimiento y reportes de errores',
            ],
          },
        },
        mlTraining: {
          title: '3. Aprendizaje Automático y Mejora de Datos',
          importantTitle:
            'Importante: Uso de Tus Datos para Entrenamiento de IA',
          importantIntro:
            'Para mejorar continuamente nuestros algoritmos de segmentación, podemos usar imágenes subidas y datos para entrenar y mejorar nuestros modelos de aprendizaje automático.',
          controlTitle: 'Tienes control completo sobre tus datos:',
          controlContent:
            'Durante la creación de cuenta, puedes elegir si permitir que tus datos se usen para entrenamiento de ML. Puedes cambiar estas preferencias en cualquier momento.',
          manageTitle: 'Para gestionar tu consentimiento:',
          manageContent:
            'Ve a Configuración → pestaña Privacidad en tu panel. Allí puedes habilitar o deshabilitar el consentimiento de entrenamiento de ML y elegir propósitos específicos (mejora de algoritmos, desarrollo de características) para los cuales pueden usarse tus datos.',
          howWeUse: {
            title: 'Cómo Usamos Tus Datos para ML:',
            items: [
              'Entrenamiento de Modelo: Las imágenes se usan para entrenar algoritmos de segmentación para mejor precisión',
              'Mejora de Algoritmos: Tus correcciones de segmentación ayudan a mejorar la detección automática',
              'Desarrollo de Características: Los patrones de uso guían el desarrollo de nuevas herramientas de análisis',
              'Aseguramiento de Calidad: Los datos ayudan a validar y probar nuevas versiones de modelos',
            ],
          },
          protection: {
            title: 'Protección de Datos en Entrenamiento de ML:',
            items: [
              'Anonimización: Todos los datos son anonimizados antes del uso en entrenamiento de ML',
              'Eliminación de Metadatos: La información identificativa personal e institucional es eliminada',
              'Procesamiento Seguro: El entrenamiento ocurre en entornos seguros y aislados',
              'Sin Distribución de Datos Sin Procesar: Tus imágenes originales nunca se comparten con terceros',
            ],
          },
        },
        howWeUse: {
          title: '4. Cómo Usamos Tu Información',
          content: 'Usamos la información recopilada para:',
          purposes: [
            'Proporcionar y mantener servicios de segmentación',
            'Procesar tus imágenes y generar resultados de análisis',
            'Mejorar nuestros algoritmos y desarrollar nuevas características',
            'Comunicarnos contigo sobre tu cuenta y actualizaciones',
            'Proporcionar soporte técnico y resolución de problemas',
            'Cumplir con obligaciones legales y proteger nuestros derechos',
          ],
        },
        dataSecurity: {
          title: '5. Seguridad y Protección de Datos',
          content: 'Implementamos medidas de seguridad robustas incluyendo:',
          measures: [
            'Cifrado de datos en tránsito y en reposo',
            'Auditorías de seguridad regulares y evaluaciones de vulnerabilidades',
            'Controles de acceso y sistemas de autenticación',
            'Procedimientos seguros de respaldo y recuperación ante desastres',
            'Entrenamiento de seguridad para empleados y limitaciones de acceso',
          ],
        },
        dataSharing: {
          title: '6. Compartir Datos y Terceros',
          noSaleStatement:
            'No vendemos tu información personal o datos de investigación.',
          sharingContent:
            'Podemos compartir información solo en estas circunstancias limitadas:',
          circumstances: [
            'Con tu consentimiento explícito',
            'Para cumplir con obligaciones legales u órdenes judiciales',
            'Con proveedores de servicios confiables que ayudan a operar nuestra plataforma (bajo estrictos acuerdos de confidencialidad)',
            'Para proteger nuestros derechos, seguridad o propiedad',
            'En forma anonimizada y agregada para publicaciones de investigación (con tu consentimiento)',
          ],
        },
        privacyRights: {
          title: '7. Tus Derechos de Privacidad y Opciones',
          content: 'Tienes derecho a:',
          rights: [
            'Acceso: Solicitar copias de tus datos personales y contenido de investigación',
            'Rectificación: Actualizar o corregir información inexacta',
            'Eliminación: Solicitar la eliminación de tu cuenta y datos asociados',
            'Portabilidad: Exportar tus datos en un formato legible por máquina',
            'Exclusión: Solicitar exclusión del entrenamiento de ML. Nota: Esto puede limitar las siguientes características: precisión de segmentación automática, recomendaciones de modelo personalizadas, sugerencias de umbral adaptativo, optimizaciones de procesamiento por lotes y futuras mejoras impulsadas por IA. Contacta al soporte para impactos específicos en tu cuenta.',
            'Restricción: Limitar cómo procesamos tu información',
          ],
          contactNote:
            'Para ejercer estos derechos, contáctanos en prusek@utia.cas.cz. Responderemos dentro de 30 días.',
        },
        dataRetention: {
          title: '8. Retención de Datos',
          content:
            'Distinguimos entre datos personales y datos de entrenamiento de ML:',
          categories: [
            'Datos Personales/de Cuenta: Todos los identificadores personales, información de perfil, configuraciones de cuenta e historial de transacciones serán eliminados permanentemente dentro de 90 días del cierre de cuenta.',
            'Datos de Investigación: Imágenes originales y datos de proyecto vinculados a tu cuenta serán eliminados dentro de 90 días del cierre de cuenta.',
            'Datos de Entrenamiento de ML: Los datos usados para entrenamiento de ML son primero anonimizados/pseudonimizados para eliminar todos los identificadores personales. Estos datos anonimizados pueden retenerse indefinidamente para preservar mejoras del modelo, a menos que específicamente te excluyas del entrenamiento de ML o solicites eliminación completa.',
            'Opciones de Exclusión: Puedes solicitar eliminación completa de todos los datos, incluyendo datos anonimizados de entrenamiento de ML, contactando prusek@utia.cas.cz. El tiempo de procesamiento es típicamente 30 días.',
          ],
        },
        internationalTransfers: {
          title: '9. Transferencias Internacionales de Datos',
          content:
            'Tus datos pueden ser procesados en países distintos al tuyo. Aseguramos salvaguardas y protecciones apropiadas para transferencias internacionales, incluyendo cláusulas contractuales estándar y decisiones de adecuación.',
        },
        childrensPrivacy: {
          title: '10. Privacidad de Menores',
          content:
            'Nuestro servicio está destinado a investigadores y no está dirigido a menores de 16 años. No recopilamos conscientemente información personal de menores de 16 años. Si descubrimos tal recopilación, eliminaremos la información promptamente.',
        },
        policyChanges: {
          title: '11. Cambios a Esta Política',
          content:
            'Podemos actualizar esta Política de Privacidad para reflejar cambios en nuestras prácticas o requisitos legales. Te notificaremos de cambios materiales vía correo electrónico o aviso prominente en nuestro sitio web. El uso continuado constituye aceptación de términos actualizados.',
        },
        contact: {
          title: '12. Información de Contacto',
          dpo: 'Oficial de Protección de Datos: prusek@utia.cas.cz',
          general: 'Consultas Generales: prusek@utia.cas.cz',
          postal: 'Dirección Postal:',
          address: {
            line1: 'ÚTIA AV ČR',
            line2: 'Pod Vodárenskou věží 4',
            line3: '182 08 Praga 8',
            line4: 'República Checa',
          },
        },
      },
      navigation: {
        backToHome: 'Volver al Inicio',
        termsOfService: 'Términos de Servicio',
      },
    },
  },
  contextMenu: {
    propagateSelectedTracks: 'Propagar microtúbulos seleccionados ({{count}})',
    confirmPropagateSelected: '¿Propagar {{count}} microtúbulos seleccionados?',
    propagateSelectedDescription:
      'Esto sobrescribe la forma de {{count}} microtúbulos seleccionados en todos los fotogramas siguientes del vídeo. Esta acción no se puede deshacer.',
    propagateTrack: 'Propagar a los fotogramas siguientes',
    confirmPropagateTrack: '¿Propagar a los fotogramas siguientes?',
    propagateTrackDescription:
      'Esto sobrescribe la forma de este microtúbulo en todos los fotogramas siguientes del vídeo. Esta acción no se puede deshacer.',
    deleteTrack: 'Eliminar toda la traza',
    confirmDeleteTrack: '¿Eliminar toda la traza del microtúbulo?',
    deleteTrackDescription:
      'Esto elimina este microtúbulo de los {{count}} fotogramas del vídeo. Esta acción no se puede deshacer.',
    deleteMicrotubule: 'Eliminar microtúbulo…',
    deleteSelected: 'Eliminar {{count}} microtúbulos…',
    confirmDeleteSelected: '¿Eliminar {{count}} microtúbulos?',
    deleteSelectedDescription:
      'Esto elimina los {{count}} microtúbulos seleccionados. No se puede deshacer.',
    confirmDeleteScopeSelected: '¿Eliminar {{count}} microtúbulos?',
    confirmDeleteScope: '¿Eliminar este microtúbulo?',
    deleteScopeDescription:
      'Este microtúbulo se sigue a lo largo del vídeo. ¿Eliminarlo solo del fotograma actual o de todos los fotogramas? Esta acción no se puede deshacer.',
    deleteScopeSelectedDescription:
      'Los microtúbulos seleccionados se siguen a lo largo del vídeo. ¿Eliminarlos solo del fotograma actual o de todos los fotogramas? Esta acción no se puede deshacer.',
    deleteScopeThisFrame: 'Solo este fotograma',
    deleteScopeAllFrames: 'Todos los fotogramas',
    deleteScopeAllFramesCount: 'Los {{count}} fotogramas',
    editPolygon: 'Editar polígono',
    splitPolygon: 'Dividir polígono',
    deletePolygon: 'Eliminar polígono',
    confirmDeletePolygon:
      '¿Estás seguro de que quieres eliminar este polígono?',
    deletePolygonDescription:
      'Esta acción es irreversible. El polígono será eliminado permanentemente de la segmentación.',
    duplicateVertex: 'Duplicar vértice',
    deleteVertex: 'Eliminar vértice',
    editPolyline: 'Editar polilínea',
    deletePolyline: 'Eliminar polilínea',
  },
  websocket: {
    reconnecting: 'Reconectando al servidor...',
    reconnected: 'Conexión al servidor restaurada',
    connected: 'Conectado a actualizaciones en tiempo real',
    disconnected: 'Desconectado de actualizaciones en tiempo real',
  },
  metrics: {
    info: 'Las métricas se evalúan solo para polígonos externos. Las áreas de polígonos internos (agujeros) se restan automáticamente de los polígonos externos correspondientes.',
    area: 'Área',
    perimeter: 'Perímetro',
    equivalentDiameter: 'Diámetro Equivalente',
    circularity: 'Circularidad',
    feretMax: 'Feret Máximo',
    feretMin: 'Feret Mínimo',
    compactness: 'Compacidad',
    convexity: 'Convexidad',
    solidity: 'Solidez',
    sphericity: 'Esfericidad',
    feretAspectRatio: 'Relación de Aspecto de Feret',
    disintegrationIndex: 'Índice de Desintegración',
    wassersteinW1: 'Wasserstein W1',
    referenceMode: 'Modo de Referencia',
    totalSpheroidArea: 'Área Total de Esferoides',
    coreArea: 'Área del Núcleo',
    invasionArea: 'Área de Invasión',
    noPolygonsFound: 'No se encontraron polígonos para análisis',
  },
  keyboardShortcuts: {
    title: 'Atajos de Teclado',
    buttonLabel: 'Atajos',
    viewMode: 'Modo visualización',
    editVertices: 'Modo edición de vértices',
    addPoints: 'Modo añadir puntos',
    createPolygon: 'Crear nuevo polígono',
    sliceMode: 'Modo corte',
    deleteMode: 'Modo eliminar',
    holdToAutoAdd: 'Mantener para adición automática de puntos',
    undo: 'Deshacer',
    redo: 'Rehacer',
    deleteSelected: 'Eliminar polígono seleccionado',
    cancelOperation: 'Cancelar operación actual',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    resetView: 'Restablecer vista',
    helperText:
      'Estos atajos funcionan dentro del editor de segmentación para un trabajo más rápido y conveniente.',
  },
  accessibility: {
    toggleSidebar: 'Alternar barra lateral',
    toggleMenu: 'Alternar menú',
    selectLanguage: 'Seleccionar idioma',
    selectTheme: 'Seleccionar tema',
    breadcrumb: 'navegación de migas de pan',
    pagination: 'paginación',
    close: 'Cerrar',
    more: 'Más',
    goToPreviousPage: 'Ir a la página anterior',
    goToNextPage: 'Ir a la página siguiente',
    previousPage: 'Anterior',
    nextPage: 'Siguiente',
    morePages: 'Más páginas',
    previousSlide: 'Diapositiva anterior',
    nextSlide: 'Siguiente diapositiva',
    gridView: 'Vista de cuadrícula',
    listView: 'Vista de lista',
  },
  footer: {
    appName: 'SpheroSeg',
    description:
      'Plataforma de segmentación y análisis de imágenes de microscopía para investigadores biomédicos: esferoides, cicatrización de heridas, espermatozoides, microcápsulas, microtúbulos y neuronas, con herramientas impulsadas por IA desde la imagen hasta la medición.',
    contact: 'Contacto',
    institution: 'Institución',
    institutionName: 'ÚTIA AV ČR',
    address: 'Dirección',
    addressText: 'Pod Vodárenskou věží 4, 182 08 Praga 8',
    resources: 'Recursos',
    documentation: 'Documentación',
    features: 'Características',
    tutorials: 'Tutoriales',
    research: 'Investigación',
    legal: 'Legal',
    termsOfService: 'Términos de servicio',
    privacyPolicy: 'Política de privacidad',
    contactUs: 'Contáctanos',
    developedAt: 'Desarrollado en',
    designBy: 'Diseño por',
  },
  sharing: {
    processingInvitation: 'Procesando invitación...',
    share: 'Compartir',
    shared: 'Compartido',
    shareProject: 'Compartir proyecto',
    shareDescription:
      'Compartir proyecto "{{title}}" con colegas y colaboradores',
    shareByEmail: 'Compartir por correo',
    shareByLink: 'Compartir por enlace',
    emailAddress: 'Dirección de correo',
    enterEmailPlaceholder: 'Ingresar dirección de correo',
    sendInvitation: 'Enviar invitación',
    sending: 'Enviando...',
    emailSent: '¡Invitación por correo enviada!',
    emailRequired: 'La dirección de correo es requerida',
    emailShareFailed: 'Error al enviar la invitación por correo',
    linkExpiry: 'Expiración del enlace',
    neverExpires: 'Nunca expira',
    hours: 'horas',
    days: 'días',
    generateLink: 'Generar enlace',
    linkCopied: '¡Enlace copiado al portapapeles!',
    sharedWithYou: 'Compartido contigo',
    sharedBy: 'Compartido por: {{email}}',
    sharedProjects: 'Proyectos compartidos',
    noSharedProjects: 'No se han compartido proyectos contigo',
    removeFromShared: 'Quitar de compartidos',
    acceptInvitation: 'Aceptar invitación',
    invitationAccepted:
      '¡Invitación aceptada! El proyecto ha sido añadido a tu panel.',
    generating: 'Generando...',
    linkGenerated: '¡Enlace de compartir creado!',
    linkCopyFailed: 'Error al copiar enlace',
    linkShareFailed: 'Error al generar enlace de compartir',
    emailInvitations: 'Invitaciones por correo',
    shareLinks: 'Enlaces de compartir',
    shareRevoked: 'El compartir ha sido revocado',
    acceptedUsers: 'Usuarios aceptados',
    pendingInvitations: 'Invitaciones pendientes',
    joinedViaLink: 'Se unió por enlace',
    activeShareLinks: 'Enlaces de compartir activos',
    joinedOn: 'Se unió el',
    sentOn: 'Enviado el',
    joinedViaLinkOn: 'Se unió el',
    resendInvitation: 'Reenviar invitación',
    invitationResent: 'Invitación reenviada exitosamente',
    resendFailed: 'Error al reenviar invitación',
    revokeAccess: 'Revocar acceso',
    cancelInvitation: 'Cancelar invitación',
    revokeShareFailed: 'Error al revocar compartir',
    failedToLoadShares: 'Error al cargar compartidos',
    status: {
      pending: 'Pendiente',
      accepted: 'Aceptado',
      revoked: 'Revocado',
    },
    invitationExpired: 'Esta invitación ha expirado',
    invitationInvalid: 'Invitación inválida',
    loginToAccept: 'Por favor inicia sesión para aceptar esta invitación',
    accepting: 'Aceptando',
    redirectingToProject: 'Redirigiendo al proyecto',
    invitedEmail: 'Correo invitado',
    loadingShare: 'Cargando información de compartir...',
    projectSharedBy: 'Proyecto compartido por',
    signInRequired: 'Inicio de sesión requerido',
    signInToAccept: 'Por favor inicia sesión para aceptar esta invitación',
    signInButton: 'Iniciar sesión',
    goToProject: 'Ir al Proyecto',
    backToHome: 'Volver al Inicio',
    acceptFailed: 'Error al aceptar invitación',
    differentEmail: 'Esta invitación es para una dirección de correo diferente',
  },
  error: 'Error',
  segmentationEditor: {
    reloadingSegmentation: 'Recargando segmentación...',
    loadingFrame: 'Cargando fotograma...',
    segmenting: 'Segmentando...',
    waitingInQueue: 'Esperando en cola...',
    retryingLoad: 'Problemas al cargar. Reintentando...',
    error: {
      title: 'Error de Segmentación',
      description:
        'Ocurrió un error al cargar los datos de segmentación. Esto podría deberse a problemas de red o del servidor.',
      errorDetails: 'Detalles del Error',
      tryAgain: 'Intentar de Nuevo',
      unsavedChanges: 'Cambios no guardados',
      imageLoadFailed:
        'Error al cargar la imagen. Por favor, actualiza la página para intentarlo de nuevo.',
    },
    export: {
      exportAllMetrics: 'Exportar todas las métricas como XLSX',
      exportUnavailable: 'Exportación No Disponible',
      loading: 'Cargando...',
    },
  },
  microtubule: {
    instancePanel: 'Instancias de microtúbulos',
    instance: 'Microtúbulo',
    hideInstance: 'Ocultar microtúbulo',
    showInstance: 'Mostrar microtúbulo',
    renameInstance: 'Renombrar microtúbulo',
    hideAll: 'Ocultar todo',
    showAll: 'Mostrar todo',
    type: {
      set: 'Establecer tipo',
      setForSelected: 'Establecer tipo para {{count}} seleccionados',
      none: 'Ninguno',
      newLabel: 'Nueva etiqueta…',
      renameLabel: 'Renombrar etiqueta',
      deleteLabel: 'Eliminar etiqueta',
      manageLabels: 'Etiquetas de tipo',
      labelName: 'Nombre',
      labelNamePlaceholder: 'p. ej. alfa-tubulina',
      labelColor: 'Color',
      labelDialogDescription: 'Nombre el tipo de tubulina y elija un color.',
      updated: 'Tipo de microtúbulo actualizado',
      updateFailed: 'No se pudo actualizar el tipo de microtúbulo',
      createFailed: 'No se pudo crear la etiqueta',
      renameFailed: 'No se pudo renombrar la etiqueta',
      deleteFailed: 'No se pudo eliminar la etiqueta',
      loadFailed: 'No se pudieron cargar las etiquetas de tipo',
      duplicateName: 'Ya existe una etiqueta con este nombre',
    },
    color: {
      label: 'Color:',
      byInstance: 'Instancia',
      byLabel: 'Etiqueta',
    },
  },
  sperm: {
    instancePanel: 'Instancias de espermatozoides',
    instance: 'Espermatozoide',
    newInstance: 'Nueva instancia',
    unassigned: 'Sin asignar',
    unclassified: 'Sin clasificar',
    part: {
      head: 'Cabeza',
      midpiece: 'Pieza media',
      tail: 'Cola',
    },
    setAsHead: 'Establecer como cabeza',
    setAsMidpiece: 'Establecer como pieza media',
    setAsTail: 'Establecer como cola',
    assignTo: 'Asignar a',
    export: {
      description:
        'Exportar mediciones de morfología espermática (longitudes de cabeza, pieza media y cola) a Excel.',
      calibration: 'Factor de calibración',
      instances: 'instancias',
      polylines: 'polilíneas',
      button: 'Exportar métricas de espermatozoides',
      failed: 'Error al exportar métricas de espermatozoides',
    },
  },
  feedback: {
    buttonTitle: 'Enviar comentarios',
    buttonAriaLabel: 'Abrir formulario de comentarios',
    title: 'Enviar comentarios',
    subtitle:
      '¿Encontraste un error o tienes una idea? Cuéntanos — leemos cada informe.',
    typeBug: 'Reporte de error',
    typeFeature: 'Solicitud de función',
    titleLabel: 'Título',
    titlePlaceholder: 'Resumen breve',
    bodyLabel: 'Detalles',
    bodyPlaceholder:
      'Pasos para reproducir, qué esperabas, capturas si es relevante...',
    submit: 'Enviar',
    submittedSuccess: '¡Gracias! Tu comentario fue enviado.',
    submitFailed: 'No se pudo enviar el comentario',
    submittedNoEmail:
      '¡Gracias! Tu comentario fue registrado (la notificación por correo está pendiente).',
    attachmentStoreFailed:
      'Tu informe se envió, pero el archivo adjunto no se pudo almacenar — inténtalo de nuevo.',
    attachmentPrompt:
      'Arrastra un archivo aquí, o haz clic para seleccionar — una captura o el vídeo/ND2 sobre el que trata tu informe (hasta 50 GB)',
    attachmentTooLarge: 'Archivo demasiado grande — el límite es 50 GB',
    attachmentInvalidType:
      'Tipo de archivo no admitido (solo imagen, vídeo o ND2)',
    removeAttachment: 'Quitar adjunto',
    uploading: 'Subiendo…',
  },
  editor: {
    channelSwitcher: {
      title: 'Canales',
      detectionSource: 'Fuente de segmentación',
    },
    kymograph: {
      title: 'Kimógrafo',
      sourceChannel: 'Canal de origen',
      tracked: '🔗 Seguido entre fotogramas',
      untracked: '⚠ Línea estática (sin seguimiento)',
      computing: 'Calculando kimógrafo…',
      downloadPng: 'PNG',
      downloadCsv: 'CSV',
      showKymograph: 'Mostrar kimógrafo',
      axisTime: 'Tiempo (frames)',
      axisAlong: 'A lo largo del microtúbulo (px) →',
      zoomIn: 'Acercar',
      zoomOut: 'Alejar',
      fit: 'Ajustar a la vista',
      zoomHint: 'arrastra para desplazar · rueda para zoom',
      empty: 'No se pudo calcular el kimograma.',
      velocityAnalysis: 'Análisis de velocidad',
      velocityHint:
        'Detecta partículas en movimiento y sus velocidades. Vuelve a leer todos los fotogramas, por lo que aproximadamente duplica la espera.',
      velocityIdle:
        'El análisis de velocidad está desactivado — el kimograma se carga más rápido sin él.',
      analyseVelocities: 'Analizar velocidades',
      velocityComputing: 'Analizando velocidades…',
      widthLabel: 'Ancho de intensidad',
      widthHint:
        'Ancho (px) de la banda muestreada alrededor de cada trayectoria para señal vs. intensidad de fondo.',
      minIntensityLabel: 'Intensidad mínima',
      minIntensityHint:
        'Ocultar trayectorias más tenues que este número de unidades de intensidad sobre su propio fondo local. Absoluto — independiente del escalado de visualización — pero no comparable entre canales. Vacío o 0 muestra todas.',
      lineWidthLabel: 'Ancho de línea',
      lineWidthHint:
        'Ancho (px) de la línea muestreada a lo largo del microtúbulo, medido transversalmente. 1 muestrea un solo píxel.',
      lineReduceLabel: 'A lo ancho',
      lineReduceHint:
        'Cómo los píxeles a lo ancho de la línea se convierten en un solo valor. La media coincide con ImageJ; el máximo es más brillante pero se sesga por píxeles calientes aislados.',
      lineReduceMean: 'Media',
      lineReduceMax: 'Máximo',
      colVelocity: 'Velocidad neta',
      colRunLength: 'Longitud de tramo (µm)',
      colRunTime: 'Duración de tramo (s)',
      colIntensity: 'Intensidad (señal−fondo)',
      colEdge: 'Borde',
      colBright: 'Brillo',
      brightHint:
        'Intensidad atípica — probablemente un agregado de varios motores, no un solo motor.',
      colSnr: 'SNR',
      edge: {
        left: 'Alcanza el extremo izquierdo (continúa fuera del microtúbulo)',
        right: 'Alcanza el extremo derecho (continúa fuera del microtúbulo)',
        both: 'Alcanza ambos extremos',
        none: 'Se mantiene dentro del microtúbulo',
      },
      noBlobs: 'No se detectaron partículas en movimiento',
      velocityFailed: 'Error en la detección de velocidad.',
      filteredHidden:
        '{{count}} trayectoria(s) no procesiva(s) por debajo de 0.01 µm/s oculta(s).',
      dimHidden:
        '{{count}} trayectoria(s) por debajo de {{threshold}} unidades sobre el fondo ocultas.',
      unmeasuredKept:
        '{{count}} trayectoria(s) no se pudieron medir; el umbral de intensidad no se les aplicó.',
      downloadTracks: 'CSV de velocidad',
      uncalibrated:
        'Sin calibración de tamaño de píxel / intervalo de fotogramas — velocidades en px/fotograma.',
    },
    channels: {
      toggleVisibility: 'Alternar visibilidad del canal',
      editColor: 'Editar color',
      opacity: 'Opacidad del canal',
      renameHint: 'Doble clic para renombrar',
      renameFailed: 'Error al renombrar',
      renameTooLong: 'Nombre demasiado largo (máx 128 caracteres)',
      colorDialog: {
        title: 'Color del canal:',
        description:
          'Elija cómo este canal tiñe la superposición compuesta. El blanco mantiene la escala de grises sin cambios.',
        customLabel: 'Personalizado',
      },
    },
    windowLevel: {
      title: 'Visualización',
      channel: 'Canal',
      min: 'Mín',
      max: 'Máx',
      brightness: 'Brillo',
      contrast: 'Contraste',
      reset: 'Restablecer',
    },
    frameNavigation: {
      frame: 'Cuadro',
      play: 'Reproducir',
      pause: 'Pausar',
      buffering: 'Almacenando en búfer…',
    },
  },

  folders: {
    folder: 'Carpeta',
    home: 'Inicio',
    newFolder: 'Nueva carpeta',
    createFolder: 'Crear carpeta',
    create: 'Crear',
    folderName: 'Nombre de la carpeta',
    folderNamePlaceholder: 'p. ej. Experimento A',
    rename: 'Renombrar',
    renameFolder: 'Renombrar carpeta',
    deleteFolder: 'Eliminar carpeta',
    deleteFolderConfirm:
      '¿Eliminar la carpeta «{{name}}»? Esto eliminará permanentemente {{projects}} proyecto(s) y {{subfolders}} subcarpeta(s). {{shared}} proyecto(s) compartido(s) volverán a la raíz.',
    moveTo: 'Mover a…',
    moveToRoot: 'Raíz (sin carpeta)',
    openFolder: 'Abrir carpeta {{name}}',
    empty: 'Carpeta vacía',
    created: 'Carpeta creada',
    renamed: 'Carpeta renombrada',
    deleted: 'Carpeta eliminada',
    moved: 'Movido correctamente',
    moveSkipped: 'Movimiento omitido — sin acceso al proyecto',
    movePartial:
      'Movidos {{moved}} proyecto(s); {{skipped}} omitido(s) (sin acceso)',
    moveAllSkipped: '{{count}} proyecto(s) omitido(s) — sin acceso',
    deletePartial:
      '{{deleted}} proyecto(s) eliminado(s); {{failed}} falló/fallaron. Carpeta conservada; inténtelo de nuevo.',
    duplicateName: 'Ya existe una carpeta con este nombre aquí',
    cannotMoveIntoSelf:
      'Una carpeta no se puede mover dentro de sí misma o de su propia subcarpeta',
  },
  automatedEssays: {
    rerun: 'Ejecutar de nuevo',
    rerunHint:
      'Vuelve a ejecutar esta carpeta con los archivos ya almacenados en el servidor: no hace falta volver a subirlos.',
    rerunStarted: 'La ejecución se ha vuelto a poner en cola.',
    rerunFailed: 'No se ha podido volver a iniciar la ejecución.',
    rerunConfirm:
      '¿Ejecutar esta carpeta de nuevo? Se usarán los archivos ya almacenados en el servidor.',
    rerunConfirmReplace:
      '¿Ejecutar esta carpeta de nuevo? El resultado actual se reemplazará: descárguelo primero si quiere conservarlo.',
    navLabel: 'Ensayos automatizados',
    title: 'Ensayos automatizados',
    subtitle:
      'Sube una carpeta de grabaciones de pocillos .nd2 para medir la longitud y la intensidad de los microtúbulos en cada pocillo.',
    dragFolder: 'Arrastra aquí una carpeta de pocillos .nd2',
    dropHere: 'Suelta la carpeta para añadirla',
    selectFolder: 'Seleccionar carpeta',
    onlyNd2: 'Solo se procesan grabaciones de pocillos .nd2.',
    filesSelected: '{{count}} archivo(s) .nd2 seleccionados',
    clear: 'Limpiar',
    uploadAndProcess: 'Subir y procesar',
    uploading: 'Subiendo… {{percent}} %',
    jobStarted: 'Subida completa: procesamiento iniciado',
    uploadFailed: 'Error al subir',
    downloadFailed: 'No se pudo iniciar la descarga',
    yourRuns: 'Tus ejecuciones',
    noRuns: 'Aún no hay ejecuciones. Sube una carpeta para empezar.',
    fileCount: '{{count}} archivo(s)',
    mtCount: '{{count}} microtúbulos',
    deviceDegraded: 'CPU (GPU no disponible)',
    deviceDegradedHint:
      'Esta ejecución debía usar la GPU pero no pudo acceder a ella, así que se ejecutó en la CPU y tardó mucho más. Por favor, repórtelo.',
    deviceBusy: 'CPU (GPU ocupada)',
    deviceBusyHint:
      'La GPU compartida estuvo ocupada durante toda la espera, así que se ejecutó en la CPU y tardó más. No hay ningún problema, no es necesario informarlo.',
    download: 'Descargar',
    delete: 'Eliminar',
    deleteFailed: 'No se pudo eliminar la ejecución',
    noNd2Found: 'No se encontraron grabaciones .nd2 en esa carpeta',
    someIgnored: 'Usando {{kept}} de {{total}} archivos (solo se procesa .nd2)',
    status: {
      queued: 'En cola',
      running: 'Procesando',
      completed: 'Completado',
      failed: 'Fallido',
    },
  },
  segmenter: {
    dashboard: {
      title: 'Segmentador',
      subtitle:
        'Conjuntos de datos de anotación de polígonos con aprendizaje de pocos ejemplos y autoentrenamiento',
      newDataset: 'Nuevo conjunto de datos',
      noDatasets: 'Aún no hay conjuntos de datos.',
      createFirst: 'Crea tu primer conjunto de datos',
      deleteDataset: 'Eliminar conjunto de datos',
      imageCount: '{{count}} imagen(es)',
      createDialogTitle: 'Nuevo conjunto de datos',
      createDialogDescription:
        'Los conjuntos de datos agrupan imágenes sin etiquetar que anotarás con tus propias clases.',
      nameLabel: 'Nombre del conjunto de datos',
      namePlaceholder: 'p. ej. Núcleos — ronda 1',
      creating: 'Creando…',
      create: 'Crear',
      deleteConfirmTitle: '¿Eliminar conjunto de datos?',
      deleteConfirmDescription:
        'Esto elimina permanentemente "{{name}}", todas sus imágenes, clases y anotaciones. Esta acción no se puede deshacer.',
      cancel: 'Cancelar',
      deleting: 'Eliminando…',
      delete: 'Eliminar',
      loadFailed: 'No se pudieron cargar los conjuntos de datos',
      created: 'Conjunto de datos creado',
      createFailed: 'No se pudo crear el conjunto de datos',
      deleted: 'Conjunto de datos eliminado',
      deleteFailed: 'No se pudo eliminar el conjunto de datos',
    },
    datasetDetail: {
      backLabel: 'Volver a los conjuntos de datos',
      loading: 'Cargando…',
      imageCount: '{{count}} imagen(es)',
      noImages: 'Aún no hay imágenes. Suelta algunas arriba para empezar.',
      annotated: 'Anotado',
      deleteImage: 'Eliminar imagen',
      deleteConfirmTitle: '¿Eliminar imagen?',
      deleteConfirmDescription:
        'Esto elimina permanentemente "{{name}}" y su anotación. Esta acción no se puede deshacer.',
      cancel: 'Cancelar',
      deleting: 'Eliminando…',
      delete: 'Eliminar',
      loadFailed: 'No se pudo cargar el conjunto de datos',
      deleteFailed: 'No se pudo eliminar la imagen',
    },
    upload: {
      skippedVideo:
        '{{count}} archivo(s) omitido(s) — el segmentador solo acepta imágenes estáticas',
      success: '{{count}} imagen(es) subida(s)',
      partialFail:
        '{{uploaded}} subida(s), {{failed}} con errores — revisa el formato y el tamaño',
      failed: 'Error al subir',
    },
    classes: {
      panelTitle: 'Clases',
      newClass: 'Nueva clase',
      loading: 'Cargando clases…',
      empty: 'Aún no hay clases. Crea una para empezar a anotar.',
      renameLabel: 'Renombrar clase',
      deleteLabel: 'Eliminar clase',
      unclassified: 'Sin clasificar',
      unknown: 'Clase desconocida',
      activeClass: 'Clase activa',
      pickerEmpty: 'Aún no hay clases — crea una antes de dibujar.',
      dialogTitleCreate: 'Nueva clase',
      dialogTitleRename: 'Renombrar clase',
      dialogDescription:
        'Ponle a la clase un nombre y un color con los que se dibujarán sus polígonos.',
      nameLabel: 'Nombre de la clase',
      namePlaceholder: 'p. ej. Núcleo',
      colorLabel: 'Color',
      cancel: 'Cancelar',
      create: 'Crear',
      save: 'Guardar',
      loadFailed: 'No se pudieron cargar las clases',
      createFailed: 'No se pudo crear la clase',
      nameClash: 'Ya existe una clase con ese nombre',
      renameFailed: 'No se pudo renombrar la clase',
      deleteFailed: 'No se pudo eliminar la clase',
    },
    editor: {
      missingRouteParams:
        'Falta el id del conjunto de datos o de la imagen en la ruta.',
      back: 'Volver',
      selectMode: 'Seleccionar',
      drawPolygon: 'Dibujar polígono',
      editVertices: 'Editar vértices',
      deletePolygon: 'Eliminar polígono',
      undo: 'Deshacer',
      redo: 'Rehacer',
      zoomOut: 'Alejar',
      zoomIn: 'Acercar',
      resetView: 'Restablecer vista',
      save: 'Guardar',
      saveUnsaved: 'Guardar*',
      saved: 'Anotación guardada',
      saveFailed: 'No se pudo guardar la anotación',
      loadFailed: 'No se pudo cargar la anotación',
      saveDisabledLoadError:
        'Guardar está deshabilitado hasta que la anotación de esta imagen se cargue correctamente, para evitar sobrescribir tu trabajo guardado con una anotación vacía.',
      retry: 'Reintentar',
      imageLoadFailed: 'No se pudo cargar la imagen',
      imageAlt: 'Imagen para anotar',
      minVertices: 'Un polígono necesita al menos 3 puntos',
    },
    polygonList: {
      title: 'Polígonos ({{count}})',
      empty:
        'Aún no hay polígonos. Cambia a "Dibujar polígono" y haz clic en la imagen.',
      instance: 'Instancia {{id}}',
      points: '{{count}} puntos',
      changeClass: 'Cambiar clase',
      delete: 'Eliminar polígono',
    },
  },
  admin: {
    navLabel: 'Administración',
    usersTitle: 'Usuarios registrados',
    usersDescription:
      'Elige un usuario para iniciar sesión como él, para depuración y soporte. Cada sesión queda registrada en el registro de auditoría.',
    searchPlaceholder: 'Buscar por correo o nombre de usuario',
    columnUsername: 'Nombre de usuario',
    columnProjects: 'Proyectos',
    columnRegistered: 'Registrado',
    badgeAdmin: 'Administrador',
    logInAs: 'Iniciar sesión como',
    cannotImpersonateSelf: 'Esta es tu propia cuenta.',
    cannotImpersonateAdmin:
      'No se puede suplantar una cuenta de administrador.',
    impersonateFailed: 'No se pudo iniciar sesión como este usuario.',
    loadUsersFailed: 'No se pudo cargar la lista de usuarios.',
    noUsersFound: 'Ningún usuario coincide con esta búsqueda.',
    pageOf: 'Página {{page}} de {{total}}',
    nextPage: 'Siguiente',
    notAuthorizedTitle: 'Se requiere acceso de administrador',
    notAuthorizedDescription:
      'Esta página solo está disponible para los administradores de la plataforma.',
    impersonationBannerTitle: 'Sesión de soporte.',
    impersonationBannerViewing: 'Estás viendo la cuenta de',
    impersonationBannerSignedInAs: '— has iniciado sesión como',
    returnToUserList: 'Volver a la lista de usuarios',
    stopImpersonationFailed: 'No se pudo finalizar la sesión de soporte.',
  },
};
