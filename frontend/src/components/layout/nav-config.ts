import type { IconName } from "@/components/ui/Icon";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface NavItem {
  label: string;
  href: string;
  /** Sections list some children without one — those get a dot instead. */
  icon?: IconName;
  /** Defaults to an exact pathname match; pass true for a section root that owns nested routes too (e.g. /bots stays active on /bots/[botId]). */
  matchPrefix?: boolean;
  /** Reads as a create action rather than a place. */
  accent?: boolean;
}

export interface NavSection {
  key: string;
  label: string;
  icon: IconName;
  /** Only the starting position — a section the reader is already inside opens itself (see SidebarNav). */
  defaultOpen: boolean;
  items: NavItem[];
}

/**
 * One description of the navigation, rendered three ways: the desktop sidebar,
 * the tablet drawer and the phone sheet all read from this, so a destination
 * cannot exist at one width and be missing at another.
 */
export interface NavModel {
  /**
   * Always at the top level, at every width.
   *
   * The phone's dock is *not* derived from this and never was — `MobileNav`
   * names its own three targets, with shorter labels that fit under a 23px
   * icon. What this list decides down there is the spillover: a primary
   * destination no tab carries gets a row in "Yana".
   */
  primary: NavItem[];
  /** Folded away behind "Ko'proq" / "Yana" — real destinations, just not everyday ones. */
  more: NavSection;
  /** Null while the workspace has a single project; see `getProjectLayer`. */
  projects: NavSection | null;
  /**
   * Reachable from the header ("?" and the avatar) at every width. The phone
   * has no header room for them, so the sheet spells them out instead.
   */
  utility: NavItem[];
}

/*
 * No "Botlar" row. A bot belongs to a project, and a second door into the same
 * list — one that opens on every bot in the workspace at once — is the door
 * that taught the reader the flat shape the project layer below is there to
 * correct. The bot list is one tap in, inside the project that owns it.
 *
 * The three lists take the words rather than holding them: a module-level
 * `const` is built once per process, which would freeze whichever language the
 * first request happened to ask for and hand it to everybody after.
 */
/*
 * No "Suhbatlar" and no "Kontaktlar" row either, and for the same reason as the
 * bots above: both belong to a project. A workspace-wide chat list and a
 * workspace-wide contact table are the flat shape the project layer is there to
 * correct — they answer "everyone who has ever written to any of our bots",
 * which is a question almost nobody has, and they were the two rows a first-time
 * reader met before they had met a project.
 *
 * The **routes stay** — `/chats`, `/chats/<id>`, `/contacts`, `/contacts/<id>`
 * all still render, every link into them still works, and both are still in the
 * command palette, which is deliberately the one door left open. A screen that
 * exists and cannot be reached at all is the worst of the three states; a
 * screen reachable by ⌘K is a screen waiting for its real home. That home is
 * inside the project page, and this row comes back the day it exists there.
 */
function primaryNav(t: Dictionary): NavItem[] {
  return [
    { label: t.nav.dashboard, href: "/dashboard", icon: "house" },
    { label: t.nav.analytics, href: "/analytics", icon: "chart-bar" },
  ];
}

/**
 * Shablonlar / Mening shablonlarim and Tariflar / Limitlar are tabs inside their own screens now, so one entry each is enough.
 *
 * No "Agentlar" row either, and for the reason the note above `primaryNav`
 * gives about bots: an agent belongs to a project, and a second door that
 * opened on every agent in the account at once taught the flat shape the
 * project layer below is there to correct. An agent is one tap in, on the
 * «Resurslar» tab of the project that owns it, next to the bots it answers on.
 */
function moreNav(t: Dictionary): NavItem[] {
  return [
    { label: t.nav.market, href: "/market", icon: "storefront", matchPrefix: true },
    { label: t.nav.integrations, href: "/integrations", icon: "puzzle-piece" },
    // The API reference, and it belongs in this list rather than beside
    // "Yordam markazi": the utility pair is reached from the header at every
    // width, but the model only *renders* it in the phone sheet — a
    // destination put there would be one a desktop reader could not find. It
    // sits next to «Integratsiyalar» on its own merits too. Somebody looking
    // for the API is looking at the same shelf.
    { label: t.nav.docs, href: "/docs", icon: "code" },
    { label: t.nav.billing, href: "/billing", icon: "credit-card", matchPrefix: true },
  ];
}

function utilityNav(t: Dictionary): NavItem[] {
  return [
    { label: t.nav.helpCenter, href: "/help", icon: "question", matchPrefix: true },
    { label: t.nav.settings, href: "/settings", icon: "gear", matchPrefix: true },
  ];
}

/**
 * The project layer always draws.
 *
 * It used to collapse into a single "Ko'proq" link while a workspace had one
 * project, on the grounds that a list of one is not a choice. That is true of
 * the *choice* and false of the *chain*: a bot belongs to a project and a flow
 * belongs to a bot, and hiding the middle link taught a first-time reader a
 * shape the data does not have. The list of one costs a row; the missing layer
 * cost the reader the model.
 *
 * The model is built on the server, where the reader's language is already
 * known, and travels to the sidebar, the drawer and the phone sheet as finished
 * strings. That is what keeps the three shapes from needing the dictionary
 * themselves — and what keeps a project's name, which no dictionary has, in the
 * same list as the labels that do.
 */
export function buildNavModel(projects: { id: string; name: string }[], t: Dictionary): NavModel {
  return {
    primary: primaryNav(t),
    more: {
      key: "more",
      label: t.nav.more,
      icon: "dots-three",
      defaultOpen: false,
      items: moreNav(t),
    },
    projects: {
      key: "projects",
      label: t.nav.projects,
      icon: "folders",
      defaultOpen: true,
      items: [
        { label: t.nav.newProject, href: "/projects/new", accent: true },
        ...projects.map((project) => ({ label: project.name, href: `/projects/${project.id}` })),
      ],
    },
    utility: utilityNav(t),
  };
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  const [base] = item.href.split("#");
  if (!base) return false;
  if (item.matchPrefix) return pathname === base || pathname.startsWith(`${base}/`);
  return pathname === base;
}

export function isSectionActive(pathname: string, section: NavSection): boolean {
  return section.items.some((item) => isNavItemActive(pathname, item));
}
