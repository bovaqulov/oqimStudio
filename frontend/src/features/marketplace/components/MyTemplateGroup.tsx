import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { ToastButton } from "@/components/ui/ToastButton";
import type { MyTemplate } from "../data";

/**
 * One of the workspace's own templates: the row that opens it, and the one
 * action its current state offers.
 *
 * What it replaces: a card with the name, a badge, a description, a stats line
 * and two grey pill buttons of the same weight sitting side by side — "Ochish"
 * and whichever of publish / unpublish / check-moderation applied. Opening it
 * is now the row itself (the whole thing is the target, chevron and all), which
 * leaves the group's second row for the state's one action, in accent text.
 *
 * The description went with the card: `meta` already carries the installs, the
 * price and when it last changed, which is what a template of your own is
 * looked up for. What it *does* is on the market listing.
 */
export function MyTemplateGroup({ template }: { template: MyTemplate }) {
  const published = template.status.label === "Nashr qilingan";
  const inReview = template.status.label === "Moderatsiyada";

  return (
    <ListGroup>
      <ToastButton message={`«${template.name}» tahrirlash uchun ochilmoqda`} className="oq-row cursor-pointer">
        <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
          <Icon name={template.icon} size={17} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="t-headline truncate">{template.name}</span>
          <span className="t-footnote t-secondary truncate">{template.meta}</span>
        </span>
        <Badge tone={template.status.tone}>{template.status.label}</Badge>
        <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
      </ToastButton>

      <ToastButton
        message={
          inReview
            ? `«${template.name}» moderatsiyada — natija email orqali keladi`
            : published
              ? `«${template.name}» marketdan olindi`
              : `«${template.name}» market moderatsiyasiga yuborildi`
        }
        className="oq-row cursor-pointer"
      >
        <span className="t-body min-w-0 flex-1 truncate text-left text-accent-400">
          {inReview ? "Moderatsiya holati" : published ? "Nashrdan olish" : "Nashr qilish"}
        </span>
      </ToastButton>
    </ListGroup>
  );
}
