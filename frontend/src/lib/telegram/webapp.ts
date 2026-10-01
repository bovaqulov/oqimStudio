/**
 * The Telegram Mini App client API, typed.
 *
 * `telegram-web-app.js` puts `window.Telegram.WebApp` on the page when the
 * document is running inside a Telegram client, and nothing anywhere else. So
 * every accessor here answers `undefined` in a normal browser, and callers
 * that guard on that get one code path for both — no `typeof window` dance at
 * each call site, and no separate build for the Mini App.
 *
 * Only the surface this app actually uses is typed. The methods are versioned
 * on Telegram's side and an old client throws `WebAppMethodUnsupported` rather
 * than ignoring the call, which is why `call()` exists: it asks
 * `isVersionAtLeast` first and swallows what is left.
 *
 * https://core.telegram.org/bots/webapps#initializing-mini-apps
 */

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramInitDataUnsafe {
  user?: TelegramUser;
  chat_type?: string;
  chat_instance?: string;
  start_param?: string;
  auth_date?: number;
  hash?: string;
}

export interface TelegramButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(handler: () => void): void;
  offClick(handler: () => void): void;
}

export interface TelegramMainButton extends TelegramButton {
  text: string;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  setParams(params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
    has_shine_effect?: boolean;
  }): void;
}

export type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
export type HapticNotification = "error" | "success" | "warning";

export interface TelegramHaptics {
  impactOccurred(style: HapticStyle): void;
  notificationOccurred(type: HapticNotification): void;
  selectionChanged(): void;
}

export interface TelegramInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;

  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  isFullscreen?: boolean;
  isActive?: boolean;
  safeAreaInset?: TelegramInsets;
  contentSafeAreaInset?: TelegramInsets;

  headerColor: string;
  backgroundColor: string;
  isClosingConfirmationEnabled: boolean;
  isVerticalSwipesEnabled: boolean;

  BackButton: TelegramButton;
  MainButton: TelegramMainButton;
  SecondaryButton: TelegramMainButton;
  SettingsButton: TelegramButton;
  HapticFeedback: TelegramHaptics;
  CloudStorage: {
    setItem(key: string, value: string, callback?: (error: string | null, stored?: boolean) => void): void;
    getItem(key: string, callback: (error: string | null, value?: string) => void): void;
    removeItem(key: string, callback?: (error: string | null, removed?: boolean) => void): void;
    getKeys(callback: (error: string | null, keys?: string[]) => void): void;
  };

  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;

  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  enableVerticalSwipes(): void;
  disableVerticalSwipes(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  addToHomeScreen?(): void;

  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, callback?: (status: string) => void): void;
  shareMessage?(messageId: string, callback?: (sent: boolean) => void): void;

  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  showPopup(
    params: {
      title?: string;
      message: string;
      buttons?: { id?: string; type?: "default" | "ok" | "close" | "cancel" | "destructive"; text?: string }[];
    },
    callback?: (buttonId: string) => void,
  ): void;
  requestWriteAccess?(callback?: (granted: boolean) => void): void;
  requestContact?(callback?: (shared: boolean) => void): void;

  onEvent(event: string, handler: (...args: unknown[]) => void): void;
  offEvent(event: string, handler: (...args: unknown[]) => void): void;
  sendData(data: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    /** The bridge an older Telegram client injects. Its presence alone says "inside Telegram". */
    TelegramWebviewProxy?: unknown;
  }
}

/** The live API object, or `undefined` in an ordinary browser. */
export function webApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

/**
 * Whether this document is running inside a Telegram client *and can prove it*.
 *
 * `initData` is the proof: the API object also exists when a page is opened
 * from a plain link inside Telegram's in-app browser, where there is no signed
 * payload and so nobody to sign in as.
 *
 * Answered from the launch URL when the SDK has not landed yet. Waiting for
 * `telegram-web-app.js` to decide this was the bug that put a password form in
 * front of a Mini App: on a slow connection the script missed the four-second
 * timeout, the app concluded it was in an ordinary browser, and asked somebody
 * Telegram had already identified to type an email address.
 */
export function insideTelegram(): boolean {
  return Boolean(initData());
}

/**
 * Telegram's launch parameters, which it puts in the URL fragment.
 *
 * `#tgWebAppData=…&tgWebAppVersion=…&tgWebAppThemeParams=…` is written by the
 * client *before* our document runs a line of JavaScript, and it is where the
 * SDK reads `WebApp.initData` from in the first place. Reading it directly is
 * what makes "are we inside Telegram" answerable without waiting for a
 * third-party script over somebody's mobile connection.
 */
function launchParam(name: string): string {
  if (typeof window === "undefined") return "";
  // A substring rather than `URLSearchParams`: the value is a query string in
  // its own right, and handing it to a parser risks it being decoded twice —
  // which would change the bytes the signature is checked over.
  const match = new RegExp(`[#&]${name}=([^&]*)`).exec(window.location.hash);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/**
 * The signed payload, verbatim, for the server to check.
 *
 * The SDK first, the launch URL second. They carry the same string — the SDK
 * parses it out of the same fragment — but only one of them is guaranteed to
 * exist at the moment somebody opens a Mini App on a slow connection.
 */
export function initData(): string {
  return webApp()?.initData || launchParam("tgWebAppData");
}

/**
 * Runs `action` only if the client is new enough for the methods inside it.
 *
 * Telegram throws on an unsupported method rather than no-opping, and a Mini
 * App that dies on an old Android client because it asked for a v8 API is a
 * worse outcome than one that skips the flourish.
 */
export function call(minVersion: string, action: (app: TelegramWebApp) => void): void {
  const app = webApp();
  if (!app) return;
  try {
    if (!app.isVersionAtLeast(minVersion)) return;
    action(app);
  } catch {
    // An unsupported method on a client that lied about its version. Nothing
    // here is load-bearing — the app works without every one of these.
  }
}

/** A short tap of feedback. Silent outside Telegram and on clients without haptics. */
export function haptic(style: HapticStyle = "light"): void {
  call("6.1", (app) => app.HapticFeedback.impactOccurred(style));
}

/** Feedback for an outcome — a save that worked, a form that did not. */
export function hapticResult(type: HapticNotification): void {
  call("6.1", (app) => app.HapticFeedback.notificationOccurred(type));
}

/**
 * Resolves once `telegram-web-app.js` has landed, or gives up.
 *
 * The SDK is loaded `async` so an ordinary visitor does not wait on a
 * third-party script to see the login screen — which means a component
 * mounting early can run before `window.Telegram` exists and conclude, wrongly,
 * that it is not inside Telegram. Everything that asks that question waits
 * here first.
 *
 * The timeout is the answer for a real browser, where the object never appears:
 * resolving `undefined` is correct there, and quickly.
 */
export function whenReady(timeoutMs = 4000): Promise<TelegramWebApp | undefined> {
  const existing = webApp();
  if (existing || typeof window === "undefined") return Promise.resolve(existing);

  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const app = webApp();
      if (app || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(app);
      }
    };
    const timer = setInterval(tick, 40);
  });
}
