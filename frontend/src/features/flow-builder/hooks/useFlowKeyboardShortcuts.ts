"use client";

import { useEffect } from "react";
import { getPaletteNodeTypes } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/** Canvas-scoped shortcuts — mounted only while a flow is open, unlike the app-wide "?"/Escape handling in GlobalShortcuts. */
export function useFlowKeyboardShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const store = useFlowEditorStore.getState();
      /*
       * Is the canvas the thing being typed at?
       *
       * These used to run on `window` with nothing but a "not in a field"
       * guard, so a digit pressed anywhere on the page dropped a block on the
       * canvas and autosave wrote it — an audit produced an unasked-for
       * «Oqimga o'tish» block that way, and the only trace was the block. The
       * canvas takes focus on mousedown now (see FlowCanvas), so a key that
       * edits the graph can require it: nothing is added, deleted or moved
       * unless the reader has actually clicked into the canvas.
       *
       * The ones that stay global are the ones that carry a modifier and mean
       * the same thing anywhere in an editor: save, undo, redo, select-all.
       */
      const canvas = document.querySelector<HTMLElement>("[data-flow-canvas]");
      const onCanvas = !!canvas && !!target && canvas.contains(target);
      // The expanded editor owns the keyboard while it is open — otherwise a
      // digit typed outside a field would add a block to the canvas behind it.
      // (Escape never reaches here; the modal consumes it during capture.)
      if (store.expandedNodeId) return;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        store.save();
        return;
      }
      // Enter is what every canvas editor uses to open the selected thing, and
      // it is the keyboard-only way into a block's settings.
      if (event.key === "Enter" && store.primarySelectedId && !store.expandedNodeId) {
        event.preventDefault();
        store.expandNode(store.primarySelectedId);
        return;
      }

      if (event.key === "Escape") {
        store.select(null, false);
        store.cancelConnection();
        if (typing) target?.blur();
        return;
      }
      if (typing) return;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.selectAll();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        store.duplicateSelected();
        return;
      }
      // Everything below edits or moves the graph, so it belongs to the canvas.
      if (!onCanvas) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        store.deleteSelected();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        store.zoomBy(0.1);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        store.zoomBy(-0.1);
        return;
      }
      if (event.key === "0") {
        store.fitView(canvas.getBoundingClientRect());
        return;
      }
      if (event.key.startsWith("Arrow") && store.primarySelectedId) {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 8;
        store.nudgeSelected(
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
        );
        return;
      }
      /*
       * A digit still adds the palette block it numbers — the palette prints
       * those numbers beside the blocks, and the reader has now had to click
       * into the canvas for this to run at all, which is what was missing.
       *
       * Not moved to Alt+1…9, which is where an audit asked for it: that
       * combination is the app's own "switch screens" shortcut, printed in the
       * help sheet, so taking it would trade a stray block for a stray
       * navigation.
       */
      const index = Number.parseInt(event.key, 10);
      const nodeType = getPaletteNodeTypes(store.moduleKey)[index - 1];
      if (index >= 1 && nodeType) {
        store.addNode(nodeType);
      }
      // "L" used to publish the flow — one unmodified letter between a draft
      // and every customer of the bot, with no confirmation on the way. The
      // top bar's own button is the way to do that, and it asks first.
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
