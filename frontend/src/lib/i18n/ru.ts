import type { Dictionary } from "./uz";

/**
 * Russian is grammatical about counting: a number picks the case of the noun
 * after it, and "5 участник" is as wrong as "5 member" would be in English.
 * Written out rather than taken from `Intl.PluralRules` for the same reason
 * `lib/utils/date.ts` tabulates month names — ICU data differs between Node and
 * a given browser, and a label that disagrees by one character between the
 * server render and hydration is a React error, not a typo.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  // 11–14 look like 1–4 and are not: "11 участников", "21 участник".
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export const ru: Dictionary = {
  nav: {
    dashboard: "Главная",
    analytics: "Аналитика",
    market: "Маркет",
    tables: "Данные",
    integrations: "Интеграции",
    docs: "Документация API",
    billing: "Оплата",
    helpCenter: "Центр помощи",
    settings: "Настройки",
    more: "Ещё",
    projects: "Проекты",
    newProject: "+ Новый проект",
  },

  chrome: {
    mainNav: "Основная навигация",
    search: "Поиск",
    searchPlaceholder: "Поиск…",
    openMenu: "Открыть меню",
    menu: "Меню",
    close: "Закрыть",
    expandSidebar: "Развернуть боковую панель",
    collapseSidebar: "Свернуть боковую панель",
    collapse: "Свернуть",
    toDarkTheme: "Перейти на тёмную тему",
    toLightTheme: "Перейти на светлую тему",
    helpAndShortcuts: "Центр помощи и горячие клавиши (?)",
    moreActions: "Другие действия",
    back: (label: string) => `Назад: ${label}`,
    profile: "Профиль и настройки",
    profileOf: (name: string) => `${name} · Профиль и настройки`,
    demoData: "Демо-данные",

    tabs: {
      home: "Главная",
      bots: "Боты",
      more: "Ещё",
    },
    sheetWorkspace: "Рабочее пространство",

    palette: {
      placeholder: "Найти проект, бота, поток или страницу…",
      label: "Глобальный поиск",
      empty: (query: string) => `По запросу «${query}» ничего не найдено.`,
      hintSelect: "↑↓ — выбрать",
      hintOpen: "Enter — открыть",
    },

    workspace: {
      switch: "Сменить рабочее пространство",
      settings: "Настройки рабочего пространства",
      list: "Рабочие пространства",
      members: (count: number) => `${count} ${plural(count, "участник", "участника", "участников")}`,
      add: "Новое рабочее пространство",
      manageTeam: "Управление командой",
      signOut: "Выйти",
    },

    error: {
      title: "Не удалось открыть страницу",
      description: "Попробуйте ещё раз.",
      retry: "Повторить",
      home: "Главная",
      help: "Помощь",
    },

    help: {
      title: "Помощь",
      centerLink: "Центр помощи — руководства и документация Telegram",
      general: "Общее",
      canvas: "Канвас",
      globalSearch: "Глобальный поиск (проект, бот, поток, страница)",
      saveFlow: "Сохранить поток",
      toggleHelp: "Открыть / закрыть это окно",
      cancel: "Отменить выделение, соединение или окно",
      switchScreens: "Переход между экранами",
      addBlock: "Добавить блок (в порядке списка слева)",
      undo: "Отменить",
      redo: "Вернуть",
      editBlock: "Редактировать выбранный блок (или карандаш на блоке)",
      selectAll: "Выделить все блоки",
      addToSelection: "Добавить блок к выделению",
      duplicateBlock: "Копия выбранного блока",
      deleteBlock: "Удалить выбранный блок",
      nudgeBlock: "Сдвинуть блок (с Shift — на 1px)",
      zoom: "Масштаб",
      recenter: "Вернуть в центр",
      toggleFlow: "Включить / остановить поток",
    },
  },

  ui: {
    search: "Поиск",
    clear: "Очистить",
  },

  settings: {
    title: "Настройки",
    workspace: "Рабочее пространство",
    readOnly: "Только просмотр",
    name: "Название",
    timezone: "Часовой пояс",
    interfaceLanguage: "Язык интерфейса",
    interfaceLanguageInfo: "Язык интерфейса — ваша личная настройка: каждый в команде выбирает свой.",
    profile: "Профиль",
    yourName: "Ваше имя",
    email: "Email",
    emailInfo:
      "Email — это способ входа в аккаунт, поэтому отсюда он не меняется. Если нужно — напишите в поддержку.",
    telegramAccount: "Аккаунт Telegram",
    telegramAccountInfo:
      "Вход в этот аккаунт — через Telegram, почтового адреса у него нет. Если нужно — напишите в поддержку.",
    appearance: "Оформление",
    themeDark: "Тёмное",
    themeLight: "Светлое",
    reportLanguage: "Язык отчётов",
    reportLanguageInfo:
      "На этом языке пишутся числа и даты в аналитике. Язык интерфейса — отдельная настройка, её каждый выбирает себе.",
    save: "Сохранить",
    team: "Команда",
    manageTeam: "Управлять",
    apiKeys: "API-ключи",
    apiKeysHint: "Другая программа или ИИ заходит в API рабочего пространства по такому ключу.",
    manageApiKeys: "Управлять",
    you: "вы",
    moreMembers: (count: number) =>
      `и ещё ${count} ${plural(count, "участник", "участника", "участников")}`,
    perMonth: "/ мес.",
    managePlan: "Управление тарифом",
  },
};
