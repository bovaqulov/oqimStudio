"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchField } from "@/components/ui/SearchField";

/**
 * Finding a row, and saying so in the address.
 *
 * The query lives in the URL rather than in state, for the same reason the page
 * number does: a reader who searched, opened a row and pressed back belongs on
 * the search they were looking at. It is also what makes the search *shareable*
 * — "the ones with MRT in them" is a link somebody can send.
 *
 * Typing is debounced before it becomes a navigation. Every keystroke as its
 * own round trip is a server that answers "M", "MR" and "MRT" and a reader who
 * watches the list flicker twice on the way to the answer.
 */
export function RowsToolbar({ tableId, total }: { tableId: string; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("q") ?? "";
  const [text, setText] = useState(current);
  const [seen, setSeen] = useState(current);

  // The address is the source of truth: a back button that changes the query
  // has to change the box too. Adjusted during the render that noticed it,
  // which is React's own answer for this — an effect would render once with
  // the stale text and React 19's lint refuses it outright.
  if (seen !== current) {
    setSeen(current);
    setText(current);
  }

  useEffect(() => {
    if (text === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (text.trim()) next.set("q", text.trim());
      else next.delete("q");
      // A new search is a new first page. Staying on page 6 of a result set
      // with four rows in it is an empty screen that looks like a bug.
      next.delete("page");
      const query = next.toString();
      router.replace(query ? `/tables/${tableId}?${query}` : `/tables/${tableId}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [text, current, params, router, tableId]);

  return (
    <div className="flex items-center gap-2 px-1">
      <div className="min-w-0 flex-1">
        <SearchField value={text} onChange={setText} placeholder="Qatorlardan qidirish…" />
      </div>
      {current && (
        <span className="t-footnote t-tertiary flex flex-none items-center gap-1">
          <Icon name="check" size={13} />
          {total} ta topildi
        </span>
      )}
    </div>
  );
}
