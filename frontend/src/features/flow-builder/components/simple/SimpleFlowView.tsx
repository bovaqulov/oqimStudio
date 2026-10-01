"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils/cn";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowNode, NodeType } from "@/features/flows";
import type { SimpleRow } from "../../lib/validate-graph";
import { buttonIdFromPort } from "../../lib/buttons";
import { acceptsIncomingEdge, getPaletteNodeTypes, isFixedNodeType } from "../../node-registry";
import type { FlowLinkOption } from "../Inspector/fields/FlowLinkField";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { AddStepSheet } from "./AddStepSheet";
import { ChatStep, CustomerBubble, EntryBubble, hopLabel } from "./ChatStep";
import { continuesInLine, entrySections, looseRows, namedPorts, openScreen, type ScreenHop } from "./chat-screens";
import { StepSheet } from "./StepSheet";

type Exit = { nodeId: string; port: string };

/** The three things almost every step is, one tap each — everything else is behind «Boshqa». */
const QUICK_ADD: { key: string; label: string; icon: IconName; type: NodeType; patch?: Partial<FlowNode>; sheet: boolean }[] = [
  { key: "message", label: "Xabar", icon: "chat-teardrop-text", type: "message", sheet: false },
  { key: "question", label: "Savol", icon: "question", type: "question", sheet: false },
  { key: "media", label: "Rasm / fayl", icon: "image", type: "message", patch: { contentKind: "photo" }, sheet: true },
];

/**
 * Simple mode: the flow as the chat the customer will have.
 *
 * The customer's side on the right, the bot's on the left, top to bottom in
 * the order it happens. The bot's words are typed straight into its bubbles;
 * a button is added under a message and tapping its › opens what that button
 * leads to as the next screen — the way tapping it in Telegram would. Nothing
 * nests, so nothing is ever too deep to show, and there is no canvas, no
 * palette and no form to learn before the first message is written.
 *
 * Pro mode is the same graph drawn as a canvas; nothing is converted between
 * the two. Every block type can still be added here («Boshqa») and configured
 * here (⚙), in the same fields Pro uses.
 */
