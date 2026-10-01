/**
 * Uzbek — the source of truth.
 *
 * Every other dictionary is annotated `: Dictionary`, which is `typeof uz`. That
 * is the whole coverage report: a key added here and forgotten in `ru.ts` is a
 * failed `npm run typecheck`, not a Russian screen with an Uzbek word on it.
 * Nothing enumerates the keys twice, so nothing can fall behind silently.
 *
 * The same reasoning as `features/auth/messages.ts`, which said out loud that
 * translating the product would mean "keying it by locale" — this is that key.
 *
 * Grouped by *who reads it*, not by what it means: `nav` is `nav-config.ts`,
 * `chrome` is `components/layout/*`, `ui` is `components/ui/*`, `settings` is
 * the settings screen. A string is then found the way it is edited — open the
 * component, open its group — and a group can be finished for a language
 * without half-translating five screens.
 *
 * A value is a plain string wherever the whole phrase is fixed, and a function
 * wherever a number or a name lands inside it. Interpolation is deliberately
 * *not* `"… {count} …"` with a replace: a template argument is typed, so a
 * caller cannot forget to pass one and a translator cannot invent a
 * placeholder the caller never fills.
 *
 * Coverage is the chrome, the shared UI primitives and this one screen. Every
 * other screen is still Uzbek in the component, and that is intentional — an
 * untranslated screen reads as Uzbek rather than as a missing key.
 */
