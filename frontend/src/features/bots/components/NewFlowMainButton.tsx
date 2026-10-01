"use client";

import { MainButton } from "@/lib/telegram/MainButton";
// Straight from the store module, not the feature barrel — a client component
// that reaches through a barrel drags whatever else it re-exports into the
// browser bundle (see CLAUDE.md).
import { useFlowStudioStore } from "@/features/flow-kit/flow-studio-store";

/**
 * "Yangi oqim", on Telegram's own button.
 *
 * It opens the chooser rather than creating a blank canvas outright: an empty
 * editor is the moment a shop owner gives up, so the three ways in — a
 * template, the assistant, a blank flow — are the first thing they see.
 *
 * `inline` puts it directly under the list of flows instead of pinning it to
 * the corner of the window. Pinned, it floated a long way from the list it adds
 * to on a wide screen — and reading "Yangi oqim" while looking at the flows is
 * what tells you the two are about each other. Inside Telegram this changes
 * nothing: the client draws its own button either way.
 */
export function NewFlowMainButton({ inline = false }: { inline?: boolean }) {
  const openChooser = useFlowStudioStore((state) => state.openChooser);
  return <MainButton text="Yangi oqim" inline={inline} onClick={openChooser} />;
}
