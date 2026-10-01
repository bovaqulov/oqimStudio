"use client";

import Link from "next/link";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ModuleKey } from "@/features/flows";
import { cn } from "@/lib/utils/cn";
import { createFlowFromTemplateAction } from "../actions";
import { useFlowStudioStore } from "../flow-studio-store";
import { buildableTemplates } from "../lib/build-graph";
import { getModuleKit } from "../registry";

/**
 * The recommended templates, offered where the module is still empty.
 *
 * An empty state that only says "you have no flows" leaves the reader to invent
 * one; three named, working flows turn the same screen into a first click. The
 * cards create straight from here rather than opening the gallery — the gallery
 * is one link away for everything else.
 */
export function TemplateStrip({
  moduleKey,
  projectId,
  botId,
  limit = 3,
}: {
  moduleKey: ModuleKey;
  projectId: string;
  botId: string;
  limit?: number;
}) {
  const kit = getModuleKit(moduleKey);
  const openGallery = useFlowStudioStore((state) => state.openGallery);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Only the ones the editor's current block set can compile — the strip is
  // the module's first impression, and a card that cannot deliver its flow is
  // the worst place to find that out.
  const offered = useMemo(() => buildableTemplates(kit), [kit]);

  // Recommended first, then whatever else the module ships, so a kit with no
  // recommendations still fills the strip instead of showing an empty row.
  const templates = [...offered]
    .sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false))
    .slice(0, limit);

  if (!templates.length) return null;

  /**
   * The action redirects into the new flow when it works, so anything returned
   * is a refusal — a plan limit, most often — and its message is the backend's
   * own words rather than a guess made here.
   */
  function create(key: string) {
    setPendingKey(key);
    setError(null);
    startTransition(async () => {
      const failure = await createFlowFromTemplateAction({ projectId, botId, moduleKey, templateKey: key });
      setPendingKey(null);
      // Nothing to report on success: the action redirects into the new flow,
      // so this promise never resolves down that path.
      if (failure) setError({ message: failure.message, code: failure.code });
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error && (
        <p role="alert" className="t-footnote m-0 rounded-[12px] bg-danger-bg px-3.5 py-3 text-danger-fg">
          {error.message}{" "}
          {/* The one refusal with somewhere to go. */}
          {error.code === "plan_limit" && (
            <Link href="/billing" className="text-accent-400 underline-offset-2 hover:underline">
              Tariflar
            </Link>
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="t-footnote t-secondary flex-1">
          Bir bosishda yoqiladigan oqimlar
        </span>
        <button
          type="button"
          onClick={openGallery}
          className="oq-press flex min-h-[44px] cursor-pointer items-center gap-1 px-1 text-[15px] text-accent-400 md:min-h-0 md:text-[13px]"
        >
          Barchasi ({offered.length}) <Icon name="caret-right" size={15} />
        </button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => create(template.key)}
            disabled={pending}
            className={cn(
              "oq-press group flex min-h-[44px] cursor-pointer flex-col gap-2 rounded-[16px] bg-surface-raised p-4 text-left transition-colors",
              "disabled:cursor-wait disabled:opacity-60",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400 transition-colors group-hover:bg-accent-800 group-hover:text-accent-ink">
                <Icon name={template.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[17px] font-semibold md:text-[13.5px]">{template.name}</span>
            </span>
            <span className="t-footnote t-tertiary line-clamp-1">{template.description}</span>
            <span className="t-footnote mt-auto flex items-center gap-1 text-accent-400">
              {pending && pendingKey === template.key ? (
                "Yaratilmoqda…"
              ) : (
                <>
                  <Icon name="plus" size={13} /> Yoqish
                </>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
