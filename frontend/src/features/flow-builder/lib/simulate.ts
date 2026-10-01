import type { BotLanguage } from "@/features/bots/types";
import type { FlowEdge, FlowNode } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { acceptsIncomingEdge } from "../node-registry";
import { nodeAiConfig } from "./ai";
import { answerShareButton, buttonPortId, isRoutableButton, effectiveButtonMode, nodeButtons } from "./buttons";
import { summarizeInvoice } from "./message-content";
import { applySampleValues } from "./variables";
import { getAiModel } from "./ai";

/*
 * A blueprint preview, not a test run.
 *
 * The editor's test chat no longer walks graphs here: it asks the backend to
 * run the flow on the same engine Telegram updates go through, because two
 * implementations of one set of rules is how a green test chat ends up sitting
 * next to a broken bot.
 *
 * What is left is the one case that has no flow to run yet — the wizard and the
 * template gallery, showing what a blueprint *would* do before anything is
 * created. It is labelled a preview everywhere it appears for that reason, and
 * it is deliberately generous: unknown variables read as sample data so the
 * message reads as a message.
 *
 * Every string a block holds may be a map of translations (see
 * `features/flows/localized-text`), so each one is resolved on the way into a
 * bubble. `main` is the bot's own language: a blueprint has no conversation
 * behind it, and therefore nobody whose language could have been guessed.
 */

/** One line in the preview. `system` is the harness talking, not the bot. */
export interface SimBubble {
  id: string;
  from: "bot" | "user" | "system";
  text: string;
  /** Which block produced it — the panel highlights that block on the canvas. */
  nodeId?: string;
}

export interface SimOption {
  label: string;
  /** Port the choice leaves the waiting block through. */
  port: string;
}

export interface SimState {
  bubbles: SimBubble[];
  /** Block the run is parked on, `null` once it ended. */
  waitingNodeId: string | null;
  options: SimOption[];
  /** The waiting block expects typed input rather than a choice. */
  expectsText: boolean;
  done: boolean;
  /**
   * What the run has learned so far — the answers given to its questions, under
   * the names its "Ma'lumotni saqlash" blocks saved them to. This is what
   * `{{mijoz_ismi}}` resolves against, so the test chat greets the tester by
   * the name they typed rather than by the preview's stand-in.
   */
  variables: Record<string, string>;
}

/** Guard against a graph that loops back on itself forever. */
const MAX_STEPS = 40;

let sequence = 0;
function bubble(from: SimBubble["from"], text: string, nodeId?: string): SimBubble {
  sequence += 1;
  return { id: `b${sequence}`, from, text, nodeId };
}

function outgoing(edges: FlowEdge[], nodeId: string, port: string): string | null {
  return edges.find((edge) => edge.from === nodeId && edge.port === port)?.to ?? null;
}

/** Entry blocks a run can start from, in canvas order. */
export function simulationStarts(nodes: FlowNode[]): FlowNode[] {
  // The blocks nothing can route into are exactly the ones an update opens a
  // flow at — the canvas draws them without an input dot for the same reason.
  const entries = nodes.filter((node) => !acceptsIncomingEdge(node.type));
  return entries.length ? entries : nodes.slice(0, 1);
}

/**
 * Runs the graph from `startId` until it needs the user. Pure: the panel keeps
 * the returned state and calls `replyToSimulation` to continue, so the same
 * walker can later be pointed at a real Bot API session without changing the UI.
 */
