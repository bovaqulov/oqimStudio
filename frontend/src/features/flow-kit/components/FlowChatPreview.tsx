"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  BUBBLE_BG,
  BUBBLE_TEXT,
  CHAT_BG,
  CHAT_BORDER,
  LINK,
  META_TEXT,
  OWN_BUBBLE_BG,
} from "@/features/flow-builder/components/preview/telegram-colors";
import { replyToSimulation, simulationStarts, startSimulation, type SimState } from "@/features/flow-builder/lib/simulate";
import { toChatState, type ChatState } from "@/features/flow-builder/lib/test-session";
import type { FlowEdge, FlowNode } from "@/features/flows";
// Straight from the action module rather than the feature barrel: the barrel
// also re-exports the repository, which is server-only.
import { replyFlowTestAction, startFlowTestAction } from "@/features/flows/runtime-actions";
import { cn } from "@/lib/utils/cn";

/**
 * The flow, walked the way a customer walks it.
 *
 * A flow that exists is walked by the **backend runtime** — the same engine a
 * Telegram update goes through. That matters more than it sounds: the browser
 * simulator does not validate answers, so a phone question accepted "abc" here
 * and rejected it in the real chat, and a test chat that disagrees with the bot
 * is worse than no test chat at all.
 *
 * `flowId` is what decides. Without one there is nothing saved to run — the
 * wizard and the gallery are previewing a blueprint that does not exist yet —
 * so those fall back to the local walk-through and say so on the header.
 *
 * Every colour comes from `telegram-colors` rather than from the studio's
 * tokens: this is a picture of Telegram, it stays dark in both themes, and text
 * painted with a theme token would go dark-on-dark the moment the studio is
 * switched to light.
 */
export function FlowChatPreview({
  nodes,
  edges,
  /** The saved flow to run. Omitted by callers previewing an unsaved blueprint. */
  flowId,
  /** Remounts the session when the graph the caller is editing changes shape. */
  resetKey,
  className,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  flowId?: string;
  resetKey?: string;
  className?: string;
}) {
  const starts = useMemo(() => simulationStarts(nodes), [nodes]);
  const startId = starts[0]?.id ?? "";

  if (flowId) {
    return <RuntimeSession key={`${resetKey ?? ""}:${flowId}`} flowId={flowId} nodes={nodes} className={className} />;
  }

  return (
    <PreviewSession
      key={`${resetKey ?? ""}:${startId}`}
      nodes={nodes}
      edges={edges}
      startId={startId}
      className={className}
    />
  );
}

/**
 * The flow on the real engine. Every turn is a round trip: the runtime decides
 * what the bot says, whether the answer was accepted and where the run parks —
 * this component only draws it.
 */
function RuntimeSession({
  flowId,
  nodes,
  className,
}: {
  flowId: string;
  nodes: FlowNode[];
  className?: string;
}) {
  const [state, setState] = useState<ChatState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  /** Bumped by "Boshidan" — a new run rather than a continuation of this one. */
  const [attempt, setAttempt] = useState(0);

  // One run per session. The answer arrives after an await, and a dialog the
  // reader closed mid-request must not set state on the way out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await startFlowTestAction(flowId);
      if (cancelled) return;
      setBusy(false);
      if (result.ok) setState(toChatState(result.run, nodes));
      else setError(result.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [flowId, nodes, attempt]);

  function restart() {
    setBusy(true);
    setError("");
    setState(null);
    setAttempt((n) => n + 1);
  }

  async function reply(next: { port?: string; text?: string }) {
    const runId = state?.runId;
    if (!runId || busy) return;
    setBusy(true);
    const result = await replyFlowTestAction(flowId, runId, next);
    if (result.ok) setState(toChatState(result.run, nodes));
    else setError(result.message);
    setBusy(false);
  }

  return (
    <ChatShell
      className={className}
      note="Telegram · haqiqiy runtime"
      empty={nodes.length === 0}
      bubbles={state?.bubbles ?? []}
      options={state?.options ?? []}
      expectsText={state?.expectsText ?? false}
      done={state?.done ?? false}
      busy={busy}
      error={error || state?.error || ""}
      onRestart={restart}
      onReply={(next) => void reply(next)}
    />
  );
}

/** The blueprint walk-through: no flow exists yet, so nothing can run it. */
function PreviewSession({
  nodes,
  edges,
  startId,
  className,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  startId: string;
  className?: string;
}) {
  const [state, setState] = useState<SimState | null>(() =>
    startId ? startSimulation(nodes, edges, startId) : null,
  );

  return (
    <ChatShell
      className={className}
      note="Namuna · oqim hali saqlanmagan"
      empty={nodes.length === 0}
      bubbles={state?.bubbles ?? []}
      options={state?.options ?? []}
      expectsText={state?.expectsText ?? false}
      done={state?.done ?? false}
      busy={false}
      error=""
      onRestart={() => setState(startId ? startSimulation(nodes, edges, startId) : null)}
      onReply={(next) => setState((current) => (current ? replyToSimulation(current, nodes, edges, next) : current))}
    />
  );
}

