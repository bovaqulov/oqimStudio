"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { MainButton } from "@/lib/telegram/MainButton";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { cn } from "@/lib/utils/cn";
import { replyFlowTestAction, startFlowTestAction } from "@/features/flows/runtime-actions";
import type { FlowNode } from "@/features/flows";
// pull `server-only` into this bundle.
import { acceptsIncomingEdge } from "../node-registry";
import { toChatState, type ChatOption, type ChatState } from "../lib/test-session";
import { useBotMainLanguage } from "./Inspector/fields/TextLanguage";
import { useFlowEditorStore } from "../store/useFlowEditorStore";
import { BUBBLE_BG, BUBBLE_TEXT, CHAT_BG, META_TEXT, OWN_BUBBLE_BG } from "./preview/telegram-colors";

/** Entry blocks a run can start from — the ones nothing can route into. */
function entryBlocks(nodes: FlowNode[]): FlowNode[] {
  const entries = nodes.filter((node) => !acceptsIncomingEdge(node.type));
  return entries.length ? entries : nodes.slice(0, 1);
}

/**
 * What the "Boshlanish" picker offers: every entry block, and — when the run
 * was opened from a card's ▶ — the block in the middle of the flow it was
 * opened at. A start the picker cannot name is a panel that disagrees with the
 * control right next to it about where the run began.
 */
function startOptions(nodes: FlowNode[], activeStart: string): FlowNode[] {
  const entries = entryBlocks(nodes);
  if (entries.some((node) => node.id === activeStart)) return entries;
  const active = nodes.find((node) => node.id === activeStart);
  return active ? [active, ...entries] : entries;
}

/**
 * Walks the graph the way a user would, in a chat that looks like Telegram.
 * Building a flow blind and testing it in the real bot is the slowest loop in
 * the product — this closes it: press a button, see which block answers, and
 * find the missing connection before a customer does.
 *
 * The walking is done by the backend, on the same engine Telegram updates go
 * through. A second walker in the browser would be a second set of rules, and
 * a test chat that disagrees with the bot is worse than none: it is confidence
 * in the wrong thing. The graph is saved first, so what is tested is what would
 * actually run.
 *
 * One name for it wherever it is offered — "Sinash": on a flow card, in the
 * editor's toolbar, on the floating button a phone gets instead, and on a
 * block's ▶, which opens this same panel with that block as the start. Three
 * names for one thing read as three things, and the ▶ was the one nobody found
 * because it looked like a fourth.
 */
export function TestChatPanel() {
  const open = useFlowEditorStore((s) => s.testChatOpen);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const request = useFlowEditorStore((s) => s.testChatStart);
  const openTestChat = useFlowEditorStore((s) => s.openTestChat);
  const starts = useMemo(() => entryBlocks(nodes), [nodes]);
  // A block this graph no longer holds falls back to the flow's own entry: the
  // ▶ that named it may have been pressed before the block was deleted, and the
  // runtime would refuse the id anyway.
  const asked = nodes.some((node) => node.id === request.nodeId) ? request.nodeId : "";
  const activeStart = asked || starts[0]?.id || "";

  if (!open) return null;

  // Keyed on the chosen block *and* on how many times one was chosen: picking
  // another start — or pressing the same block's ▶ again — remounts the
  // session, which starts a fresh run without an effect resetting state after
  // the fact.
  return <TestChatSession key={`${activeStart}:${request.nonce}`} startId={activeStart} onStartChange={openTestChat} />;
}