export function runFrom(
  nodes: FlowNode[],
  edges: FlowEdge[],
  startId: string,
  history: SimBubble[] = [],
  collected: Record<string, string> = {},
  main: BotLanguage = DEFAULT_LANGUAGE,
): SimState {
  const bubbles = [...history];
  const variables = { ...collected };
  let currentId: string | null = startId;
  let steps = 0;
  const say = (value: FlowNode["text"]) => resolveText(value, main, main);

  while (currentId && steps < MAX_STEPS) {
    steps += 1;
    const node: FlowNode | undefined = nodes.find((n) => n.id === currentId);
    if (!node) break;

    switch (node.type) {
      case "start": {
        bubbles.push(bubble("user", "/start", node.id));
        break;
      }
      case "trigger":
      case "groupjoin":
      case "groupleave":
      case "joinrequest":
      case "channelpost": {
        bubbles.push(bubble("system", `⚡ ${node.title} ishga tushdi`, node.id));
        break;
      }
      case "delay": {
        bubbles.push(bubble("system", `⏳ ${node.minutes ?? 0} daqiqa kutildi`, node.id));
        break;
      }
      case "tag": {
        if (node.tagAction === "set_variable" && node.tagName) {
          // The value is usually `{{message.text}}` — the answer just given.
          variables[node.tagName] = applySampleValues(node.tagValue ?? "", variables);
          bubbles.push(bubble("system", `🏷 ${node.tagName} = ${variables[node.tagName]}`, node.id));
        } else {
          bubbles.push(bubble("system", `🏷 ${applySampleValues(say(node.text), variables)}`, node.id));
        }
        break;
      }
      case "http": {
        bubbles.push(bubble("system", `🌐 ${say(node.text)}`, node.id));
        break;
      }
      // A system line and not a bubble. The `default` below would send this
      // block's own card text to the reader as something the bot said — and
      // what it says is "Javoblarni jadvalga yozadi", which is a note to the
      // author about the block, not a sentence any customer should ever read.
      // A lookup the preview cannot perform — it has no workspace and no rows —
      // so it says which branch it is taking and takes the optimistic one. The
      // alternative is a blueprint that only ever demonstrates the failure path.
      case "tableread": {
        const from = node.tableRead?.handle;
        bubbles.push(
          bubble("system", from ? `🔎 «${from}» dan qator topildi` : "🔎 Ma'lumot tanlanmagan", node.id),
        );
        currentId = outgoing(edges, node.id, from ? "yes" : "no");
        continue;
      }
      case "tablerow": {
        const handle = node.tableWrite?.handle;
        bubbles.push(
          bubble("system", handle ? `🗂 «${handle}» ma'lumotiga yozildi` : "🗂 Ma'lumot tanlanmagan", node.id),
        );
        break;
      }
      case "end": {
        // The same line the walk prints when it runs off the end of the graph,
        // word for word: an ending the author drew and an ending they left
        // implicit are the same ending, and a preview that named them
        // differently would suggest the bot behaves differently.
        bubbles.push(bubble("system", "✓ Oqim yakunlandi", node.id));
        return { bubbles, waitingNodeId: null, options: [], expectsText: false, done: true, variables };
      }
      case "flowlink": {
        // With a block picked, `text` already reads "oqim · blok" — naming that
        // whole string "oqimiga" would claim the block is a flow of its own.
        const target = say(node.text);
        const where = node.targetNodeId ? `${target} blokiga o'tdi` : `«${target}» oqimiga o'tdi`;
        bubbles.push(bubble("system", `↪ ${where}`, node.id));
        return { bubbles, waitingNodeId: null, options: [], expectsText: false, done: true, variables };
      }
      case "ai": {
        const config = nodeAiConfig(node);
        bubbles.push(
          bubble("bot", `[${getAiModel(config.model).label} javobi]\n${applySampleValues(say(node.text))}`, node.id),
        );
        break;
      }
      case "condition": {
        bubbles.push(bubble("system", `🔀 Shart: ${say(node.text)}`, node.id));
        return {
          bubbles,
          waitingNodeId: node.id,
          options: [
            { label: "Ha", port: "yes" },
            { label: "Yo'q", port: "no" },
          ],
          expectsText: false,
          done: false,
          variables,
        };
      }
      default: {
        bubbles.push(bubble("bot", applySampleValues(say(node.text), variables), node.id));
        break;
      }
    }

    // A keyboard parks the run until the tester picks a row.
    const mode = effectiveButtonMode(node);
    const routable = nodeButtons(node).filter((button) => isRoutableButton(button, mode));
    const options = routable.map((button) => ({ label: say(button.label), port: buttonPortId(button.id) }));
    if (options.length) {
      return { bubbles, waitingNodeId: node.id, options, expectsText: false, done: false, variables };
    }

    currentId = outgoing(edges, node.id, "out");
  }

  if (steps >= MAX_STEPS) {
    bubbles.push(bubble("system", "⚠️ Juda ko'p blok — oqimda tsikl bo'lishi mumkin"));
  } else {
    bubbles.push(bubble("system", "✓ Oqim yakunlandi"));
  }
  return { bubbles, waitingNodeId: null, options: [], expectsText: false, done: true, variables };
}

export function startSimulation(
  nodes: FlowNode[],
  edges: FlowEdge[],
  startId: string,
  main: BotLanguage = DEFAULT_LANGUAGE,
): SimState {
  sequence = 0;
  return runFrom(nodes, edges, startId, [], {}, main);
}

/** Continues a parked run: a button press (`port`) or a typed answer (`text`). */
export function replyToSimulation(
  state: SimState,
  nodes: FlowNode[],
  edges: FlowEdge[],
  reply: { port?: string; text?: string },
  main: BotLanguage = DEFAULT_LANGUAGE,
): SimState {
  if (!state.waitingNodeId) return state;
  const answer = reply.text?.trim() || reply.port || "…";
  const history = [...state.bubbles, bubble("user", answer)];
  // The reply *is* `{{message.text}}` from here on — that is the placeholder a
  // "Teg" block copies the answer out of.
  const variables = { ...state.variables, "message.text": reply.text?.trim() ?? answer };
  const next = outgoing(edges, state.waitingNodeId, reply.port ?? "out");

  if (!next) {
    return {
      bubbles: [...history, bubble("system", "⚠️ Bu javob uchun davomi ulanmagan — blokni bog'lang")],
      waitingNodeId: null,
      options: [],
      expectsText: false,
      done: true,
      variables,
    };
  }
  return runFrom(nodes, edges, next, history, variables, main);
}
