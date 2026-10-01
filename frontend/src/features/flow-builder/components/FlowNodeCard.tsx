"use client";

import { memo, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/icon-names";
import { cn } from "@/lib/utils/cn";
import type { FlowNode } from "@/features/flows";
import { resolveText } from "@/features/flows/localized-text";
import { buttonKindMeta, effectiveButtonMode, isRoutableButton, nodeButtons } from "../lib/buttons";
import { effectivePriority, isPriorityOverridden } from "../lib/trigger";
import {
  BACK_ROW_LABEL,
  BUTTON_ROWS_BOTTOM_PAD,
  BUTTON_ROWS_TOP_PAD,
  BUTTON_ROW_HEIGHT,
  CARD_GAP,
  CARD_ICON,
  CARD_PAD_X,
  acceptsIncomingEdge,
  backRowReachesTelegram,
  buttonRowsHeight,
  hasBackRow,
  getNodeDefinition,
  getNodePorts,
  nodeHeight,
  nodeInputDy,
  nodeWidth,
  type NodePortKind,
} from "../node-registry";
import { useBotMainLanguage } from "./Inspector/fields/TextLanguage";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

const CARD_BG = "var(--color-surface)";
/** Port dot diameter; halved to centre each dot on its anchor. */
const PORT = 10;
/** Port colours by kind — the same three tones the edges are drawn in. */
const PORT_COLOR: Record<NodePortKind, string> = {
  out: "var(--color-neutral-600)",
  yes: "#5f9c7c",
  no: "#a08b5c",
  button: "var(--color-accent-500)",
  // Muted, and deliberately not the accent the author's own keys wear: the
  // back row is a way out of the block rather than one of the choices in it.
  back: "var(--color-neutral-500)",
  // Blue rather than another shade of the amber "no" wears: an agent asking
  // for a person is the flow working, not the flow failing, and a reader
  // scanning a canvas for what went wrong should not stop here.
  escalate: "#6d8fd0",
};
const PORT_GLOW: Record<NodePortKind, string> = {
  out: "var(--color-accent-400)",
  yes: "#5f9c7c",
  no: "#a08b5c",
  button: "var(--color-accent-400)",
  back: "var(--color-neutral-400)",
  escalate: "#6d8fd0",
};
/**
 * Corner rounding, capped so the curve never reaches further inward than the
 * card's horizontal padding — past that the rounded edge starts clipping the
 * first and last lines of text.
 */
const MAX_RADIUS = 30;

/**
 * Inset of the "Ha"/"Yo'q" caption from the card's right edge — clear of the
 * dot it names, which straddles that edge by half its own width.
 */
const BRANCH_LABEL_INSET = 12;

/**
 * The block's icon on a soft tint of its own colour.
 *
 * A bare glyph in the block's colour was legible and said nothing: at 13px the
 * hue is a few coloured pixels, so every card read as the same grey row with a
 * different word on it. Sitting the glyph on a rounded square filled with ~14%
 * of the same colour gives each type a shape the eye catches before it reads —
 * the block type becomes scannable down a column of cards.
 *
 * The tint is mixed from the definition's own colour rather than listed, so a
 * type that is recoloured stays consistent with itself and there is no second
 * table to keep in step. `color-mix` against `transparent` keeps it honest in
 * both themes: the same 14% lands as a dark wash on the dark canvas and a pale
 * one on the light theme's white card, with no per-theme branch here.
 */
function IconChip({ name, color }: { name: IconName; color: string }) {
  return (
    <span
      className="flex flex-none items-center justify-center"
      style={{
        // 34 against a 66px card: big enough to be the thing the eye lands on
        // first, with room left for the name beside it on the narrowest block.
        // Read from the constant `nodeWidth` measures with, not typed again
        // here: the card and the width it is given have to agree about how much
        // of the title row the icon takes, and they have disagreed before.
        width: CARD_ICON,
        height: CARD_ICON,
        borderRadius: 10,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      <Icon name={name} size={19} style={{ color }} />
    </span>
  );
}

/**
 * Memoised on purpose: dragging one block hands the canvas a new `nodes` array
 * every frame, but only the dragged block's own object changes identity, so
 * every other card can skip the whole render. The card still subscribes to the
 * store itself, so selection and connection state reach it regardless.
 */
export const FlowNodeCard = memo(function FlowNodeCard({
  node,
  conflict,
}: {
  node: FlowNode;
  /** Pre-joined by the caller — a string keeps the memo above intact, an array would not. */
  conflict?: string;
}) {
  const selectedIds = useFlowEditorStore((s) => s.selectedIds);
  const primarySelectedId = useFlowEditorStore((s) => s.primarySelectedId);
  const pending = useFlowEditorStore((s) => s.pending);
  // Which side each exit is actually using: a keyboard row leaves by whichever
  // side its target is on (see `portAnchor`), and the dot on the other side has
  // to say it is the unused one rather than pretending both are wired.
  const edges = useFlowEditorStore((s) => s.edges);
  const nodesById = useFlowEditorStore((s) => s.nodes);
  const startNodeInteraction = useFlowEditorStore((s) => s.startNodeInteraction);
  const startConnection = useFlowEditorStore((s) => s.startConnection);
  const completeConnection = useFlowEditorStore((s) => s.completeConnection);
  const select = useFlowEditorStore((s) => s.select);
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const testFlowFromNode = useFlowEditorStore((s) => s.openTestChat);
  // The bot's own language, not the one a text field is open in: the canvas is
  // read as a whole, and cards that changed under a switch in the corner of the
  // Inspector would make the graph look like it had been edited.
  const main = useBotMainLanguage();

  const definition = getNodeDefinition(node.type);
  const height = nodeHeight(node);
  const selected = selectedIds.includes(node.id) || node.id === primarySelectedId;
  const primary = node.id === primarySelectedId;
  // An entry block opens a flow and is never the end of an edge, so it has no
  // input dot and stays dark while a connection is being drawn. Every other
  // node is a valid target — including the one the drag started from, now that
  // self-loops are allowed.
  const acceptsIncoming = acceptsIncomingEdge(node.type);
  const connecting = !!pending && acceptsIncoming;
  const ports = getNodePorts(node, main);
  // Only a Handler shows a priority, because only a Handler has one: it is the
  // order the runtime tries the triggers in, and it says nothing on a block
  // that is never the thing an update is matched against. This used to be read
  // off the trigger sentence the card no longer paints, which computed a whole
  // condition per card per frame to answer a question about the block's type.
  const showsPriority = definition.hasTriggerConfig;
  const priority = effectivePriority(node);
  // The keyboard, one row per button — rows are what the button ports line up with.
  const buttons = nodeButtons(node);
  const buttonMode = effectiveButtonMode(node);
  const rowsHeight = buttonRowsHeight(node);

  const cardStyle: CSSProperties = {
    // Half the height is a full stadium; short blocks reach it, taller ones stop at the cap.
    borderRadius: Math.min(MAX_RADIUS, height / 2),
    background: CARD_BG,
    // Fixed, not minimum: the button ports are placed from this number, so the
    // rows have to land exactly where the geometry says they do.
    height,
    borderColor: connecting || selected ? "var(--color-accent-500)" : "var(--color-neutral-800)",
    boxShadow: primary
      ? "0 0 0 2px color-mix(in srgb, var(--color-accent-500) 30%, transparent)"
      : selected
        ? "0 0 0 1px color-mix(in srgb, var(--color-accent-500) 25%, transparent)"
        : "0 1px 4px rgba(0,0,0,.28)",
  };

  return (
    <div
      // The card's own id, for anything that starts from a pointer rather than
      // from the store — today the right-click menu, which has to know whether
      // it was opened on a block or on the canvas behind it.
      data-node-id={node.id}
      className="absolute"
      style={{ left: node.x, top: node.y, width: nodeWidth(node), zIndex: selected ? 4 : 2 }}
    >
      <div
        style={cardStyle}
        // No overflow clipping here: the port dots deliberately hang off both
        // edges. The text block below does its own clipping instead.
        className={cn(
          // `group` is what reveals the edit button on hover; `select-none`
          // stops a double-click — which opens the same editor — from selecting
          // the title text instead of doing anything useful.
          "group relative flex select-none flex-col border transition-[box-shadow,border-color] duration-150",
          connecting ? "cursor-crosshair" : "cursor-grab",
        )}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (pending) {
            completeConnection(node.id);
            return;
          }
          startNodeInteraction(node.id, event.shiftKey || event.metaKey || event.ctrlKey, event.clientX, event.clientY);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          expandNode(node.id);
        }}
      >
        {/* Given the height the port geometry reads rather than left to add up
            its own padding: `branchPorts` holds a block's two exits clear of
            this row (see CARD_HEADER_HEIGHT), and a row that grew without that
            number following would put a "Ha" caption back under the controls
            on the right of it. */}
        {/* The start block carries no caption and no body, so its name *is* the
            card: the row is given the whole height instead of the header strip
            and the name sits in the middle of it, a size up from every other
            block's title. Safe to grow only here — `CARD_HEADER_HEIGHT` is
            load-bearing for `branchPorts`, and this block publishes a single
            exit measured from `bodyMiddle`, which is the same centre line. */}
        {/* The whole card above the keyboard rows, not a 29px strip of it: a
            block says its icon and its name and nothing else now, so the pair
            is given the body to sit in the middle of. `height - rowsHeight` is
            the same span `bodyMiddle` measures the `out` port from, which is
            what puts the name on the exact line its dot leaves by. */}
        <div
          className="flex flex-none items-center"
          // Gap and padding as values rather than Tailwind classes: `nodeWidth`
          // subtracts these exact numbers to decide what is left for the name,
          // and a class here would be a second copy of them to keep in step.
          style={{
            height: height - rowsHeight,
            gap: CARD_GAP,
            paddingLeft: CARD_PAD_X,
            paddingRight: CARD_PAD_X,
          }}
        >
          <IconChip name={definition.icon} color={definition.color} />
          <span
            // A name longer than the card is truncated, and this is the only
            // place the rest of it can be read without opening the block.
            title={node.title}
            className={cn(
              "min-w-0 flex-1 truncate font-semibold tracking-tight",
              // The entry block reads a size up: it is the one card a reader
              // looks for first when they open a flow they did not draw.
              node.type === "start" ? "text-[16px]" : "text-[13.5px]",
            )}
          >
            {node.title}
          </span>
          {/* Testing from *here*, not from the top. The panel's own picker only
              offers the blocks a flow starts at, so checking the last block of
              a long flow meant walking every block before it — and the block
              you want to see is the one you are already looking at. */}
          <button
            type="button"
            aria-label={`${node.title || definition.kindLabel} blokidan sinash`}
            title="Shu blokdan sinash"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              testFlowFromNode(node.id);
            }}
            // Hover is not an input a finger has: on a touch screen this button
            // never appeared at all, and at 17px it would have been unreachable
            // even if it had. `oq-tap` widens the hit box to 44px without
            // changing what is drawn — see `globals.css`.
            className="oq-tap relative flex-none cursor-pointer rounded p-0.5 text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent-300 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Icon name="play" size={11} />
          </button>
          {/* The way into the block's settings, said out loud. Double-click and
              Enter open the same editor, but neither is visible on a card, and
              an editor nobody can find is an editor that does not exist. */}
          <button
            type="button"
            aria-label={`${node.title || definition.kindLabel} blokini tahrirlash`}
            title="Tahrirlash (Enter)"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              expandNode(node.id);
            }}
            // Hover is not an input a finger has: on a touch screen this button
            // never appeared at all, and at 17px it would have been unreachable
            // even if it had. `oq-tap` widens the hit box to 44px without
            // changing what is drawn — see `globals.css`.
            className="oq-tap relative flex-none cursor-pointer rounded p-0.5 text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent-300 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Icon name="pen-nib" size={12} />
          </button>
          {conflict ? (
            <span className="flex-none text-warning-fg" title={`Shart konflikti: ${conflict}`}>
              <Icon name="warning" size={11} />
            </span>
          ) : null}
          {showsPriority && (
            <span
              title={`Ustuvorlik: ${priority}${isPriorityOverridden(node) ? " (qo'lda)" : " (avtomatik)"}`}
              className={cn(
                "flex-none rounded px-[5px] py-[1px] text-[9px] font-medium tabular-nums",
                isPriorityOverridden(node) ? "bg-accent-900 text-accent-200" : "bg-neutral-800 text-neutral-500",
              )}
            >
              #{priority}
            </span>
          )}
        </div>

        {/* Keyboard rows. Each row owns the horizontal band its port sits in,
            so a row and its dot always line up — see BUTTON_ROW_HEIGHT. */}
        {rowsHeight > 0 && (
          /*
           * Full-bleed, and joined to the card rather than floating in it.
           * They were inset pills with air between them, which read as four
           * separate objects that happened to be stacked; a keyboard is one
           * thing with rows in it, and each row is where its own dots sit —
           * an edge landing on a row that visibly belongs to the card says
           * where it came from without being traced. The height and the pads
           * are untouched, because `buttonPorts` measures the dots from them.
           */
          <div
            className="flex flex-none flex-col border-t border-neutral-800"
            style={{ height: rowsHeight, paddingTop: BUTTON_ROWS_TOP_PAD, paddingBottom: BUTTON_ROWS_BOTTOM_PAD }}
          >
            {buttons.map((button) => {
              const routable = isRoutableButton(button, buttonMode);
              const label = resolveText(button.label, main, main);
              return (
                <div key={button.id} className="flex items-center" style={{ height: BUTTON_ROW_HEIGHT }}>
                  <span
                    title={routable ? label : `${label} · tarmoq ochilmaydi`}
                    className={cn(
                      /*
                       * A stadium per row, and shorter than the row it sits
                       * in. The slot stays BUTTON_ROW_HEIGHT — the port dots
                       * are measured from it — while the key inside it gives
                       * up a couple of pixels top and bottom. Without that
                       * gap three touching keys of one colour merge into a
                       * single rounded slab, which rounds the stack rather
                       * than the keys, and the dots then read as attached to
                       * the card's edge instead of to a row.
                       */
                      "mx-2 flex h-[15px] w-full items-center gap-[3px] rounded-full px-2.5 text-[9.5px]",
                      routable ? "bg-accent-900/60 text-accent-200" : "bg-neutral-800/60 text-neutral-500",
                    )}
                  >
                    <Icon name={buttonKindMeta(button.kind).icon} size={8} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </span>
                </div>
              );
            })}
            {/* Last in the stack, and quieter than the keys above it: it is the
                block's own way back, not one of the author's choices. Its dot
                leaves the *left* edge — see [[backPort]] — so the row reads as
                the one exit that does not go forward. */}
            {/* An album is drawn struck through rather than dropped: the row is
                still stored and the author's edge is still on the canvas, and
                taking the row off the card would hide both. It carries no dot
                then — nothing publishes the exit while the block sends
                something Telegram takes no keyboard with, see
                [[backRowReachesTelegram]] — so the strike-through is what says
                why the row is the one row here with no port beside it. The same
                treatment the unroutable keys above wear, because it is the same
                fact: this one is on the card and will not be on the phone. */}
            {hasBackRow(node) && (
              <div className="flex items-center" style={{ height: BUTTON_ROW_HEIGHT }}>
                <span
                  title={
                    backRowReachesTelegram(node)
                      ? undefined
                      : `${resolveText(node.back ?? "", main, main) || BACK_ROW_LABEL} · albom bilan yuborilmaydi`
                  }
                  className={cn(
                    "mx-2 flex h-[15px] w-full items-center gap-[3px] rounded-full bg-neutral-800/60 px-2.5 text-[9.5px]",
                    backRowReachesTelegram(node) ? "text-neutral-400" : "text-neutral-600 line-through",
                  )}
                >
                  <Icon name="arrow-left" size={8} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate">
                    {resolveText(node.back ?? "", main, main) || BACK_ROW_LABEL}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {acceptsIncoming && (
          <button
            type="button"
            aria-label="Kirish"
            title="Kirish"
            onMouseDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              if (pending) completeConnection(node.id);
              else select(node.id, false);
            }}
            className="oq-port absolute cursor-crosshair rounded-full border-2 transition-transform hover:scale-125"
            style={
              {
                width: PORT,
                height: PORT,
                left: -PORT / 2,
                top: nodeInputDy(node) - PORT / 2,
                background: pending ? "var(--color-accent-400)" : "var(--color-neutral-600)",
                borderColor: CARD_BG,
                "--port-glow": "var(--color-accent-400)",
              } as CSSProperties
            }
          />
        )}

        {ports.map((port) => {
          /*
           * Two dots per keyboard row, and both are exits. Which one the edge
           * actually uses is decided by where its target sits, so the unused
           * side is drawn dim: a lit dot on an empty side would promise a
           * connection that is not there, and no dot at all would hide the
           * side an author can drag from.
           */
          const wired = edges.find((edge) => edge.from === node.id && edge.port === port.id);
          const target = wired ? nodesById.find((item) => item.id === wired.to) : undefined;
          const sides =
            port.kind === "button" ? (["left", "right"] as const) : ([port.side ?? "right"] as const);
          /*
           * Which side the edge actually leaves by, or null when this exit is
           * wired to nothing. The null case is the one that was wrong: with
           * "left is live, so right is the other one", an exit with no edge at
           * all still drew a filled dot on the right — a row promising a
           * connection it did not have. Filled means wired; a ring means the
           * side is there to drag from.
           */
          const liveSide = !wired
            ? null
            : port.side === "left" || (port.kind === "button" && !!target && target.x < node.x)
              ? "left"
              : "right";
          return sides.map((side) => {
            // A one-sided exit keeps the filled dot it always had: hollowing
            // every unwired "out" would repaint the whole canvas for a
            // distinction only the two-sided rows need.
            const live = port.kind === "button" ? liveSide === side : true;
            const dragging = pending?.fromNodeId === node.id && pending.port === port.id;
            return (
              <button
                key={`${port.id}:${side}`}
                type="button"
                aria-label={port.kind === "button" ? `"${port.label}" tugmasi uchun chiqish` : port.label || "Chiqish"}
                title={
                  port.kind === "button" || port.kind === "back"
                    ? `"${port.label}" bosilganda → blokka ulash`
                    : "Chiqish"
                }
                onMouseDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  startConnection(node.id, port.id);
                }}
                className="oq-port absolute cursor-crosshair rounded-full border-2 transition-transform hover:scale-125"
                style={
                  {
                    // A block's own exit and the back row each have one side.
                    // A keyboard row has both, and the edge takes whichever is
                    // nearer its target — so the spare one is drawn faint
                    // rather than hidden: an author can still drag from it.
                    left: side === "left" ? -PORT / 2 : undefined,
                    right: side === "left" ? undefined : -PORT / 2,
                    top: port.offset - PORT / 2,
                    width: PORT,
                    height: PORT,
                    /*
                     * Filled means "the edge leaves here"; a ring means "you
                     * may drag from here". Fading the spare dot instead was
                     * not a distinction at all — a 35%-opacity accent dot on
                     * a near-black canvas still reads as a blue dot, so a row
                     * looked wired on both sides at once. Shape carries it
                     * where colour could not, and the ring keeps the side
                     * visible rather than hiding what an author can use.
                     */
                    borderColor: dragging || live ? CARD_BG : PORT_COLOR[port.kind],
                    background: dragging
                      ? "var(--color-accent-400)"
                      : live
                        ? PORT_COLOR[port.kind]
                        : CARD_BG,
                    opacity: dragging || live ? 1 : 0.75,
                    "--port-glow": PORT_GLOW[port.kind],
                  } as CSSProperties
                }
              />
            );
          });
        })}

        {/* "Ha"/"Yo'q" ride inside the card, each level with the dot it names —
            the two exits leave the same edge, so which is which has to be
            readable before either one is wired up. They sit at the right, in
            the card's body — which is the whole reason `branchPorts` holds the
            pair below the title row (see CARD_HEADER_HEIGHT): a caption up
            there would land under the card's own edit controls. A button port
            is already named by its own row and needs no second label here. */}
        {ports
          .filter((port) => port.kind === "yes" || port.kind === "no")
          .map((port) => (
            <span
              key={`label-${port.id}`}
              className="pointer-events-none absolute -translate-y-1/2 text-[9px] font-medium tracking-wide"
              style={{
                right: BRANCH_LABEL_INSET,
                top: port.offset,
                color: port.kind === "yes" ? "#7fc79c" : "#c4ab7a",
              }}
            >
              {port.label}
            </span>
          ))}
      </div>
    </div>
  );
});