export const uz = {
  /** The navigation model — see `components/layout/nav-config.ts`. */
  nav: {
    dashboard: "Bosh sahifa",
    analytics: "Analitika",
    market: "Market",
    tables: "Ma'lumotlar",
    integrations: "Integratsiyalar",
    docs: "API hujjatlari",
    billing: "To'lov",
    helpCenter: "Yordam markazi",
    settings: "Sozlamalar",
    more: "Ko'proq",
    projects: "Loyihalar",
    newProject: "+ Yangi loyiha",
  },

  /** The shell around every screen — sidebar, header, dock, dialogs. */
  chrome: {
    mainNav: "Asosiy navigatsiya",
    search: "Qidirish",
    searchPlaceholder: "Qidirish…",
    openMenu: "Menyuni ochish",
    menu: "Menyu",
    close: "Yopish",
    expandSidebar: "Yon panelni yoyish",
    collapseSidebar: "Yon panelni yig'ish",
    collapse: "Yig'ish",
    toDarkTheme: "Qorong'i temaga o'tish",
    toLightTheme: "Yorug' temaga o'tish",
    helpAndShortcuts: "Yordam markazi va tezkor tugmalar (?)",
    moreActions: "Boshqa amallar",
    /** The phone's back button, which names where it goes. */
    back: (label: string) => `Orqaga: ${label}`,
    profile: "Profil va sozlamalar",
    /** The header avatar's tooltip: whose account this opens. */
    profileOf: (name: string) => `${name} · Profil va sozlamalar`,
    demoData: "Demo ma'lumot",

    /**
     * The bottom dock. Its labels are shorter than the sidebar's on purpose —
     * "Bosh sahifa" does not fit under a 23px icon on a 320px screen — so they
     * are their own keys rather than a reuse of `nav`.
     */
    tabs: {
      home: "Bosh",
      bots: "Botlar",
      /** Everything no tab owns. */
      more: "Yana",
    },
    /** The heading over the rows the sidebar keeps in its footer. */
    sheetWorkspace: "Ish maydoni",

    palette: {
      placeholder: "Loyiha, bot, oqim yoki sahifa qidiring…",
      label: "Global qidiruv",
      empty: (query: string) => `«${query}» bo'yicha hech nima topilmadi.`,
      hintSelect: "↑↓ — tanlash",
      hintOpen: "Enter — ochish",
    },

    workspace: {
      switch: "Ish maydonini almashtirish",
      settings: "Ish maydoni sozlamalari",
      list: "Ish maydonlari",
      members: (count: number) => `${count} ta a'zo`,
      add: "Yangi ish maydoni",
      manageTeam: "Jamoani boshqarish",
      signOut: "Chiqish",
    },

    /** `ErrorState`'s defaults — what a boundary says when the screen says nothing. */
    error: {
      title: "Sahifani ochib bo'lmadi",
      description: "Qayta urinib ko'ring.",
      retry: "Qayta urinish",
      home: "Bosh sahifa",
      help: "Yordam",
    },

    help: {
      title: "Yordam",
      centerLink: "Yordam markazi — qo'llanmalar va Telegram hujjatlari",
      general: "Umumiy",
      canvas: "Kanvas",
      /*
       * Only the descriptions are here. The key combinations are not words —
       * "⌘ / Ctrl + K" is the same in every language and belongs next to the
       * component that draws it.
       */
      globalSearch: "Global qidiruv (loyiha, bot, oqim, sahifa)",
      saveFlow: "Oqimni saqlash",
      toggleHelp: "Shu oynani ochish / yopish",
      cancel: "Tanlovni, ulashni yoki oynani bekor qilish",
      switchScreens: "Ekranlar orasida o'tish",
      addBlock: "Blok qo'shish (chapdagi ro'yxat tartibida)",
      undo: "Bekor qilish",
      redo: "Bekor qilishni bekor qilish",
      editBlock: "Tanlangan blokni tahrirlash (yoki blokdagi qalam belgisi)",
      selectAll: "Barcha bloklarni tanlash",
      addToSelection: "Tanlovga blok qo'shish",
      duplicateBlock: "Tanlangan blokdan nusxa",
      deleteBlock: "Tanlangan blokni o'chirish",
      nudgeBlock: "Blokni surish (Shift bilan 1px)",
      zoom: "Masshtab",
      recenter: "Markazga qaytarish",
      toggleFlow: "Oqimni yoqish / to'xtatish",
    },
  },

  /** Defaults baked into the shared primitives in `components/ui/*`. */
  ui: {
    search: "Qidirish",
    clear: "Tozalash",
  },

  settings: {
    title: "Sozlamalar",
    workspace: "Ish maydoni",
    readOnly: "Faqat ko'rish",
    name: "Nomi",
    timezone: "Vaqt mintaqasi",
    interfaceLanguage: "Interfeys tili",
    /** The one (i) on this screen: why this field is not greyed out like its neighbours. */
    interfaceLanguageInfo: "Interfeys tili faqat sizga tegishli — jamoadagi har kim o'zinikini tanlaydi.",
    /** The reader's own half of this screen: their name, their words, their eyes. */
    profile: "Profil",
    yourName: "Ismingiz",
    email: "Email",
    /** Why the address is drawn and disabled, rather than simply absent. */
    emailInfo:
      "Email — hisobga kirish yo'li, shuning uchun uni bu yerdan o'zgartirib bo'lmaydi. Kerak bo'lsa qo'llab-quvvatlashga yozing.",
    /** The same field for an account Telegram identified: it has no address at all. */
    telegramAccount: "Telegram hisobi",
    telegramAccountInfo:
      "Bu hisobga Telegram orqali kiriladi — unga biriktirilgan email manzil yo'q. Kerak bo'lsa qo'llab-quvvatlashga yozing.",
    appearance: "Ko'rinish",
    themeDark: "Qorong'i",
    themeLight: "Yorug'",
    /** The tenant's formatting default — the workspace's, not the reader's. */
    reportLanguage: "Hisobot tili",
    reportLanguageInfo:
      "Analitikadagi sonlar va sanalar shu tilda yoziladi. Interfeys tili bundan alohida — uni har kim o'ziga tanlaydi.",
    save: "Saqlash",
    team: "Jamoa",
    manageTeam: "Boshqarish",
    apiKeys: "API kalitlari",
    /** One line, because the screen behind the link explains the rest. */
    apiKeysHint: "Boshqa dastur yoki AI ish maydoni API'siga shu kalit bilan kiradi.",
    manageApiKeys: "Boshqarish",
    /** Marks the signed-in reader in the member list. */
    you: "siz",
    moreMembers: (count: number) => `va yana ${count} ta a'zo`,
    perMonth: "/ oy",
    managePlan: "Tarifni boshqarish",
  },
};

/**
 * The contract `ru.ts` and `en.ts` are checked against.
 *
 * `typeof uz` and not a hand-written interface: a second declaration of the
 * same keys is a second thing to keep up to date, and the one that goes stale
 * is the one that was supposed to catch staleness.
 */
export type Dictionary = typeof uz;
