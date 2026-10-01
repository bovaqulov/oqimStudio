"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListGroup } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { SearchField } from "@/components/ui/SearchField";
import { Segmented } from "@/components/ui/Segmented";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { MARKET_CATEGORY_LABEL, filterTemplates, type MarketCategory, type MarketplaceTemplate } from "../data";
import { TemplateRow } from "./TemplateRow";
import { TemplatePreview } from "./TemplatePreview";

const CATEGORY_OPTIONS: { value: MarketCategory | "all"; label: string }[] = [
  { value: "all", label: "Barchasi" },
  ...(Object.entries(MARKET_CATEGORY_LABEL) as [MarketCategory, string][]).map(([value, label]) => ({ value, label })),
];

const PRICE_OPTIONS: { value: "all" | "free" | "paid"; label: string }[] = [
  { value: "all", label: "Barchasi" },
  { value: "free", label: "Bepul" },
  { value: "paid", label: "Pullik" },
];

/** Below this many templates, scrolling the list beats filtering it. */
const CONTROLS_FROM = 6;

export function TemplateBrowser({
  templates,
  bots,
}: {
  templates: MarketplaceTemplate[];
  /** Where an installed template can land. Empty means there is nowhere to put one yet. */
  bots: { id: string; name: string }[];
}) {
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [price, setPrice] = useState<"all" | "free" | "paid">("all");
  const [query, setQuery] = useState("");
  const [previewing, setPreviewing] = useState<MarketplaceTemplate | null>(null);

  const filtered = useMemo(
    () => filterTemplates(templates, category, price, query),
    [templates, category, price, query],
  );

  // Counted from the whole catalogue, not from what is on screen: a filter that
  // narrows the list to two would otherwise take itself away mid-search.
  const showControls = templates.length >= CONTROLS_FROM;

  return (
    <>
      {showControls && (
        <div className="mb-4 flex flex-col gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Shablon nomi yoki muallifi" />
          {/* Five categories will not fit as equal shares of a 390px screen, so
              they scroll as pills. Neutral, not accent: the one blue on this
              screen belongs to the install button, not to a filter. */}
          <div className="no-scrollbar overflow-x-auto">
            <SegmentedTabs
              label="Turkum"
              tone="neutral"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={setCategory}
              className="w-max"
            />
          </div>
          <Segmented label="Narx" options={PRICE_OPTIONS} value={price} onChange={setPrice} />
        </div>
      )}

      {filtered.length === 0 ? (
        <Panel>
          {/* An empty catalogue and an over-narrow filter look identical on
              screen and mean opposite things, so they at least say which. The
              paragraph under each ("shorten the search, clear the filters")
              told the reader what the two visible controls already offer. */}
          <EmptyState
            icon="storefront"
            title={templates.length === 0 ? "Hozircha shablon yo'q" : "Mos shablon topilmadi"}
          />
        </Panel>
      ) : (
        <ListGroup title={`${filtered.length} ta shablon`} inset="icon">
          {filtered.map((template) => (
            <TemplateRow key={template.id} template={template} onPreview={setPreviewing} />
          ))}
        </ListGroup>
      )}

      <TemplatePreview template={previewing} bots={bots} onClose={() => setPreviewing(null)} />
    </>
  );
}