/**
 * The chat itself — bubbles, the keyboard under them, the composer.
 *
 * Deliberately dumb: whether a turn was decided by the runtime or by the local
 * walk-through, the customer's view of it is the same, and one component
 * drawing both is what keeps them looking the same.
 */
function ChatShell({
  note,
  empty,
  bubbles,
  options,
  expectsText,
  done,
  busy,
  error,
  onReply,
  onRestart,
  className,
}: {
  note: string;
  empty: boolean;
  bubbles: { id: string; from: "bot" | "user" | "system"; text: string }[];
  options: { label: string; port: string }[];
  expectsText: boolean;
  done: boolean;
  busy: boolean;
  error: string;
  onReply: (next: { port?: string; text?: string }) => void;
  onRestart: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  function reply(next: { port?: string; text?: string }) {
    onReply(next);
    setDraft("");
  }

  return (
    <div
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-[12px]", className)}
      style={{ background: CHAT_BG }}
    >
      <div className="flex flex-none items-center gap-2 border-b px-3 py-2" style={{ borderColor: CHAT_BORDER }}>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: OWN_BUBBLE_BG, color: BUBBLE_TEXT }}
        >
          <Icon name="telegram-logo" size={13} />
        </span>
        <span className="flex-1 truncate text-[11.5px] max-md:text-[13px]" style={{ color: META_TEXT }}>
          {note}
        </span>
        <button
          type="button"
          onClick={() => {
            onRestart();
            setDraft("");
          }}
          className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[10.5px] max-md:text-[12px] transition-opacity hover:opacity-100"
          style={{ color: LINK, opacity: 0.85 }}
        >
          <Icon name="arrow-counter-clockwise" size={11} /> Boshidan
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {empty ? (
          <div className="px-2 py-8 text-center text-[11.5px] max-md:text-[13px] leading-relaxed" style={{ color: META_TEXT }}>
            Oqim hali bo&apos;sh — qadam qo&apos;shsangiz suhbat shu yerda ko&apos;rinadi.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {bubbles.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "animate-rise max-w-[88%] rounded-[13px] px-2.5 py-1.5 leading-relaxed whitespace-pre-wrap",
                  /*
                   * The size belongs to each branch and not to the line above.
                   * It used to sit in the base — `text-[11.5px]` for everyone,
                   * with the system row asking for `text-[10.5px]` underneath —
                   * and `cn` is `clsx`, so both landed and the stylesheet chose.
                   * Measured in the built CSS: `text-[11.5px]` comes after
                   * `text-[10.5px]`, so the system note rendered at the bubble's
                   * size and had done since it was written. Nothing warned,
                   * because nothing was wrong except the assumption that the
                   * later class in the call wins.
                   */
                  item.from === "user"
                    ? "self-end text-[11.5px] max-md:text-[13px]"
                    : item.from === "bot"
                      ? "self-start text-[11.5px] max-md:text-[13px]"
                      : "self-center bg-transparent text-center text-[10.5px] max-md:text-[12px]",
                )}
                style={
                  item.from === "system"
                    ? { color: META_TEXT }
                    : { background: item.from === "user" ? OWN_BUBBLE_BG : BUBBLE_BG, color: BUBBLE_TEXT }
                }
              >
                {item.text}
              </div>
            ))}
            {error && (
              <div className="self-center px-2 py-1 text-center text-[10.5px] max-md:text-[12px]" style={{ color: "#e08a8a" }}>
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {!empty && (
        <div className="flex-none border-t p-2" style={{ borderColor: CHAT_BORDER }}>
          {options.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {options.map((option) => (
                <button
                  key={option.port}
                  type="button"
                  disabled={busy}
                  onClick={() => reply({ port: option.port })}
                  className="cursor-pointer rounded-md px-2.5 py-1.5 text-[11.5px] max-md:text-[13px] transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
                  style={{ background: BUBBLE_BG, color: LINK }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          {done ? (
            <button
              type="button"
              onClick={() => {
                onRestart();
                setDraft("");
              }}
              className="w-full cursor-pointer rounded-md py-1.5 text-[11.5px] max-md:text-[13px] transition-opacity hover:opacity-90"
              style={{ background: OWN_BUBBLE_BG, color: BUBBLE_TEXT }}
            >
              Yana bir marta sinash
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim()) reply({ text: draft });
              }}
              className="flex items-center gap-1.5"
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  busy ? "Runtime javobini kutmoqda…" : expectsText ? "Javobingizni yozing…" : "Mijoz nomidan yozing…"
                }
                aria-label="Sinov xabari"
                className="min-w-0 flex-1 rounded-md border border-transparent px-2.5 py-1.5 text-[11.5px] max-md:text-[13px] focus-visible:outline-none"
                style={{ background: BUBBLE_BG, color: BUBBLE_TEXT }}
              />
              <button
                type="submit"
                disabled={!draft.trim() || busy}
                aria-label="Yuborish"
                className="flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full transition-opacity disabled:cursor-default disabled:opacity-50"
                style={{
                  background: draft.trim() ? OWN_BUBBLE_BG : BUBBLE_BG,
                  color: draft.trim() ? BUBBLE_TEXT : META_TEXT,
                }}
              >
                <Icon name="paper-plane-tilt" size={13} />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
