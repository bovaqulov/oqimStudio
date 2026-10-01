"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { ListGroup } from "@/components/ui/List";
import { Modal } from "@/components/ui/Modal";
import { SearchField } from "@/components/ui/SearchField";
import { ToggleChip } from "@/components/ui/ToggleChip";
import type { ModuleKey } from "@/features/flows";
import { cn } from "@/lib/utils/cn";
import { createFlowFromTemplateAction } from "../actions";
import { buildableTemplates } from "../lib/build-graph";
import { getModuleKit } from "../registry";
import type { BlueprintStep, FlowTemplate } from "../types";

/**
 * Ready-made flows, one tap each.
 *
 * A template is not a starting point to be finished — it arrives complete enough
 * to answer a real customer and lands switched on, because the alternative is an
 * owner who chose "Ish vaqtidan tashqari avtojavob" and still has no after-hours
 * autoreply. "Sozlash" is there for the cases where one value (a keyword, a
 * phone number) has to be theirs before it goes live.
 *
 * Rows rather than cards: every card used to carry a filled blue "Yoqish", so
 * four of them on screen meant four primary actions competing — the same thing
 * the payments screen was rebuilt to remove. The row itself is the action now.
 */
export function TemplateGallery({
  moduleKey,
  projectId,
  botId,
  open,
  onClose,
  onCustomize,
}: {
  moduleKey: ModuleKey;
  projectId: string;
  botId: string;
  open: boolean;
  onClose: () => void;
  /** Hands the template's own answers to the wizard instead of saving it as-is. */
  onCustomize: (initial: { name: string; templateKey: string; trigger: BlueprintStep; actions: BlueprintStep[] }) => void;
}) {
  const kit = getModuleKit(moduleKey);
  // Only what the editor's current block set can actually compile. A template
  // that would land missing a step is not offered at all — see
  // [[isBuildableTemplate]].
  const offered = useMemo(() => buildableTemplates(kit), [kit]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** What the server refused, shown above the list rather than as a toast. */
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of offered) {
      for (const item of template.tags) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [offered]);

  const templates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return offered.filter((template) => {
      if (tag && !template.tags.includes(tag)) return false;
      if (!needle) return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.description.toLowerCase().includes(needle) ||
        template.tags.some((item) => item.includes(needle))
      );
    });
  }, [offered, query, tag]);

  /**
   * Applying a template.
   *
   * The action redirects into the new flow when it works, so anything that
   * comes back is a refusal — most often the plan's flow limit, whose message
   * the backend already wrote for the reader. It lands above the list, in the
   * sheet that is still open, rather than in a toast that outlives it.
   */
  function create(template: FlowTemplate) {
    setPendingKey(template.key);
    setError(null);
    startTransition(async () => {
      const failure = await createFlowFromTemplateAction({
        projectId,
        botId,
        moduleKey,
        templateKey: template.key,
      });
      setPendingKey(null);
      if (failure) setError({ message: failure.message, code: failure.code });
    });
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} labelledBy="gallery-title" className="max-w-[720px]">
      <div className="flex flex-none items-center gap-3 border-b border-separator px-4 py-3">
        <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
          <Icon name="puzzle-piece" size={17} />
        </span>
        <span id="gallery-title" className="t-headline min-w-0 flex-1 truncate">
          Tayyor oqimlar
        </span>
        <IconButton icon="x" label="Yopish" size={30} onClick={onClose} />
      </div>

      <div className="flex flex-none flex-col gap-2 border-b border-separator px-4 py-2.5">
        <SearchField value={query} onChange={setQuery} placeholder="Narx, operator, anketa" />
        {tags.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip active={tag === null} onClick={() => setTag(null)}>
              Hammasi <span className="tabular-nums opacity-70">{offered.length}</span>
            </ToggleChip>
            {tags.map(([item, count]) => (
              <ToggleChip key={item} active={tag === item} onClick={() => setTag(tag === item ? null : item)}>
                {item} <span className="tabular-nums opacity-70">{count}</span>
              </ToggleChip>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error && (
          <p
            role="alert"
            className="t-footnote m-0 flex items-start gap-2 rounded-[12px] bg-danger-bg px-3.5 py-3 text-danger-fg"
          >
            <Icon name="warning" size={17} className="mt-px flex-none" />
            <span className="min-w-0 flex-1">
              {error.message}{" "}
              {error.code === "plan_limit" && (
                <Link href="/billing" className="text-accent-400 underline-offset-2 hover:underline">
                  Tariflar
                </Link>
              )}
            </span>
          </p>
        )}

        {templates.length === 0 ? (
          <EmptyState icon="magnifying-glass" title="Mos shablon topilmadi" />
        ) : (
          <ListGroup inset="icon">
            {templates.map((template) => {
              const busy = pending && pendingKey === template.key;
              return (
                <div key={template.key} className="oq-row">
                  <span
                    className={cn(
                      "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px]",
                      template.recommended ? "bg-accent-700 text-white" : "bg-neutral-800 text-neutral-400",
                    )}
                  >
                    <Icon name={template.icon} size={17} />
                  </span>

                  {/* Stretched over the row, so a tap anywhere on it switches
                      the template on — and "Sozlash" beside it keeps its own
                      click by being positioned above the stretch. */}
                  <button
                    type="button"
                    onClick={() => create(template)}
                    disabled={pending}
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer text-left disabled:cursor-wait",
                      "after:absolute after:inset-0 after:content-['']",
                    )}
                  >
                    <span className="t-body block truncate">{template.name}</span>
                    {/* One line. `outcome` was a second and a third, written to
                        sell the template rather than to tell it apart. */}
                    <span className="t-footnote t-secondary block truncate">
                      {busy ? "Yaratilmoqda…" : template.description}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      onCustomize({
                        name: template.name,
                        templateKey: template.key,
                        trigger: template.trigger,
                        actions: template.actions,
                      })
                    }
                    className="oq-press relative flex min-h-[44px] flex-none cursor-pointer items-center px-2 text-[15px] text-accent-400 disabled:opacity-40"
                  >
                    Sozlash
                  </button>
                </div>
              );
            })}
          </ListGroup>
        )}
      </div>
    </Modal>
  );
}
