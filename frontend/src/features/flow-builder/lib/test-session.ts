import type { BotLanguage } from "@/features/bots/types";
import type { FlowNode } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import type { TestRun } from "@/features/flows/runtime-actions";
import { BACK_ROW_LABEL, hasBackRow } from "../node-registry";
import { answerShareButton, buttonPortId, effectiveButtonMode, isRoutableButton, nodeButtons } from "./buttons";
import {
  getContentDefinition,
  nodeContentKind,
  SKIP_ROW_LABEL,
  SUBSCRIPTION_CHECK_LABEL,
} from "./message-content";

/** One line in the test chat. `system` is the runtime talking, not the bot. */
export interface ChatBubble {
  id: string;
  from: "bot" | "user" | "system";
  text: string;
  /** Which block produced it — the panel highlights that block on the canvas. */
  nodeId?: string;
}

export interface ChatOption {
  label: string;
  /** Port the choice leaves the waiting block through. */
  port: string;
  /**
   * Sent with the port when the tap itself carries an answer. Telegram's share
   * buttons deliver a phone number or a place, so a simulated tap has to as
   * well — see [[AnswerShareButton.sample]].
   */
  text?: string;
}

export interface ChatState {
  runId: string;
  bubbles: ChatBubble[];
  /** Block the run is parked on, `null` once it ended. */
  waitingNodeId: string | null;
  options: ChatOption[];
  /** The waiting block expects typed input rather than a choice. */
  expectsText: boolean;
  done: boolean;
  error: string;
}

/** Statuses that mean the run will not continue on its own. */
const FINISHED = new Set(["done", "failed", "handoff"]);

/**
 * Every row the parked block would put on a customer's screen, as something
 * the tester can press.
 *
 * A mirror of `sender.build_keyboard`, row for row, and it has to be read as
 * one: what is listed here is what the test chat can do, and what that
 * function builds is what the bot actually sends. An author loses either way
 * when the two drift apart. A row missing here is an exit they drew, wired and
 * cannot try — «Orqaga» and «O'tkazib yuborish» were both in that state for as
 * long as they have existed, so whether they worked was something only a live
 * customer could report. A row that exists only here is the mirror image: a
 * button the panel promises and no phone ever shows.
 * `apps/engine/tests/test_test_chat_contract.py` is what notices either.
 *
 * Two rows the runtime does draw are deliberately left off, and both leave the
 * graph rather than exiting a block: a menu's «Bosh menyu», which re-enters the
 * bot at a command only `dispatch` can route, and a gate's channel links, which
 * open Telegram and tell the bot nothing. A test run is one flow on the engine
 * with no bot-level routing behind it, so a button for either would be the
 * second kind of lie.
 */
function waitingOptions(node: FlowNode, main: BotLanguage): ChatOption[] {
  const back: ChatOption[] = hasBackRow(node)
    ? [{ label: resolveText(node.back ?? "", main, main) || BACK_ROW_LABEL, port: "back" }]
    : [];

  // An invoice's keyboard is Telegram's, not the author's — "If not empty, the
  // first button must be a Pay button" — and under it the block's own way out.
  // Nothing in the keyboard further down names either, so without them a parked
  // invoice can only be answered with typed text on `out` and everything a flow
  // does after a payment is unreachable from the test chat.
  if (nodeContentKind(node) === "invoice") {
    return [
      { label: "To'lash", port: "paid" },
      { label: node.invoice?.cancelLabel?.trim() || "Bekor qilish", port: "cancelled" },
      ...back,
    ];
  }

  // A language picker draws a keyboard of its own, and every row leaves through
  // the block's one exit carrying the value that was tapped rather than a port
  // of its own. The composer below already reaches it, so there is no exit here
  // a press could take that typing cannot.
  if (node.type === "language") return [];

  // Read after the block types above, exactly as `sender.content_kind` reads it:
  // a self-keyboarded block still carrying the `contentKind` of the Xabar it was
  // converted out of is that block type first and its stored kind second. What
  // is left here is an album, sent by `sendMediaGroup` — the one method that
  // takes no `reply_markup` at all — so this block has no keyboard whatever it
  // carries, the «Orqaga» row included.
  if (!getContentDefinition(nodeContentKind(node)).supportsButtons) return [];

  const mode = effectiveButtonMode(node);

  return [
    ...nodeButtons(node)
      .filter((button) => isRoutableButton(button, mode))
      .map((button) => ({
        label: resolveText(button.label, main, main),
        port: buttonPortId(button.id),
        // A Web App row is the one routable button whose answer is not the
        // press. Marked here so the panel knows to ask for the form first;
        // without it the row continued the run carrying nothing and the block
      })),
    // Last of all, under everything else: it is the way out of the block, and a
    // way out sitting between two choices reads as a third choice.
    ...back,
  ];
}

/**
 * A backend run, as the chat renders it.
 *
 * What the runtime returns is a trace: which blocks ran and what they sent.
 * What the panel needs on top of that is what the *tester* can do next, and
 * that is read from the block the run is parked on — the same keyboard the
 * customer would be looking at.
 *
 * The bubbles arrive already in one language — the runtime resolved them as it
 * sent them — but the keyboard is read off the stored graph here, so its labels
 * are resolved on this side. `main` is the bot's own language, which is what a
 * test run with no customer behind it is answered in.
 */
export function toChatState(run: TestRun, nodes: FlowNode[], main: BotLanguage = DEFAULT_LANGUAGE): ChatState {
  const waiting = run.status === "waiting" ? (nodes.find((node) => node.id === run.currentNodeId) ?? null) : null;
  const options = waiting ? waitingOptions(waiting, main) : [];

  return {
    runId: run.id,
    bubbles: run.steps.map((step) => ({
      id: step.id,
      from: step.actor,
      text: step.text,
      ...(step.nodeId ? { nodeId: step.nodeId } : {}),
    })),
    waitingNodeId: waiting?.id ?? null,
    options,
    // A parked block with no keyboard is waiting on typed input.
    expectsText: !!waiting && options.length === 0,
    done: FINISHED.has(run.status),
    error: run.error,
  };
}
