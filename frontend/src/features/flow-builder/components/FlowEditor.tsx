"use client";

import { useEffect, useRef } from "react";
import type { EditorPlanLimits } from "@/features/billing/editor-limits";
import type { BotLanguages } from "@/features/bots/types";
import type { FlowRecord } from "@/features/flows";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import type { PaymentProviderOption, TableOption } from "../types";
import { useFlowKeyboardShortcuts } from "../hooks/useFlowKeyboardShortcuts";
import { NotEnabledBanner } from "./NotEnabledBanner";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { useFlowEditorStore } from "../store/useFlowEditorStore";
import { FlowCanvas } from "./FlowCanvas";
import { FlowTopBar } from "./FlowTopBar";
import { Inspector } from "./Inspector/Inspector";
import { EdgeInspector } from "./Inspector/EdgeInspector";
import type { FlowLinkOption } from "./Inspector/fields/FlowLinkField";
import { NodeEditorModal } from "./NodeEditorModal";
import { NodePalette } from "./NodePalette";
import { ScriptPanel } from "./script/ScriptPanel";
import { SimpleFlowView } from "./simple/SimpleFlowView";
import { TestChatFab, TestChatPanel } from "./TestChatPanel";

export function FlowEditor({
  flow,
  backHref,
  siblingFlows,
  paymentProviders = [],
  tables = [],
  botIdentity = { name: "Bot", avatarEmoji: "🤖" },
  botLanguages,
  planLimits,
  notEnabled = false,
}: {
  flow: FlowRecord;
  backHref: string;
  siblingFlows: FlowLinkOption[];
  /** Payment providers connected to this flow's bot — what the invoice block may bill through. */
  paymentProviders?: PaymentProviderOption[];
  /** Tables in this bot's workspace — what a «Jadvalga yozish» block may pick from. */
  tables?: TableOption[];
  /** How this flow's bot presents itself, for the message preview's chat header. */
  botIdentity?: { name: string; avatarEmoji: string };
  /**
   * The languages this flow's bot answers in. Absent — a bot with none
   * configured — means no language switch on any text field, which is how the
   * editor read before a bot could speak more than one.
   */
  botLanguages?: BotLanguages;
  /**
   * What this workspace's plan refuses, so the palette can lock a block rather
   * than let it be built into a flow that «Yoqish» then turns down. Absent
   * means nothing is locked, which is what an editor rendered without a plan
   * has always assumed.
   */
  planLimits?: EditorPlanLimits;
  /** Arrived here from a "create and switch on" that only managed the create. */
  notEnabled?: boolean;
}) {
  const initialize = useFlowEditorStore((s) => s.initialize);
  // `initialize` runs in an effect, so the first paint has an empty graph. The
  // list read that as "this flow has no steps" and offered to start one — an
  // empty state shown while the data is on its way is worse than a blank
  // screen, because it invites the reader to act on a lie.
  const loadedFlowId = useFlowEditorStore((s) => s.flowId);
  const flushSave = useFlowEditorStore((s) => s.flushSave);
  const saveStatus = useFlowEditorStore((s) => s.saveStatus);
  const setNarrow = useFlowEditorStore((s) => s.setNarrow);
  const layoutMode = useFlowEditorStore((s) => s.layoutMode);
  const phone = usePhoneViewport();
  const workAreaRef = useRef<HTMLDivElement>(null);
  const ready = loadedFlowId === flow.id;

  // A phone reads the flow as a list whatever the flow remembers. The canvas is
  // a desktop tool — panning a graph with two fingers on a 390px screen is not
  // editing, it is looking for the block you were about to edit — and Simple
  // mode is not a reduced view of it: the same steps, the same fields, the same
  // reordering. Read and not written: `layoutMode` is a stored preference, and
  // opening a flow on a phone must not be what takes Pro mode away from the
  // desktop it was chosen on.
  const mode = phone ? "simple" : layoutMode;

  // Saving revalidates this route, so the server hands the editor a fresh
  // `flow` and a fresh bot context after every autosave. Those are read through
  // a ref rather than depended on: re-initializing on them would throw away the
  // pan, the zoom, the selection and the undo history a second after every
  // keystroke — which is what put the graph back under the palette in the first
  // place.
  const contextRef = useRef({ flow, paymentProviders, tables, botIdentity, botLanguages, planLimits });
  // Kept in step above the effect that reads it: effects run in source order,
  // so by the time another flow is initialized the ref already holds that
  // flow's props rather than the previous one's.
  useEffect(() => {
    contextRef.current = { flow, paymentProviders, tables, botIdentity, botLanguages, planLimits };
  }, [flow, paymentProviders, tables, botIdentity, botLanguages, planLimits]);

  useEffect(() => {
    const context = contextRef.current;
    initialize(context.flow, {
      paymentProviders: context.paymentProviders,
      tables: context.tables,
      botIdentity: context.botIdentity,
      botLanguages: context.botLanguages,
      planLimits: context.planLimits,
    });
    // Re-initialize only when a different flow is opened — editing the loaded flow must not reset it.
  }, [flow.id, initialize]);

  // Autosave writes on a short debounce, so every way out of the editor —
  // closing the tab, switching to another app, navigating away — pays out
  // whatever is still owed first. `pagehide` rather than `beforeunload`: it is
  // the one that also fires for a backgrounded mobile tab that never returns.
  useEffect(() => {
    // A write that has not landed yet is work the reader still owns. `pagehide`
    // fires the request, but the tab can die before the answer comes back — so
    // anything still in flight, or refused, also gets a chance to be kept.
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saveStatus === "pending" || saveStatus === "error") event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    function onHide() {
      if (document.visibilityState === "hidden") flushSave();
    }
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
      flushSave();
    };
  }, [flushSave, saveStatus]);

  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(width > 0 && width < 900);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [setNarrow]);

  return (
    // `oq-viewport` rather than `100vh`: on a phone the browser's own bar is
    // inside the viewport until you scroll, and inside Telegram the keyboard
    // covers the bottom without resizing the webview — both are what
    // `viewportStableHeight` measures around.
    <div className="oq-viewport flex w-full flex-col overflow-hidden bg-bg text-text">
      <FlowTopBar backHref={backHref} />
      <div ref={workAreaRef} className="relative min-h-0 flex-1">
        {/* One graph, two readings of it — see `FlowRecord.layoutMode`. Nothing
            is converted on the way between them; only what is on screen changes. */}
        {!ready ? (
          <StepsSkeleton />
        ) : mode === "simple" ? (
          <SimpleFlowView siblingFlows={siblingFlows} />
        ) : (
          <FlowWorkArea flowId={flow.id} siblingFlows={siblingFlows} />
        )}
        {/* Both modes: a graph that failed to load is read-only either way, and
            testing the flow is worth doing from whichever view built it. */}
        <ReadOnlyBanner />
        <NotEnabledBanner show={notEnabled} />
        <TestChatPanel />
        <TestChatFab />
        {/* Over both, and over the test chat: the panel is the whole screen
            while it is open, because what is behind it is a canvas nobody is
            reading. It mounts nothing until it is opened. */}
        <ScriptPanel />
      </div>
    </div>
  );
}

