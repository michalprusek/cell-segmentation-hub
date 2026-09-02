export default {
  common: {
    appName: 'SpheroSeg',
    loading: 'Načítání...',
    save: 'Uložit',
    cancel: 'Zrušit',
    apply: 'Použít',
    dismiss: 'Zavřít',
    delete: 'Smazat',
    edit: 'Upravit',
    actions: 'Akce',
    show: 'Zobrazit',
    hide: 'Skrýt',
    create: 'Vytvořit',
    search: 'Hledat',
    error: 'Chyba',
    success: 'Úspěch',
    back: 'Zpět',
    signIn: 'Přihlásit se',
    signUp: 'Registrovat se',
    signOut: 'Odhlásit se',
    settings: 'Nastavení',
    profile: 'Profil',
    dashboard: 'Přehled',
    project: 'Projekt',
    projects: 'Projekty',
    polygon: 'Polygon',
    newProject: 'Nový projekt',
    upload: 'Nahrát',
    uploadImages: 'Nahrát obrázky',
    recentAnalyses: 'Nedávné analýzy',
    noProjects: 'Nebyly nalezeny žádné projekty',
    noImages: 'Nebyly nalezeny žádné obrázky',
    createYourFirst: 'Vytvořte svůj první projekt pro začátek',
    tryAgain: 'Zkusit znovu',
    cancelling: 'Rušení...',
    deleting: 'Mazání...',
    retry: 'Zkusit znovu',
    retrying: 'Opakuji pokus...',
    retryAttempt: 'Pokus {{attempt}} z {{max}}',
    retryingIn: 'Zkouším znovu za {{seconds}} sekund...',
    nextRetryIn: 'Další pokus za {{seconds}}s',
    operationFailed: 'Operace selhala',
    unexpectedError: 'Nastala neočekávaná chyba',
    failedToLoad: 'Načtení selhalo',
    loadingFailed: 'Načtení selhalo. Zkuste to prosím znovu.',
    networkError: 'Chyba sítě. Zkontrolujte prosím připojení.',
    refreshPage: 'Obnovit stránku',
    tryAgainLater: 'Zkuste to prosím později',
    email: 'Email',
    password: 'Heslo',
    name: 'Jméno',
    description: 'Popis',
    date: 'Datum',
    status: 'Stav',
    images: 'Obrázky',
    image: 'Obrázek',
    projectName: 'Název projektu',
    projectDescription: 'Popis projektu',
    theme: 'Motiv',
    language: 'Jazyk',
    light: 'Světlý',
    dark: 'Tmavý',
    system: 'Systémový',
    account: 'Účet',
    notifications: 'Oznámení',
    passwordConfirm: 'Potvrdit heslo',
    manageAccount: 'Spravovat účet',
    getStarted: 'Začít',
    learnMore: 'Zjistit více',
    documentation: 'Dokumentace',
    changePassword: 'Změnit heslo',
    deleteAccount: 'Smazat účet',
    termsOfService: 'Podmínky služby',
    privacyPolicy: 'Zásady ochrany osobních údajů',
    createAccount: 'Vytvořit účet',
    signInToAccount: 'Přihlásit se k účtu',
    sort: 'Řadit',
    no_preview: 'Žádný náhled',
    openMenu: 'Otevřít menu',
    logOut: 'Odhlásit se',
    pageNotFound: 'Ojoj! Stránka nebyla nalezena',
    returnToHome: 'Návrat domů',
    next: 'Další',
    copy: 'Kopírovat',
    close: 'Zavřít',
    noImage: 'Žádný obrázek',
    untitledImage: 'Nepojmenovaný obrázek',
    rename: 'Přejmenovat',
    redirectingToDashboard: 'Přesměrování na přehled...',
  },
  landing: {
    hero: {
      eyebrow: 'Segmentace biomedicínských obrazů · ÚTIA AV ČR',
      title: 'Segmentace pro každý vzorek, který nasnímáte.',
      subtitle:
        'Sféroidy a jejich rozpad, rány ze scratch assay, morfologie spermií, vlákna mikrotubulů, mikrokapsle, neurony a jejich výběžky — pro každý typ natrénovaný model, pro všechny jeden editor a export, kterému ImageJ, COCO i YOLO rozumí.',
      getStarted: 'Začít',
      learnMore: 'Co všechno zvládne',
      backupNoticeTitle: 'Nechte si vlastní kopii svých snímků.',
      backupNotice:
        'Nahrané obrazové soubory zálohované nejsou. Váš účet, projekty a výsledky segmentace se zálohují denně.',
    },
    specimens: {
      trayLabel: 'Vyberte vzorek',
      spheroid: {
        label: 'Sféroid',
        detail:
          'Světlé pole, 2048 × 2048. Jeden nádorový sféroid, obrys červeně od modelu HRNet — přesně ten obrys, který vám editor nabídne k úpravě.',
        alt: 'Snímek jednoho nádorového sféroidu ve světlém poli s červeně vykresleným segmentačním obrysem.',
      },
      disintegration: {
        label: 'Rozpadající se sféroid',
        detail:
          'Světlé pole, 2048 × 2048, 48 hodin od začátku rozpadového testu. Husté jádro je zeleně, každá buňka, která se od něj oddělila, červeně. Přesně z tohoto rozdělení se počítá index rozpadu.',
        alt: 'Snímek rozpadajícího se sféroidu ve světlém poli: husté jádro obtažené zeleně, každá oddělená buňka červeně.',
      },
      wound: {
        label: 'Rána ze scratch assay',
        detail:
          'Scratch assay, 2048 × 2048. Otevřená rána je červená hranice; ostrůvky buněk uvnitř jsou modré a od plochy rány se odečítají.',
        alt: 'Snímek ze scratch assay s otevřenou ranou obtaženou červeně a čtyřmi ostrůvky buněk uvnitř obtaženými modře.',
      },
      sperm: {
        label: 'Morfologie spermií',
        detail:
          'Světlé pole, 1360 × 1024. Každá buňka je vedena jako tři lomené čáry místo jedné plochy — hlavička zeleně, krček oranžově, bičík azurově — takže každý úsek lze změřit zvlášť.',
        alt: 'Snímek dvou spermií ve světlém poli, každá vedená třemi barevnými lomenými čarami: zelená hlavička, oranžový krček, azurový bičík.',
      },
      microtubule: {
        label: 'Vlákna mikrotubulů',
        detail:
          'Časosběr v IRM, snímek 30. Každé vlákno má vlastní osu a barvu podle identifikátoru dráhy — tu si drží po celém časosběru, takže kymograf sleduje jedno konkrétní vlákno, ne to zrovna nejbližší.',
        alt: 'Snímek mikrotubulů v interferenčním reflexním kontrastu, každé vlákno vedené osou ve vlastní barvě.',
      },
      microcapsule: {
        label: 'Mikrokapsle',
        detail:
          'Světlé pole, 1280 × 1024. Dvě celé kapsle jsou obtaženy červeně — právě u nich se počítá plocha, obvod a kompaktnost. Kapsle uříznuté okrajem snímku červený obrys nemají: model je označí a do statistik nevstupují.',
        alt: 'Snímek mikrokapslí ve světlém poli, dvě celé kapsle obtažené červeně, kapsle uříznuté okrajem snímku bez obrysu.',
      },
      neurite: {
        label: 'Neurity a somata',
        detail:
          'Konfokální fluorescence, tubulinový kanál — výřez 1400 × 1400 ze snímku 6657 × 6664. Každý neuron se dělí na dvě třídy: tělo buňky purpurově, každý jeho výběžek azurově, takže počet somat i délka výběžků se měří odděleně, ne jako jedna skvrna.',
        alt: 'Konfokální fluorescenční snímek kultivovaných neuronů, tělo každé buňky obtažené purpurově a výběžky z něj vycházející azurově.',
      },
    },
    about: {
      badge: 'Kdo za tím stojí',
      title: 'Odkud platforma pochází',
      description1:
        'Naše platforma byla vyvinuta Bc. Michalem Průškem, studentem Fakulty jaderné a fyzikálně inženýrské ČVUT v Praze, pod vedením Ing. Adama Novozámského, Ph.D.',
      description2:
        'Tento projekt je ve spolupráci se skupinou Ing. Silvie Rimpelové, Ph.D. z Ústavu biochemie a mikrobiologie VŠCHT Praha.',
      description3:
        'Začalo to u nádorových sféroidů a rostlo to s experimenty, které nám naši spolupracovníci nosili: rozpadové testy, rány ze scratch assay, morfologie spermií, časosběry mikrotubulů, mikrokapsle a kultivované neurony. Každý typ vzorku má vlastní natrénovaný model, vlastní metriky a vlastní export — a za nimi jeden editor.',
      contactText: 'Pro dotazy nás prosím kontaktujte na',
      supportText:
        'Pokud byste chtěli projekt podpořit finančně, ozvěte se mi prosím na',
    },
    acknowledgments: {
      badge: 'Poděkování',
      title: 'Zvláštní poděkování',
      lukasIntro: 'Děkujeme',
      lukasName: 'Lukáši Veškrnovi',
      lukasContribution:
        'za poskytnutí celého modulu pro segmentaci hojení ran (wound healing) této platformě.',
      visitPage: 'Navštívit stránku',
    },
    cta: {
      title: 'Přineste vlastní snímky.',
      subtitle:
        'Založte projekt, vyberte typ vzorku a nahrajte sérii snímků. Model běží na GPU a výsledek se rovnou otevře v editoru, připravený k úpravám.',
      cardDescription: 'Registrace je otevřená — pozvánku nepotřebujete',
      createAccount: 'Vytvořit účet',
    },
    features: {
      badge: 'Co umí',
      title: 'Jeden editor, ať máte na sklíčku cokoli',
      subtitle:
        'Každý typ vzorku má vlastní model a vlastní metriky. Všechno další — úpravy, sledování v čase, export — je už stejné.',
      cards: {
        models: {
          title: 'Model pro každý typ vzorku',
          description:
            'Typ vzorku zvolíte při zakládání projektu a nabídnou se jen modely, které k němu sedí. Samotné sféroidy jich mají pět, od U-Netu za 200 ms po Mamba bottleneck pro snímky z neznámého mikroskopu.',
        },
        stacks: {
          title: 'Časosběry a série, nejen jednotlivé snímky',
          description:
            'MP4, AVI, MOV, MKV i WebM, vícestránkový TIFF a Nikon ND2 se nahrají jako jedna položka a rozbalí se na snímky. Vícekanálové akvizice si kanály ponechají a vy vyberete, ze kterého model čte.',
        },
        tracking: {
          title: 'Identita, která přežije posun v čase',
          description:
            'Mikrotubuly se mezi snímky páruje geometrie křivek, takže si vlákno drží své id i barvu po celé akvizici — a kymograf měří právě to vlákno, ne to zrovna nejbližší.',
        },
        corrections: {
          title: 'Cokoli opravíte ručně',
          description:
            'Táhněte vrcholy, rozdělte slitý objekt na dva, přidejte body na obrysu, spojte dvě lomené čáry, přeznačte třídu. Úpravy se ukládají k obrázku, nedrží se jen v prohlížeči.',
        },
        measurements: {
          title: 'Čísla, v souborech, které otevřou i jiné nástroje',
          description:
            'Plocha, obvod, Feretův průměr, délka lomené čáry a intenzita po kanálech — export do XLSX i do COCO, YOLO, ROI sad pro ImageJ a anotací pro CVAT.',
        },
        batch: {
          title: 'Dimenzováno na celý experiment',
          description:
            'Dávky až 10 000 snímků běží na GPU a fronta odsouvá toho, koho právě obsloužila, takže jeden 600snímkový časosběr nezablokuje ostatní.',
        },
      },
    },
  },
  dashboard: {
    manageProjects: 'Spravujte své výzkumné projekty a analýzy',
    projectGallery: 'Galerie Projektů',
    projectGalleryDescription:
      'Procházejte a spravujte všechny své segmentační projekty',
    statsOverview: 'Přehled statistik',
    totalProjects: 'Celkem projektů',
    activeProjects: 'Aktivní projekty',
    totalImages: 'Celkem obrázků',
    totalAnalyses: 'Celkem analýz',
    lastUpdated: 'Naposledy aktualizováno',
    noProjectsDescription:
      'Zatím jste nevytvořili žádný projekt. Vytvořte svůj první projekt pro začátek.',
    noImagesDescription: 'Nahrajte několik obrázků pro začátek',
    searchProjectsPlaceholder: 'Hledat projekty...',
    searchImagesPlaceholder: 'Hledat obrázky podle názvu...',
    sortBy: 'Řadit podle',
    name: 'Název',
    lastChange: 'Poslední změna',
    status: 'Stav',
    stats: {
      totalProjects: 'Celkem projektů',
      totalProjectsDesc: 'Aktivní studie',
      processedImages: 'Zpracované obrázky',
      processedImagesDesc: 'Úspěšně segmentovány',
      uploadedToday: 'Nahrané dnes',
      uploadedTodayDesc: 'Mikroskopické snímky',
      storageUsed: 'Využité úložiště',
      totalSpaceUsed: 'Celkem využitého místa',
      incompleteWarning:
        'Statistiky mohou být neúplné — nepodařilo se načíst {{count}} projekt(y)',
    },
    completed: 'Dokončeno',
    processing: 'Zpracování',
    pending: 'Čekající',
    failed: 'Selhalo',
    storageUsed: 'Využité úložiště',
  },
  projects: {
    createProject: 'Vytvořit nový projekt',
    createProjectDesc:
      'Přidat nový projekt pro organizaci vašich mikroskopických snímků a analýz.',
    projectType: 'Typ projektu',
    projectTypeUpdated: 'Typ projektu byl aktualizován',
    failedToUpdateProject: 'Nepodařilo se aktualizovat projekt',
    changeProjectType: 'Změnit typ projektu',
    typeChangeSegmentationsWarning:
      '{{count}} existujících segmentací nemusí odpovídat exportnímu formátu "{{type}}". Re-segmentujte pro aktualizaci metrik.',
    verified: 'Ověřeno',
    toggleVerified: 'Přepnout ověření',
    projectVerified: 'Projekt byl označen jako ověřený',
    projectUnverified: 'Označení ověření projektu bylo zrušeno',
    failedToUpdateVerified: 'Nepodařilo se aktualizovat stav ověření',
    types: {
      spheroid: 'Sféroidy (standardní)',
      spheroid_invasive: 'Rozprsknuté sféroidy',
      wound: 'Hojení ran',
      sperm: 'Spermie',
      microtubules: 'Mikrotubuly',
      microcapsule: 'Mikrokapsle',
      neurite: 'Neurity a somata',
    },
    projectNamePlaceholder: 'např. Buňky HeLa, destička 3',
    projectDescPlaceholder:
      'např. Screening rezistence na léčiva, 48h časosběr',
    creatingProject: 'Vytváření...',
    duplicateProject: 'Duplikovat',
    shareProject: 'Sdílet',
    deleteProject: 'Smazat',
    openProject: 'Otevřít projekt',
    confirmDelete: 'Opravdu chcete tento projekt smazat?',
    projectCreated: 'Projekt byl úspěšně vytvořen',
    projectDeleted: 'Projekt byl úspěšně smazán',
    viewProject: 'Zobrazit projekt',
    projectImages: 'Obrázky projektu',
    noProjects: 'Žádné projekty nebyly nalezeny',
    imageDeleted: 'Obrázek byl odstraněn',
    deleteImageError: 'Nepodařilo se odstranit obrázek',
    deleteImageFailed: 'Odstranění obrázku selhalo',
    imagesQueuedForSegmentation:
      '{{count}} obrázků přidáno do fronty pro segmentaci',
    imageQueuedForResegmentation: 'Obrázek přidán do fronty pro re-segmentaci',
    errorAddingToQueue: 'Chyba při přidávání obrázků do fronty',
    imageAlreadyProcessing: 'Obrázek je již zpracováván',
    processImageFailed: 'Nepodařilo se zpracovat obrázek',
    selected: '{{count}} obrázek vybrán',
    deleteSelected: 'Smazat vybrané',
    segmentationCompleted: 'Segmentace dokončena pro obrázek',
    segmentationFailed: 'Segmentace selhala',
    segmentationStarted: 'Segmentace byla zahájena',
    segmentationCompleteWithCount:
      'Segmentace dokončena! Nalezeno {{count}} objektů',
    failedToLoadProjects: 'Nepodařilo se načíst projekty',
    projectNameRequired: 'Zadejte prosím název projektu',
    mustBeLoggedIn: 'Pro vytvoření projektu se musíte přihlásit',
    failedToCreateProject: 'Nepodařilo se vytvořit projekt',
    serverResponseInvalid: 'Odpověď serveru byla neplatná',
    projectCreatedDesc: '"{{name}}" je připraven pro obrázky',
    descriptionOptional: 'Popis (volitelný)',
    noDescriptionProvided: 'Nebyl poskytnut žádný popis',
    deleteDialog: {
      title: 'Potvrdit smazání',
      description:
        'Opravdu chcete smazat {{count}} vybraných obrázků? Tuto akci nelze vrátit zpět.',
    },
    selectProject: 'Vybrat projekt',
    projectSelection: 'Výběr projektu',
    selectProjectHeader: 'Vybrat projekt',
  },
  errors: {
    noProjectOrUser:
      'Není vybrán žádný projekt nebo uživatel. Vyberte prosím projekt ze seznamu.',
    unknown: 'Nastala neočekávaná chyba. Zkuste prosím akci opakovat.',
    network:
      'Nelze se připojit k serveru. Zkontrolujte své internetové připojení a zkuste to znovu.',
    unauthorized: 'Vaše přihlášení vypršelo. Přihlaste se prosím znovu.',
    forbidden:
      'K této akci nemáte oprávnění. Kontaktujte správce, pokud si myslíte, že je to chyba.',
    notFound: 'Požadovaný obsah nebyl nalezen. Možná byl smazán nebo přesunut.',
    conflict:
      'Tento email je již zaregistrován. Zkuste se přihlásit nebo použijte jiný email.',
    invalidCredentials:
      'Nesprávný email nebo heslo. Zkontrolujte své přihlašovací údaje.',
    validation:
      'Zadané údaje nejsou správné. Zkontrolujte formulář a opravte chyby.',
    general: 'Něco se pokazilo. Zkuste to prosím znovu za chvíli.',
    server: 'Server je momentálně nedostupný. Zkuste to prosím později.',
    timeout:
      'Požadavek trval příliš dlouho. Zkontrolujte připojení a zkuste to znovu.',
    sessionExpired:
      'Vaše přihlášení vypršelo. Pro pokračování se prosím přihlaste znovu.',
    tooManyRequests:
      'Příliš mnoho požadavků. Počkejte prosím chvíli a zkuste to znovu.',
    serverUnavailable:
      'Služba je dočasně nedostupná. Zkuste to prosím za několik minut.',
    clientError:
      'Chyba v požadavku. Zkontrolujte zadané údaje a zkuste to znovu.',
    emailAlreadyExists:
      'Tento email je již zaregistrován. Zkuste se přihlásit nebo použijte jiný email.',
    validationErrors: {
      projectNameRequired: 'Zadejte prosím název projektu',
      loginRequired: 'Pro vytvoření projektu se musíte přihlásit',
      emailRequired: 'E-mail je povinný',
      passwordRequired: 'Heslo je povinné',
      invalidEmail: 'Zadejte prosím platnou e-mailovou adresu',
      passwordTooShort: 'Heslo musí mít alespoň 6 znaků',
      passwordsDoNotMatch: 'Hesla se neshodují',
      confirmationRequired: 'Potvrďte prosím svou akci',
      fieldRequired: 'Toto pole je povinné',
    },
    operations: {
      loadProject:
        'Nepodařilo se načíst projekt. Zkontrolujte připojení a zkuste to znovu.',
      saveProject:
        'Nepodařilo se uložit změny projektu. Zkuste to prosím znovu.',
      uploadImage:
        'Nepodařilo se nahrát obrázek. Zkontrolujte formát a velikost souboru.',
      deleteImage:
        'Nelze smazat obrázek. Zkuste obnovit stránku a opakovat akci.',
      processImage:
        'Zpracování obrázku selhalo. Zkuste jiný obrázek nebo kontaktujte podporu.',
      segmentation:
        'Segmentace selhala. Zkuste použít jiný model nebo upravit nastavení.',
      export: 'Export dat selhal. Zkontrolujte, zda jsou data k dispozici.',
      login: 'Přihlášení selhalo. Zkontrolujte email a heslo.',
      logout: 'Odhlášení selhalo. Zkuste zavřít prohlížeč.',
      register: 'Registrace selhala. Tento email možná již používá někdo jiný.',
      updateProfile:
        'Nepodařilo se aktualizovat profil. Zkontrolujte zadané údaje.',
      changePassword:
        'Nepodařilo se změnit heslo. Zkontrolujte současné heslo.',
      deleteAccount:
        'Nepodařilo se smazat účet. Kontaktujte podporu pro pomoc.',
      resetPassword:
        'Reset hesla selhal. Zkontrolujte zadanou emailovou adresu.',
      updateConsent:
        'Nepodařilo se aktualizovat nastavení souhlasu. Zkuste to prosím znovu.',
      unshareProject: 'Nepodařilo se odebrat projekt ze sdílených projektů',
      deleteProject: 'Nepodařilo se smazat projekt',
    },
    deleteImages: 'Nepodařilo se smazat vybrané obrázky',
    deleteAnnotations: 'Nepodařilo se smazat anotace',
    contexts: {
      dashboard: 'Chyba dashboardu',
      project: 'Chyba projektu',
      image: 'Chyba obrázku',
      segmentation: 'Chyba segmentace',
      export: 'Chyba exportu',
      auth: 'Chyba autentifikace',
      profile: 'Chyba profilu',
      settings: 'Chyba nastavení',
    },
  },
  images: {
    uploadImages: 'Nahrát obrázky nebo videa',
    dragDrop: 'Přetáhněte obrázky nebo videa sem',
    clickToSelect: 'nebo klikněte pro výběr souborů',
    acceptedFormats:
      'Obrázky: JPEG, PNG, TIFF, BMP (max 20 MB) — Videa: MP4, AVI, MOV, MKV, WebM, ND2, multi-page TIFF (max 100 GB)',
    uploadProgress: 'Průběh nahrávání',
    readyToUpload: 'Připraveno k nahrání',
    uploadingTo: 'Nahrávání do',
    currentProject: 'Aktuální projekt',
    autoSegment: 'Automatická segmentace obrázků po nahrání',
    uploadCompleted: 'Nahrávání dokončeno',
    uploadFailed: 'Nahrávání selhalo',
    imagesUploaded: 'Obrázky byly úspěšně nahrány',
    imagesFailed: 'Nahrávání obrázků selhalo',
    viewAnalyses: 'Zobrazit analýzy',
    noAnalysesYet: 'Zatím žádné analýzy',
    runAnalysis: 'Spustit analýzu',
    viewResults: 'Zobrazit výsledky',
    dropImagesHere: 'Přetáhněte soubory sem...',
    selectProjectFirst: 'Nejprve vyberte projekt',
    registerChannels: {
      promptTitle: 'Registrovat kanály?',
      help: 'Při nahrání opraví malé posuny mezi kanály zarovnáním každého k prvnímu (pouze translace).',
      confirm: 'Registrovat a nahrát',
      decline: 'Nahrát bez registrace',
    },
    projectRequired: 'Před nahráním obrázků musíte vybrat projekt',
    pending: 'Čekající',
    uploading: 'Nahrávání',
    processing: 'Zpracování',
    complete: 'Dokončeno',
    error: 'Chyba',
    imageDeleted: 'Obrázek byl úspěšně smazán',
    deleteImageFailed: 'Smazání obrázku selhalo',
    deleteImageError: 'Chyba při mazání obrázku',
    imageAlreadyProcessing: 'Obrázek se již zpracovává',
    processImageFailed: 'Zpracování obrázku selhalo',
    upload: {
      inProgress:
        'Nahrávání probíhá. Můžete pokračovat v práci — průběh sledujte v pravém dolním rohu.',
      uploading: 'Nahrávání {{success}}/{{total}} souborů',
      completed: '{{count}} souborů úspěšně nahráno',
      completedWithFailures: '{{success}} nahráno, {{failed}} selhalo',
      failed: 'Nahrávání selhalo',
      cancelled: 'Nahrávání zrušeno',
      cancelButton: 'Zrušit nahrávání',
      preparing: 'Příprava nahrávání {{count}} souborů...',
      alreadyInProgress: 'Pro tento projekt již probíhá nahrávání',
      remaining: '~{{time}} zbývá',
      project: 'Projekt:',
      view: 'Zobrazit',
      filesProgress: '{{success}} z {{total}} souborů ({{percent}} %)',
      chunkProgress: 'Část {{current}}/{{total}}',
    },
  },
  specimens: {
    preview: {
      byModel:
        'Skutečné snímky, které tento model segmentoval, i s obrysy, jež vrátil.',
      byType:
        'Skutečné snímky z projektů tohoto typu se segmentací, kterou vytvořil jejich model.',
      alt: 'Ukázkový snímek typu {{type}} se segmentací od modelu {{model}}.',
    },
  },
  settings: {
    pageTitle: 'Nastavení',
    profile: 'Profil',
    account: 'Účet',
    models: 'Modely',
    manageSettings: 'Spravujte své nastavení účtu',
    appearance: 'Vzhled',
    themeSettings: 'Nastavení motivu',
    systemDefault: 'Systémové výchozí',
    languageSettings: 'Nastavení jazyka',
    selectLanguage: 'Vyberte jazyk',
    accountSettings: 'Nastavení účtu',
    notificationSettings: 'Nastavení oznámení',
    emailNotifications: 'E-mailová oznámení',
    pushNotifications: 'Push oznámení',
    profileSettings: 'Nastavení profilu',
    profileUpdated: 'Profil byl úspěšně aktualizován',
    profileUpdateFailed: 'Aktualizace profilu selhala',
    saveChanges: 'Uložit změny',
    savingChanges: 'Ukládání změn...',
    notifications: {
      projectUpdates: 'Aktualizace projektů',
      analysisCompleted: 'Analýza dokončena',
      newFeatures: 'Nové funkce',
      marketingEmails: 'Marketingové e-maily',
      billing: 'Oznámení o fakturaci',
    },
    modelSelection: {
      title: 'Výběr modelu',
      description: 'Vyberte AI model pro segmentaci buněk',
      sections: {
        spheroid: 'Modely sféroidů',
        spheroid_invasive: 'Modely rozprsknutých sféroidů',
        sperm: 'Modely spermií',
        wound: 'Modely hojení ran',
        microtubule: 'Modely mikrotubulů',
        microcapsule: 'Modely mikrokapsulí',
        neurite: 'Modely neuritů a somat',
      },
      presets: {
        fast: 'Rychlý',
        accurate: 'Přesný',
        robust: 'Robustní',
        showMore: 'Zobrazit další modely',
        showLess: 'Skrýt další modely',
      },
      presetDescriptions: {
        fast: 'Náhled v reálném čase, velké dávky, slabší GPU',
        accurate: 'Laboratoře s HQ snímky, když nezáleží na čase',
        robust:
          'Externí laboratoře, neznámá optika, léčené vzorky, neobvyklé morfologie',
      },
      models: {
        hrnet: {
          name: 'HRNet',
          description: 'Rychlý a efektivní model pro segmentaci v reálném čase',
        },
        cbam: {
          name: 'CBAM-ResUNet',
          description: 'Přesný segmentační model s mechanismy pozornosti',
        },
        unet_spherohq: {
          name: 'UNet (SpheroHQ)',
          description:
            'Nejlepší výkon na datové sadě SpheroHQ - optimalizováno pro segmentaci sféroidů s vyváženou rychlostí a přesností (~0.25s/obr., 10 obr./s)',
        },
        spheroid_disintegration: {
          name: 'Rozpad sféroidů',
          description:
            'UNet++ s enkodérem EfficientNet-B5 — 3třídová segmentace (pozadí / korona / husté jádro) rozpadajících se sféroidů; jádro predikuje přímo pro správný Disintegration Index (~0.7s/snímek)',
        },
        segformer: {
          name: 'SegFormer',
          description:
            'Model založený na transformeru (SegFormer-B0) pro sféroidy ve světlém poli — nejvyšší přesnost (93% IoU) a velmi rychlý (~13 ms/snímek)',
        },
        mamba_unet: {
          name: 'Mamba-UNet',
          description:
            'U-Net s obousměrným Mamba (state-space) bottleneckem — nejlepší robustnost na snímcích mimo trénovací distribuci (neznámá optika, léčené vzorky, neobvyklé morfologie)',
        },
        sperm: {
          name: 'Morfologie spermií',
          description:
            'Model morfologie spermií s extrakcí kostry pro měření hlavy, středního dílu a bičíku',
        },
        wound: {
          name: 'Hojení ran (scratch assay)',
          description:
            'U-Net s enkodérem MiT-B5 (SegFormer) pro binární segmentaci ran v mikroskopii scratch-assay (~32 ms na A5000, 90% IoU na externí testovací sadě)',
        },
        microtubule: {
          name: 'Mikrotubuly (ResEnc-M + zakřivený instancer)',
          description:
            'Instanční segmentace mikrotubulů pro IRM časosběrná videa. Síť nnU-Net ResEnc-M předpoví popředí vláken a instancer je rozdělí na jednotlivé centerline, přičemž každé křížení řeší pod tvrdou mezí zakřivení 0,25 rad/px. Trénováno výhradně na syntetických snímcích — bez lidských anotací. ~4,5 s/frame; jediný model v platformě s nativním polyline výstupem.',
        },
        microcapsule: {
          name: 'Microcapsule',
          description:
            'Instanční segmentace mikrokapsulí (kulatých objektů) v mikroskopii světlého pole. Kompaktní U-Net destilovaný z Meta SAM 3 vrací jednu čistou hranici plného rozlišení na kapsuli a odděluje se dotýkající kapsule pomocí watershedu; kapsule přesahující okraj snímku jsou vyloučeny z metrik (plocha, obvod, kompaktnost).',
        },
        neurite_soma: {
          name: 'Neurit / Soma (nnU-Net ResEnc-M)',
          description:
            'Dvoutřídní sémantická segmentace neuronů ve fluorescenční mikroskopii — neurit (výběžky) a soma (tělo buňky) — pouze z tubulinového kanálu. nnU-Net v2 ResEnc-M, ansámbl 3 foldů se zrcadlovou TTA a topologickým členem clDice pro třídu neurit. Dice na testovací sadě 0,832 neurit / 0,915 soma.',
        },
      },
    },
    detectHoles: 'Detekce Děr',
    detectHolesDescription:
      'Povolit detekci vnitřních struktur a děr uvnitř buněk',
    modelSelected: 'Model úspěšně vybrán',
    modelSettingsSaved: 'Nastavení modelu úspěšně uloženo',
    modelSize: {
      small: 'Malý',
      medium: 'Střední',
      large: 'Velký',
    },
    modelDescription: {
      hrnet:
        'Vyvážený model s dobrou rychlostí a kvalitou (E2E ~309ms, 4.9 obr/s)',
      cbam_resunet:
        'Nejpřesnější segmentace s mechanismy pozornosti (E2E ~482ms, 2.7 obr/s)',
      unet_spherohq:
        'Nejrychlejší model po optimalizacích! Výborný pro zpracování v reálném čase (E2E ~286ms, 5.5 obr/s)',
      spheroid_disintegration:
        'Model UNet++ / EfficientNet-B5, 3 třídy (pozadí / korona / jádro) pro rozpadající se sféroidy; husté jádro predikuje přímo pro správný Disintegration Index (30.7M parametrů)',
      segformer:
        'Model SegFormer-B0 založený na transformeru, trénovaný na datasetu SpheroMix. Nejvyšší přesnost segmentace sféroidů v platformě (93% IoU) a zároveň nejmenší a nejrychlejší model (~13 ms/snímek).',
      mamba_unet:
        'U-Net s obousměrným Mamba (state-space) bottleneckem (90,75M parametrů). Nejlepší generalizace mimo distribuci v platformě (HTS-Seg IoU 0,587) — určený pro externí laboratoře, neznámou optiku, léčené vzorky a neobvyklé morfologie sféroidů.',
      sperm:
        'Model morfologie spermií s extrakcí kostry pro měření hlavy, středního dílu a bičíku',
      wound:
        'U-Net + MiT-B5 (SegFormer enkodér) model pro segmentaci ran v mikroskopii scratch-assay. Jedna binární oblast rány na snímek; ideální pro časové řady hojení.',
      microtubule:
        'Instanční segmentace mikrotubulů pro IRM mikroskopii. Síť nnU-Net ResEnc-M, instancer s mezí zakřivení, nativní polyline výstup s geometrickým cross-frame trackingem.',
      microcapsule:
        'Kompaktní U-Net (destilovaný z Meta SAM 3) pro instanční segmentaci mikrokapsulí — plocha, obvod a kompaktnost každé kapsule; kapsule přesahující okraj snímku jsou vyloučeny z metrik.',
      neurite_soma:
        'nnU-Net v2 ResEnc-M (2D, ansámbl 3 foldů) pro segmentaci neuritů a somat ve fluorescenční mikroskopii. Čte tubulinový kanál; Dice na testovací sadě 0,832 neurit / 0,915 soma. Trénováno na konfokálních datech Leica při ~0,180 µm/px — u jiné velikosti pixelu ověřte počty somat.',
    },
    dataUsageTitle: 'Použití dat a soukromí',
    dataUsageDescription:
      'Kontrola použití vašich dat pro strojové učení a výzkum',
    allowMLTraining: {
      label: 'Povolit trénování ML modelů',
      description:
        'Povolit použití vašich dat pro trénování a zlepšování našich segmentačních modelů',
    },
    consent: {
      privacyNotice:
        'Vaše soukromí je pro nás důležité. Tato nastavení řídí, jak mohou být vaše nahrané obrázky a segmentační data použity ke zlepšení našich ML modelů. Tyto preference můžete kdykoli změnit.',
      dataUsageNote:
        'Data od uživatelů, kteří se odhlásili, nebudou zahrnuta do žádných tréninkových procesů.',
      algorithmImprovement: {
        label: 'Vylepšení algoritmů',
        description: 'Použít data pro zvýšení přesnosti a rychlosti segmentace',
      },
      featureDevelopment: {
        label: 'Vývoj funkcí',
        description: 'Pomoci vyvinout nové funkce a schopnosti',
      },
      lastUpdated: 'Naposledy aktualizováno',
      savePreferences: 'Uložit preference souhlasu',
      savingPreferences: 'Ukládání...',
    },
    cancel: 'Zrušit',
    deleting: 'Mazání...',
    deleteAccount: 'Smazat účet',
    accountDeleted: 'Účet byl úspěšně smazán',
    deleteAccountError: 'Nepodařilo se smazat účet',
    deleteAccountDialog: {
      title: 'Smazat účet',
      description:
        'Tuto akci nelze vrátit zpět. Tímto trvale smažete svůj účet a odstraníte všechna svá data z našich serverů.',
      whatWillBeDeleted: 'Co bude smazáno:',
      deleteItems: {
        account: 'Váš uživatelský účet a profil',
        projects: 'Všechny vaše projekty a obrázky',
        segmentation: 'Všechna data segmentace a výsledky',
        settings: 'Nastavení účtu a preference',
      },
      confirmationLabel: 'Pro potvrzení prosím napište {email}:',
      confirmationPlaceholder: '{email}',
    },
    personal: 'Osobní informace',
    fullName: 'Celé jméno',
    organization: 'Organizace',
    department: 'Oddělení',
    publicProfile: 'Veřejný profil',
    bio: 'Biografie',
    makeProfileVisible: 'Učinit můj profil viditelným pro ostatní výzkumníky',
    dangerZone: 'Nebezpečná zóna',
    deleteAccountWarning:
      'Jakmile svůj účet smažete, není cesty zpět. Všechna vaše data budou trvale smazána.',
    currentPassword: 'Současné heslo',
    newPassword: 'Nové heslo',
    confirmNewPassword: 'Potvrdit nové heslo',
    fillAllFields: 'Prosím vyplňte všechna povinná pole',
    passwordsDoNotMatch: 'Hesla se neshodují',
    passwordTooShort: 'Heslo musí mít alespoň 6 znaků',
    passwordChanged: 'Heslo bylo úspěšně změněno',
    passwordsMatch: 'Hesla se shodují',
    changingPassword: 'Měním heslo...',
    changePassword: 'Změnit heslo',
    languageUpdated: 'Jazyk byl úspěšně aktualizován',
    themeUpdated: 'Motiv byl úspěšně aktualizován',
    appearanceDescription: 'Přizpůsobte vzhled aplikace',
    language: 'Jazyk',
    languageDescription: 'Vyberte svůj preferovaný jazyk',
    theme: 'Motiv',
    themeDescription: 'Vyberte světlý, tmavý nebo systémový motiv',
    light: 'Světlý',
    dark: 'Tmavý',
    system: 'Systémový',
  },
  segmentation: {
    selection: {
      selectAll: 'Vybrat vše',
      deselectAll: 'Zrušit výběr',
      selected: 'Vybráno: {{count}}',
    },
    trackOps: {
      propagateSelectedSuccess:
        '{{count}} mikrotubulů propagováno do dalších snímků',
      propagateSelectedPartial: 'Propagováno {{done}} z {{total}} mikrotubulů',
      propagateSuccess:
        'Mikrotubulus propagován do {{count}} následujících snímků',
      propagateFailed: 'Propagace mikrotubulu selhala',
      deleteTrackSuccess: 'Track odstraněn z {{count}} snímků',
      deleteTrackFailed: 'Smazání tracku selhalo',
      deleteFrameSuccess:
        'Mikrotubulus odstraněn z tohoto snímku; zbytek tracku zůstává',
      deleteFrameFailed: 'Odstranění mikrotubulu z tohoto snímku selhalo',
      deleteScopeUnavailable:
        'Video se ještě načítá — zkuste mikrotubulus smazat za okamžik znovu',
    },
    modelNotCompatible:
      'Model "{{model}}" není kompatibilní s typem projektu "{{type}}". Povolené: {{allowed}}.',
    incompatibleModelTitle: 'Tímto modelem nelze segmentovat',
    incompatibleModelDesc:
      'Aktuálně vybraný model "{{model}}" není kompatibilní s typem tohoto projektu ({{type}}). Povolené modely pro tento typ: {{allowed}}. Změňte prosím model v Nastavení nebo změňte typ projektu.',
    channelPicker: {
      title: 'Vyberte kanál k segmentaci',
      description:
        'Tento projekt obsahuje snímky videa s více kanály. Vyberte, který kanál se má segmentovat.',
      confirm: 'Segmentovat',
    },
    mode: {
      view: 'Zobrazit a navigovat',
      edit: 'Upravit',
      editVertices: 'Upravit vrcholy',
      addPoints: 'Přidat body',
      create: 'Vytvořit',
      createPolygon: 'Vytvořit polygon',
      createPolyline: 'Vytvořit polylajn',
      slice: 'Rozřezat',
      delete: 'Smazat',
      deletePolygon: 'Smazat polygon',
      unknown: 'Neznámý',
    },
    modeDescription: {
      view: 'Procházet a vybírat polygony',
      edit: 'Přesunout a upravit vrcholy',
      addPoints: 'Přidat body mezi vrcholy',
      create: 'Vytvořit nové polygony',
      createPolyline:
        'Klikněte pro umístění bodů, dvojklikem dokončete polylajn',
      slice: 'Rozdělit polygony čarou',
      delete: 'Odstranit polygony',
    },
    toolbar: {
      mode: 'Režim',
      keyboard: 'Klávesa: {{key}}',
      requiresSelection: 'Vyžaduje výběr polygonu',
      requiresPolygonSelection: 'Vyžaduje výběr polygonu',
      resegment: 'Znovu segmentovat snímek',
      resegmentTooltipModel: 'Model: {{model}} · {{threshold}}',
      resegmentSuccess: 'Snímek byl znovu segmentován',
      resegmentFailed: 'Resegmentace selhala',
      resegmentConfirmTitle: 'Nahradit existující polygony?',
      resegmentConfirmDescription:
        'Spuštění modelu přepíše současnou segmentaci. Ruční úpravy polygonů na tomto snímku budou ztraceny.',
      select: 'Vybrat',
      undoTooltip: 'Zpět (Ctrl+Z)',
      undo: 'Zpět',
      redoTooltip: 'Znovu (Ctrl+Y)',
      redo: 'Znovu',
      zoomInTooltip: 'Přiblížit (+)',
      zoomIn: 'Přiblížit',
      zoomOutTooltip: 'Oddálit (-)',
      zoomOut: 'Oddálit',
      resetViewTooltip: 'Resetovat pohled (R)',
      resetView: 'Reset',
      unsavedChanges: 'Neuložené změny',
      saving: 'Ukládání...',
      save: 'Uložit',
      keyboardShortcuts:
        'V: Zobrazit • E: Upravit • A: Přidat • N: Nový • S: Rozřezat • D: Smazat',
      nothingToSave: 'Všechny změny uloženy',
    },
    status: {
      polygons: 'polygonů',
      vertices: 'vrcholů',
      visible: 'viditelných',
      hidden: 'skrytých',
      selected: 'vybrán',
      saved: 'Uloženo',
      unsaved: 'Neuloženo',
      noPolygons: 'Žádné polygony',
      startCreating: 'Začněte vytvářením polygonu',
      polygonList: 'Seznam polygonů',
      external: 'Externí',
      internal: 'Interní',
      polyline: 'Polylajn',
    },
    // Object classes of the neurite/soma model. Deliberately NOT under
    // `sperm.part` — different model, different vocabulary.
    partClass: {
      neurite: 'Neurit',
      soma: 'Soma',
    },
    shortcuts: {
      buttonText: 'Zkratky',
      title: 'Klávesové zkratky',
      dialogTitle: 'Klávesové zkratky',
      footerNote:
        'Tyto zkratky fungují v editoru segmentace pro rychlejší a pohodlnější práci.',

      // Categories
      categories: {
        modes: 'Režimy úprav',
        actions: 'Akce',
        view: 'Ovládání pohledu',
        navigation: 'Navigace',
      },

      // Mode shortcuts
      viewMode: 'Režim zobrazení',
      editVertices: 'Režim úpravy vrcholů',
      addPoints: 'Režim přidávání bodů',
      createPolygon: 'Vytvořit nový polygon',
      sliceMode: 'Režim řezání',
      deleteMode: 'Režim mazání',

      // Action shortcuts
      save: 'Uložit',
      undo: 'Zpět',
      redo: 'Znovu',
      deleteSelected: 'Smazat vybraný polygon',
      finishShape: 'Dokončit rozpracovaný tvar',

      // View shortcuts
      zoom: 'Přiblížit/oddálit',
      resetView: 'Resetovat pohled',
      fitToScreen: 'Přizpůsobit obrazovce',

      // Navigation shortcuts
      cycleModes: 'Procházet režimy',
      cycleModesReverse: 'Procházet režimy (zpět)',
      cancel: 'Zrušit aktuální operaci',
      showHelp: 'Zobrazit tuto nápovědu',

      // Conditions
      requiresSelection: 'Vyžaduje výběr polygonu',

      // Legacy keys (kept for backward compatibility)
      v: 'Režim zobrazení',
      e: 'Režim úpravy vrcholů',
      a: 'Režim přidávání bodů',
      n: 'Vytvořit nový polygon',
      s: 'Režim řezání',
      d: 'Režim mazání',
      shift: 'Držet pro automatické přidávání bodů',
      ctrlZ: 'Zpět',
      ctrlY: 'Znovu',
      delete: 'Smazat vybraný polygon',
      esc: 'Zrušit aktuální operaci',
      plus: 'Přiblížit',
      minus: 'Oddálit',
      r: 'Resetovat pohled',
    },
    tips: {
      header: 'Tipy:',
      edit: {
        createPoint: 'Klikněte pro vytvoření nového bodu',
        holdShift: 'Držte Shift pro automatické vytváření sekvence bodů',
        closePolygon: 'Uzavřete polygon kliknutím na první bod',
      },
      slice: {
        startSlice: 'Klikněte pro zahájení řezání',
        endSlice: 'Klikněte znovu pro dokončení řezání',
        cancelSlice: 'Esc zruší řezání',
      },
      addPoints: {
        hoverLine: 'Namiřte kurzor na čáru polygonu',
        clickAdd: 'Klikněte pro přidání bodu do vybraného polygonu',
        escCancel: 'Esc ukončí režim přidávání',
      },
    },
    helpTips: {
      editMode: [
        'Klikněte pro vytvoření nového bodu',
        'Držte Shift pro automatické vytváření sekvence bodů',
        'Uzavřete polygon kliknutím na první bod',
      ],
      slicingMode: [
        'Klikněte pro zahájení řezání',
        'Klikněte znovu pro dokončení řezání',
        'Esc zruší řezání',
      ],
      pointAddingMode: [
        'Namiřte kurzor na čáru polygonu',
        'Klikněte pro přidání bodu do vybraného polygonu',
        'Esc ukončí režim přidávání',
      ],
    },
    loading: 'Načítání segmentace...',
    noPolygons: 'Nebyly nalezeny žádné polygony',
    polygonNotFound: 'Polygon nebyl nalezen',
    invalidSlice: 'Neplatná operace řezání',
    sliceSuccess: 'Polygon byl úspěšně rozřezán',
    sliceFailed: 'Řezání polygonu selhalo',
    instructions: {
      slice: {
        selectPolygon: '1. Klikněte na polygon pro jeho výběr k řezání',
        placeFirstPoint: '2. Klikněte pro umístění prvního bodu řezání',
        placeSecondPoint:
          '3. Klikněte pro umístění druhého bodu řezání a provedení řezu',
        cancel: 'Stiskněte ESC pro zrušení',
      },
      create: {
        startPolygon: '1. Klikněte pro zahájení vytváření polygonu',
        continuePoints:
          '2. Pokračujte klikáním pro přidání dalších bodů (potřeba minimálně 3)',
        finishPolygon:
          '3. Pokračujte v přidávání bodů nebo klikněte blízko prvního bodu pro uzavření polygonu',
        holdShift: 'Držte SHIFT pro automatické přidávání bodů',
        cancel: 'Stiskněte ESC pro zrušení',
      },
      createPolyline: {
        start: 'Kliknutím umístíte první bod mikrotubulu',
        finish: 'Tvorbu ukončíte stiskem Enter nebo dvojklikem',
        holdShift: 'Podržte SHIFT pro automatické přidávání bodů',
        cancel: 'Stiskněte ESC pro zrušení',
      },
      addPoints: {
        clickVertex: 'Klikněte na jakýkoli vrchol pro zahájení přidávání bodů',
        clickVertexMt: 'Klikněte na konec mikrotubulu pro jeho prodloužení',
        addPointsMt: 'Klikáním přidávejte body, poté ukončete stiskem Enter',
        addPoints:
          'Klikněte pro přidání bodů, poté klikněte na jiný vrchol pro dokončení. Klikněte přímo na jiný vrchol bez přidávání bodů pro odstranění všech bodů mezi nimi.',
        holdShift: 'Držte SHIFT pro automatické přidávání bodů',
        cancel: 'Stiskněte ESC pro zrušení',
        joinHint:
          'Kliknutím na koncový bod jiné polylinie stejné třídy je spojíte',
      },
      editVertices: {
        selectPolygon: 'Klikněte na polygon pro jeho výběr k úpravě',
        dragVertices: 'Klikněte a táhněte vrcholy pro jejich přesunutí',
        addPoints: 'Držte SHIFT a klikněte na vrchol pro přidání bodů',
        deleteVertex: 'Dvojklik na vrchol pro jeho smazání',
      },
      deletePolygon: {
        clickToDelete: 'Klikněte na polygon pro jeho smazání',
      },
      view: {
        selectPolygon: 'Klikněte na polygon pro jeho výběr',
        navigation: 'Táhněte pro posouvání • Rolujte pro zvětšování',
      },
      modes: {
        slice: 'Režim řezání',
        create: 'Režim vytváření polygonu',
        createPolyline: 'Režim tvorby mikrotubulu',
        addPoints: 'Režim přidávání bodů',
        editVertices: 'Režim úpravy vrcholů',
        deletePolygon: 'Režim mazání polygonu',
        view: 'Režim zobrazení',
      },
      shiftIndicator: '⚡ SHIFT: Automatické přidávání bodů',
    },
  },
  auth: {
    signIn: 'Přihlásit se',
    signUp: 'Registrovat se',
    redirectingToDashboard: 'Přesměrování na nástěnku...',
    signOut: 'Odhlásit se',
    forgotPassword: 'Zapomněli jste heslo?',
    resetPassword: 'Obnovit heslo',
    dontHaveAccount: 'Nemáte účet?',
    alreadyHaveAccount: 'Již máte účet?',
    signInWith: 'Přihlásit se pomocí',
    signUpWith: 'Registrovat se pomocí',
    orContinueWith: 'nebo pokračujte s',
    rememberMe: 'Zapamatovat si mě',
    emailRequired: 'E-mail je povinný',
    passwordRequired: 'Heslo je povinné',
    invalidEmail: 'Neplatná e-mailová adresa',
    passwordTooShort: 'Heslo musí mít alespoň 6 znaků',
    passwordsDontMatch: 'Hesla se neshodují',
    successfulSignIn: 'Úspěšné přihlášení',
    successfulSignUp: 'Úspěšná registrace',
    verifyEmail: 'Zkontrolujte prosím svůj e-mail pro potvrzení účtu',
    successfulSignOut: 'Úspěšné odhlášení',
    signOutFailed: 'Odhlášení se nezdařilo. Zkuste to prosím znovu.',
    checkingAuthentication: 'Kontrola ověření...',
    loadingAccount: 'Načítání vašeho účtu...',
    processingRequest: 'Zpracování vašeho požadavku...',
    signInToAccount: 'Přihlaste se ke svému účtu',
    accessPlatform: 'Přístup k platformě pro segmentaci mikroskopických snímků',
    emailAddress: 'E-mailová adresa',
    emailPlaceholder: 'vas@email.com',
    password: 'Heslo',
    passwordPlaceholder: '••••••••',
    signingIn: 'Přihlašování...',
    redirectingToSignIn: 'Přesměrování k přihlášení...',
    fillAllFields: 'Vyplňte prosím všechna pole',
    signInSuccess: 'Úspěšně přihlášen',
    signInFailed: 'Přihlášení selhalo',
    registrationSuccess: 'Registrace úspěšná',
    registrationFailed: 'Registrace selhala',
    logoutFailed: 'Odhlášení selhalo',
    profileUpdateFailed: 'Aktualizace profilu selhala',
    tokenMissing: 'Chybí autentizační token',
    tokenExpired: 'Platnost tokenu vypršela',
    pleaseSignInAgain: 'Prosím přihlaste se znovu',
    welcomeMessage:
      'Vítejte na platformě pro segmentaci mikroskopických snímků',
    confirmationRequired:
      'Potvrzovací text je povinný a musí se shodovat s vaší e-mailovou adresou',
    agreeToTerms: 'Přihlášením souhlasíte s našimi',
    termsOfService: 'Podmínkami služby',
    and: 'a',
    privacyPolicy: 'Zásadami ochrany osobních údajů',
    createAccount: 'Vytvořte svůj účet',
    signUpPlatform:
      'Zaregistrujte se pro použití platformy pro segmentaci mikroskopických snímků',
    confirmPassword: 'Potvrdit heslo',
    passwordsMatch: 'Hesla se shodují',
    passwordsDoNotMatch: 'Hesla se neshodují',
    agreeToTermsCheckbox: 'Souhlasím s',
    mustAgreeToTerms: 'Musíte souhlasit s podmínkami a ujednáními',
    creatingAccount: 'Vytváření účtu...',
    alreadyLoggedIn: 'Již jste přihlášeni',
    alreadySignedUp: 'Již jste zaregistrováni a přihlášeni.',
    goToDashboard: 'Přejít na Dashboard',
    signUpFailed: 'Registrace selhala',
    enterEmailForReset: 'Zadejte svou e-mailovou adresu pro reset hesla',
    sending: 'Odesílání...',
    sendNewPassword: 'Odeslat nové heslo',
    emailSent: 'Email odeslán',
    checkEmailForNewPassword:
      'Zkontrolujte svůj email pro odkaz na reset hesla',
    resetPasswordEmailSent:
      'Pokud email existuje, byl odeslán odkaz na reset hesla',
    resetPasswordError: 'Nepodařilo se odeslat email s novým heslem',
    backToSignIn: 'Zpět na přihlášení',
    didntReceiveEmail: 'Nedostali jste email?',
    rememberPassword: 'Vzpomněli jste si na heslo?',
    tryAgain: 'Zkusit znovu',
    enterNewPassword: 'Zadejte nové heslo',
    newPassword: 'Nové heslo',
    confirmPasswordPlaceholder: 'Potvrzení hesla',
    passwordRequirements: 'Heslo musí mít alespoň 8 znaků',
    resettingPassword: 'Resetování hesla...',
    passwordResetSuccess: 'Heslo úspěšně resetováno',
    passwordResetSuccessMessage:
      'Vaše heslo bylo úspěšně resetováno. Nyní se můžete přihlásit novým heslem.',
    invalidResetToken: 'Neplatný odkaz pro reset',
    invalidResetTokenMessage:
      'Tento odkaz pro reset hesla je neplatný nebo vypršel. Požádejte prosím o nový reset hesla.',
    requestNewReset: 'Požádat o nový reset',
  },
  profile: {
    title: 'Profil',
    about: 'O mně',
    activity: 'Aktivita',
    projects: 'Projekty',
    papers: 'Články',
    analyses: 'Analýzy',
    recentProjects: 'Nedávné projekty',
    recentAnalyses: 'Nedávné analýzy',
    accountDetails: 'Detaily účtu',
    accountType: 'Typ účtu',
    joinDate: 'Datum registrace',
    lastActive: 'Naposledy aktivní',
    projectsCreated: 'Vytvořené projekty',
    imagesUploaded: 'Nahrané obrázky',
    segmentationsCompleted: 'Dokončené segmentace',
    editProfile: 'Upravit profil',
    joined: 'Připojen',
    copyApiKey: 'Kopírovat API klíč',
    collaborators: 'Spolupracovníci',
    noCollaborators: 'Žádní spolupracovníci',
    connectedAccounts: 'Propojené účty',
    connect: 'Propojit',
    recentActivity: 'Nedávná aktivita',
    noRecentActivity: 'Žádná nedávná aktivita',
    statistics: 'Statistiky',
    totalImagesProcessed: 'Celkem zpracovaných obrázků',
    averageProcessingTime: 'Průměrná doba zpracování',
    fromLastMonth: 'od minulého měsíce',
    storageUsed: 'Využité úložiště',
    of: 'z',
    apiRequests: 'API požadavky',
    thisMonth: 'tento měsíc',
    recentPublications: 'Nedávné publikace',
    viewAll: 'Zobrazit vše',
    noPublications: 'Zatím žádné publikace',
    today: 'dnes',
    yesterday: 'včera',
    daysAgo: 'dní nazpět',
    completionRate: 'míra dokončení',
    createdProject: 'Vytvořil projekt',
    completedSegmentation: 'Dokončil segmentaci pro',
    uploadedImage: 'Nahrál obrázek',
    avatar: {
      uploadButton: 'Nahrát Avatar',
      selectFile: 'Vybrat obrázek avatara',
      cropTitle: 'Oříznutí Avatara',
      cropDescription: 'Ořízněte svůj avatar pro perfektní zobrazení',
      zoomLevel: 'Úroveň Přiblížení',
      cropInstructions:
        'Táhněte pro přesunutí, použijte posuvník pro přiblížení',
      applyChanges: 'Použít Změny',
      processing: 'Zpracovává se...',
      invalidFileType: 'Neplatný typ souboru. Vyberte prosím obrázek.',
      fileTooLarge: 'Soubor je příliš velký. Maximální velikost je 5MB.',
      cropError: 'Chyba při zpracování obrázku. Zkuste to znovu.',
      uploadSuccess: 'Avatar byl úspěšně nahrán',
      uploadError: 'Nepodařilo se nahrát avatar. Zkuste to znovu.',
    },
  },
  status: {
    segmented: 'Segmentováno',
    processing: 'Zpracovává se',
    queued: 'Ve frontě',
    failed: 'Chyba',
    no_segmentation: 'Bez segmentace',
    disconnected: 'Odpojeno od serveru',
    error: 'Chyba ML služby',
    ready: 'Připraven k segmentaci',
    online: 'Online',
    offline: 'Offline',
    noPolygons: 'Žádné polygony',
  },
  queue: {
    title: 'Segmentační fronta',
    connected: 'Připojeno',
    disconnected: 'Odpojeno',
    waiting: 'čeká',
    processing: 'zpracovává se',
    resegmentSelected: 'Znovu segmentovat vybrané ({{count}})',
    segmentSelected: 'Segmentovat vybrané',
    segmentSelectedWithCount: 'Segmentovat vybrané ({{count}})',
    selectNothingTooltip: 'Vyberte obrázky k segmentaci',
    segmentMixed:
      'Segmentovat {{new}} + Znovu {{resegment}} (celkem {{total}})',
    segmentTooltip:
      '{{new}} nových obrázků bude segmentováno, {{resegment}} vybraných obrázků bude znovu segmentováno',
    totalProgress: 'Celkový postup',
    images: 'obrázků',
    loadingStats: 'Načítání statistik...',
    connectingMessage:
      'Připojuji se k serveru... Real-time aktualizace budou brzy dostupné.',
    emptyMessage:
      'Ve frontě nejsou žádné obrázky. Nahrajte obrázky a přidejte je do fronty pro segmentaci.',
    addingToQueue: 'Přidáváno do fronty...',
    cancelSegmentation: 'Zrušit segmentaci',
    segmentationCancelled: '{{count}} segmentace zrušena',
    segmentationCancelled_other: '{{count}} segmentace zrušeny',
    cancelFailed: 'Nepodařilo se zrušit segmentaci',
    // Cancel All functionality
    cancelAll: 'Zrušit vše',
    cancelAllTooltip: 'Zrušit všech {{count}} segmentačních úkolů',
    confirmCancelAll: 'Zrušit všechny segmentace?',
    confirmCancelAllDescription:
      'Chystáte se zrušit {{count}} segmentačních úkolů ve všech vašich projektech.',
    processingTasks: '{{count}} úkolů se právě zpracovává',
    queuedTasks: '{{count}} úkolů ve frontě',
    cancelAllWarning:
      'Tuto akci nelze vrátit zpět. Zrušené úkoly bude nutné znovu odeslat.',
    confirmCancelAllButton: 'Ano, zrušit {{count}} úkolů',
    cancellingAllSegmentations: 'Ruším všechny segmentace...',
    allSegmentationsCancelled: 'Úspěšně zrušeno {{count}} segmentací',
    affectedProjects: 'Ovlivněno {{count}} projektů',
    cancelAllFailed: 'Nepodařilo se zrušit segmentace',
    cancelAllError: 'Chyba při rušení segmentací',
    cancelling: 'Ruším...',
    processingSlots: 'Zpracovávací sloty',
    parallel: 'paralelně',
    users: 'uživatelů',
    active: 'aktivní',
    you: 'Vy',
    yourSlot: 'Váš slot: #{{slot}}',
    concurrentUsers: 'Také zpracovává: {{users}}',
    availableSlots: '{{count}} slot dostupný',
    availableSlots_other: '{{count}} slotů dostupných',
    yourPosition: 'Vaše pozice',
    estimatedWait: 'Odh. čekání',
    allSlotsActive:
      'Všechny zpracovávací sloty jsou obsazeny – dosažena maximální kapacita paralelního zpracování',
    slotAvailable:
      'Slot je dostupný! Pozice #{{position}} (~{{waitTime}} min čekání)',
  },
  toast: {
    error: 'Došlo k chybě',
    success: 'Operace úspěšná',
    info: 'Informace',
    warning: 'Varování',
    loading: 'Načítání...',
    failedToUpdate: 'Nepodařilo se aktualizovat data. Zkuste to prosím znovu.',
    fillAllFields: 'Vyplňte prosím všechna pole',
    operationFailed: 'Operace selhala. Zkuste to prosím znovu.',
    unexpectedError: 'Neočekávaná chyba',
    somethingWentWrong: 'Něco se pokazilo. Zkuste to prosím později.',
    somethingWentWrongPage: 'Něco se pokazilo při načítání této stránky.',
    returnToHome: 'Návrat domů',
    operationCompleted: 'Operace byla úspěšně dokončena',
    dataSaved: 'Data byla úspěšně uložena',
    dataUpdated: 'Data byla úspěšně aktualizována',
    reconnecting: 'Znovu se připojuji k serveru...',
    reconnected: 'Připojení k serveru obnoveno',
    connectionFailed: 'Nepodařilo se obnovit připojení k serveru',
    segmentationRequested: 'Požadavek na segmentaci odeslán',
    segmentationCompleted: 'Segmentace obrázku dokončena',
    segmentationFailed: 'Segmentace selhala',
    segmentationResultFailed: 'Nepodařilo se získat výsledek segmentace',
    segmentationStatusFailed: 'Nepodařilo se zkontrolovat stav segmentace',
    exportCompleted: 'Export byl úspěšně dokončen!',
    exportFailed: 'Export selhal. Zkuste to prosím znovu.',
    project: {
      created: 'Projekt byl úspěšně vytvořen',
      createFailed: 'Nepodařilo se vytvořit projekt',
      deleted: 'Projekt byl úspěšně smazán',
      deleteFailed: 'Nepodařilo se smazat projekt',
      notFound: 'Projekt nebyl nalezen',
      urlCopied: 'URL projektu bylo zkopírováno do schránky',
      unshared: 'Projekt byl odebrán ze sdílených',
      invalidResponse: 'Odpověď serveru byla neplatná',
      readyForImages: 'je připraven pro obrázky',
      selected: '{{count}} obrázek vybrán',
      selected_other: '{{count}} obrázky vybrány',
      deleteSelected: 'Smazat vybrané',
    },
    profile: {
      loadFailed: 'Nepodařilo se načíst data profilu',
      consentUpdated: 'Předvolby souhlasu byly úspěšně aktualizovány',
    },
    segmentation: {
      deleted: 'Polygon byl smazán',
      cannotDeleteVertex:
        'Nelze smazat vrchol - polygon potřebuje alespoň 3 body',
      vertexDeleted: 'Vrchol byl úspěšně smazán',
      failed: 'Segmentace selhala',
      saved: 'Segmentace byla úspěšně uložena',
      started: 'Segmentace byla zahájena',
      completed: 'Segmentace byla úspěšně dokončena',
      completedWithCount: 'Segmentace dokončena! Nalezeno {{count}} objektů',
      batchStarted: 'Segmentace zahájena pro {{count}} obrázků',
      batchCompleted:
        '✅ {{count}} obrázků úspěšně segmentováno ({{duration}}s)',
      batchCompletedWithErrors:
        '⚠️ Dávka dokončena: {{successful}} úspěšných, {{failed}} neúspěšných ({{duration}}s)',
      noPolygons: 'Nebyly nalezeny žádné polygony segmentace',
      reloadFailed:
        'Nepodařilo se načíst výsledky segmentace. Obnovte prosím stránku.',
      autosaveFailed: 'Automatické ukládání selhalo - změny mohou být ztraceny',
    },
    // Multi-channel canvas actions
    multiChannel: {
      allChannelsFailed: 'Nepodařilo se načíst kanály obrázku',
      someChannelsFailed: 'Některé kanály obrázku se nepodařilo načíst',
    },
    upload: {
      failed: 'Nepodařilo se obnovit obrázky po nahrání',
      cancelUpload: 'Zrušit nahrávání',
      uploadCancelled: 'Nahrávání zrušeno',
      uploadCancelledSuccess: 'Nahrávání úspěšně zrušeno',
      redirectingToGallery: 'Přesměrování do galerie obrázků...',
    },
  },
  imageDeleted: 'Obrázek byl úspěšně smazán',
  deleteImageFailed: 'Smazání obrázku selhalo',
  deleteImageError: 'Chyba při mazání obrázku',
  imageAlreadyProcessing: 'Obrázek se již zpracovává',
  processImageFailed: 'Zpracování obrázku selhalo',
  exportDialog: {
    title: 'Možnosti exportu',
    includeMetadata: 'Zahrnout metadata',
    includeSegmentation: 'Zahrnout segmentaci',
    includeObjectMetrics: 'Zahrnout metriky objektů',
    exportMetricsOnly: 'Exportovat pouze metriky (XLSX)',
    selectImages: 'Vyberte obrázky k exportu',
    selectAll: 'Vybrat vše',
    selectNone: 'Odznačit vše',
    noImagesAvailable: 'Žádné obrázky nejsou k dispozici',
  },
  project: {
    selected: '{{count}} obrázek vybrán',
    selected_other: '{{count}} obrázky vybrány',
    deleteSelected: 'Smazat vybrané',
    deleteAnnotations: 'Smazat anotace',
    addChannel: 'Přidat kanál',
    addChannelSuccess: 'Kanál {{channels}} přidán k {{frames}} snímkům',
    addChannelAlignWarning:
      'Zarovnání selhalo u {{failed}} z {{frames}} snímků — zarovnáno bylo jen {{shifted}}. Kanály nelze zkorelovat (nemají společnou strukturu); snímky byly přidány neposunuté.',
    addChannelAlignWarningImplausible:
      'Zarovnání selhalo u {{failed}} z {{frames}} snímků — zarovnáno bylo jen {{shifted}}. Byl nalezen zřetelný posun, ale příliš velký na to, aby byl věrohodný, proto byl zahozen a snímky byly přidány neposunuté. Ověřte, že přidávaný kanál pochází ze stejného zorného pole a není oříznutý ani posunutý vůči cílovému videu.',
    addChannelAlignWarningShape:
      'Zarovnání selhalo u {{failed}} z {{frames}} snímků — zarovnáno bylo jen {{shifted}}. Přidávaný kanál má jiné rozměry v pixelech než cílové snímky, proto je nelze zarovnat; snímky byly přidány neposunuté.',
    addChannelFailed: 'Nepodařilo se přidat kanál',
    addChannelDialog: {
      title: 'Přidat kanál',
      description:
        'Přidejte k vybraným snímkům další kanál nahráním videa/stacku se stejným počtem snímků, nebo jednoho obrázku, který se otiskne na každý vybraný snímek.',
      selectionSummary: 'Vybráno {{frames}} snímků napříč {{videos}} videi.',
      sourceLabel: 'Zdrojový soubor (video / stack / obrázek)',
      dropPrompt: 'Přetáhněte soubor sem, nebo klikněte pro výběr',
      dropInvalidType: 'Nepodporovaný typ souboru.',
      dropTooManyFiles: 'Najednou lze přidat pouze jeden soubor.',
      removeFile: 'Odebrat soubor',
      imageHint: 'Jeden obrázek → otiskne se na každý vybraný snímek.',
      videoHint:
        'Video/stack → musí mít přesně {{frames}} snímků a patřit jednomu videu.',
      nameLabel: 'Název kanálu',
      namePlaceholder: 'např. GFP',
      alignLabel: 'Zarovnat k segmentačnímu kanálu',
      alignHint: 'Registrace fázovou korelací, která opraví malý drift stolku.',
      multiVideoError:
        'Video/stack lze přidat jen ke snímkům jednoho videa. Vyberte snímky z jednoho videa, nebo nahrajte jeden obrázek.',
      uploading: 'Nahrávání… {{percent}} %',
      adding: 'Přidávání…',
      confirm: 'Přidat kanál',
    },
    annotationsDeleted: 'Anotace smazány u {{count}} obrázků',
    annotationsDeleteFailed: 'Nepodařilo se smazat anotace u {{count}} obrázků',
    deleteAnnotationsDialog: {
      title: 'Smazat anotace?',
      description:
        'Smaže segmentační anotace u {{count}} vybraných obrázků. Obrázky zůstanou, ale jejich výsledky segmentace se odstraní. Tuto akci nelze vrátit.',
    },
    imagesDeleted: '{{count}} obrázek smazán',
    imagesDeleted_other: '{{count}} obrázky smazány',
  },
  export: {
    mtKymographs: {
      title: 'Analýza rychlosti z kymografu',
      description:
        'Detekce pohyblivých částic na kymografu pro každý mikrotubul a export jejich rychlostí.',
      enable: 'Zahrnout analýzu kymografů',
      velocityMetrics: 'Metriky rychlosti (CSV)',
      segmentedImages: 'Segmentované kymografy (PNG)',
      modeKymograph: 'Kymograf (prostor × čas)',
      modeProfiles: 'Profily intenzity (na obrázek)',
      singleFrameHint:
        'Jen jeden snímek — kymograf potřebuje časovou řadu, proto se exportuje pouze profil intenzity.',
      profilesHint:
        'Exportuje jeden matplotlib graf intenzity v závislosti na pozici pro každý snímek a k tomu CSV s intenzitami.',
      lineWidthLabel: 'Šířka linie (px)',
      lineWidthHelp:
        'Šířka linie vzorkované podél každého mikrotubulu, měřená napříč ním. Hodnota 1 odebere jediný pixel. Platí stejně pro kymografy i profily intenzity.',
      lineReduceLabel: 'Napříč šířkou',
      lineReduceHelp:
        'Jak se pixely napříč šířkou sloučí do jedné hodnoty. Průměr odpovídá ImageJ, maximum je jasnější, ale zkreslují ho ojedinělé horké pixely.',
      lineReduceMean: 'Průměr',
      lineReduceMax: 'Maximum',
      minIntensityLabel: 'Min. intenzita trajektorie',
      minIntensityHelp:
        'Zahodit trajektorie slabší než tolik syrových jednotek intenzity nad vlastním pozadím. Absolutní, takže nezávisí na škálování obrazu — ale není přenosné mezi kanály. Prázdné ponechá vše.',
    },
    mt: {
      sectionTitle: 'Metriky mikrotubulů',
      sectionDescription:
        'Délka, plocha a intenzita signálu pro každý MT z původního ND2/TIFF souboru. Odečteno median pozadí (mimo dilatovanou masku MT).',
      intensityNote:
        'Intenzita signálu podle kanálu — včetně součtové (integrované) intenzity — se vždy vypočítá pro každý kanál a zapíše do tabulky metrik. Není třeba nic vybírat.',
      wideNote:
        'Každý kanál má vlastní řádek v metrics.csv (viz sloupec „channel“). Doprovodný soubor metrics_wide.csv — a další list v metrics.xlsx — dá všechny kanály téhož mikrotubulu na jeden řádek, pro každý kanál jednu sadu sloupců.',
      thicknessLabel: 'Tloušťka MT (px)',
      thicknessHelp:
        'Šířka pásu podél polyline, ze kterého se sbírá signál. 5 px odpovídá běžnému průměru mikrotubulu při 100× widefield.',
      marginLabel: 'Okraj pozadí (× tloušťka)',
      marginHelp:
        'Pixely v tomto poloměru (tloušťka × násobek) od libovolného MT se z pozadí vyloučí. Vyšší = konzervativnější.',
    },
    advancedExport: 'Pokročilý export',
    advancedOptions: 'Pokročilé možnosti exportu',
    configureSettings:
      'Nakonfigurujte nastavení exportu pro vytvoření komplexního balíčku dat',
    general: 'Obecné',
    visualization: 'Vizualizace',
    formatsTab: 'Formáty',
    exportContents: 'Obsah exportu',
    selectContent: 'Vyberte typy obsahu k zahrnutí do exportu',
    includeOriginal: 'Zahrnout původní obrázky',
    includeVisualizations: 'Zahrnout vizualizace s očíslovanými polygony',
    includeDocumentation: 'Zahrnout dokumentaci a metadata',
    selectedImages: 'Vybrané obrázky',
    imagesSelected: '{{count}} z {{total}} obrázků vybráno',
    selectAll: 'Vybrat vše',
    allSelected: 'Všech {{count}} obrázků vybráno',
    selectAllProject: 'Vybrat všech {{count}} obrázků',
    selectNone: 'Nevybrat žádný',
    imageSelection: 'Výběr obrázků',
    chooseImages: 'Vyberte obrázky k zahrnutí do exportu',
    searchImages: 'Hledat obrázky...',
    sortBy: 'Seřadit podle',
    sortOptions: {
      date: 'Datum',
      name: 'Název',
      status: 'Stav',
    },
    showingImages: 'Zobrazeno {{start}}-{{end}} z {{total}}',
    noImagesFound: 'Žádné obrázky nenalezeny',
    qualitySettings: 'Nastavení kvality',
    imageQuality: 'Kvalita obrázku',
    compressionLevel: 'Úroveň komprese',
    outputResolution: 'Výstupní rozlišení',
    colorSettings: 'Nastavení barev',
    backgroundColor: 'Barva pozadí',
    strokeColor: 'Barva obrysu',
    strokeWidth: 'Šířka obrysu',
    fontSize: 'Velikost písma',
    showNumbers: 'Zobrazit čísla polygonů',
    showLabels: 'Zobrazit popisky',
    scaleConversion: 'Převod měřítka',
    pixelToMicrometerScale: 'Kalibrace pixel na mikrometry',
    scaleDescription:
      'Určete, kolik mikrometrů představuje jeden pixel pro převod měření',
    scalePlaceholder: 'např. 0,5 (1 pixel = 0,5 µm)',
    scaleUnit: 'µm/pixel',
    scaleWarning:
      'Poznámka: Hodnota měřítka nad 1 µm/pixel indikuje velmi nízkou magnifikaci. Prosím ověřte.',
    outputSettings: 'Nastavení výstupu',
    exportFormats: {
      yolo: 'YOLO Formát',
      excel: 'Excel Formát',
      json: 'JSON Formát',
    },
    // Progress panel specific
    title: 'Průběh exportu',
    readyToDownload: 'Export připraven ke stažení',
    fallbackMode: 'Režim dotazování',
    fallbackMessage:
      'Používáme dotazování pro aktualizace průběhu kvůli problémům s připojením',
    exportFormatsLabel: 'Formáty exportu',
    exportToZip: 'Exportovat do ZIP archívu',
    generateExcel: 'Generovat Excel metriky',
    includeCocoFormat: 'Zahrnout anotace ve formátu COCO',
    includeJsonMetadata: 'Zahrnout JSON metadata',
    microtubuleAnnotationsNote:
      'Mikrotubulární projekty exportují anotace jako ImageJ RoiSet + CVAT 1.1 (vždy zahrnuto), každá nese třídu tubulin typu. COCO/YOLO/JSON se pro mikrotubuly nepoužívají.',
    preparing: 'Příprava exportu...',
    processing: 'Zpracování {{current}} z {{total}}',
    processingExport: 'Zpracování...',
    packaging: 'Vytváření balíčku...',
    completed: 'Export dokončen',
    downloading: 'Stahování...',
    cancelling: 'Ruší se...',
    cancelled: 'Export zrušen',
    cancelExport: 'Zrušit export',
    connected: 'Připojeno',
    disconnected: 'Odpojeno',
    reconnecting: 'Připojování...',
    startExport: 'Spustit export',
    cancel: 'Zrušit',
    download: 'Stáhnout',
    retry: 'Opakovat',
    close: 'Zavřít',
    exportError: 'Export selhal',
    exportFailed: 'Export selhal',
    exportComplete: 'Export dokončen',
    metricsExportComplete: 'Export metrik dokončen',
    connectionError: 'Spojení ztraceno během exportu',
    serverError: 'Nastala chyba serveru',
    invalidSelection: 'Vyberte prosím alespoň jeden obrázek',
    noData: 'Žádná data k exportu nejsou k dispozici',
    segmentationData: 'Data segmentace',
    spermMetrics: 'Metriky spermií',
    cocoFormat: 'Formát COCO',
    cocoFormatTitle: 'Export formátu COCO',
    downloadJson: 'Stáhnout JSON',
  },
  docs: {
    // Hlavička
    badge: 'Dokumentace',
    title: 'Dokumentace SpheroSeg',
    subtitle:
      'Vše, co platforma umí, pro všech sedm typů projektů — s vyhledáváním',
    backTo: 'Zpět na {{page}}',

    // Vyhledávání
    search: {
      placeholder: 'Hledat v dokumentaci…',
      hint: 'Stisknutím / začnete hledat. Odpovídající sekce se vyfiltrují a zvýrazní.',
      results: 'Odpovídajících sekcí: {{count}}',
      noResults: 'Hledání nic nenašlo',
      noResultsHint:
        'Zkuste kratší dotaz nebo pojem jako „kanál“, „kymograf“, „export“ či „práh“.',
      clear: 'Zrušit hledání',
    },

    // Navigace
    navigation: 'Navigace',
    nav: {
      introduction: 'Úvod',
      gettingStarted: 'Začínáme',
      projectTypes: 'Typy projektů',
      uploadingImages: 'Nahrávání dat',
      videosChannels: 'Videa a kanály',
      modelSelection: 'Modely',
      segmentationProcess: 'Segmentace',
      segmentationEditor: 'Editor',
      exportFeatures: 'Export',
      automatedEssays: 'Automatizované eseje',
      segmenter: 'Segmenter',
      sharedProjects: 'Sdílení',
      troubleshooting: 'Řešení potíží',
    },

    // Úvod
    introduction: {
      title: 'Úvod',
      whatIs: 'Co je SpheroSeg?',
      description:
        'SpheroSeg je platforma pro segmentaci a měření mikroskopických snímků a časosběrných videí s pomocí umělé inteligence. Nabízí sedm typů projektů opřených o jedenáct segmentačních modelů, editor polygonů a polyline, sledování mikrotubulů napříč snímky a dávkový export.',
      developedBy:
        'Platformu vyvinul Bc. Michal Průšek z Fakulty jaderné a fyzikálně inženýrské ČVUT v Praze pod vedením Ing. Adama Novozámského, Ph.D., ve spolupráci s výzkumníky z Ústavu biochemie a mikrobiologie VŠCHT Praha.',
      addresses:
        'Začalo to obtížnou úlohou vymezit hranice sferoidů v mikroskopii. Dnes platforma pokrývá i rozpadající se sferoidy, testy hojení ran, morfologii spermií, časosběrná videa mikrotubulů, mikrokapsle a kultivované neurony — každý typ s vlastním modelem, měřeními i formátem exportu.',
    },

    // Začínáme
    gettingStarted: {
      title: 'Začínáme',
      accountCreation: 'Vytvoření účtu',
      accountDescription:
        'Registrace je otevřená, nic se neschvaluje. Účet drží pohromadě vaše projekty, snímky i výsledky.',
      accountSteps: {
        step1: 'Přejděte na stránku registrace',
        step2: 'Zadejte e-mailovou adresu a zvolte heslo',
        step3: 'Doplňte profil se svým jménem a institucí',
        step4: 'V Nastavení zvolte preferovaný model, jazyk a motiv',
      },
      firstProject: 'První projekt',
      projectDescription:
        'Projekt drží snímky a segmentace z nich vytvořené. Jeho typ určuje, jaké modely můžete spustit, co ukáže editor a jak se výsledky exportují — vybírejte tedy uvážlivě.',
      projectSteps: {
        step1: 'Na nástěnce klikněte na „Nový projekt“',
        step2: 'Zadejte název a volitelně popis',
        step3:
          'Zvolte typ projektu odpovídající vašemu vzorku (viz Typy projektů níže)',
        step4: 'Klikněte na „Vytvořit projekt“ a nahrajte data',
      },
    },

    // Typy projektů
    projectTypes: {
      title: 'Typy projektů',
      description:
        'Každý projekt má typ, který volíte při jeho založení. Není to jen štítek: určuje dostupné modely, tvar výstupní geometrie, panely v editoru i soubory, které dostanete při exportu.',
      types: {
        spheroid: {
          name: 'Sferoidy (standardní)',
          bestFor:
            'Pro: buněčné sferoidy ve světlém poli nebo fázovém kontrastu. Jediný typ s výběrem modelu — hned z pěti.',
          output: 'Výstup: uzavřené polygony s volitelnými otvory.',
        },
        spheroidInvasive: {
          name: 'Rozpadající se sferoidy',
          bestFor:
            'Pro: sferoidy rozptylující se do matrice. Klíčovým číslem je index rozpadu ukotvený v jádře.',
          output:
            'Výstup: uzavřené polygony; husté jádro je predikováno jako vlastní třída a vykresleno zeleně.',
        },
        wound: {
          name: 'Hojení ran',
          bestFor:
            'Pro: časosběrné snímky scratch testu. Přidává křivku uzavírání rány přes celou sérii.',
          output:
            'Výstup: uzavřené polygony pokrývající otevřenou ránu a list s plochou rány v čase včetně grafu.',
        },
        sperm: {
          name: 'Spermie',
          bestFor:
            'Pro: morfologii spermií, měřenou po třech částech na buňku — hlavička, krček a bičík.',
          output:
            'Výstup: otevřené polyline s třídou části a identifikátorem instance, barevně odlišené zeleně, oranžově a azurově.',
        },
        microtubules: {
          name: 'Mikrotubuly',
          bestFor:
            'Pro: časosběrné IRM snímky mikrotubulů, se sledováním napříč snímky, intenzitou po kanálech a kymografy.',
          output:
            'Výstup: otevřené polyline se stabilním ID stopy; exportuje se do ImageJ ROI a CVAT místo COCO či YOLO.',
        },
        microcapsule: {
          name: 'Mikrokapsle',
          bestFor:
            'Pro: kulaté mikrokapsle ve světlém poli, včetně kapslí, které se dotýkají.',
          output:
            'Výstup: jeden uzavřený polygon na kapsli. Kapsle useknuté okrajem snímku se do metrik nezapočítávají.',
        },
        neurite: {
          name: 'Neurity a somata',
          bestFor:
            'Pro: kultivované neurony ve fluorescenční mikroskopii, čtené z tubulinového kanálu. Otázkou je, kolik z buňky je tělo a kolik výběžky.',
          output:
            'Výstup: uzavřené polygony ve dvou třídách — soma (tělo buňky) a neurit (výběžky) — kreslené purpurově a azurově.',
        },
      },
      note: 'Typ zvolte ještě před nahráním dat.',
      noteText:
        'Kompatibilita modelů se řídí typem projektu, takže pozdější změna znamená, že stávající výsledky už nelze přepočítat modelem, který je vytvořil.',
    },

    // Nahrávání dat
    uploadImages: {
      title: 'Nahrávání dat',
      description:
        'Platforma přijímá jak samostatné snímky, tak časosběrná data. Video, ND2 nebo vícestránkový TIFF se stane kontejnerem s jedním záznamem na snímek.',
      formats: 'Podporované formáty a limity',
      formatsTable: {
        kind: 'Druh',
        extensions: 'Formáty',
        limit: 'Maximální velikost',
        imagesLabel: 'Samostatné snímky',
        imagesLimit: '20 MB na soubor',
        videosLabel: 'Videa a stacky',
        videosLimit: '100 GB na soubor',
      },
      methods: 'Jak nahrávat',
      methodsDescription: 'Tři rovnocenné způsoby:',
      methodsList: {
        dragDrop: 'Přetáhněte soubory na plochu pro nahrávání',
        browse: 'Klikněte na plochu a soubory vyberte v dialogu',
        batch:
          'Přetáhněte celou složku — projde se rekurzivně, až 10 000 souborů v jedné dávce',
        autoSegment:
          'Zaškrtněte „Segmentovat po nahrání“ a vše se rovnou zařadí do fronty',
      },
      tiffNote: 'TIFF může být obojí.',
      tiffNoteText:
        'TIFF se zpracuje jako stack, když je větší než 20 MB nebo skutečně obsahuje víc stránek — hlavička souboru se kontroluje, takže i malý vícekanálový TIFF se zpracuje správně.',
      note: 'Pro nejlepší výsledky:',
      noteText:
        'dbejte na dobrý kontrast mezi objektem a pozadím a na to, aby soubor nesl kalibraci pixelu, chcete-li měření v mikrometrech. Nahrání videa je jeden dlouhý požadavek — přenos i extrakce snímků probíhají společně, takže velký ND2 chvíli trvá.',
    },

    // Videa a kanály
    videosChannels: {
      title: 'Videa, snímky a kanály',
      description:
        'Časosběrná a vícekanálová data mají vlastní zpracování: kontejner pro záznam, jeden záznam na snímek a seznam kanálů, který ovládáte z editoru.',
      containers: 'Kontejnery a snímky',
      containerFacts: {
        frames:
          'Z jednoho nahrání vznikne kontejner a jeden záznam na snímek; snímky se v rozhraní číslují od 1.',
        hidden:
          'Samotný kontejner se v galerii nezobrazuje a nikdy se nesegmentuje — segmentují se jen snímky.',
        positions:
          'ND2 nasnímaný na několika pozicích stolku se rozpadne na jeden záznam projektu pro každou pozici.',
        calibration:
          'Velikost pixelu a interval mezi snímky se načtou ze souboru, pokud tam jsou, a použijí se k automatickému převodu měření.',
      },
      channels: 'Kanály',
      channelsDescription:
        'Každý kanál je uložen jako vlastní obraz pro každý snímek. Právě jeden kanál může být zdrojem segmentace — ten, který model čte.',
      channelControls: {
        visibility: 'Zaškrtávátko přidá kanál do složeného zobrazení',
        color: 'Barevný čtvereček nastaví jeho odstín v překryvu',
        rename: 'Dvojklikem na název jej přejmenujete',
        opacity: 'Posuvník nastaví krytí od 0 do 100 %',
        source: 'Zdroj segmentace je označen „● src“',
      },
      sourceNote: 'Zkontrolujte zdroj segmentace.',
      sourceNoteText:
        'Pokud není žádný název kanálu rozpoznatelný, není označen žádný zdroj a použije se první kanál. U mikrotubulů to má následky: model pracuje jen s IRM, takže na fluorescenčním kanálu vytvoří přesvědčivé polyline, pod nimiž ale nic není.',
      windowLevel: 'Zobrazení 16bitových dat',
      windowLevelDescription:
        'Snímky s vysokou bitovou hloubkou se pro zobrazení mapují posuvníky Min a Max, doplněnými o Jas a Kontrast. Okno je zvlášť pro každý kanál, nikoli sdílené: kanál se při prvním zobrazení automaticky přizpůsobí vlastním datům, poté si drží vaše meze a rozsah jen rozšiřuje, když přijdou jasnější snímky. Nastavení platí po dobu relace; barvy a krytí kanálů se pamatují.',
      navigation: 'Pohyb po snímcích',
      keys: {
        step: 'Předchozí / další snímek',
        play: 'Přehrát nebo pozastavit — pevných 10 snímků za sekundu, konec u posledního snímku',
      },
      mtExtras: 'Navíc pro projekty s mikrotubuly',
      mtExtrasList: {
        registration:
          'Registrace kanálů při nahrávání: zarovná každý kanál k prvnímu posunem o celé pixely, takže se nic neinterpoluje.',
        addChannel:
          'Přidat kanál: dodatečně připojí další kanál k vybraným snímkům, buď jeden obrázek otisknutý na všechny, nebo video párované snímek po snímku.',
        tracking:
          'Sledování napříč snímky proběhne automaticky, jakmile jsou hotové všechny snímky, a dá každému vláknu stabilní identitu i barvu.',
      },
    },

    // Modely
    modelSelection: {
      title: 'Modely',
      description:
        'Jedenáct modelů, každý svázaný s typy projektů, pro které byl trénován. Výběr nabízí jen kompatibilní modely a skutečnou volbu mají pouze standardní sferoidové projekty — ostatní typy mají právě jeden.',
      spheroidModels: 'Sferoidové modely — vyberte si',
      specialisedModels: 'Specializované modely — jeden na typ projektu',
      models: {
        hrnet: {
          name: 'HRNet (vyvážený)',
          inferenceTime: 'Přibližně 0,20 s na snímek',
          bestFor:
            'Nejlepší pro: jeden model a žádné přemýšlení. Výchozí volba platformy.',
          description:
            'Udržuje větev s vysokým rozlišením napříč celou sítí místo kódování a dekódování, což zachovává detail hranic.',
        },
        cbam: {
          name: 'CBAM-ResUNet (přesný)',
          inferenceTime: 'Přibližně 0,38 s na snímek',
          bestFor:
            'Nejlepší pro: obrázky do publikace a obtížné hranice, za zhruba dvojnásobek času HRNetu.',
          description:
            'Reziduální U-Net s kanálovou i prostorovou pozorností v každé úrovni — z pětice nejpřesnější hranice.',
        },
        unet: {
          name: 'UNet (nejrychlejší)',
          inferenceTime: 'Přibližně 0,18 s na snímek',
          bestFor:
            'Nejlepší pro: velké dávky, kde je průchodnost důležitější než poslední procento přesnosti.',
          description:
            'Prostý U-Net trénovaný na datasetu SpheroHQ a optimalizovaný na propustnost.',
        },
        segformer: {
          name: 'SegFormer',
          inferenceTime: 'Přibližně 0,20 s na snímek',
          bestFor:
            'Nejlepší pro: nejvyšší naměřenou přesnost na sferoidech ve světlém poli — 93 % IoU.',
          description:
            'Model založený na transformeru (SegFormer-B0): hierarchický enkodér s lehkým dekodérem z čistých MLP vrstev.',
        },
        mamba: {
          name: 'Mamba-UNet',
          inferenceTime: 'Přibližně 0,24 s na snímek',
          bestFor:
            'Nejlepší pro: snímky nepodobné trénovacím datům — jiná laboratoř, neznámá optika, ovlivnění léčivy či neobvyklé morfologie.',
          description:
            'U-Net s obousměrným stavovým (state-space) hrdlem, vybraný pro odolnost mimo trénovací distribuci.',
        },
        disintegration: {
          name: 'Rozpad sferoidů',
          inferenceTime: 'Přibližně 0,70 s na snímek · výchozí práh 0,2',
          bestFor: 'Používá: projekty s rozpadajícími se sferoidy.',
          description:
            'UNet++ s enkodérem EfficientNet-B5 predikující tři třídy — pozadí, koronu a husté jádro. Jádro je predikováno přímo, nikoli odvozeno, což teprve dělá index rozpadu důvěryhodným.',
        },
        wound: {
          name: 'Hojení ran',
          inferenceTime: 'Přibližně 0,03 s na snímek',
          bestFor: 'Používá: projekty hojení ran.',
          description:
            'U-Net s enkodérem MiT-B5 pro binární segmentaci rány, 90 % IoU na externí testovací sadě. Uvnitř pracuje v rozlišení 256×256 a výsledek zvětšuje, což vysvětluje jeho rychlost i vyhlazení jemných detailů okraje.',
        },
        sperm: {
          name: 'Morfologie spermií',
          inferenceTime: 'Přibližně 0,30 s na snímek',
          bestFor: 'Používá: projekty se spermiemi.',
          description:
            'Víceklasová instanční segmentace, která hlavičku, krček i bičík rovnou vytváří jako polyline pomocí extrakce kostry, nikoli prahovaných skvrn.',
        },
        microtubule: {
          name: 'Mikrotubuly (v5H)',
          inferenceTime:
            'Přibližně 4,5 s na snímek · práh je pevně 0,97 a uživatel jej nemění',
          bestFor: 'Používá: projekty s mikrotubuly. Pouze snímky IRM.',
          description:
            'Síť nnU-Net ResEnc-M predikuje popředí vláken a pak instancer omezený křivostí rozdělí popředí na jednotlivé osy, přičemž každé křížení řeší pod pevnou mezí křivosti. Trénováno výhradně na syntetických snímcích. Doba běhu roste s počtem vláken, nejen s velikostí snímku.',
        },
        microcapsule: {
          name: 'Mikrokapsle',
          inferenceTime: 'Přibližně 0,30 s na snímek',
          bestFor: 'Používá: projekty s mikrokapslemi.',
          description:
            'Kompaktní U-Net destilovaný z Meta SAM 3, doplněný watershedem pro oddělení dotýkajících se kapslí. Kapsle useknuté okrajem snímku se označí a z metrik vynechají.',
        },
        neuriteSoma: {
          name: 'Neurit / soma',
          inferenceTime:
            'Přibližně 12 s na snímek 2048 × 2048 · bez prahu — rozhoduje argmax',
          bestFor:
            'Používají: projekty s neurity a somaty. Jen fluorescence, tubulinový kanál.',
          description:
            'Ansámbl tří foldů nnU-Net v2 ResEnc-M, průměrovaný v prostoru logitů, s mirroring augmentací při inferenci a topologickým členem clDice, který drží tenké výběžky spojité místo přerušované. Na odložených datech Dice 0,832 pro neurity a 0,915 pro somata. Trénováno na konfokálních datech z Leiky při zhruba 0,180 µm/px — při poloviční velikosti pixelu se soma obvykle vrací rozdělená na dva kusy, takže si počty somat nejdřív ověřte.',
        },
      },
      howToSelect: 'Výběr modelu',
      selectionSteps: {
        step1:
          'V Nastavení zvolte výchozí model — použije se všude, kde typ projektu dovoluje výběr',
        step2: 'Otevřete projekt a vyberte snímky ke zpracování',
        step3:
          'Klikněte na Segmentovat; dialog nabídne jen kompatibilní modely',
        step4:
          'Každý model má vlastní práh detekce, pevně daný při jeho validaci — pro jednotlivý běh není co nastavovat',
        step5: 'U vícekanálového videa zvolte, který kanál má model číst',
      },
      thresholdNote: 'Prahy detekce jsou pevně dané pro každý model.',
      thresholdNoteText:
        'V rozhraní žádné nastavení prahu není: každý model používá řez, se kterým byl validován, u mikrotubulů je to 0,97. Snížení prahu nenajde více skutečných objektů — najde jich více se slabším důkazem, a na jiném než IRM kanálu výstup mikrotubulového modelu nesleduje obraz při žádném nastavení. Pokud detekce chybí, zkontrolujte raději vstupní kanál.',
      tip: 'Tip:',
      tipText:
        'Začněte výchozím modelem. Po CBAM-ResUNetu sáhněte, když jsou hranice důležitější než rychlost, a po Mamba-UNetu, když vaše snímky nevypadají jako ničí trénovací data.',
    },

    // Průběh segmentace
    segmentationProcess: {
      title: 'Průběh segmentace',
      description:
        'Segmentace běží na pozadí ve frontě, takže během zpracování dávky můžete dál pracovat. Průběh vidíte živě.',
      queueBased: 'Zpracování ve frontě',
      queueDescription: 'Fronta je stavěná na velké dávky:',
      queueFeatures: {
        realTime:
          'Živý stav: průběh chodí přes WebSocket a zálohuje jej HTTP dotazování, takže výpadek spojení úlohu nezastaví',
        batch: 'Dávkové zpracování: až 10 000 snímků v jednom odeslání',
        priority:
          'Spravedlivé řazení: uživatelé nedávno obsloužení jdou dozadu, takže jedno dlouhé video nezabere celou GPU',
        recovery:
          'Zotavení: přerušená práce se zopakuje místo ztráty a chyba se vypíše',
      },
      workflow: 'Postup',
      workflowSteps: {
        step1: 'Nahrajte do projektu snímky nebo videa',
        step2:
          'Vyberte snímky ke zpracování, nebo nevybírejte nic a zpracují se všechny',
        step3: 'Zvolte model',
        step4: 'U vícekanálového videa zvolte kanál, který má model číst',
        step5: 'Sledujte průběh na ukazatelích stavu',
        step6:
          'Otevřete libovolný snímek v editoru a výsledek zkontrolujte či opravte',
      },
      polygonTypes: 'Co modely vytvářejí',
      polygonDescription: 'Dva druhy geometrie podle modelu:',
      polygonTypesList: {
        external: 'Vnější polygony: obrys objektu — sferoidy, rány, kapsle',
        internal:
          'Vnitřní polygony: otvory uvnitř objektu, odečtené od jeho plochy',
        polyline:
          'Polyline: otevřené křivky s délkou, ale bez plochy, které vytvářejí modely mikrotubulů a spermií',
      },
      processingNote: 'Doba zpracování závisí na modelu:',
      processingTimes:
        'model hojení ran zabere zhruba 0,03 s na snímek a sferoidové modely 0,2–0,4 s, zatímco model mikrotubulů asi 4,5 s na snímek, protože oddělení jednotlivých vláken je ta nákladná část.',
    },

    // Editor
    segmentationEditor: {
      title: 'Segmentační editor',
      description:
        'Místo, kde výsledky kontrolujete a opravujete. Sedm režimů úprav, plné ovládání klávesnicí a panely, které se mění podle typu projektu.',
      editingModes: 'Režimy úprav',
      modes: {
        view: {
          title: 'Prohlížení (V)',
          description:
            'Vybírání, posun a přiblížení. Kliknutí na tvar jej vybere a přepne do úpravy vrcholů.',
        },
        editVertices: {
          title: 'Úprava vrcholů (E)',
          description:
            'Tažením vrcholů doladíte hranici. Pravým tlačítkem vrchol smažete. Vyžaduje vybraný tvar.',
        },
        addPoints: {
          title: 'Přidání bodů (A)',
          description:
            'Vloží vrcholy, prodlouží polyline od bližšího konce nebo spojí dvě polyline koncem ke konci. Vyžaduje vybraný tvar.',
        },
        createPolygon: {
          title: 'Nový polygon (N)',
          description:
            'Naklikáte uzavřený tvar; kliknutím poblíž prvního bodu jej uzavřete. Nejméně tři body.',
        },
        createPolyline: {
          title: 'Nová polyline (P)',
          description:
            'Naklikáte otevřenou křivku pro mikrotubulus nebo část spermie. Ukončíte klávesou Enter nebo dvojklikem.',
        },
        sliceMode: {
          title: 'Řez (S)',
          description:
            'Rozdělí tvar čárou zadanou dvěma kliknutími. Funguje na uzavřených polygonech i na polyline.',
        },
        deletePolygon: {
          title: 'Mazání (D)',
          description:
            'Kliknutím tvary odstraníte. Režim zůstává aktivní a nic se nepotvrzuje.',
        },
      },
      keyFeatures: 'Co editor nabízí',
      features: {
        undoRedo:
          'Zpět a Znovu pro geometrii i vlastnosti tvarů. Historie je pro každý snímek zvlášť a při změně snímku se resetuje.',
        saving:
          'Ukládání na povel: tlačítkem Uložit, klávesou Ctrl+S, nebo automaticky při přechodu na jiný snímek.',
        zoomPan:
          'Přiblížení k ukazateli myši, posun tažením a přizpůsobení snímku klávesou R nebo 0.',
        polygonManagement:
          'Seznam tvarů s vícenásobným výběrem, skrýváním, přejmenováním a mazáním.',
        keyboardShortcuts:
          'Plné ovládání klávesnicí — seznam zobrazíte klávesou H nebo ?.',
        realTimeFeedback:
          'Pokyny k aktuálnímu režimu přímo na plátně a průběžný počet tvarů a vrcholů.',
      },
      shortcuts: 'Klávesové zkratky',
      shortcutCategories: {
        modes: 'Režimy',
        actions: 'Akce',
        view: 'Zobrazení',
      },
      shortcutsList: {
        v: 'Režim prohlížení',
        e: 'Úprava vrcholů',
        a: 'Přidání bodů',
        n: 'Nový polygon',
        p: 'Nová polyline',
        s: 'Řez',
        d: 'Mazání tvarů',
        tab: 'Procházení režimů',
        ctrlZ: 'Zpět',
        ctrlY: 'Znovu',
        ctrlS: 'Uložit',
        delete: 'Smazat vybraný tvar',
        enter: 'Dokončit rozpracovanou polyline',
        escape: 'Zrušit a vrátit se do prohlížení',
        zoom: 'Přiblížit a oddálit',
        reset: 'Přizpůsobit snímek pohledu',
        pan: 'Držte a táhněte pro posun v libovolném režimu',
        help: 'Zobrazit seznam zkratek',
      },
      workingWithPolygons: 'Práce s tvary',
      polygonSteps: {
        step1: 'Kliknutím vyberte tvar',
        step2: 'Přepněte do režimu odpovídajícího zamýšlené změně',
        step3: 'Proveďte změnu myší',
        step4:
          'V seznamu vpravo tvary skrývejte, přejmenovávejte, vybírejte hromadně nebo mažte',
        step5: 'Uložte klávesou Ctrl+S',
      },
      saveNote: 'Průběžné automatické ukládání neexistuje.',
      saveNoteText:
        'Práce se uloží po stisku Uložit nebo Ctrl+S a na pozadí při přechodu na jiný snímek. Kliknutí v drobečkové navigaci odejde okamžitě a uloží na pozadí, takže při rozsáhlejších úpravách stiskněte nejdřív Ctrl+S. U videa smazání sledovaného tvaru a uložení odstraní tvar ze všech snímků.',
      typeSpecific: 'Co se mění podle typu projektu',
      typeSpecificList: {
        microtubules:
          'Mikrotubuly: panel instancí se stabilními barvami podle stopy, vlastní typové štítky, přiřazení celé stopě, propagace a mazání stopy a zobrazení kymografu.',
        sperm:
          'Spermie: panel instancí, kde před kreslením zvolíte aktivní buňku a část, plus přeřazení z kontextové nabídky.',
        disintegration:
          'Rozpadající se sferoidy: husté jádro se vykresluje zeleně. Samotný index rozpadu se počítá až při exportu.',
      },
    },

    // Export
    exportFeatures: {
      title: 'Export',
      description:
        'Exporty běží na pozadí a po dokončení se samy stáhnou. Na uživatele běží vždy jen jeden; výsledkem je jediný ZIP.',
      packageContents: 'Co balíček obsahuje',
      contents: {
        originalImages: {
          title: 'Původní snímky',
          description: 'Soubory, které jste nahráli, beze změny.',
        },
        visualizations: {
          title: 'Vizualizace',
          description:
            'Vykreslené překryvy s očíslovanými tvary, v barvách, tloušťce čar a průhlednosti podle vaší volby.',
        },
        annotations: {
          title: 'Anotace',
          description:
            'Strojově čitelná geometrie ve zvolených formátech — a u projektů s mikrotubuly navíc soubory ImageJ a CVAT, které jsou vždy součástí.',
        },
        metrics: {
          title: 'Metriky',
          description:
            'Sešit, jehož listy závisejí na typu projektu, ve formátu XLSX, CSV nebo JSON.',
        },
      },
      annotationFormats: 'Formáty anotací',
      formats: {
        coco: 'COCO: standardní formát pro detekční frameworky. Polygony s otvory se exportují jako RLE masky.',
        yolo: 'YOLO: ohraničující obdélníky, polygon je v komentářovém řádku. Otevřené polyline formát neumí, a proto se vynechávají.',
        json: 'Vlastní JSON: úplné souřadnice a metadata, u projektů se spermiemi včetně seskupení po buňkách.',
        imagej:
          'ImageJ RoiSet: ZIP, který se otevře přímo ve správci ROI ve Fiji, jedno ROI na vlákno a řez, obarvené podle třídy nebo stopy. Jen projekty s mikrotubuly, vždy součástí.',
        cvat: 'CVAT 1.1: polyline s identitou stopy jako atributem. Jen projekty s mikrotubuly, vždy součástí.',
      },
      calculatedMetrics: 'Metriky podle typu projektu',
      metricsDescription: 'Podoba sešitu závisí na tom, co měříte:',
      metricsTable: {
        projectType: 'Typ projektu',
        sheet: 'List a jeho obsah',
        spheroid:
          'Polygon Metrics + Summary — plocha, obvod, kruhovitost, Feretovy průměry, solidita a další, jeden řádek na tvar',
        spheroidInvasive:
          'Image Metrics — jeden řádek na snímek s indexem rozpadu, plochou jádra a invaze a panelem rozptylu',
        wound:
          'Polygon Metrics + Summary + WoundTimeSeries — křivka uzavírání rány s vloženým grafem',
        sperm:
          'Sperm Metrics — délka hlavičky, krčku, bičíku a celková, jeden řádek na buňku',
        microtubules:
          'Microtubule Metrics + Channel Totals — délka a intenzita po kanálech, jeden řádek na snímek, vlákno a kanál',
        microcapsule:
          'Microcapsule Metrics + Summary — jeden řádek na celou kapsli; kapsle useknuté okrajem se vynechávají',
        neurite:
          'Polygon Metrics + Summary — stejný report na tvar jako u standardních sferoidových projektů, jeden řádek na polygon neuritu nebo somatu',
      },
      scaleTitle: 'Velikost pixelu a jednotky',
      scaleText:
        'Zadejte velikost pixelu v mikrometrech a všechny délky i plochy se převedou. Pole se předvyplní z kalibrace v souboru, pokud ji nese. Bez použitelné hodnoty se exportuje v pixelech, takže si zkontrolujte jednotky v záhlaví sloupců.',
      howToExport: 'Jak exportovat',
      exportSteps: {
        step1: 'Otevřete projekt a klikněte na Export',
        step2: 'Zvolte, které snímky zahrnout, nebo vezměte všechny',
        step3:
          'Nastavte velikost pixelu, chcete-li mikrometry, a vyberte barvy vizualizací',
        step4: 'Zaškrtněte potřebné formáty anotací a metrik',
        step5: 'Spusťte export a nechte jej běžet — průběh vidíte živě',
        step6: 'Po dokončení se ZIP stáhne sám',
      },
      exportNote: 'Neúspěch dílčí fáze export nezruší.',
      exportNoteText:
        'Volitelné fáze skončí jen varováním a zbytek balíčku se vytvoří. U intenzit mikrotubulů se navíc omezený běh zapíše přímo do balíčku, do metrics_status.json a do záhlaví průvodce metrikami — než se na list spolehnete, podívejte se tam.',
    },

    // Automatizované eseje
    automatedEssays: {
      title: 'Automatizované eseje',
      description:
        'Dávkový test mikrotubulů, který stojí mimo systém projektů. Nahrajete složku záznamů jamek ve formátu Nikon ND2 a dostanete jeden řádek na vlákno: délku, intenzitu podél něj a jeho lokální pozadí.',
      howTo: 'Spuštění dávky',
      steps: {
        step1: 'Otevřete Automatizované eseje v nabídce pod svým profilem',
        step2:
          'Přetáhněte složku se soubory .nd2 na stránku, nebo použijte tlačítko pro výběr složky',
        step3:
          'Vyčkejte — úlohy běží po jedné a seznam se sám obnovuje, dokud něco běží',
        step4:
          'Stáhněte ZIP, nebo tlačítkem Spustit znovu zpracujte tytéž soubory bez opětovného nahrávání',
      },
      results: 'Co dostanete zpět',
      resultsList: {
        csv: 'results.csv — jeden řádek na mikrotubulus s délkou, intenzitou podél něj a jeho pozadím',
        failures:
          'failures.csv — každá jamka či pozice, kterou nešlo zpracovat, a proč. Zapisuje se vždy, i když je prázdný',
        focus:
          'focus_qc.csv — jeden řádek na pozici se skóre rozostření pro segmentovaný a měřený kanál. Stejný verdikt nese i results.csv u každého vlákna',
        overlays:
          'Dva překryvné obrázky na pozici: jeden kontroluje segmentaci proti jejímu vlastnímu vstupu, druhý měřený pás proti signálu',
        annotations:
          'Soubor JSON pro každou pozici s vytrasovanými osami vláken a jejich délkami',
      },
      focusNote:
        'Příznak rozostření je pouze informativní — nic se nezahazuje.',
      focusNoteText:
        'Měří, jakou část snímku zabírá struktura zřetelně nad šumem, takže hustě pokryté pole může projít i rozostřené; chybuje směrem k zachování dat, ne k jejich zahození. Prahy byly odvozeny z jediného snímání, takže jiná expozice či kamera se ve sloupci reason ohlásí jako out_of_calibration — to je poznámka o prahu, ne o vašem snímku.',
      channelNote: 'Segmentuje se IRM, měří se fluorescence.',
      channelNoteText:
        'Model byl trénován na IRM, takže vlákna se trasují tam a fluorescenční kanál se čte jen podél těchto tras. Soubor bez kanálu IRM se ohlásí jako chyba, místo aby se segmentoval z něčeho jiného.',
      retentionNote: 'Nahrané soubory se uklidí, výsledky ne.',
      retentionNoteText:
        'Vstupní soubory se smažou, jakmile běh čistě doběhne, a při potížích se drží týden — což je právě ten běh, který budete chtít zopakovat. Výsledek zůstává, dokud úlohu nesmažete.',
    },

    // Segmenter
    segmenter: {
      title: 'Segmenter',
      description:
        'Samostatný nástroj pro anotaci polygonů s vlastními datasety a paletou tříd, oddělený od projektů i od segmentačního editoru.',
      features: {
        datasets:
          'Zakládejte datasety a nahrávejte do nich statické snímky; jsou soukromé jen pro vás.',
        classes:
          'Definujte vlastní třídy s názvy a barvami. Smazání třídy polygony zachová a jen jim třídu odebere.',
        polygons:
          'Kreslete, upravujte a mažte uzavřené polygony a přiřazujte jim třídy. Překrývající se polygony jsou plně podporovány.',
        saving:
          'Ukládá se výslovně — tlačítkem nebo Ctrl+S — a je zablokované, pokud se stávající anotaci nepodařilo načíst, aby prázdné plátno nikdy nepřepsalo skutečnou práci.',
      },
      scopeNote: 'Zatím jen ruční anotace.',
      scopeNoteText:
        'Segmenter zatím neobsahuje žádné strojové učení: žádné předznačování, žádné aktivní učení ani export. Dostupný je na adrese /segmenter.',
    },

    // Sdílení
    sharedProjects: {
      title: 'Sdílení a spolupráce',
      description:
        'Projekt sdílejte s kolegy e-mailem nebo odkazem. Po přijetí se jim objeví na vlastní nástěnce.',
      sharingFeatures: 'Co sdílení umožňuje',
      features: {
        collaborative:
          'Spolupracující přístup: spolupracovník může prohlížet, upravovat anotace, spouštět segmentaci, exportovat i označit projekt za zkontrolovaný',
        emailInvite:
          'E-mailové pozvánky: sdílení funguje, ať už e-mail dorazí, nebo ne — doručení může trvat i několik minut',
        linkShare:
          'Sdílení odkazem: odkaz se naváže na toho, kdo jej přijme, volitelně s platností do určitého data',
        revokeAccess: 'Kdykoli odvolatelné, s okamžitým účinkem',
        multipleCollaborators:
          'Libovolný počet spolupracovníků, každý si projekt zařadí do vlastních složek',
      },
      howToShare: 'Jak sdílet',
      shareSteps: {
        step1: 'Otevřete projekt, který chcete sdílet',
        step2: 'Klikněte na Sdílet v nástrojové liště projektu',
        step3: 'Zadejte e-mail spolupracovníka, nebo vytvořte odkaz',
        step4: 'Odešlete pozvánku',
        step5:
          'Ve stejném dialogu sdílení spravujte i rušte; u každého vidíte jeho stav',
      },
      permissionsNote: 'Sdílení je pro spolupráci, ne jen pro čtení.',
      permissionsNoteText:
        'Spolupracovníci mohou anotace měnit a u videa mají jejich úpravy stejné důsledky napříč snímky jako ty vaše. Přejmenovat projekt, změnit jeho typ, sdílet jej dál nebo jej smazat může jen vlastník.',
    },

    // Řešení potíží
    troubleshooting: {
      title: 'Řešení potíží',
      description:
        'Problémy, na které lidé skutečně narážejí, a co je způsobuje.',
      table: {
        symptom: 'Projev',
        cause: 'Příčina a řešení',
      },
      items: {
        uploadRejected: {
          symptom: 'Soubor je odmítnut ještě před zahájením nahrávání',
          cause:
            'Samostatné snímky mají strop 20 MB. Větší TIFF se zpracuje jako stack a platí pro něj limit 100 GB. Názvy kanálů delší než 64 znaků se odmítají — vyexportujte data s kratšími popisky.',
        },
        darkFrames: {
          symptom: 'Snímky vypadají skoro černé',
          cause:
            'Data s vysokou bitovou hloubkou potřebují nastavit okno. Použijte posuvníky Min a Max pro daný kanál; každý kanál má okno vlastní.',
        },
        noDetections: {
          symptom: 'Model najde jen velmi málo',
          cause:
            'Nejdřív zkontrolujte kontrast a typ projektu. Práh spolehlivosti snižujte jen tam, kde jde nastavit — model mikrotubulů jej záměrně ignoruje.',
        },
        wrongChannel: {
          symptom: 'Tvarů je dost, ale nesledují nic v obraze',
          cause:
            'Segmentuje se špatný kanál. Nastavte zdroj segmentace výslovně v seznamu kanálů; model mikrotubulů funguje jen na IRM.',
        },
        colorsChange: {
          symptom: 'Barvy objektů se mezi snímky mění',
          cause:
            'Sledování napříč snímky u toho kontejneru nedoběhlo. Barvy se řídí identitou stopy, takže nesledovaný snímek dostane nové.',
        },
        exportSlow: {
          symptom: 'Export stojí na 95 %',
          cause:
            'To je fáze komprese. U velkého projektu, zvlášť s kymografy, opravdu chvíli trvá.',
        },
        lostEdits: {
          symptom: 'Úpravy zmizely',
          cause:
            'Opětovná segmentace nahradí segmentaci snímku a kliknutí v drobečkové navigaci odejde dřív, než uložení na pozadí nutně doběhne. Před odchodem stiskněte Ctrl+S.',
        },
      },
      helpNote: 'Pořád nic?',
      helpNoteText:
        'Použijte tlačítko zpětné vazby a pošlete hlášení chyby nebo návrh — dorazí přímo ke správcům.',
    },

    // Navigace v patičce
    footer: {
      backToHome: 'Zpět na hlavní stránku',
      backToTop: 'Zpět nahoru',
    },
  },
  legal: {
    terms: {
      title: 'Podmínky použití',
      lastUpdated: 'Naposledy aktualizováno: leden 2025',
      disclaimer:
        'Používáním SpheroSeg souhlasíte s těmito podmínkami. Pečlivě si je prosím přečtěte.',
      sections: {
        acceptance: {
          title: '1. Přijetí podmínek',
          content:
            'Přístupem nebo používáním SpheroSeg ("Služba") souhlasíte, že budete vázáni těmito Podmínkami použití ("Podmínky") a všemi platnými zákony a předpisy. Pokud nesouhlasíte s některou z těchto podmínek, je vám zakázáno používat tuto službu. Tyto Podmínky představují právně závaznou smlouvu mezi vámi a SpheroSeg.',
        },
        useLicense: {
          title: '2. Licence k používání a povolené použití',
          content: 'Povolení k používání SpheroSeg je uděleno pro:',
          permittedUses: [
            'Osobní, nekomerční výzkumné účely',
            'Akademický a vzdělávací výzkum',
            'Vědecké publikace a studie',
            'Biomedicínský výzkum a analýzu',
          ],
          licenseNote:
            'Jedná se o udělení licence, nikoli převod vlastnictví. Službu nesmíte používat pro komerční účely bez výslovného písemného souhlasu.',
        },
        dataUsage: {
          title: '3. Používání dat a strojové učení',
          importantTitle: 'Důležité: Použití vašich dat',
          importantContent:
            'Nahráváním obrázků a dat do SpheroSeg souhlasíte s tím, že tato data použijeme ke zlepšení a trénování našich modelů strojového učení pro lepší přesnost segmentace.',
          ownershipTitle: 'Vlastnictví dat:',
          ownershipContent:
            'Zachováváte si vlastnictví všech dat, která do SpheroSeg nahrajete. Nicméně používáním naší služby nám udělujete povolení k:',
          permissions: [
            'Zpracování vašich obrázků pro analýzu segmentace',
            'Používání nahraných dat (v anonymizované formě) ke zlepšení našich ML algoritmů',
            'Zvyšování přesnosti modelů prostřednictvím kontinuálního učení',
            'Vývoji nových funkcí a schopností segmentace',
          ],
          protectionNote:
            'Všechna data používaná pro trénování ML jsou anonymizována a zbavena identifikačních informací. Vaše surová data nesdílíme s třetími stranami bez výslovného souhlasu.',
        },
        userResponsibilities: {
          title: '4. Povinnosti uživatele',
          content: 'Souhlasíte s tím, že:',
          responsibilities: [
            'Budete službu používat pouze k zákonným účelům',
            'Budete respektovat práva duševního vlastnictví',
            'Nebudete se pokoušet o reverzní inženýrství nebo kompromitování služby',
            'Při vytváření účtu poskytnete přesné informace',
            'Budete udržovat zabezpečení vašich přihlašovacích údajů',
          ],
        },
        serviceAvailability: {
          title: '5. Dostupnost služby a omezení',
          content:
            'Ačkoli se snažíme udržovat kontinuální dostupnost služby, SpheroSeg je poskytována "tak jak je" bez jakýchkoli záruk. Nezaručujeme nepřerušený přístup a služba může podléhat údržbě, aktualizacím nebo dočasné nedostupnosti.',
        },
        limitationLiability: {
          title: '6. Omezení odpovědnosti',
          content:
            'SpheroSeg, její vývojáři nebo přidružené společnosti nenesou v žádném případě odpovědnost za jakékoli nepřímé, náhodné, zvláštní, následné nebo trestní škody, včetně, ale nejen, ztráty dat, zisků nebo obchodních příležitostí vyplývajících z vašeho používání služby.',
        },
        privacy: {
          title: '7. Ochrana soukromí a dat',
          content:
            'Vaše soukromí je pro nás důležité. Prosím, prostudujte si naše Zásady ochrany osobních údajů, které upravují způsob, jakým shromažďujeme, používáme a chráníme vaše osobní informace a výzkumná data.',
        },
        changes: {
          title: '8. Změny podmínek',
          content:
            'Vyhrazujeme si právo kdykoli tyto Podmínky upravit. Změny nabydou účinnosti okamžitě po zveřejnění. Vaše pokračující používání služby představuje přijetí upravených Podmínek.',
        },
        termination: {
          title: '9. Ukončení',
          content:
            'Kterákoli strana může tuto smlouvu kdykoli ukončit. Po ukončení okamžitě zanikne vaše právo na přístup ke službě, ačkoli tyto Podmínky zůstávají v platnosti ohledně předchozího použití.',
        },
        governingLaw: {
          title: '10. Rozhodné právo',
          content:
            'Tyto Podmínky se řídí a vykládají v souladu s platnými zákony. Všechny spory budou řešeny prostřednictvím závazného arbitráže nebo u příslušných soudů.',
        },
      },
      contact: {
        title: 'Kontaktní informace:',
        content:
          'Pokud máte otázky ohledně těchto Podmínek, kontaktujte nás na prusek@utia.cas.cz',
      },
      navigation: {
        backToHome: 'Zpět domů',
        privacyPolicy: 'Zásady ochrany osobních údajů',
      },
    },
    privacy: {
      title: 'Zásady ochrany osobních údajů',
      lastUpdated: 'Naposledy aktualizováno: leden 2025',
      disclaimer:
        'Vaše soukromí je pro nás důležité. Tyto zásady vysvětlují, jak shromažďujeme, používáme a chráníme vaše data.',
      sections: {
        introduction: {
          title: '1. Úvod',
          content:
            'Tyto Zásady ochrany osobních údajů vysvětlují, jak SpheroSeg ("my", "nás", "naše") shromažďuje, používá, chrání a sdílí vaše informace při používání naší platformy pro segmentaci a analýzu mikroskopických snímků. Používáním naší služby souhlasíte s praktikami týkajícími se dat popsanými v těchto zásadách.',
        },
        informationCollected: {
          title: '2. Informace, které shromažďujeme',
          content:
            'Shromažďujeme informace, které nám přímo poskytujete při vytváření účtu, nahrávání obrázků, vytváření projektů a interakci s našimi službami.',
          personalInfo: {
            title: '2.1 Osobní informace',
            items: [
              'Jméno a e-mailová adresa',
              'Přidružení k instituci nebo organizaci',
              'Přihlašovací údaje a preference účtu',
              'Kontaktní informace pro žádosti o podporu',
            ],
          },
          researchData: {
            title: '2.2 Výzkumná data a obrázky',
            ownershipTitle: 'Vaše výzkumná data',
            ownershipContent:
              'Zachováváte si plné vlastnictví všech obrázků a výzkumných dat, která do SpheroSeg nahrajete. Nikdy si nenárokujeme vlastnictví vašeho obsahu.',
            items: [
              'Obrázky, které nahrajete k analýze',
              'Metadata projektů a nastavení',
              'Výsledky segmentace a anotace',
              'Parametry analýzy a vlastní konfigurace',
            ],
          },
          usageInfo: {
            title: '2.3 Informace o používání',
            items: [
              'Protokolová data a časové značky přístupu',
              'Informace o zařízení a typu prohlížeče',
              'Vzory používání a interakce s funkcemi',
              'Metriky výkonu a hlášení chyb',
            ],
          },
        },
        mlTraining: {
          title: '3. Strojové učení a zlepšování dat',
          importantTitle: 'Důležité: Použití vašich dat pro trénování AI',
          importantIntro:
            'Pro kontinuální zlepšování našich algoritmů segmentace můžeme používat nahrané obrázky a data k trénování a vylepšování našich modelů strojového učení.',
          controlTitle: 'Máte plnou kontrolu nad svými daty:',
          controlContent:
            'Při vytváření účtu si můžete vybrat, zda povolíte použití vašich dat pro trénování ML. Tyto preference můžete kdykoli změnit.',
          manageTitle: 'Pro správu vašeho souhlasu:',
          manageContent:
            'Přejděte do Nastavení → záložka Soukromí ve vašem přehledu. Tam můžete povolit nebo zakázat souhlas s trénováním ML a vybrat konkrétní účely (zlepšení algoritmů, vývoj funkcí), pro které mohou být vaše data použita.',
          howWeUse: {
            title: 'Jak používáme vaše data pro ML:',
            items: [
              'Trénování modelu: Obrázky se používají k trénování algoritmů segmentace pro lepší přesnost',
              'Vylepšení algoritmů: Vaše opravy segmentace pomáhají zlepšit automatickou detekci',
              'Vývoj funkcí: Vzory používání vedou vývoj nových analytických nástrojů',
              'Zajištění kvality: Data pomáhají validovat a testovat nové verze modelů',
            ],
          },
          protection: {
            title: 'Ochrana dat při trénování ML:',
            items: [
              'Anonymizace: Všechna data jsou anonymizována před použitím při trénování ML',
              'Odstranění metadat: Osobní a institucionální identifikační informace jsou odstraněny',
              'Bezpečné zpracování: Trénování probíhá v bezpečných, izolovaných prostředích',
              'Žádná distribuce surových dat: Vaše původní obrázky nejsou nikdy sdíleny s třetími stranami',
            ],
          },
        },
        howWeUse: {
          title: '4. Jak používáme vaše informace',
          content: 'Shromážděné informace používáme k:',
          purposes: [
            'Poskytování a udržování služeb segmentace',
            'Zpracování vašich obrázků a generování výsledků analýzy',
            'Zlepšování našich algoritmů a vývoji nových funkcí',
            'Komunikaci s vámi ohledně vašeho účtu a aktualizací',
            'Poskytování technické podpory a řešení problémů',
            'Dodržování právních povinností a ochraně našich práv',
          ],
        },
        dataSecurity: {
          title: '5. Zabezpečení a ochrana dat',
          content: 'Implementujeme robustní bezpečnostní opatření včetně:',
          measures: [
            'Šifrování dat při přenosu a v klidu',
            'Pravidelné bezpečnostní audity a hodnocení zranitelností',
            'Kontroly přístupu a autentizační systémy',
            'Bezpečné zálohování a postupy obnovy po havárii',
            'Školení zaměstnanců v oblasti bezpečnosti a omezení přístupu',
          ],
        },
        dataSharing: {
          title: '6. Sdílení dat a třetí strany',
          noSaleStatement:
            'Neprodáváme vaše osobní informace ani výzkumná data.',
          sharingContent:
            'Informace můžeme sdílet pouze v těchto omezených případech:',
          circumstances: [
            'S vaším výslovným souhlasem',
            'Pro dodržení právních povinností nebo soudních příkazů',
            'S důvěryhodnými poskytovateli služeb, kteří pomáhají provozovat naši platformu (pod přísnými dohodami o mlčenlivosti)',
            'Pro ochranu našich práv, bezpečnosti nebo majetku',
            'V anonymizované, agregované formě pro výzkumné publikace (s vaším souhlasem)',
          ],
        },
        privacyRights: {
          title: '7. Vaše práva na soukromí a volby',
          content: 'Máte právo na:',
          rights: [
            'Přístup: Požádat o kopie vašich osobních dat a výzkumného obsahu',
            'Oprava: Aktualizovat nebo opravit nepřesné informace',
            'Vymazání: Požádat o vymazání vašeho účtu a souvisejících dat',
            'Přenositelnost: Exportovat vaše data ve strojově čitelném formátu',
            'Odhlášení: Požádat o vyloučení z trénování ML. Poznámka: To může omezit následující funkce: přesnost automatické segmentace, personalizovaná doporučení modelů, adaptivní návrhy prahu, optimalizace dávkového zpracování a budoucí vylepšení poháněná AI. Kontaktujte podporu pro konkrétní dopady na váš účet.',
            'Omezení: Omezit způsob, jakým zpracováváme vaše informace',
          ],
          contactNote:
            'Pro uplatnění těchto práv nás kontaktujte na prusek@utia.cas.cz. Odpovíme do 30 dnů.',
        },
        dataRetention: {
          title: '8. Uchovávání dat',
          content: 'Rozlišujeme mezi osobními daty a daty pro trénování ML:',
          categories: [
            'Osobní/účetní data: Všechny osobní identifikátory, informace o profilu, nastavení účtu a transakční historie budou trvale vymazány do 90 dnů od uzavření účtu.',
            'Výzkumná data: Původní obrázky a projektová data propojená s vaším účtem budou vymazána do 90 dnů od uzavření účtu.',
            'Data pro trénování ML: Data používaná pro trénování ML jsou nejprve anonymizována/pseudonymizována k odstranění všech osobních identifikátorů. Tato anonymizovaná data mohou být uchovávána neomezeně dlouho k zachování zlepšení modelu, pokud se specificky neodhlásíte z trénování ML nebo nepožádáte o úplné vymazání.',
            'Možnosti odhlášení: Můžete požádat o úplné vymazání všech dat, včetně anonymizovaných dat pro trénování ML, kontaktováním prusek@utia.cas.cz. Doba zpracování je obvykle 30 dnů.',
          ],
        },
        internationalTransfers: {
          title: '9. Mezinárodní přenosy dat',
          content:
            'Vaše data mohou být zpracovávána v jiných zemích než ve vaší vlastní. Zajišťujeme odpovídající záruky a ochranu pro mezinárodní přenosy, včetně standardních smluvních doložek a rozhodnutí o přiměřenosti.',
        },
        childrensPrivacy: {
          title: '10. Soukromí dětí',
          content:
            'Naše služba je určena pro výzkumníky a není zaměřena na děti mladší 16 let. Vědomě neshromažďujeme osobní informace od dětí mladších 16 let. Pokud takové shromažďování objevíme, informace okamžitě vymažeme.',
        },
        policyChanges: {
          title: '11. Změny těchto zásad',
          content:
            'Můžeme aktualizovat tyto Zásady ochrany osobních údajů, aby odrážely změny v našich postupech nebo právních požadavcích. O podstatných změnách vás budeme informovat prostřednictvím e-mailu nebo výrazného oznámení na naší webové stránce. Pokračující používání představuje přijetí aktualizovaných podmínek.',
        },
        contact: {
          title: '12. Kontaktní informace',
          dpo: 'Pověřenec pro ochranu osobních údajů: prusek@utia.cas.cz',
          general: 'Obecné dotazy: prusek@utia.cas.cz',
          postal: 'Poštovní adresa:',
          address: {
            line1: 'ÚTIA AV ČR',
            line2: 'Pod Vodárenskou věží 4',
            line3: '182 08 Praha 8',
            line4: 'Česká republika',
          },
        },
      },
      navigation: {
        backToHome: 'Zpět domů',
        termsOfService: 'Podmínky použití',
      },
    },
  },
  websocket: {
    reconnecting: 'Znovu se připojuji k serveru...',
    reconnected: 'Připojení k serveru obnoveno',
    connected: 'Připojeno k aktualizacím v reálném čase',
    disconnected: 'Odpojeno od aktualizací v reálném čase',
  },
  contextMenu: {
    propagateSelectedTracks: 'Propagovat vybrané mikrotubuly ({{count}})',
    confirmPropagateSelected: 'Propagovat {{count}} vybraných mikrotubulů?',
    propagateSelectedDescription:
      'Přepíše tvar {{count}} vybraných mikrotubulů ve všech následujících snímcích videa. Tuto akci nelze vrátit.',
    propagateTrack: 'Propagovat do dalších snímků',
    confirmPropagateTrack: 'Propagovat do dalších snímků?',
    propagateTrackDescription:
      'Přepíše tvar tohoto mikrotubulu ve všech následujících snímcích videa. Tuto akci nelze vrátit.',
    deleteTrack: 'Smazat celý track',
    confirmDeleteTrack: 'Smazat celý track mikrotubulu?',
    deleteTrackDescription:
      'Odstraní tento mikrotubulus ze všech {{count}} snímků videa. Tuto akci nelze vrátit.',
    deleteMicrotubule: 'Smazat mikrotubulus…',
    confirmDeleteScope: 'Smazat tento mikrotubulus?',
    deleteScopeDescription:
      'Tento mikrotubulus je sledován napříč celým videem. Smazat ho jen z aktuálního snímku, nebo ze všech snímků? Tuto akci nelze vrátit.',
    deleteScopeThisFrame: 'Jen z tohoto snímku',
    deleteScopeAllFrames: 'Ze všech snímků',
    deleteScopeAllFramesCount: 'Ze všech {{count}} snímků',
    editPolygon: 'Upravit polygon',
    splitPolygon: 'Rozdělit polygon',
    deletePolygon: 'Smazat polygon',
    confirmDeletePolygon: 'Opravdu chcete smazat polygon?',
    deletePolygonDescription:
      'Tato akce je nevratná. Polygon bude trvale odstraněn ze segmentace.',
    duplicateVertex: 'Duplikovat bod',
    deleteVertex: 'Smazat bod',
    editPolyline: 'Upravit polylajn',
    deletePolyline: 'Smazat polylajn',
  },
  metrics: {
    info: 'Metriky jsou vyhodnocovány pouze pro externí polygony. Plochy interních polygonů (děr) jsou automaticky odečteny od příslušných externích polygonů.',
    area: 'Plocha',
    perimeter: 'Obvod',
    equivalentDiameter: 'Ekvivalentní průměr',
    circularity: 'Kruhovitost',
    feretMax: 'Feretův maximum',
    feretMin: 'Feretův minimální',
    compactness: 'Kompaktnost',
    convexity: 'Konvexita',
    solidity: 'Solidita',
    sphericity: 'Sféricita',
    feretAspectRatio: 'Feretův poměr stran',
    disintegrationIndex: 'Index rozpadu',
    wassersteinW1: 'Wasserstein W1',
    referenceMode: 'Referenční režim',
    totalSpheroidArea: 'Celková plocha sféroidů',
    coreArea: 'Plocha core',
    invasionArea: 'Plocha invaze',
    noPolygonsFound: 'Nebyly nalezeny žádné polygony pro analýzu',
  },
  keyboardShortcuts: {
    title: 'Klávesové zkratky',
    buttonLabel: 'Zkratky',
    viewMode: 'Režim prohlížení',
    editVertices: 'Režim úprav bodů',
    addPoints: 'Režim přidávání bodů',
    createPolygon: 'Vytvořit nový polygon',
    sliceMode: 'Režim řezání',
    deleteMode: 'Režim mazání',
    holdToAutoAdd: 'Držte pro automatické přidávání bodů',
    undo: 'Zpět',
    redo: 'Znovu',
    deleteSelected: 'Smazat vybraný polygon',
    cancelOperation: 'Zrušit aktuální operaci',
    zoomIn: 'Přiblížit',
    zoomOut: 'Oddálit',
    resetView: 'Resetovat zobrazení',
    helperText:
      'Tyto zkratky fungují v editoru segmentace pro rychlejší a pohodlnější práci.',
  },
  accessibility: {
    toggleSidebar: 'Přepnout boční panel',
    toggleMenu: 'Přepnout menu',
    selectLanguage: 'Vybrat jazyk',
    selectTheme: 'Vybrat téma',
    breadcrumb: 'drobečková navigace',
    pagination: 'stránkování',
    close: 'Zavřít',
    more: 'Více',
    goToPreviousPage: 'Jít na předchozí stránku',
    goToNextPage: 'Jít na další stránku',
    previousPage: 'Předchozí',
    nextPage: 'Další',
    morePages: 'Více stránek',
    previousSlide: 'Předchozí snímek',
    nextSlide: 'Další snímek',
    gridView: 'Mřížkové zobrazení',
    listView: 'Seznamové zobrazení',
  },
  footer: {
    appName: 'SpheroSeg',
    description:
      'Platforma pro segmentaci a analýzu mikroskopických snímků pro biomedicínské výzkumníky — sféroidy, hojení ran, spermie, mikrokapsle, mikrotubuly a neurony, s nástroji AI od snímku až po měření.',
    contact: 'Kontakt',
    institution: 'Instituce',
    institutionName: 'ÚTIA AV ČR',
    address: 'Adresa',
    addressText: 'Pod Vodárenskou věží 4, 182 08 Praha 8',
    resources: 'Zdroje',
    documentation: 'Dokumentace',
    features: 'Funkce',
    tutorials: 'Návody',
    research: 'Výzkum',
    legal: 'Právní',
    termsOfService: 'Podmínky služby',
    privacyPolicy: 'Zásady ochrany osobních údajů',
    contactUs: 'Kontaktujte nás',
    developedAt: 'Vyvinuto na',
    designBy: 'Design',
  },
  sharing: {
    processingInvitation: 'Zpracování pozvánky...',
    share: 'Sdílet',
    shared: 'Sdíleno',
    shareProject: 'Sdílet projekt',
    shareDescription: 'Sdílejte projekt "{{title}}" s kolegy a spolupracovníky',
    shareByEmail: 'Sdílet emailem',
    shareByLink: 'Sdílet odkazem',
    emailAddress: 'Emailová adresa',
    enterEmailPlaceholder: 'Zadejte emailovou adresu',
    sendInvitation: 'Odeslat pozvánku',
    sending: 'Odesílání...',
    emailSent: 'Email pozvánka byla odeslána!',
    emailRequired: 'Emailová adresa je povinná',
    emailShareFailed: 'Nepodařilo se odeslat email pozvánku',
    linkExpiry: 'Platnost odkazu',
    neverExpires: 'Nikdy nevyprší',
    hours: 'hodin',
    days: 'dní',
    generateLink: 'Vygenerovat odkaz',
    generating: 'Generování...',
    linkGenerated: 'Odkaz pro sdílení byl vytvořen!',
    linkCopied: 'Odkaz zkopírován do schránky',
    linkCopyFailed: 'Nepodařilo se zkopírovat odkaz',
    linkShareFailed: 'Nepodařilo se vygenerovat odkaz',
    emailInvitations: 'Emailové pozvánky',
    shareLinks: 'Odkazy pro sdílení',
    shareRevoked: 'Sdílení bylo zrušeno',
    revokeShareFailed: 'Nepodařilo se zrušit sdílení',
    failedToLoadShares: 'Nepodařilo se načíst seznam sdílení',
    status: {
      pending: 'Čekající',
      accepted: 'Přijato',
      revoked: 'Zrušeno',
    },
    sharedWithYou: 'Sdíleno s vámi',
    sharedBy: 'Sdílel:',
    sharedProjects: 'Sdílené projekty',
    noSharedProjects: 'Žádné projekty s vámi nejsou sdíleny',
    removeFromShared: 'Odebrat ze sdílených',
    acceptInvitation: 'Přijmout pozvánku',
    invitationAccepted: 'Pozvánka byla přijata!',
    invitationExpired: 'Tato pozvánka již expirovala',
    invitationInvalid: 'Neplatná pozvánka',
    loginToAccept: 'Pro přijetí pozvánky se přihlaste',
    accepting: 'Přijímání',
    redirectingToProject: 'Přesměrování na projekt',
    invitedEmail: 'Pozvaný email',
    pendingInvitations: 'Čekající pozvánky',
    sentOn: 'Odesláno',
    joinedViaLink: 'Připojeni přes odkaz',
    joinedViaLinkOn: 'Připojeno',
    loadingShare: 'Načítání informací o sdílení...',
    projectSharedBy: 'Projekt sdílel',
    signInRequired: 'Vyžadováno přihlášení',
    signInToAccept: 'Pro přijetí pozvánky se prosím přihlaste',
    signInButton: 'Přihlásit se',
    goToProject: 'Přejít na projekt',
    backToHome: 'Zpět domů',
    acceptFailed: 'Nepodařilo se přijmout pozvánku',
    differentEmail: 'Tato pozvánka je pro jinou emailovou adresu',
    acceptedUsers: 'Přijatí uživatelé',
    activeShareLinks: 'Aktivní odkazy pro sdílení',
    joinedOn: 'Připojeno',
    resendInvitation: 'Odeslat pozvánku znovu',
    invitationResent: 'Pozvánka byla odeslána znovu',
    resendFailed: 'Nepodařilo se odeslat pozvánku znovu',
    revokeAccess: 'Zrušit přístup',
    cancelInvitation: 'Zrušit pozvánku',
  },
  error: 'Chyba',
  segmentationEditor: {
    reloadingSegmentation: 'Obnovování segmentace...',
    loadingFrame: 'Načítání snímku...',
    segmenting: 'Segmentování...',
    waitingInQueue: 'Čekání ve frontě...',
    retryingLoad: 'Načítání se nedaří. Zkouším znovu...',
    error: {
      title: 'Chyba segmentace',
      description:
        'Při načítání segmentačních dat došlo k chybě. Může to být způsobeno problémy se sítí nebo serverem.',
      errorDetails: 'Podrobnosti chyby',
      tryAgain: 'Zkusit znovu',
      unsavedChanges: 'Neuložené změny',
      imageLoadFailed:
        'Obrázek se nepodařilo načíst. Obnovte stránku a zkuste to znovu.',
    },
    export: {
      exportAllMetrics: 'Exportovat všechny metriky jako XLSX',
      exportUnavailable: 'Export není k dispozici',
      loading: 'Načítání...',
    },
  },
  microtubule: {
    instancePanel: 'Instance mikrotubulů',
    instance: 'Mikrotubulus',
    hideInstance: 'Skrýt mikrotubulus',
    showInstance: 'Zobrazit mikrotubulus',
    renameInstance: 'Přejmenovat mikrotubulus',
    hideAll: 'Skrýt vše',
    showAll: 'Zobrazit vše',
    type: {
      set: 'Nastavit typ',
      setForSelected: 'Nastavit typ pro {{count}} vybraných',
      none: 'Žádný',
      newLabel: 'Nový label…',
      renameLabel: 'Přejmenovat label',
      deleteLabel: 'Smazat label',
      manageLabels: 'Typové labely',
      labelName: 'Název',
      labelNamePlaceholder: 'např. alfa-tubulin',
      labelColor: 'Barva',
      labelDialogDescription: 'Pojmenujte typ tubulinu a vyberte barvu.',
      updated: 'Typ mikrotubulu upraven',
      updateFailed: 'Nepodařilo se upravit typ mikrotubulu',
      createFailed: 'Nepodařilo se vytvořit label',
      renameFailed: 'Nepodařilo se přejmenovat label',
      deleteFailed: 'Nepodařilo se smazat label',
      loadFailed: 'Nepodařilo se načíst typové labely',
      duplicateName: 'Label s tímto názvem už existuje',
    },
    color: {
      label: 'Barva:',
      byInstance: 'Instance',
      byLabel: 'Label',
    },
  },
  sperm: {
    instancePanel: 'Instance spermií',
    instance: 'Spermie',
    newInstance: 'Nová instance',
    unassigned: 'Nepřiřazeno',
    unclassified: 'Neklasifikováno',
    part: {
      head: 'Hlava',
      midpiece: 'Střední část',
      tail: 'Bičík',
    },
    setAsHead: 'Nastavit jako hlavu',
    setAsMidpiece: 'Nastavit jako střední část',
    setAsTail: 'Nastavit jako bičík',
    assignTo: 'Přiřadit k',
    export: {
      description:
        'Exportovat měření morfologie spermií (délky hlavy, středního dílu a bičíku) do Excelu.',
      calibration: 'Kalibrační faktor',
      instances: 'instancí',
      polylines: 'polylajn',
      button: 'Exportovat metriky spermií',
      failed: 'Export metrik spermií selhal',
    },
  },
  feedback: {
    buttonTitle: 'Odeslat zpětnou vazbu',
    buttonAriaLabel: 'Otevřít formulář zpětné vazby',
    title: 'Odeslat zpětnou vazbu',
    subtitle:
      'Našli jste chybu nebo máte nápad? Napište nám — každý report čteme.',
    typeBug: 'Hlášení chyby',
    typeFeature: 'Návrh funkce',
    titleLabel: 'Název',
    titlePlaceholder: 'Krátké shrnutí',
    bodyLabel: 'Detaily',
    bodyPlaceholder:
      'Kroky k reprodukci, co jste očekávali, případně screenshoty...',
    submit: 'Odeslat',
    submittedSuccess: 'Díky! Vaše zpětná vazba byla odeslána.',
    submitFailed: 'Zpětnou vazbu se nepodařilo odeslat',
    submittedNoEmail:
      'Díky! Vaše zpětná vazba byla zaznamenána (e-mailová notifikace čeká ve frontě).',
    attachmentStoreFailed:
      'Hlášení bylo odesláno, ale přiložený soubor se nepodařilo uložit — zkuste ho prosím přiložit znovu.',
    attachmentPrompt:
      'Sem přetáhněte soubor nebo klikněte pro výběr — snímek obrazovky nebo video/ND2, kterého se hlášení týká (až 50 GB)',
    attachmentTooLarge: 'Soubor je příliš velký — limit je 50 GB',
    attachmentInvalidType:
      'Nepodporovaný typ souboru (jen obrázek, video nebo ND2)',
    removeAttachment: 'Odebrat přílohu',
    uploading: 'Nahrávání…',
  },
  editor: {
    channelSwitcher: {
      title: 'Kanály',
      detectionSource: 'Zdroj segmentace',
    },
    kymograph: {
      title: 'Kymograf',
      sourceChannel: 'Zdrojový kanál',
      tracked: '🔗 Sledováno napříč snímky',
      untracked: '⚠ Statická čára (bez sledování)',
      computing: 'Počítám kymograf…',
      downloadPng: 'PNG',
      downloadCsv: 'CSV',
      showKymograph: 'Zobrazit kymograf',
      axisTime: 'Čas (snímky)',
      axisAlong: 'Podél mikrotubule (px) →',
      zoomIn: 'Přiblížit',
      zoomOut: 'Oddálit',
      fit: 'Přizpůsobit',
      zoomHint: 'táhni pro posun · kolečko pro zoom',
      empty: 'Kymograf nelze spočítat.',
      velocityAnalysis: 'Analýza rychlosti',
      velocityHint:
        'Najde pohybující se částice a jejich rychlosti. Znovu čte každý snímek, takže čekání zhruba zdvojnásobí.',
      velocityIdle:
        'Analýza rychlosti je vypnutá — bez ní se kymograf načte rychleji.',
      analyseVelocities: 'Spustit analýzu rychlosti',
      velocityComputing: 'Analyzuji rychlosti…',
      widthLabel: 'Šířka intenzity',
      widthHint:
        'Šířka (px) pásu vzorkovaného kolem každé trajektorie pro signál vs. intenzitu pozadí.',
      minIntensityLabel: 'Min. intenzita',
      minIntensityHint:
        'Skrýt trajektorie slabší než tolik syrových jednotek intenzity nad vlastním lokálním pozadím. Absolutní — nezávislé na tom, jak je kymograf škálovaný pro zobrazení — ale nepřenosné mezi kanály. Prázdné nebo 0 zobrazí vše.',
      lineWidthLabel: 'Šířka linie',
      lineWidthHint:
        'Šířka (px) linie vzorkované podél mikrotubulu, měřená napříč. Hodnota 1 vzorkuje jediný pixel.',
      lineReduceLabel: 'Napříč šířkou',
      lineReduceHint:
        'Jak se pixely napříč šířkou linie sloučí do jedné hodnoty. Průměr odpovídá ImageJ; maximum je jasnější, ale zkreslené jednotlivými horkými pixely.',
      lineReduceMean: 'Průměr',
      lineReduceMax: 'Maximum',
      colVelocity: 'Čistá rychlost',
      colRunLength: 'Délka běhu (µm)',
      colRunTime: 'Čas běhu (s)',
      colIntensity: 'Intenzita (signál−pozadí)',
      colEdge: 'Kraj',
      colBright: 'Jas',
      brightHint:
        'Odlehlá intenzita — pravděpodobně shluk více motorů, ne jeden motor.',
      colSnr: 'SNR',
      edge: {
        left: 'Dosahuje levého konce (pokračuje za mikrotubuli)',
        right: 'Dosahuje pravého konce (pokračuje za mikrotubuli)',
        both: 'Dosahuje obou konců',
        none: 'Zůstává v rámci mikrotubule',
      },
      noBlobs: 'Nedetekovány žádné pohyblivé částice',
      velocityFailed: 'Detekce rychlosti selhala.',
      filteredHidden:
        'Skryto {{count}} neprocesivních trajektorií pod 0.01 µm/s.',
      dimHidden:
        'Skrytých trajektorií pod prahem {{threshold}} jednotek nad pozadím: {{count}}.',
      downloadTracks: 'CSV rychlostí',
      uncalibrated:
        'Bez kalibrace velikosti pixelu / intervalu snímků — rychlosti v px/snímek.',
    },
    channels: {
      toggleVisibility: 'Přepnout viditelnost kanálu',
      editColor: 'Upravit barvu',
      opacity: 'Průhlednost kanálu',
      renameHint: 'Dvojklikem přejmenovat',
      renameFailed: 'Přejmenování selhalo',
      renameTooLong: 'Příliš dlouhé jméno (max 128 znaků)',
      colorDialog: {
        title: 'Barva kanálu:',
        description:
          'Vyberte, jak tento kanál obarví složený overlay. Bílá ponechá podkladovou škálu šedi beze změny.',
        customLabel: 'Vlastní',
      },
    },
    windowLevel: {
      title: 'Zobrazení',
      channel: 'Kanál',
      min: 'Min',
      max: 'Max',
      brightness: 'Jas',
      contrast: 'Kontrast',
      reset: 'Resetovat',
    },
    frameNavigation: {
      frame: 'Snímek',
      play: 'Přehrát',
      pause: 'Pauza',
      buffering: 'Načítání…',
    },
  },

  folders: {
    folder: 'Složka',
    home: 'Domů',
    newFolder: 'Nová složka',
    createFolder: 'Vytvořit složku',
    create: 'Vytvořit',
    folderName: 'Název složky',
    folderNamePlaceholder: 'např. Experiment A',
    rename: 'Přejmenovat',
    renameFolder: 'Přejmenovat složku',
    deleteFolder: 'Smazat složku',
    deleteFolderConfirm:
      'Smazat složku „{{name}}"? Tato akce trvale smaže {{projects}} projektů a {{subfolders}} podsložek. {{shared}} sdílených projektů se vrátí do rootu.',
    moveTo: 'Přesunout do…',
    moveToRoot: 'Root (bez složky)',
    openFolder: 'Otevřít složku {{name}}',
    empty: 'Prázdná složka',
    created: 'Složka vytvořena',
    renamed: 'Složka přejmenována',
    deleted: 'Složka smazána',
    moved: 'Úspěšně přesunuto',
    moveSkipped: 'Přesun přeskočen — žádný přístup k projektu',
    movePartial:
      'Přesunuto {{moved}} projektů; {{skipped}} přeskočeno (bez přístupu)',
    moveAllSkipped: '{{count}} projektů přeskočeno — bez přístupu',
    deletePartial:
      'Smazáno {{deleted}} projektů; {{failed}} selhalo. Složka zůstala; zkuste znovu.',
    duplicateName: 'Složka se stejným názvem zde už existuje',
    cannotMoveIntoSelf: 'Složku nelze přesunout do sebe nebo do své podsložky',
  },
  automatedEssays: {
    rerun: 'Spustit znovu',
    rerunHint:
      'Spustí tuto složku znovu ze souborů, které už jsou na serveru — není potřeba nic nahrávat.',
    rerunStarted: 'Běh byl znovu zařazen do fronty.',
    rerunFailed: 'Běh se nepodařilo spustit znovu.',
    rerunConfirm:
      'Spustit tuto složku znovu? Použijí se soubory, které už jsou na serveru.',
    rerunConfirmReplace:
      'Spustit tuto složku znovu? Stávající výsledek bude nahrazen — pokud si ho chcete nechat, nejdřív si ho stáhněte.',
    navLabel: 'Automatické eseje',
    title: 'Automatické eseje',
    subtitle:
      'Nahrajte složku se záznamy jamek ve formátu .nd2 pro měření délky a intenzity mikrotubulů v každé jamce.',
    dragFolder: 'Přetáhněte sem složku se soubory .nd2',
    dropHere: 'Pusťte složku pro přidání',
    selectFolder: 'Vybrat složku',
    onlyNd2: 'Zpracovávají se pouze záznamy jamek .nd2.',
    filesSelected: 'Vybráno {{count}} souborů .nd2',
    clear: 'Vymazat',
    uploadAndProcess: 'Nahrát a zpracovat',
    uploading: 'Nahrávání… {{percent}} %',
    jobStarted: 'Nahrávání dokončeno — zpracování zahájeno',
    uploadFailed: 'Nahrávání selhalo',
    downloadFailed: 'Stahování se nepodařilo spustit',
    yourRuns: 'Vaše úlohy',
    noRuns: 'Zatím žádné úlohy. Začněte nahráním složky.',
    fileCount: '{{count}} souborů',
    mtCount: '{{count}} mikrotubulů',
    deviceDegraded: 'CPU (GPU nedostupné)',
    deviceDegradedHint:
      'Tento běh měl použít GPU, ale nepodařilo se k němu přistoupit, takže běžel na CPU a trval výrazně déle. Nahlaste to prosím.',
    deviceBusy: 'CPU (GPU zaneprázdněné)',
    deviceBusyHint:
      'Společné GPU bylo po celou dobu čekání obsazené, takže běh proběhl na CPU a trval déle. Nic není rozbité, není třeba to hlásit.',
    download: 'Stáhnout',
    delete: 'Smazat',
    deleteFailed: 'Úlohu se nepodařilo smazat',
    noNd2Found: 'V dané složce nebyly nalezeny žádné záznamy .nd2',
    someIgnored:
      'Použije se {{kept}} z {{total}} souborů (zpracují se jen .nd2)',
    status: {
      queued: 'Ve frontě',
      running: 'Zpracovává se',
      completed: 'Dokončeno',
      failed: 'Selhalo',
    },
  },
  segmenter: {
    dashboard: {
      title: 'Segmentátor',
      subtitle:
        'Datové sady pro anotaci polygonů s malým počtem příkladů a vlastním trénováním',
      newDataset: 'Nová datová sada',
      noDatasets: 'Zatím žádné datové sady.',
      createFirst: 'Vytvořit první datovou sadu',
      deleteDataset: 'Smazat datovou sadu',
      imageCount: '{{count}} obrázek(ů)',
      createDialogTitle: 'Nová datová sada',
      createDialogDescription:
        'Datové sady seskupují neoznačené obrázky, které budete anotovat vlastními třídami.',
      nameLabel: 'Název datové sady',
      namePlaceholder: 'např. Jádra — kolo 1',
      creating: 'Vytváření…',
      create: 'Vytvořit',
      deleteConfirmTitle: 'Smazat datovou sadu?',
      deleteConfirmDescription:
        'Tímto trvale smažete „{{name}}“ a všechny její obrázky, třídy a anotace. Tuto akci nelze vrátit zpět.',
      cancel: 'Zrušit',
      deleting: 'Mazání…',
      delete: 'Smazat',
      loadFailed: 'Nepodařilo se načíst datové sady',
      created: 'Datová sada byla vytvořena',
      createFailed: 'Nepodařilo se vytvořit datovou sadu',
      deleted: 'Datová sada byla smazána',
      deleteFailed: 'Nepodařilo se smazat datovou sadu',
    },
    datasetDetail: {
      backLabel: 'Zpět na datové sady',
      loading: 'Načítání…',
      imageCount: '{{count}} obrázek(ů)',
      noImages: 'Zatím žádné obrázky. Přetáhněte je nahoru pro začátek.',
      annotated: 'Anotováno',
      deleteImage: 'Smazat obrázek',
      deleteConfirmTitle: 'Smazat obrázek?',
      deleteConfirmDescription:
        'Tímto trvale smažete „{{name}}“ a jeho anotaci. Tuto akci nelze vrátit zpět.',
      cancel: 'Zrušit',
      deleting: 'Mazání…',
      delete: 'Smazat',
      loadFailed: 'Nepodařilo se načíst datovou sadu',
      deleteFailed: 'Nepodařilo se smazat obrázek',
    },
    upload: {
      skippedVideo:
        '{{count}} soubor(ů) přeskočeno — segmentátor přijímá pouze statické obrázky',
      success: '{{count}} obrázek(ů) nahráno',
      partialFail:
        '{{uploaded}} nahráno, {{failed}} se nezdařilo — zkontrolujte formát a velikost',
      failed: 'Nahrávání se nezdařilo',
    },
    classes: {
      panelTitle: 'Třídy',
      newClass: 'Nová třída',
      loading: 'Načítání tříd…',
      empty: 'Zatím žádné třídy. Vytvořte jednu a začněte anotovat.',
      renameLabel: 'Přejmenovat třídu',
      deleteLabel: 'Smazat třídu',
      unclassified: 'Nezařazeno',
      unknown: 'Neznámá třída',
      activeClass: 'Aktivní třída',
      pickerEmpty: 'Zatím žádné třídy — před kreslením vytvořte alespoň jednu.',
      dialogTitleCreate: 'Nová třída',
      dialogTitleRename: 'Přejmenovat třídu',
      dialogDescription:
        'Zadejte název třídy a barvu, kterou se budou vykreslovat její polygony.',
      nameLabel: 'Název třídy',
      namePlaceholder: 'např. Jádro',
      colorLabel: 'Barva',
      cancel: 'Zrušit',
      create: 'Vytvořit',
      save: 'Uložit',
      loadFailed: 'Nepodařilo se načíst třídy',
      createFailed: 'Nepodařilo se vytvořit třídu',
      nameClash: 'Třída s tímto názvem již existuje',
      renameFailed: 'Nepodařilo se přejmenovat třídu',
      deleteFailed: 'Nepodařilo se smazat třídu',
    },
    editor: {
      missingRouteParams:
        'V adrese chybí identifikátor datové sady nebo obrázku.',
      back: 'Zpět',
      selectMode: 'Výběr',
      drawPolygon: 'Kreslit polygon',
      editVertices: 'Upravit vrcholy',
      deletePolygon: 'Smazat polygon',
      undo: 'Zpět',
      redo: 'Znovu',
      zoomOut: 'Oddálit',
      zoomIn: 'Přiblížit',
      resetView: 'Obnovit zobrazení',
      save: 'Uložit',
      saveUnsaved: 'Uložit*',
      saved: 'Anotace byla uložena',
      saveFailed: 'Nepodařilo se uložit anotaci',
      loadFailed: 'Nepodařilo se načíst anotaci',
      saveDisabledLoadError:
        'Ukládání je zakázáno, dokud se anotace tohoto obrázku úspěšně nenačte — jinak byste mohli přepsat uloženou práci prázdnou anotací.',
      retry: 'Zkusit znovu',
      imageLoadFailed: 'Nepodařilo se načíst obrázek',
      imageAlt: 'Obrázek k anotaci',
      minVertices: 'Polygon musí mít alespoň 3 body',
    },
    polygonList: {
      title: 'Polygony ({{count}})',
      empty:
        'Zatím žádné polygony. Přepněte na „Kreslit polygon“ a klikněte do obrázku.',
      instance: 'Instance {{id}}',
      points: '{{count}} bodů',
      changeClass: 'Změnit třídu',
      delete: 'Smazat polygon',
    },
  },
};
