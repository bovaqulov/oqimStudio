import { call, webApp, type TelegramThemeParams } from "./webapp";

/**
 * Telegram's palette, mapped onto ours.
 *
 * The client hands every Mini App the colours the reader actually chose — they
 * run a dozen themes, not two — and an app that ignores them is a blue-grey
 * rectangle inside somebody's purple client. The audit found `themeParams`
 * being read and then dropped on the floor.
 *
 * Only the four structural colours are taken (`bg`, `secondary_bg`, `text`,
 * `button`), and only when the client actually sent them. Everything else in
 * the stylesheet is derived from those four: the neutral ramp is `--color-text`
 * at decreasing opacity and the accent tints are `--color-accent` mixed with
 * transparent, so mapping four values re-tones the whole app.
 *
 * Outside Telegram this writes nothing at all and our own palette stands.
 */

/** Telegram sends `#rrggbb`; anything else is a client we do not follow. */
function hex(value: string | undefined): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * Which of our tokens each Telegram colour drives.
 *
 * `secondary_bg_color` is the one worth explaining: in Telegram's own settings
 * screens the *page* is the secondary colour and the *cards* are `bg_color`,
 * which is the inverse of how a web app is usually built. Following that is
 * what makes a grouped list look native rather than approximately native.
 */
function applyTheme(params: TelegramThemeParams): void {
  const root = document.documentElement.style;
  const set = (token: string, value: string | null) => {
    if (value) root.setProperty(token, value);
    else root.removeProperty(token);
  };

  const bg = hex(params.bg_color);
  const secondary = hex(params.secondary_bg_color);
  const section = hex(params.section_bg_color);

  // A client that sends both: the page is the secondary tone, cards are the
  // section (or plain) background. One that sends only `bg_color` uses it for
  // the page and lets our own surface stand.
  set("--color-bg", secondary ?? bg);
  set("--color-surface", section ?? bg ?? null);
  set("--color-surface-raised", section ?? bg ?? null);
  set("--color-text", hex(params.text_color));

  const button = hex(params.button_color);
  set("--color-accent", button);
  set("--color-accent-400", button);
  set("--color-accent-500", button);
  set("--color-accent-600", button);
  set("--color-accent-700", button);
  // The readable-on-tint end of the ramp cannot be the fill itself, and we do
  // not know the client's light variant — the button colour at 70% ink over
  // the page is close enough and always legible.
  set("--color-accent-200", button && `color-mix(in srgb, ${button} 72%, ${hex(params.text_color) ?? "#ffffff"})`);
  set("--color-accent-300", button && `color-mix(in srgb, ${button} 84%, ${hex(params.text_color) ?? "#ffffff"})`);

  set("--color-danger-fg", hex(params.destructive_text_color));
}

/** Reads the current theme out of the client and applies it. Safe to call twice. */
export function syncTelegramTheme(): void {
  const app = webApp();
  if (!app?.initData) return;
  applyTheme(app.themeParams ?? {});
}

/**
 * Pushes our chrome colours back the other way — the header strip and the
 * ground behind the bounce belong to the client, not to the document.
 */
export function paintTelegramChrome(): void {
  const read = (token: string, fallback: string) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const surface = read("--color-surface", "#1e2a38");
  const bg = read("--color-bg", "#17212b");
  call("6.1", (tg) => {
    tg.setHeaderColor(surface);
    tg.setBackgroundColor(bg);
  });
  call("7.10", (tg) => tg.setBottomBarColor(surface));
}