/**
 * What the list looks like before it has anything to list.
 *
 * Shapes, not a spinner: the reader is about to see a column of step cards, and
 * a skeleton that is already that column means nothing jumps when the real one
 * arrives.
 */
function StepsSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-busy aria-label="Yuklanmoqda">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 py-6">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex gap-2.5">
            <span className="h-9 w-5 flex-none" />
            <div className="animate-pulse-soft h-[68px] min-w-0 flex-1 rounded-[14px] bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The canvas and everything that only makes sense beside it.
 *
 * Its own component so the palette, the zoom, the fit-to-view and the fifteen
 * keyboard shortcuts are *mounted* only in Pro mode rather than hidden in
 * Simple mode. A digit key that drops an unwired block onto a list, or a
 * Backspace that deletes the selected step, is exactly the developer tool
 * Simple mode exists to get out of the way.
 */
function FlowWorkArea({ flowId, siblingFlows }: { flowId: string; siblingFlows: FlowLinkOption[] }) {
  const fitView = useFlowEditorStore((s) => s.fitView);
  const areaRef = useRef<HTMLDivElement>(null);

  useFlowKeyboardShortcuts();

  // Once per opened flow, after the first layout pass has given the work area
  // its size — and once more on arriving from Simple mode, which is a fresh
  // mount of this component. Not on resize and not on the narrow/wide flip:
  // re-fitting would move the graph out from under whoever is reading it, and
  // a view somebody panned themselves is theirs to keep — "Markazga" fits it
  // again on request.
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = areaRef.current;
      if (el) fitView(el.getBoundingClientRect());
    }, 60);
    return () => clearTimeout(timer);
  }, [flowId, fitView]);

  return (
    <div ref={areaRef} className="absolute inset-0">
      <NodePalette />
      <FlowCanvas />
      <Inspector siblingFlows={siblingFlows} />
      {/* The two never show at once: selecting an edge clears the node
          selection and the other way round (see `selectEdge` / `select`), so
          each returns null when the other has something to draw. */}
      <EdgeInspector />
      <NodeEditorModal siblingFlows={siblingFlows} />
    </div>
  );
}
