"use client";

import { useLayoutEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils/cn";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowButton, FlowNode } from "@/features/flows";
import { setTranslation, translationOf } from "@/features/flows/localized-text";
import type { SimpleRow } from "../../lib/validate-graph";
import { buttonKindMeta, buttonPortId, createFlowButton } from "../../lib/buttons";
import { getContentDefinition, nodeContentKind } from "../../lib/message-content";
import { triggerCardSummary } from "../../lib/trigger";
import { hasBackRow, isFixedNodeType } from "../../node-registry";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { branchSize, chipPorts, namedPorts, type ScreenHop } from "./chat-screens";
import { nodeDefinitionOrNull, stepHeadline, variableLabel } from "./step-meta";

/**
 * A textarea that grows with what is typed into it, so a bubble is as tall as
 * the message it holds — the way the customer will see it — and never a box
 * with a scrollbar inside a page that already scrolls.
 */
function GrowingText({
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    // A narrower column wraps the same words onto more lines — a phone turned
    // sideways, a panel opening beside the chat — so the height follows the
    // width as well as the text.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-neutral-500",
        className,
      )}
    />
  );
}

/** What the customer taps into a branch with — shown at the top of the screen it opens. */
export function hopLabel(node: FlowNode | undefined, port: string, main: BotLanguage): string {
  if (!node) return "";
  return namedPorts(node, main).find((candidate) => candidate.id === port)?.label || "Tugma";
}

/** The customer's side of the chat: what they send or tap to get here. */
export function CustomerBubble({ text, onClick }: { text: string; onClick?: () => void }) {
  const content = <span className="block text-[15px] leading-snug break-words whitespace-pre-wrap">{text}</span>;
  return (
    <div className="flex justify-end">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="oq-press max-w-[80%] cursor-pointer rounded-[18px] rounded-br-[6px] bg-accent-700 px-3.5 py-2 text-left text-white"
        >
          {content}
        </button>
      ) : (
        <div className="max-w-[80%] rounded-[18px] rounded-br-[6px] bg-accent-700 px-3.5 py-2 text-white">{content}</div>
      )}
    </div>
  );
}

/** The entry of a flow, read as the customer's first message: "/start", a keyword, a join. */
export function EntryBubble({ node }: { node: FlowNode }) {
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const text = node.type === "start" ? "/start" : triggerCardSummary(node) || "Mijoz yozganda";
  return (
    <div className="flex flex-col items-end gap-1" data-step-id={node.id}>
      <CustomerBubble text={text} onClick={() => expandNode(node.id)} />
      <span className="t-caption t-tertiary pr-1">
        {node.type === "start" ? "Mijoz botni ochadi" : "Mijoz shunday yozsa, bot javob beradi"}
      </span>
    </div>
  );
}

/**
 * One thing the bot does, drawn as it arrives in Telegram.
 *
 * What the customer reads is written *on the bubble itself*: the message text
 * and the button labels are fields, not previews of fields in a form elsewhere.
 * Everything else — the file, the answer type, the rules of a condition — sits
 * behind the ⚙, so building the common bot is typing into a chat, not filling
 * in settings.
 */
