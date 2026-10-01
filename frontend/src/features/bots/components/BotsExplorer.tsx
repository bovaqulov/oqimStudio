"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { SearchField } from "@/components/ui/SearchField";
import { countOf } from "@/lib/utils/format";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/utils/cn";
import type { BotGroup } from "../get-bot-groups";
import { BotListPanel } from "./BotListPanel";

type KindFilter = "all" | "bot" | "userbot";

/**
 * The workspace's bots, searchable. Past a handful of bots the grouped list
 * stops being scannable — the field answers "which bot was that again" without
 * making the reader open projects one by one.
 */
/** Below this many bots, scrolling the list beats filtering it. */
const CONTROLS_FROM = 6;

export function BotsExplorer({ groups }: { groups: BotGroup[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  // Counted from everything the workspace has, not from what is on screen —
  // otherwise typing a query that narrows the list to two would take the field
  // away mid-search.
  const totalBots = groups.reduce((sum, group) => sum + group.bots.length, 0);
  const showControls = totalBots >= CONTROLS_FROM;
  // One project is not a grouping — it is the same heading over every row.
  const showGroupHeadings = groups.length > 1;

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        bots: group.bots.filter((bot) => {
          if (kind !== "all" && bot.kind !== kind) return false;
          if (!trimmed) return true;
          return `${bot.handle} ${bot.settings.displayName} ${group.projectName} ${bot.status.label}`
            .toLowerCase()
            .includes(trimmed);
        }),
      }))
      .filter((group) => group.bots.length > 0);
  }, [groups, kind, query]);

  const total = filtered.reduce((sum, group) => sum + group.bots.length, 0);

  return (
    <>
      <div className={cn("mb-4 flex-col gap-2", showControls ? "flex" : "hidden")}>
        <SearchField value={query} onChange={setQuery} placeholder="Bot nomi yoki holati" />
        <Segmented
          label="Bot turi"
          options={[
            { value: "all", label: "Barchasi" },
            { value: "bot", label: "Botlar" },
            { value: "userbot", label: "Userbotlar" },
          ]}
          value={kind}
          onChange={(value) => setKind(value as KindFilter)}
        />
      </div>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon="robot"
            title={query || kind !== "all" ? "Mos bot topilmadi" : "Hozircha bot yo'q"}
          />
          {!query && kind === "all" && (
            <div className="flex justify-center pb-6">
              <Link
                href="/bots/new"
                className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-2 text-accent-400"
              >
                <Icon name="plus" size={16} /> Yangi bot qo&apos;shish
              </Link>
            </div>
          )}
        </Panel>
      ) : (
        <>
          {showControls && (
            <div className="t-footnote t-tertiary mb-4 px-1">
              {countOf(total, "bot")} · {countOf(filtered.length, "loyiha")}
            </div>
          )}
          {filtered.map((group) => (
            <div key={group.projectId} className="mb-6">
              {showGroupHeadings && (
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="t-footnote t-secondary">
                    {group.projectName} ({group.bots.length})
                  </span>
                  <span className="flex-1" />
                  <Link href={group.projectHref} className="t-footnote flex min-h-[44px] items-center px-1 text-accent-400 md:min-h-0">
                    Loyihaga o&apos;tish
                  </Link>
                </div>
              )}
              <BotListPanel bots={group.bots} />
            </div>
          ))}

          {/* A workspace with two bots leaves most of a phone screen empty, and
              the thing to do with that space is the thing to do next. A row, not
              a floating button: it belongs to the list it extends. */}
          <Link
            href="/bots/new"
            className="oq-press oq-group oq-row t-body mb-6 text-accent-400"
          >
            <Icon name="plus" size={20} className="flex-none" />
            <span className="min-w-0 flex-1">Yangi bot qo&apos;shish</span>
          </Link>
        </>
      )}
    </>
  );
}
