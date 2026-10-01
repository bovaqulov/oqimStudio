/**
 * Every icon this build ships, as data.
 *
 * Kept out of `Icon.tsx` on purpose: that module is a Client Component, and a
 * server component reading an icon name off a backend row — a notification, a
 * marketplace card — has to be able to check the name without importing the
 * client boundary. Importing a client function into the server is an error, not
 * a lint warning, so the list lives where both sides may read it.
 *
 * `Icon.tsx` types its registry as `Record<IconName, PhosphorIcon>`, so a name
 * added here without a glyph — or a glyph without a name — fails typecheck.
 */
export const ICON_NAMES = [
  "house",
  "folders",
  "folder-simple",
  "folder",
  "gear",
  "storefront",
  "puzzle-piece",
  "credit-card",
  "plus",
  "caret-right",
  "caret-down",
  "caret-up",
  "magnifying-glass",
  "keyboard",
  "arrow-left",
  "arrow-right",
  "arrow-counter-clockwise",
  "arrow-clockwise",
  "arrow-elbow-down-right",
  "arrows-left-right",
  "lightning",
  "chat-teardrop-text",
  "question",
  "git-branch",
  "clock",
  "clock-counter-clockwise",
  "tag",
  "sparkle",
  "globe-hemisphere-west",
  "headset",
  "crosshair",
  "cursor-click",
  "copy",
  "corners-out",
  "trash",
  "x",
  "check",
  "check-circle",
  "info",
  "warning",
  "plugs-connected",
  "plugs",
  "telegram-logo",
  "robot",
  "user-circle",
  "user-plus",
  "users-three",
  "megaphone",
  "chat-circle",
  "browser",
  "graduation-cap",
  "shopping-bag",
  "shopping-cart",
  "shopping-cart-simple",
  "identification-badge",
  "flow-arrow",
  "dots-three",
  "chart-bar",
  "chats-circle",
  "bookmark-simple",
  "table",
  "kanban",
  "buildings",
  "wallet",
  "chat-dots",
  "database",
  "download-simple",
  "star",
  "star-half",
  "calendar-blank",
  "seal-check",
  "pen-nib",
  "phone",
  "receipt",
  "bell-ringing",
  "hand-waving",
  "waveform",
  "minus",
  "broadcast",
  "timer",
  "paper-plane-tilt",
  "pause",
  "play",
  "text-aa",
  "image",
  "images",
  "video-camera",
  "music-notes",
  "moon",
  "sun",
  "microphone",
  "file-text",
  "film-strip",
  "map-pin",
  "address-book",
  "list-checks",
  "text-b",
  "text-italic",
  "text-underline",
  "text-strikethrough",
  "eye",
  "eye-slash",
  "code",
  "link",
  "quotes",
  "upload-simple",
  "paperclip",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);

/**
 * Whether a string names an icon that exists. Needed wherever an icon arrives
 * as data rather than as source — a backend row naming an icon this build does
 * not have would otherwise render as a crash, not a missing glyph.
 */
export function isIconName(value: string): value is IconName {
  return ICON_NAME_SET.has(value);
}