export function SimpleFlowView({ siblingFlows }: { siblingFlows: FlowLinkOption[] }) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  const main = useFlowEditorStore((s) => s.botLanguages?.main ?? "uz");
  const readOnly = useFlowEditorStore((s) => s.readOnly);
  const spliceSimpleStep = useFlowEditorStore((s) => s.spliceSimpleStep);
  const linkSimpleStep = useFlowEditorStore((s) => s.linkSimpleStep);
  const collapseNode = useFlowEditorStore((s) => s.collapseNode);
  const addNode = useFlowEditorStore((s) => s.addNode);

  const [path, setPath] = useState<ScreenHop[]>([]);
  const [sheetAt, setSheetAt] = useState<(Exit & { returnOnly?: boolean }) | null>(null);
  const focusId = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const sections = useMemo(() => entrySections(nodes, edges), [nodes, edges]);
  const loose = useMemo(() => looseRows(nodes, edges), [nodes, edges]);
  const opened = useMemo(() => openScreen(nodes, edges, path, main), [nodes, edges, path, main]);

  // A step added with a quick button is written in place: its bubble takes
  // the cursor as soon as it is on screen, instead of a sheet opening over it.
  useEffect(() => {
    if (!focusId.current) return;
    const field = document.querySelector<HTMLTextAreaElement>(`[data-step-id="${CSS.escape(focusId.current)}"] textarea`);
    if (!field) return;
    focusId.current = null;
    field.focus();
    field.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [nodes]);

  // A new screen starts at its top, like a new chat does.
  const depth = opened?.hops.length ?? 0;
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [depth]);

  function quickAdd(at: Exit, choice: (typeof QUICK_ADD)[number]) {
    const id = `n${useFlowEditorStore.getState().nextSeq}`;
    spliceSimpleStep(choice.type, at, choice.patch);
    if (!choice.sheet) {
      collapseNode();
      focusId.current = id;
    }
  }

  function pick(type: NodeType, patch?: Partial<FlowNode>) {
    if (sheetAt) spliceSimpleStep(type, sheetAt, patch);
    setSheetAt(null);
  }

  function link(toNodeId: string) {
    if (sheetAt) linkSimpleStep(sheetAt, toNodeId);
    setSheetAt(null);
  }

  // Where a return can go: every step the author can currently see on the way
  // here — the first screen and each screen opened since.
  const returnable: FlowNode[] = [];
  for (const hop of opened?.hops ?? []) {
    const node = byId.get(hop.nodeId);
    if (node && !returnable.includes(node)) returnable.push(node);
  }
  for (const row of [...sections.map((section) => section.row), ...(opened ? [opened.row] : [])]) {
    for (const step of row.steps) {
      const node = byId.get(step.nodeId);
      if (node && !returnable.includes(node)) returnable.push(node);
    }
  }

  const firstEntry = getPaletteNodeTypes(moduleKey).find((type) => !acceptsIncomingEdge(type) && !isFixedNodeType(type));

  function renderRow(row: SimpleRow, building = true) {
    return (
      <ChatRow
        row={row}
        byId={byId}
        readOnly={readOnly}
        prominent={building}
        main={main}
        onOpen={(hop) => setPath([...(opened?.hops ?? []), hop])}
        onMore={setSheetAt}
        onPickReturn={(at) => setSheetAt({ ...at, returnOnly: true })}
        onQuick={quickAdd}
      />
    );
  }

  const lastHop = opened?.hops[opened.hops.length - 1];
  const lastHopNode = lastHop ? byId.get(lastHop.nodeId) : undefined;

  return (
    <div ref={scroller} className="absolute inset-0 overflow-y-auto">
      {/* Room at the bottom for the floating «Sinash», and on a phone for
          Telegram's own MainButton, which is drawn outside this document. */}
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4 px-4 py-5 max-md:pb-[96px] md:pb-[96px]">
        {opened && lastHop ? (
          <>
            <Breadcrumbs hops={opened.hops} byId={byId} main={main} onGo={(depth) => setPath(opened.hops.slice(0, depth))} />
            {buttonIdFromPort(lastHop.port) ? (
              <CustomerBubble text={hopLabel(lastHopNode, lastHop.port, main)} />
            ) : (
              <div className="t-footnote t-secondary self-center rounded-full bg-neutral-850 px-3 py-1">
                «{lastHopNode?.title || "Blok"}» → {hopLabel(lastHopNode, lastHop.port, main)}
              </div>
            )}
            {renderRow(opened.row)}
          </>
        ) : (
          <>
            {sections.map((section) => (
              <section key={section.entry.id} className="flex flex-col gap-4">
                <EntryBubble node={section.entry} />
                {renderRow(section.row)}
              </section>
            ))}

            {!nodes.length && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="t-headline m-0">Oqim hali bo&apos;sh</p>
                <p className="t-subhead t-secondary m-0 max-w-[340px]">
                  Avval mijoz nima yozganda bot javob berishini tanlang, keyin javobni shu yerda yozasiz.
                </p>
                {firstEntry && !readOnly && (
                  <button
                    type="button"
                    onClick={() => addNode(firstEntry)}
                    className="oq-press t-body min-h-[44px] cursor-pointer rounded-[12px] bg-accent-700 px-5 text-white"
                  >
                    Boshlash
                  </button>
                )}
              </div>
            )}

            {/* Blocks nothing leads to are still the author's work: listed apart,
                not dropped from the only view they have. */}
            {loose.length > 0 && (
              <section className="mt-4 flex flex-col gap-3 border-t border-separator pt-4">
                <h2 className="t-footnote t-secondary m-0">
                  Hech qayerdan ulanmagan — mijoz bularni ko&apos;rmaydi
                </h2>
                {loose.map((row) => (
                  <div key={row.steps[0]?.nodeId} className="flex flex-col gap-3">
                    {renderRow(row, false)}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {sheetAt && (
        <AddStepSheet
          onClose={() => setSheetAt(null)}
          onPick={pick}
          onLink={link}
          returnable={returnable.filter((node) => node.id !== sheetAt.nodeId)}
          returnOnly={sheetAt.returnOnly}
        />
      )}
      <StepSheet siblingFlows={siblingFlows} />
    </div>
  );
}

function Breadcrumbs({
  hops,
  byId,
  main,
  onGo,
}: {
  hops: ScreenHop[];
  byId: Map<string, FlowNode>;
  main: BotLanguage;
  onGo: (depth: number) => void;
}) {
  return (
    <nav className="sticky top-0 z-10 -mx-4 flex items-center gap-1 bg-bg/95 px-2 py-1.5 backdrop-blur">
      <IconButton icon="arrow-left" label="Orqaga" size={34} onClick={() => onGo(hops.length - 1)} />
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <li className="flex-none">
          <button type="button" onClick={() => onGo(0)} className="t-footnote cursor-pointer text-neutral-400 hover:text-text">
            Boshi
          </button>
        </li>
        {hops.map((hop, index) => {
          const last = index === hops.length - 1;
          return (
            <li key={`${hop.nodeId}:${hop.port}`} className="flex min-w-0 flex-none items-center gap-1">
              <Icon name="caret-right" size={11} className="text-neutral-600" />
              <button
                type="button"
                disabled={last}
                onClick={() => onGo(index + 1)}
                className={cn(
                  "t-footnote max-w-[160px] truncate",
                  last ? "cursor-default text-text" : "cursor-pointer text-neutral-400 hover:text-text",
                )}
              >
                {hopLabel(byId.get(hop.nodeId), hop.port, main)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * One run of the chat: its steps, a place to put a step between any two, and
 * the bar that adds the next one.
 */
function ChatRow({
  row,
  byId,
  readOnly,
  prominent,
  main,
  onOpen,
  onMore,
  onPickReturn,
  onQuick,
}: {
  row: SimpleRow;
  byId: Map<string, FlowNode>;
  readOnly: boolean;
  /** A row the reader is building on, rather than one listed as disconnected. */
  prominent: boolean;
  main: BotLanguage;
  onOpen: (hop: ScreenHop) => void;
  onMore: (at: Exit) => void;
  onPickReturn: (at: Exit) => void;
  onQuick: (at: Exit, choice: (typeof QUICK_ADD)[number]) => void;
}) {
  const last = row.steps.length ? byId.get(row.steps[row.steps.length - 1]!.nodeId) : undefined;
  // Where the next step is wired in: after the last step's own exit, or onto
  // the exit that opened this screen when nothing has been written here yet. A
  // block with no `out` — a condition, an ending — does not continue in line.
  const end: Exit | null = last ? (continuesInLine(last, main) ? { nodeId: last.id, port: "out" } : null) : row.head;
  const returnsTo = row.endsAt ? byId.get(row.endsAt) : undefined;

  return (
    <div className="flex flex-col gap-3">
      {row.steps.map((step, index) => {
        const node = byId.get(step.nodeId);
        if (!node) return null;
        const before: Exit | null = index === 0 ? row.head : (() => {
          const previous = byId.get(row.steps[index - 1]!.nodeId);
          return previous && continuesInLine(previous, main) ? { nodeId: previous.id, port: "out" } : null;
        })();
        return (
          <div key={node.id} className="flex flex-col gap-3">
            {before && !readOnly && index > 0 && <InsertHere onClick={() => onMore(before)} />}
            {index > 0 && !before && (
              <p className="t-footnote m-0 rounded-[12px] bg-warning-bg px-3 py-2 text-warning-fg">
                Bu qadamga navbat kelmaydi: yuqoridagi xabar mijoz tugma bosishini kutadi. Uni kerakli
                tugma ichiga ko&apos;chiring yoki o&apos;chiring.
              </p>
            )}
            <ChatStep node={node} index={index} row={row} onOpen={onOpen} onPickReturn={onPickReturn} />
          </div>
        );
      })}

      {!readOnly && end && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5 rounded-[16px] p-1.5",
            prominent ? "border border-neutral-800 bg-surface" : "border border-dashed border-neutral-800",
          )}
        >
          <span className="t-footnote t-tertiary px-1.5">
            {row.steps.length ? "Keyin:" : "Bot javobi:"}
          </span>
          {QUICK_ADD.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => onQuick(end, choice)}
              className="oq-press t-subhead flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[12px] bg-neutral-850 px-3 text-text hover:bg-neutral-800"
            >
              <Icon name={choice.icon} size={15} className="text-accent-400" />
              {choice.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onMore(end)}
            className="oq-press t-subhead flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[12px] px-3 text-neutral-400 hover:bg-neutral-850 hover:text-text"
          >
            <Icon name="dots-three" size={15} />
            Boshqa
          </button>
        </div>
      )}

      {returnsTo && (
        <div className="t-footnote t-tertiary flex items-center gap-1.5">
          <Icon name="arrow-counter-clockwise" size={13} className="flex-none" />
          So&apos;ng «{returnsTo.title || "yuqoridagi xabar"}» ga qaytadi
        </div>
      )}

      {!end && last && !returnsTo && (
        <p className="t-footnote t-tertiary m-0">
          {namedPorts(last, main).some((port) => port.kind !== "back")
            ? "Davomi tugmalar ichida — › ni bosing"
            : namedPorts(last, main).length
              ? "Mijoz «Orqaga» ni bosguncha shu yerda kutadi"
              : "Suhbat shu yerda tugaydi"}
        </p>
      )}
    </div>
  );
}

/** The gap between two steps, offered as a place to put one. Quiet until pointed at. */
function InsertHere({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Shu yerga qadam qo'shish"
      title="Shu yerga qadam qo'shish"
      className="group/insert -my-2 flex h-4 cursor-pointer items-center gap-2 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-60"
    >
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border border-dashed border-neutral-600 text-neutral-400 group-hover/insert:border-accent-600 group-hover/insert:text-accent-400">
        <Icon name="plus" size={9} />
      </span>
      <span className="h-px flex-1 bg-neutral-800 group-hover/insert:bg-accent-800" />
    </button>
  );
}
