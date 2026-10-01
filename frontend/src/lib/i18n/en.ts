import type { Dictionary } from "./uz";

/**
 * British spelling, sentence case, and the same tone rule the auth copy states:
 * buttons are verbs, and nothing blames the reader.
 */
export const en: Dictionary = {
  nav: {
    dashboard: "Home",
    analytics: "Analytics",
    market: "Market",
    tables: "Data",
    integrations: "Integrations",
    docs: "API docs",
    billing: "Billing",
    helpCenter: "Help centre",
    settings: "Settings",
    more: "More",
    projects: "Projects",
    newProject: "+ New project",
  },

  chrome: {
    mainNav: "Main navigation",
    search: "Search",
    searchPlaceholder: "Search…",
    openMenu: "Open the menu",
    menu: "Menu",
    close: "Close",
    expandSidebar: "Expand the sidebar",
    collapseSidebar: "Collapse the sidebar",
    collapse: "Collapse",
    toDarkTheme: "Switch to the dark theme",
    toLightTheme: "Switch to the light theme",
    helpAndShortcuts: "Help centre and shortcuts (?)",
    moreActions: "More actions",
    back: (label: string) => `Back: ${label}`,
    profile: "Profile and settings",
    profileOf: (name: string) => `${name} · Profile and settings`,
    demoData: "Demo data",

    tabs: {
      home: "Home",
      bots: "Bots",
      more: "More",
    },
    sheetWorkspace: "Workspace",

    palette: {
      placeholder: "Search a project, bot, flow or page…",
      label: "Global search",
      empty: (query: string) => `Nothing found for “${query}”.`,
      hintSelect: "↑↓ — select",
      hintOpen: "Enter — open",
    },

    workspace: {
      switch: "Switch workspace",
      settings: "Workspace settings",
      list: "Workspaces",
      members: (count: number) => `${count} ${count === 1 ? "member" : "members"}`,
      add: "New workspace",
      manageTeam: "Manage the team",
      signOut: "Sign out",
    },

    error: {
      title: "This page could not be opened",
      description: "Please try again.",
      retry: "Try again",
      home: "Home",
      help: "Help",
    },

    help: {
      title: "Help",
      centerLink: "Help centre — guides and Telegram documentation",
      general: "General",
      canvas: "Canvas",
      globalSearch: "Global search (project, bot, flow, page)",
      saveFlow: "Save the flow",
      toggleHelp: "Open / close this window",
      cancel: "Cancel a selection, a connection or a dialog",
      switchScreens: "Move between screens",
      addBlock: "Add a block (in the order of the list on the left)",
      undo: "Undo",
      redo: "Redo",
      editBlock: "Edit the selected block (or the pencil on the block)",
      selectAll: "Select every block",
      addToSelection: "Add a block to the selection",
      duplicateBlock: "Duplicate the selected block",
      deleteBlock: "Delete the selected block",
      nudgeBlock: "Nudge the block (1px with Shift)",
      zoom: "Zoom",
      recenter: "Recentre",
      toggleFlow: "Start / stop the flow",
    },
  },

  ui: {
    search: "Search",
    clear: "Clear",
  },

  settings: {
    title: "Settings",
    workspace: "Workspace",
    readOnly: "View only",
    name: "Name",
    timezone: "Time zone",
    interfaceLanguage: "Interface language",
    interfaceLanguageInfo: "The interface language is yours alone — everyone on the team picks their own.",
    profile: "Profile",
    yourName: "Your name",
    email: "Email",
    emailInfo:
      "The address is a way into the account, so it is not changed from here. Write to support if you need it moved.",
    telegramAccount: "Telegram account",
    telegramAccountInfo:
      "This account signs in through Telegram and has no email address. Write to support if you need one added.",
    appearance: "Appearance",
    themeDark: "Dark",
    themeLight: "Light",
    reportLanguage: "Report language",
    reportLanguageInfo:
      "Numbers and dates in analytics are written in this language. The interface language is a separate setting everyone picks for themselves.",
    save: "Save",
    team: "Team",
    manageTeam: "Manage",
    apiKeys: "API keys",
    apiKeysHint: "Another program or an AI reaches the workspace API with a key like this.",
    manageApiKeys: "Manage",
    you: "you",
    moreMembers: (count: number) => `and ${count} more ${count === 1 ? "member" : "members"}`,
    perMonth: "/ month",
    managePlan: "Manage the plan",
  },
};
