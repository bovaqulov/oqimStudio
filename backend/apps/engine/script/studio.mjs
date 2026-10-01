/*
 * `studio` — the library that manages flows, and creates them.
 *
 * Everything else a script can reach reads or writes one conversation. This
 * reaches the *product*: it lists flows, draws new ones, wires blocks together
 * and switches them on. Which is why the first thing in this file is not an
 * API but a closed door.
 *
 * ## The rule that comes before the API
 *
 * A bot that creates a flow on every customer message destroys itself within
 * an hour. The quota fills, the graphs tangle, and nobody can say which
 * version is running — and none of that announces itself, because each
 * individual call succeeded. So `studio.*` is refused outright anywhere a
 * customer's message is what started the code:
 *
 *   `ctx.surface === "management"`   the Script panel, a scheduled job, an API
 *                                    key. Somebody asked for this, once.
 *   anything else                    a conversation. Closed.
 *
 * Note the direction of the default. The test is for the *open* value, so a
 * `ctx` from an older runtime that sets no `surface` at all, a `ctx` that is
 * undefined, a `ctx` a script rebuilt by hand — every one of them is a
 * conversation and every one of them is refused. A gate that has to recognise
 * every closed case in order to close is a gate that opens on the case nobody
 * thought of.
 *
 * ## Why `surface` and not `mode`
 *
 * `ctx.mode` already exists and already means something: `"test"` is the
 * studio's own chat and `"live"` is a real customer (`hooks.context_for`). A
 * hook that charges a card branches on it. That is a different question from
 * this one, and both answers are real in all four combinations — the Script
 * panel is management *and* a test, a scheduled job is management *and* live.
 * One key cannot carry two orthogonal facts; overloading it would silently
 * break every hook already reading `ctx.mode`, and silence is the failure mode
 * this repository is written against.
 *
 * ## How it reaches the host
 *
 * It does not know. `createStudio({ call, ctx })` is handed the host-call
 * function and the context, so the sandbox bridge can be wired in one line and
 * changed without touching this file — there is no global here to reach for
 * and nothing imported but the local graph check. Every method sends one
 * dotted command name identical to its own path (`studio.flows.create` is
 * `studio.flows.create`), so the host side is a table lookup with nothing to
 * translate.
 *
 * `call(name, payload)` may answer either way round and both are handled: it
 * may reject, or it may resolve `{ok: false, code, error}`. What it must not
 * do is resolve a refusal as if it were an answer.
 */

import { checkGraph, refusals } from "./graphcheck.mjs";

export const CONVERSATION = "conversation";
export const MANAGEMENT = "management";

/** What a refused call throws. `code` is what a script branches on. */
export class StudioError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StudioError";
    this.code = code;
  }
}

/** Which surface this code is running on. Anything not plainly management is a
 * conversation — see the note on the default at the top of this file. */
export function surfaceOf(ctx) {
  return ctx && ctx.surface === MANAGEMENT ? MANAGEMENT : CONVERSATION;
}

/*
 * A graph as the host wants it, from a spec written either way.
 *
 * `{graph: {nodes, edges}}` is the shape `/api/flows/import/` takes and
 * `{nodes, edges}` is the shape `POST /api/flows/` takes; both are in the tree,
 * both will be typed, and refusing one of them would be a rule whose only
 * purpose is to be discovered.
 */
function graphOf(spec) {
  const source = spec && typeof spec === "object" ? spec : {};
  const graph = source.graph && typeof source.graph === "object" ? source.graph : source;
  return { nodes: graph.nodes, edges: graph.edges };
}

function requireText(name, field, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new StudioError("missing_argument", `${name} uchun «${field}» kerak`);
  }
  return value.trim();
}