function TestChatSession({
  startId,
  onStartChange,
}: {
  startId: string;
  onStartChange: (id: string) => void;
}) {
  const close = useFlowEditorStore((s) => s.closeTestChat);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const flowId = useFlowEditorStore((s) => s.flowId);
  const botId = useFlowEditorStore((s) => s.botId);
  const saveQuietly = useFlowEditorStore((s) => s.saveQuietly);
  const focusNode = useFlowEditorStore((s) => s.focusNode);
  const isNarrow = useFlowEditorStore((s) => s.isNarrowViewport);
  const phone = usePhoneViewport();
  // A test run has no customer whose language could be guessed, so the keyboard
  // it offers is named in the one the bot answers in by default.
  const main = useBotMainLanguage();
  const starts = useMemo(() => startOptions(nodes, startId), [nodes, startId]);
  const activeStart = startId;

  const [restartKey, setRestartKey] = useState(0);
  const [state, setState] = useState<ChatState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state]);

  // One run per opened session, started from the block the tester picked. The
  // graph is written first: the runtime reads what is stored, so testing an
  // unsaved canvas would test the flow as it was a moment ago.
  useEffect(() => {
    let cancelled = false;
    if (!flowId || !activeStart) return;

    (async () => {
      setBusy(true);
      await saveQuietly();
      const result = await startFlowTestAction(flowId, activeStart);
      if (cancelled) return;
      setBusy(false);
      if (result.ok) {
        setFailure(null);
        setState(toChatState(result.run, nodes, main));
      } else {
        setFailure(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Restarting is what the button is for; edits mid-run must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, activeStart, restartKey]);

  function restart() {
    setDraft("");
    setState(null);
    setRestartKey((key) => key + 1);
  }

  async function reply(next: { port?: string; text?: string; webapp?: Record<string, string> }) {
    if (!flowId || !state || busy) return false;
    setDraft("");
    setBusy(true);
    const result = await replyFlowTestAction(flowId, state.runId, next);
    setBusy(false);
    if (result.ok) {
      setFailure(null);
      setState(toChatState(result.run, nodes, main));
      return true;
    }
    setFailure(result.message);
    return false;
  }

  /**
   * A pressed row. Everything but a Web App one answers the run immediately;
   * that one opens the bot's own form first, because what continues the run in
   * Telegram is the submission and not the tap.
   */
  async function press(option: ChatOption) {
    void reply({ port: option.port, text: option.text });
  }

  function jumpTo(nodeId?: string) {
    if (!nodeId) return;
    const canvas = document.querySelector<HTMLDivElement>("[data-flow-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    focusNode(nodeId, { width: rect.width, height: rect.height });
  }

  const panel = (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-neutral-800 px-3.5 py-2.5 max-md:px-4 max-md:py-3">
        <Icon name="play" size={14} className="text-accent-300" />
        <span id="test-chat-title" className="flex-1 text-[12.5px] font-medium max-md:text-[15px]">
          Sinash
        </span>
        <IconButton
          icon="arrow-counter-clockwise"
          label="Qayta boshlash"
          size={24}
          className="oq-tap relative"
          onClick={restart}
        />
        <IconButton icon="x" label="Yopish" size={24} className="oq-tap relative" onClick={close} />
      </div>

      {starts.length > 1 && (
        <label className="flex flex-none items-center gap-1.5 border-b border-neutral-900 px-3.5 py-2 text-[11px] text-neutral-600 max-md:px-4 max-md:py-2.5 max-md:text-[13px]">
          Boshlanish:
          <select
            value={activeStart}
            onChange={(event) => onStartChange(event.target.value)}
            className="min-w-0 flex-1 cursor-pointer border-none bg-transparent text-[11.5px] text-neutral-200 outline-none max-md:text-[15px]"
          >
            {starts.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* The chat keeps Telegram's own Night colours in both themes, so the text
          on it has to come from the same palette — a theme token here reads as
          dark-on-dark the moment the studio is switched to light. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain p-3"
        style={{ background: CHAT_BG }}
      >
        {nodes.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11.5px] leading-relaxed max-md:text-[15px]" style={{ color: META_TEXT }}>
            Kanvas bo&apos;sh. Blok qo&apos;shsangiz, oqimni shu yerda sinab ko&apos;rasiz.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {state?.bubbles.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jumpTo(item.nodeId)}
                title={item.nodeId ? "Blokka o'tish" : undefined}
                className={cn(
                  "max-w-[86%] rounded-[12px] px-2.5 py-1.5 text-left leading-relaxed whitespace-pre-wrap",
                  "max-md:px-3 max-md:py-2",
                  /*
                   * Each branch carries its own size, because the base cannot.
                   * It used to: `text-[11.5px]` for every bubble, with the
                   * system row asking for `text-[10.5px]` underneath — and `cn`
                   * is `clsx`, so both classes landed and the stylesheet
                   * decided. Tailwind writes `text-[11.5px]` after
                   * `text-[10.5px]`, so the note saying which block a run
                   * reached rendered at the same size as the customer's own
                   * message, which is the one thing it was not meant to do.
                   */
                  item.from === "user"
                    ? "self-end text-[11.5px] max-md:text-[15px]"
                    : item.from === "bot"
                      ? "self-start text-[11.5px] max-md:text-[15px]"
                      : "self-center bg-transparent text-center text-[10.5px] max-md:text-[13px]",
                  item.nodeId ? "cursor-pointer" : "cursor-default",
                )}
                style={
                  item.from === "system"
                    ? { color: META_TEXT }
                    : { background: item.from === "user" ? OWN_BUBBLE_BG : BUBBLE_BG, color: BUBBLE_TEXT }
                }
              >
                {item.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-neutral-800 p-2.5 max-md:p-3">
        {/* The runtime is on the other side of a request now, so the two states
            that were impossible before — waiting, and refused — have to be
            visible. Silence would read as a flow that simply stops. */}
        {failure && (
          <div className="mb-2 rounded-md bg-danger-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-danger-fg max-md:text-[13px]">
            {failure}
          </div>
        )}
        {busy && !failure && (
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-neutral-500 max-md:text-[13px]">
            <Icon name="arrow-clockwise" size={11} className="animate-spin" /> Runtime javobini kutmoqda…
          </div>
        )}

        {state?.options.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {state.options.map((option) => (
              <button
                key={option.port}
                type="button"
                onClick={() => void press(option)}
                className="cursor-pointer rounded-md bg-neutral-800 px-2.5 py-1.5 text-[11.5px] text-neutral-200 hover:bg-neutral-700 max-md:px-3.5 max-md:py-2.5 max-md:text-[15px]"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {state?.done ? (
          <button
            type="button"
            onClick={restart}
            className="w-full cursor-pointer rounded-md bg-accent-700 py-2 text-[12px] text-white hover:bg-accent-600 max-md:py-3 max-md:text-[15px]"
          >
            Qayta boshlash
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim()) void reply({ text: draft });
            }}
            className="flex items-center gap-1.5"
          >
            <input
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={state?.expectsText ? "Javobingizni yozing…" : "Xabar yozing…"}
              className="min-w-0 flex-1 rounded-md border border-transparent bg-neutral-800 px-2.5 py-1.5 text-[11.5px] text-text placeholder:text-neutral-600 focus-visible:border-accent-500 focus-visible:outline-none max-md:px-3 max-md:py-2.5 max-md:text-[16px]"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-accent-700 text-white hover:bg-accent-600 disabled:cursor-default disabled:bg-neutral-800 disabled:text-neutral-600 max-md:h-11 max-md:w-11"
            >
              <Icon name="paper-plane-tilt" size={13} />
            </button>
          </form>
        )}
      </div>
    </>
  );

  // On a phone the panel *is* the screen: a 272px dock beside a list that is
  // itself 390px wide leaves neither the flow nor the chat readable, and the
  // composer — the one control this panel exists for — ends up under the
  // on-screen keyboard. `Modal` is where a sheet's shape is decided for the
  // whole product (`100dvh`, the safe-area inset, the grab handle), so this
  // borrows it rather than growing a second one.
  if (phone) {
    return (
      <Modal open onClose={close} labelledBy="test-chat-title">
        {panel}
      </Modal>
    );
  }

  return (
    <div
      className="animate-rise absolute top-[14px] right-[14px] bottom-[14px] z-[11] flex flex-col overflow-hidden rounded-[14px] bg-overlay/95 shadow-lg backdrop-blur-lg"
      style={{ width: isNarrow ? 272 : 320 }}
    >
      {panel}
    </div>
  );
}

/**
 * "Sinash", where a thumb reaches it.
 *
 * The toolbar is the top of the screen — the one place a hand holding a phone
 * cannot get to — and on a 390px screen it has no room for the button anyway.
 * The same panel, the same run, the same name: only the control moved. It
 * stands down while the panel is open, because a floating button over a
 * full-screen sheet is a second way to do what is already happening.
 */
export function TestChatFab() {
  const phone = usePhoneViewport();
  const open = useFlowEditorStore((s) => s.testChatOpen);
  const openTestChat = useFlowEditorStore((s) => s.openTestChat);

  if (!phone || open) return null;

  // Telegram's own button rather than a floating pill over the list: the pill
  // sat on top of the last step and had to be scrolled out from under, which is
  // the failure a MainButton does not have — it is outside the page entirely.
  return <MainButton text="Sinash" onClick={() => openTestChat()} />;
}
