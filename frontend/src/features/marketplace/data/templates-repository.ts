import "server-only";
import { apiList } from "@/lib/api/server";
import { formatRelative } from "@/lib/utils/date";
import type { MarketplaceTemplate, MyTemplate, TemplateReview } from "../data";

/**
 * The market, from `/api/market/templates/`.
 *
 * Installing is not here: it writes a flow, so it belongs to the action that
 * does the writing (`features/marketplace/actions.ts`) rather than to a read.
 */
export interface TemplatesRepository {
  list(workspaceId: string): Promise<MarketplaceTemplate[]>;
  /** The ones this workspace published — the "Mening shablonlarim" screen. */
  listMine(workspaceId: string): Promise<MyTemplate[]>;
}

type TemplateDto = Omit<MarketplaceTemplate, "updatedAt" | "reviews"> & {
  updatedAt: string;
  moduleKey: string;
  reviews: (Omit<TemplateReview, "when"> & { when: string })[];
};

function toTemplate(dto: TemplateDto): MarketplaceTemplate {
  return {
    ...dto,
    updatedAt: formatRelative(dto.updatedAt),
    reviews: dto.reviews.map((review) => ({ ...review, when: formatRelative(review.when) })),
  };
}

function toMine(dto: TemplateDto): MyTemplate {
  const price = dto.price > 0 ? `${dto.price.toLocaleString("uz-UZ")} ${dto.currency}` : "bepul";
  return {
    id: dto.id,
    name: dto.name,
    icon: dto.icon,
    description: dto.description,
    // A seeded shelf entry says so where its own numbers are: "14 o'rnatish"
    // is the sentence a reader would otherwise read as their own result.
    status: dto.isDemo ? { label: "Namuna", tone: "warning" } : { label: "Nashr qilingan", tone: "success" },
    meta: `${dto.installs} o'rnatish · ${price} · ${formatRelative(dto.updatedAt)} yangilangan`,
  };
}

class ApiTemplatesRepository implements TemplatesRepository {
  async list(workspaceId: string): Promise<MarketplaceTemplate[]> {
    const rows = await apiList<TemplateDto>("/api/market/templates/", { workspaceId });
    return rows.map(toTemplate);
  }

  async listMine(workspaceId: string): Promise<MyTemplate[]> {
    const rows = await apiList<TemplateDto>("/api/market/templates/", {
      workspaceId,
      params: { mine: 1 },
    });
    return rows.map(toMine);
  }
}

export const templatesRepository: TemplatesRepository = new ApiTemplatesRepository();