export function createStudio(options) {
  const { call, ctx } = options || {};
  const surface = surfaceOf(ctx);

  function guard(name) {
    if (surface !== MANAGEMENT) {
      throw new StudioError("studio_conversation", `${name} faqat boshqaruv rejimida ishlaydi`);
    }
  }

  function unwrap(name, answer) {
    if (answer && typeof answer === "object" && !Array.isArray(answer)) {
      if (answer.ok === false) {
        throw new StudioError(answer.code || "studio_error", String(answer.error || answer.message || `${name} bajarilmadi`));
      }
      if (answer.ok === true && "value" in answer) return answer.value;
    }
    return answer;
  }

  async function send(name, payload) {
    guard(name);
    if (typeof call !== "function") {
      /* The wiring is missing, not the permission. Said differently on purpose:
       * «boshqaruv rejimida ishlaydi» would send an author to check a setting
       * that is already right. */
      throw new StudioError("studio_unavailable", `${name} bu yerda ishlamaydi — studio ulanmagan`);
    }
    return unwrap(name, await call(name, payload));
  }

  /*
   * The graph, checked here rather than at the other end of the wire.
   *
   * The host re-runs the real check on everything that gets past this — see
   * `graphcheck.mjs` for why a second validator is written to have no opinion
   * of its own. What this buys is the sentence arriving in the author's own
   * `catch` block, with nothing written and nothing spent, naming the block
   * they got wrong.
   */
  function refuseBrokenGraph(name, graph) {
    const stopping = refusals(checkGraph(graph));
    if (!stopping.length) return;
    const first = stopping[0];
    const message = stopping.length === 1 ? first.message : `${first.message} (jami ${stopping.length} ta xato)`;
    throw new StudioError(first.code, `${name}: ${message}`);
  }

  const flows = {
    /** Summaries. `filter` narrows by `{botId, projectId, moduleKey, enabled, q, limit}`. */
    list(filter) {
      return send("studio.flows.list", { filter: filter && typeof filter === "object" ? filter : {} });
    },
    /** One flow, graph included. */
    get(id) {
      return send("studio.flows.get", { id: requireText("studio.flows.get", "id", id) });
    },
    /**
     * A new flow from a graph this script built.
     *
     * Refused before anything leaves the machine when the graph could not
     * work: no blocks, no entry block or two of them, a duplicate or missing
     * id, an edge with no port, an edge to a block that is not there, an edge
     * into an entry block, a block nothing reaches. That list is the answer to
     * a live flow found switched on with two of its three buttons wired
     * nowhere — a flow a script builds passes the same check as one somebody
     * drew.
     */
    create(spec) {
      guard("studio.flows.create");
      const graph = graphOf(spec);
      refuseBrokenGraph("studio.flows.create", graph);
      const source = spec && typeof spec === "object" ? spec : {};
      return send("studio.flows.create", {
        spec: {
          name: source.name,
          description: source.description,
          moduleKey: source.moduleKey,
          botId: source.botId,
          projectId: source.projectId,
          graph,
        },
      });
    },
    /** Renames, re-describes, or replaces the graph. Only the keys given move. */
    update(id, patch) {
      return send("studio.flows.update", {
        id: requireText("studio.flows.update", "id", id),
        patch: patch && typeof patch === "object" ? patch : {},
      });
    },
    enable(id) {
      return send("studio.flows.enable", { id: requireText("studio.flows.enable", "id", id) });
    },
    disable(id) {
      return send("studio.flows.disable", { id: requireText("studio.flows.disable", "id", id) });
    },
    /**
     * What is wrong with a stored flow — errors *and* warnings, written the
     * way the editor's own panel writes them.
     *
     * The reporting half of the pair. `create` and `enable` refuse; this one
     * only tells, which is what a script wants before it switches something on
     * and what a person wants when it refused.
     */
    validate(id) {
      return send("studio.flows.validate", { id: requireText("studio.flows.validate", "id", id) });
    },
  };

  const nodes = {
    add(flowId, node) {
      return send("studio.nodes.add", {
        flowId: requireText("studio.nodes.add", "flowId", flowId),
        node: node && typeof node === "object" ? node : {},
      });
    },
    update(flowId, nodeId, patch) {
      return send("studio.nodes.update", {
        flowId: requireText("studio.nodes.update", "flowId", flowId),
        nodeId: requireText("studio.nodes.update", "nodeId", nodeId),
        patch: patch && typeof patch === "object" ? patch : {},
      });
    },
    remove(flowId, nodeId) {
      return send("studio.nodes.remove", {
        flowId: requireText("studio.nodes.remove", "flowId", flowId),
        nodeId: requireText("studio.nodes.remove", "nodeId", nodeId),
      });
    },
  };

  const edges = {
    add(flowId, edge) {
      return send("studio.edges.add", {
        flowId: requireText("studio.edges.add", "flowId", flowId),
        edge: edge && typeof edge === "object" ? edge : {},
      });
    },
    remove(flowId, edgeId) {
      return send("studio.edges.remove", {
        flowId: requireText("studio.edges.remove", "flowId", flowId),
        edgeId: requireText("studio.edges.remove", "edgeId", edgeId),
      });
    },
  };

  return { surface, flows, nodes, edges };
}

export default createStudio;