export function ChatStep({
  node,
  index,
  row,
  onOpen,
  onPickReturn,
}: {
  node: FlowNode;
  index: number;
  row: SimpleRow;
  /** Opens the screen behind one of this step's exits. */
  onOpen: (hop: ScreenHop) => void;
  /** Asks where one of this step's exits goes back to. */
  onPickReturn: (at: ScreenHop) => void;
}) {
  const main = useFlowEditorStore((s) => s.botLanguages?.main ?? "uz");
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const patchNode = useFlowEditorStore((s) => s.patchNode);
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const reorderSimpleStep = useFlowEditorStore((s) => s.reorderSimpleStep);
  const removeSimpleStep = useFlowEditorStore((s) => s.removeSimpleStep);

  const definition = nodeDefinitionOrNull(node.type);
  const count = row.steps.length;
  const kind = nodeContentKind(node);
  const content = getContentDefinition(kind);
  // The two blocks whose words *are* the step: a message, and a question.
  const speaks = (node.type === "message" || node.type === "question") && content.bodyRole !== "none";
  const keyboard = !!definition?.hasButtons && content.supportsButtons;
  const ports = new Set(namedPorts(node, main).map((port) => port.id));
  const chips = chipPorts(node, main);

  function setText(value: string) {
    patchNode(node.id, { text: setTranslation(node.text, main, value, main) });
  }

  function setButtons(buttons: FlowButton[]) {
    patchNode(node.id, { buttons });
  }

  function addButton() {
    const buttons = node.buttons ?? [];
    setButtons([...buttons, { ...createFlowButton(), label: `Tugma ${buttons.length + 1}` }]);
  }

  function relabel(button: FlowButton, label: string) {
    const next = setTranslation(button.label, main, label, main);
    setButtons((node.buttons ?? []).map((candidate) => (candidate.id === button.id ? { ...candidate, label: next } : candidate)));
  }

  // «Orqaga» belongs on the bubble, next to the buttons it sits under — not two
  // levels deep in a settings sheet, behind a keyboard type that has to be
  // picked first. Adding it wires it to the message this one came from (see
  // `patchNode`), so one tap is the whole job.
  const backAddable = !hasBackRow(node) && (keyboard || !!definition?.hasBackRowOnly);

  function addBack() {
    patchNode(node.id, { back: "" });
  }

  function removeButton(button: FlowButton) {
    setButtons((node.buttons ?? []).filter((candidate) => candidate.id !== button.id));
  }

  const tools = (
    /* On a phone four 44px targets beside a bubble leave the bubble a third of
       the screen, so there they sit under it and only while the step is being
       worked on — tapping into its text is what brings them up. */
    <div className="flex flex-none items-center self-end opacity-0 transition-opacity group-hover/step:opacity-100 group-focus-within/step:opacity-100 pointer-coarse:opacity-100 max-md:hidden max-md:group-focus-within/step:flex md:self-start">
      <IconButton icon="gear" label="Sozlamalar" size={28} onClick={() => expandNode(node.id)} />
      {count > 1 && (
        <>
          <IconButton
            icon="caret-up"
            label="Yuqoriga"
            size={28}
            disabled={index === 0}
            onClick={() => reorderSimpleStep(node.id, index - 1, row)}
          />
          <IconButton
            icon="caret-down"
            label="Pastga"
            size={28}
            disabled={index === count - 1}
            onClick={() => reorderSimpleStep(node.id, index + 1, row)}
          />
        </>
      )}
      {!isFixedNodeType(node.type) && (
        <IconButton icon="trash" label="O'chirish" size={28} onClick={() => removeSimpleStep(node.id)} />
      )}
    </div>
  );

  return (
    <div className="group/step flex flex-col gap-1.5" data-step-id={node.id}>
      <div className="flex flex-col gap-1 md:flex-row md:items-start">
        <div className="flex w-full min-w-0 max-w-[440px] flex-col gap-1.5 md:flex-1">
          {speaks ? (
            <div className="overflow-hidden rounded-[18px] rounded-bl-[6px] border border-neutral-800 bg-surface">
              {content.needsFile && (
                <button
                  type="button"
                  onClick={() => expandNode(node.id)}
                  className="flex w-full cursor-pointer items-center gap-2.5 border-b border-neutral-800 bg-neutral-850 px-3.5 py-3 text-left hover:bg-neutral-800"
                >
                  <Icon name={content.icon} size={20} className="flex-none text-neutral-400" />
                  <span className="min-w-0 flex-1">
                    <span className="t-subhead block truncate text-text">{content.label}</span>
                    <span className="t-footnote t-tertiary block truncate">
                      {node.mediaSource?.fileName || node.mediaSource?.value || "Fayl tanlanmagan — tanlash uchun bosing"}
                    </span>
                  </span>
                </button>
              )}
              <div className="px-3.5 py-2.5">
                <GrowingText
                  label={node.type === "question" ? "Savol matni" : "Xabar matni"}
                  value={translationOf(node.text, main, main)}
                  onChange={setText}
                  placeholder={
                    node.type === "question"
                      ? "Savolni yozing… masalan: Ismingiz nima?"
                      : content.bodyRole === "caption"
                        ? "Izoh (ixtiyoriy)"
                        : "Xabar matnini yozing…"
                  }
                  className="text-[15px] leading-snug text-text"
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => expandNode(node.id)}
              className="flex cursor-pointer items-center gap-2.5 rounded-[14px] border border-dashed border-neutral-700 bg-neutral-850 px-3 py-2.5 text-left hover:border-neutral-600"
            >
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-neutral-700 bg-surface"
                style={{ color: definition?.color }}
              >
                <Icon name={definition?.icon ?? "flow-arrow"} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-caption t-tertiary block">{definition?.kindLabel ?? node.type}</span>
                <span className="t-subhead line-clamp-2 block text-text">{stepHeadline(node, main)}</span>
              </span>
              <Icon name="caret-right" size={13} className="flex-none text-neutral-600" />
            </button>
          )}


          {keyboard && (
            <div className="flex flex-col gap-1">
              {(node.buttons ?? []).map((button) => {
                const port = buttonPortId(button.id);
                const branches = ports.has(port);
                const size = branches ? branchSize(nodes, edges, node.id, port) : 0;
                return (
                  <div
                    key={button.id}
                    className="group/button flex items-center gap-1 rounded-[12px] border border-neutral-800 bg-neutral-850 pl-3"
                  >
                    {!branches && (
                      <Icon name={buttonKindMeta(button.kind).icon} size={13} className="flex-none text-neutral-500" />
                    )}
                    <input
                      value={translationOf(button.label, main, main)}
                      onChange={(event) => relabel(button, event.target.value)}
                      aria-label="Tugma nomi"
                      placeholder="Tugma nomi"
                      className="min-w-0 flex-1 bg-transparent py-2 text-center text-[14px] text-accent-300 outline-none placeholder:text-neutral-600"
                    />
                    <IconButton
                      icon="x"
                      label="Tugmani o'chirish"
                      size={24}
                      className="opacity-0 group-hover/button:opacity-100 pointer-coarse:opacity-100"
                      onClick={() => removeButton(button)}
                    />
                    {branches && (
                      <button
                        type="button"
                        onClick={() => onOpen({ nodeId: node.id, port })}
                        title="Bu tugma bosilganda nima bo'ladi"
                        className="oq-press flex flex-none cursor-pointer items-center gap-1 self-stretch rounded-r-[12px] border-l border-neutral-800 px-2.5 text-neutral-400 hover:bg-neutral-800 hover:text-text"
                      >
                        <span className="t-caption tabular-nums">{size ? `${size} qadam` : "bo'sh"}</span>
                        <Icon name="caret-right" size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={addButton}
                  className="oq-press t-footnote flex min-h-[36px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-neutral-800 text-neutral-500 hover:border-accent-700 hover:text-accent-300"
                >
                  <Icon name="plus" size={13} /> Tugma qo&apos;shish
                </button>
                {backAddable && <AddBackButton onClick={addBack} />}
              </div>
            </div>
          )}
          {!keyboard && backAddable && <AddBackButton onClick={addBack} />}

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((port) => {
                // «Orqaga» is not a new part of the conversation, it is the way
                // to an earlier one — so it names where it goes and is pointed
                // there, instead of opening an empty screen to write in.
                if (port.kind === "back") {
                  const to = edges.find((edge) => edge.from === node.id && edge.port === port.id)?.to;
                  const target = to ? nodes.find((candidate) => candidate.id === to) : undefined;
                  return (
                    <button
                      key={port.id}
                      type="button"
                      onClick={() => onPickReturn({ nodeId: node.id, port: port.id })}
                      className={cn(
                        "oq-press t-footnote flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border px-3",
                        target
                          ? "border-neutral-800 bg-neutral-850 text-neutral-300 hover:border-neutral-600"
                          : "border-warning-fg bg-warning-bg text-warning-fg",
                      )}
                    >
                      {port.label || "Orqaga"}
                      <span className={target ? "t-tertiary" : ""}>
                        {target ? `→ «${target.title || "xabar"}»` : "— qayerga? tanlang"}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Orqaga tugmasini olib tashlash"
                        title="Olib tashlash"
                        onClick={(event) => {
                          event.stopPropagation();
                          patchNode(node.id, { back: undefined });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          patchNode(node.id, { back: undefined });
                        }}
                        className="-mr-1 ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-800 hover:text-text"
                      >
                        <Icon name="x" size={11} />
                      </span>
                    </button>
                  );
                }
                const size = branchSize(nodes, edges, node.id, port.id);
                return (
                  <button
                    key={port.id}
                    type="button"
                    onClick={() => onOpen({ nodeId: node.id, port: port.id })}
                    className="oq-press t-footnote flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-850 px-3 text-neutral-300 hover:border-neutral-600"
                  >
                    {port.label || "Keyingi"}
                    <span className="t-caption t-tertiary tabular-nums">{size ? `${size} qadam` : "bo'sh"}</span>
                    <Icon name="caret-right" size={12} className="text-neutral-500" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {tools}
      </div>

      {/* The customer's turn, drawn where it happens: a question is answered
          before the chat goes on, and where that answer is kept is part of
          what the author is deciding. */}
      {node.type === "question" && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => expandNode(node.id)}
            className="oq-press flex max-w-[80%] cursor-pointer flex-col items-end rounded-[18px] rounded-br-[6px] border border-dashed border-accent-800 px-3.5 py-2 text-right hover:border-accent-600"
          >
            <span className="text-[15px] text-accent-300 italic">Mijoz javob yozadi</span>
            <span className="t-caption t-tertiary">
              {node.saveAnswerAs ? `«${variableLabel(node.saveAnswerAs)}» sifatida saqlanadi` : "Javob saqlanmaydi — ⚙ da tanlang"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function AddBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Mijoz avvalgi xabarga qaytishi uchun"
      className="oq-press t-footnote flex min-h-[36px] cursor-pointer items-center justify-center gap-1.5 self-start rounded-[12px] border border-dashed border-neutral-800 px-3 text-neutral-500 hover:border-accent-700 hover:text-accent-300"
    >
      <Icon name="arrow-counter-clockwise" size={13} /> Orqaga
    </button>
  );
}
