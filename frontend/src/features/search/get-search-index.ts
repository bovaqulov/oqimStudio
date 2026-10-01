import type { IconName } from "@/components/ui/Icon";
import { botsRepository } from "@/features/bots";
import { MODULE_DEFINITIONS } from "@/features/bots/modules";
import { flowsRepository } from "@/features/flows";
import { projectsRepository } from "@/features/projects";

/** One destination the command palette can jump to. */
export interface SearchItem {
  id: string;
  label: string;
  /** Second line under the label — what tells two same-named results apart. */
  meta: string;
  href: string;
  icon: IconName;
  group: string;
  /** Extra terms the item is findable by but that are never displayed (e.g. "sozlama" for /settings). */
  keywords?: string;
}

/**
 * Screens that exist regardless of any data. Kept next to the dynamic entries
 * rather than derived from `nav-config` — the sidebar names a section, the
 * palette names the thing someone is looking for, and those are not always the
 * same words.
 */
const STATIC_PAGES: SearchItem[] = [
  { id: "page-dashboard", label: "Bosh sahifa", meta: "Umumiy holat va so'nggi hodisalar", href: "/dashboard", icon: "house", group: "Sahifalar" },
  { id: "page-projects", label: "Loyihalar", meta: "Barcha loyihalar ro'yxati", href: "/projects", icon: "folders", group: "Sahifalar" },
  { id: "page-bots", label: "Botlar", meta: "Ulangan botlar va userbotlar", href: "/bots", icon: "robot", group: "Sahifalar", keywords: "bot userbot" },
  { id: "page-analytics", label: "Analitika", meta: "Suhbatlar, voronka va kanallar kesimi", href: "/analytics", icon: "chart-bar", group: "Sahifalar", keywords: "statistika hisobot" },
  { id: "page-market", label: "Market · Shablonlar", meta: "Tayyor oqim shablonlari", href: "/market", icon: "storefront", group: "Sahifalar", keywords: "shablon template" },
  { id: "page-market-mine", label: "Mening shablonlarim", meta: "Nashr qilgan shablonlaringiz", href: "/market/mine", icon: "bookmark-simple", group: "Sahifalar" },
  // Help left the sidebar for the header's "?" — search is now one of the
  // few ways anyone finds it by name.
  { id: "page-help", label: "Yordam markazi", meta: "Qo'llanmalar va qo'llab-quvvatlash", href: "/help", icon: "graduation-cap", group: "Sahifalar", keywords: "yordam qo'llanma help" },
  { id: "page-chats", label: "Suhbatlar", meta: "Botlar bilan yozishmalar va operator javoblari", href: "/chats", icon: "chats-circle", group: "Sahifalar", keywords: "chat suhbat xabar inbox" },
  { id: "page-tables", label: "Ma'lumotlar", meta: "Oqim o'qiydigan ma'lumotlar: narxlar, xizmatlar", href: "/tables", icon: "table", group: "Sahifalar", keywords: "ma'lumot narx ro'yxat table baza" },
  { id: "page-contacts", label: "Kontaktlar", meta: "Botlaringizga yozgan odamlar", href: "/contacts", icon: "address-book", group: "Sahifalar", keywords: "mijoz kontakt" },
  { id: "page-integrations", label: "Integratsiyalar", meta: "Tashqi xizmatlar bilan ulanish", href: "/integrations", icon: "puzzle-piece", group: "Sahifalar" },
  // Found by what somebody types when they are looking for it, which is rarely
  // its title: "api", "curl", "endpoint", "token" and "bearer" all land here,
  // and none of them is a word on the row.
  { id: "page-docs", label: "API hujjatlari", meta: "Ochiq API: kalit, doiralar, endpointlar", href: "/docs", icon: "code", group: "Sahifalar", keywords: "api docs hujjat endpoint curl kalit key token bearer scope doira me options limit 429 integratsiya rest json webhook" },
  { id: "page-billing", label: "Tariflar", meta: "Tarif rejalari va to'lovlar", href: "/billing", icon: "credit-card", group: "Sahifalar", keywords: "to'lov tarif plan" },
  { id: "page-usage", label: "Limitlar", meta: "Joriy tarif bo'yicha foydalanish", href: "/billing/usage", icon: "chart-bar", group: "Sahifalar", keywords: "limit foydalanish" },
  { id: "page-team", label: "Jamoa", meta: "A'zolar va rollarni boshqarish", href: "/settings/team", icon: "users-three", group: "Sahifalar", keywords: "a'zo rol team" },
  { id: "page-settings", label: "Sozlamalar", meta: "Workspace sozlamalari", href: "/settings", icon: "gear", group: "Sahifalar", keywords: "sozlama profil" },
  { id: "page-new-project", label: "Yangi loyiha", meta: "Bo'sh loyiha yaratish", href: "/projects/new", icon: "plus", group: "Amallar", keywords: "yaratish qo'shish" },
];

/**
 * Everything ⌘K can find, flattened into one list. Composed here rather than in
 * any single repository — the palette spans three features and none of them
 * should learn about the other two.
 */
export async function getSearchIndex(workspaceId: string): Promise<SearchItem[]> {
  const [projects, bots, flows] = await Promise.all([
    projectsRepository.list(workspaceId),
    botsRepository.list(workspaceId),
    flowsRepository.list(workspaceId),
  ]);
  const handleOf = new Map(bots.map((bot) => [bot.id, bot.handle]));

  return [
    ...STATIC_PAGES,
    ...projects.map<SearchItem>((project) => ({
      id: `project-${project.id}`,
      label: project.name,
      meta: project.description,
      href: `/projects/${project.id}`,
      icon: project.icon,
      group: "Loyihalar",
    })),
    ...bots.map<SearchItem>((bot) => ({
      id: `bot-${bot.id}`,
      label: bot.handle,
      meta: `${bot.kind === "bot" ? "Telegram bot" : "Userbot"} · ${bot.status.label}`,
      href: `/bots/${bot.id}`,
      icon: bot.kind === "bot" ? "robot" : "user-circle",
      group: "Botlar",
    })),
    // Where a flow lives, not what it says it does. Half the workspace's
    // flows are called "Asosiy oqim" or "Nomsiz oqim" — one per bot, one per
    // module — and the description under them is the default "Yangi oqim" they
    // were created with, so the palette offered four rows that were identical
    // twice over. The bot and the module are what actually tell them apart,
    // and typing either now finds the flow: `meta` is searched as well as the
    // label.
    ...flows.map<SearchItem>((flow) => ({
      id: `flow-${flow.id}`,
      label: flow.name,
      meta: [handleOf.get(flow.botId), MODULE_DEFINITIONS.find((module) => module.key === flow.moduleKey)?.name]
        .filter(Boolean)
        .join(" · "),
      href: `/flows/${flow.id}`,
      icon: "flow-arrow",
      group: "Oqimlar",
      // The description keeps its search hits without taking the line: a flow
      // whose text mentions "narx" is still found by that word.
      keywords: flow.description.toLowerCase(),
    })),
  ];
}
