import type { IconName } from "@/components/ui/Icon";
import type { StatusLabel } from "@/components/ui/types";

export type MarketCategory = "sales" | "support" | "content" | "ai";

export const MARKET_CATEGORY_LABEL: Record<MarketCategory, string> = {
  sales: "Sotuv",
  support: "Qo'llab-quvvatlash",
  content: "Kontent",
  ai: "AI",
};

/** One reader's verdict. What turns a catalogue into something you can choose from. */
export interface TemplateReview {
  id: string;
  author: string;
  /** 1–5. */
  rating: number;
  text: string;
  when: string;
}

/** What the template installs, shown before anything is added to the workspace. */
export interface TemplatePreviewStep {
  icon: IconName;
  title: string;
  detail: string;
}

export interface MarketplaceTemplate {
  id: string;
  name: string;
  icon: IconName;
  description: string;
  category: MarketCategory;
  /** Author of the template — a person or a studio, not the installing workspace. */
  author: string;
  installs: number;
  /** 0 for a free template. */
  price: number;
  currency: string;
  /** Average of `reviews`, rounded to one decimal. */
  rating: number;
  reviews: TemplateReview[];
  /** The blocks this template lays down, in order. */
  preview: TemplatePreviewStep[];
  /** Telegram modules the template needs — shown before install so a mismatch is caught early. */
  requires: string[];
  updatedAt: string;
  /**
   * A row `seed_demo` put on the shelf. Its author, its install count and its
   * reviews are invented, and this is the screen where those three numbers are
   * the whole basis for choosing — so the card says so rather than letting
   * «O'rnatishlar 1 240» read as fact.
   */
  isDemo: boolean;
  /**
   * This workspace has installed it. What the review form is gated on: a
   * verdict is a report from use.
   */
  installed: boolean;
}

/** A template this workspace published, as its card shows it. */
export interface MyTemplate {
  id: string;
  name: string;
  icon: IconName;
  description: string;
  status: StatusLabel;
  meta: string;
}

export function filterTemplates(
  templates: MarketplaceTemplate[],
  category: MarketCategory | "all",
  price: "all" | "free" | "paid",
  query = "",
): MarketplaceTemplate[] {
  const trimmed = query.trim().toLowerCase();
  return templates.filter((template) => {
    if (category !== "all" && template.category !== category) return false;
    if (price === "free" && template.price > 0) return false;
    if (price === "paid" && template.price === 0) return false;
    if (!trimmed) return true;
    return `${template.name} ${template.description} ${template.author} ${template.requires.join(" ")}`
      .toLowerCase()
      .includes(trimmed);
  });
}
