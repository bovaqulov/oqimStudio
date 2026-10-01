/*
 * Reading a graph before it costs a round trip — the JavaScript half of
 * `apps/flows/graph_validation.py`.
 *
 * A script that builds a flow is holding the graph in its own memory. Sending
 * it to be refused is a process boundary, a database transaction and a
 * sentence that arrives after the fact; checking it here is a function call.
 * That is the whole reason this file exists, and it is also the reason it is
 * dangerous: a second validator is how a graph comes to be legal on one side
 * of a wire and illegal on the other, and this repository has already paid for
 * that once (`vocabulary.py` is the *second* copy of the block table and the
 * contract test beside it is what keeps it honest).
 *
 * So the rule this file is written under is: **it never has an opinion of its
 * own**. Every code below is a code `graph_validation.py` already emits, with
 * the severity `graph_validation.py` gives it, and the host re-runs the real
 * check on everything that gets past here. What this file adds is speed and a
 * message the author reads without waiting.
 *
 * What it deliberately does NOT check, and why the omission is safe:
 *
 *   `unknown_type`      the block vocabulary is 23 types with their ports,
 *   `unknown_port`      their fields and their content-kind rules. Copying it
 *   `dangling_port`     into JavaScript would be a *third* copy of the table
 *   `empty_body`        two files already warn about. These are host-only, and
 *   `unroutable_button` the host refuses on them exactly as it always has.
 *   `missing_back_row`
 *   `unsent_back_row`
 *
 * The one thing it does copy is the six entry-block type names, because every
 * rule below about "an entry block" needs them. `tests/test_studio_api.py`
 * binds that list to `flows.vocabulary.ENTRY_TYPES`, so the copy cannot drift
 * without a test saying which way.
 *
 * Nothing here is a security boundary. The author's own module shares this
 * realm and can replace `Array.isArray` under it; that buys them a graph the
 * host then refuses, which is where it was going to be refused anyway.
 */

/* Mirrors `flows.vocabulary.ENTRY_TYPES` — held by a test, not by hope. */
export const ENTRY_TYPES = Object.freeze([
  "start",
  "trigger",
  "groupjoin",
  "groupleave",
  "joinrequest",
  "channelpost",
]);

/*
 * Mirrors `flows.vocabulary.OWNED_ENTRY_TYPES`, and the gap between this list
 * and the one above is deliberate rather than an oversight. `groupjoin` and
 * the three beside it are ordinary palette blocks: a groups flow answering
 * both a join and a leave has two entry blocks on purpose. Only `start` and
 * `trigger` are owned by the flow, and `node-registry.ts::applyEntryRule`
 * keeps the first of those and deletes the rest the next time the graph is
 * opened — which is why two of them is an error and not a preference.
 */
export const OWNED_ENTRY_TYPES = Object.freeze(["start", "trigger"]);

export const SEVERITY_ERROR = "error";
export const SEVERITY_WARNING = "warning";

/*
 * The codes `studio.flows.create` refuses on beyond the plain errors.
 *
 * Both are *warnings* to `graph_validation.py`, and that is not a disagreement
 * about the graph — it is a difference in what happens next. An import lands
 * on a canvas with an author in front of it, so "no entry block" and "nothing
 * routes here" are things they will see and finish. A script creates a flow
 * and walks away: there is no canvas, nobody reads the warning, and what is
 * left behind is a flow nothing can start or a block nothing reaches. Same
 * finding, stricter threshold, and the precedent is already in the tree —
 * `PUT /api/v1/flows/<id>/graph/` applies a check the panel's autosave skips,
 * for the same reason, because nobody is typing on that surface either.
 */
export const CREATE_FATAL_CODES = Object.freeze(["empty_graph", "no_entry", "unreachable"]);

function finding(severity, code, message, extra) {
  return Object.assign({ severity, code, message }, extra || {});
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* How a finding names a block: its id, since that is the one thing an author
 * can search their own file for, plus the title when there is one. Same rule
 * as `graph_validation._label`. */
function label(node) {
  const id = text(node && node.id);
  const title = text(node && node.title);
  if (id && title) return `«${id}» (${title})`;
  return `«${id || title || "?"}»`;
}

function edgeName(edge, index) {
  const id = text(edge && edge.id);
  return id ? `«${id}»` : `${index + 1}-bog'lanish`;
}

/* Every block an update can arrive at, walked forward from the entry blocks.
 * Same walk as `graph_validation._reachable_ids`, and the same reason for
 * starting only at entry blocks: an edge into a `trigger` is not a way to
 * reach it — the canvas gives entry blocks no input dot at all. */
function reachableIds(nodes, edges) {
  const seen = new Set();
  const queue = nodes.filter((node) => ENTRY_TYPES.includes(node.type)).map((node) => String(node.id));
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edges) {
      if (isObject(edge) && String(edge.from) === id) queue.push(String(edge.to));
    }
  }
  return seen;
}

function checkNodes(nodes) {
  const findings = [];
  const seen = new Set();
  nodes.forEach((node, index) => {
    if (!isObject(node)) {
      findings.push(finding(SEVERITY_ERROR, "invalid_node", `${index + 1}-blok obyekt emas — har bir blok JSON obyekt bo'lishi kerak`));
      return;
    }
    const id = text(node.id);
    if (!id) {
      findings.push(
        finding(SEVERITY_ERROR, "missing_node_id", `${index + 1}-blokda «id» yo'q — har bir blokning takrorlanmas id'si bo'lishi kerak`),
      );
      return;
    }
    if (seen.has(id)) {
      findings.push(
        finding(SEVERITY_ERROR, "duplicate_node_id", `«${id}» id'si ikki marta ishlatilgan — id takrorlanmasligi kerak`, { nodeId: id }),
      );
      return;
    }
    seen.add(id);
  });
  return findings;
}

function checkEdges(nodes, edges) {
  const byId = new Map();
  for (const node of nodes) {
    if (isObject(node) && text(node.id)) byId.set(text(node.id), node);
  }

  const findings = [];
  edges.forEach((edge, index) => {
    if (!isObject(edge)) {
      findings.push(finding(SEVERITY_ERROR, "invalid_edge", `${index + 1}-bog'lanish obyekt emas`));
      return;
    }
    const id = text(edge.id);
    const from = edge.from === undefined || edge.from === null ? "" : String(edge.from);
    const to = edge.to === undefined || edge.to === null ? "" : String(edge.to);
    const name = edgeName(edge, index);

    const missing = [from, to].filter((end) => !byId.has(end)).map((end) => `\`${end}\``);
    if (missing.length) {
      findings.push(
        finding(SEVERITY_ERROR, "edge_to_missing_node", `${name} mavjud bo'lmagan blokka ishora qilyapti: ${missing.join(", ")}`, {
          edgeId: id,
        }),
      );
      return;
    }

    const source = byId.get(from);
    if (typeof edge.port !== "string" || !edge.port) {
      /* Not a cosmetic omission, and it is the single most likely thing for a
       * generator to leave out: `Flow.edge` compares `edge["port"] == port`
       * literally, so an edge without one matches nothing, ever. The host's
       * version of this message goes on to list the block's real exits; that
       * needs the vocabulary, so here the sentence stops at the fact. */
      findings.push(
        finding(
          SEVERITY_ERROR,
          "missing_port",
          `${name} bog'lanishida «port» ko'rsatilmagan — ${label(source)} blokining qaysi chiqishidan ketishini yozing`,
          { edgeId: id, nodeId: from },
        ),
      );
      return;
    }

    const target = byId.get(to);
    if (ENTRY_TYPES.includes(target.type)) {
      /* A real misunderstanding rather than a typo: a generator that thinks an
       * entry block is an ordinary step wires the whole flow through it. The
       * edge is simply never walked and the run finishes at the block before. */
      findings.push(
        finding(
          SEVERITY_ERROR,
          "edge_into_entry",
          `${name} ${label(target)} boshlanish blokiga kiryapti — boshlanish bloklariga bog'lanish kirmaydi, ular faqat oqimni ochadi`,
          { edgeId: id, nodeId: to },
        ),
      );
    }
  });
  return findings;
}

function checkShape(nodes, edges) {
  const findings = [];
  const blocks = nodes.filter(isObject);

  const owned = blocks.filter((node) => OWNED_ENTRY_TYPES.includes(node.type));
  if (owned.length > 1) {
    findings.push(
      finding(
        SEVERITY_ERROR,
        "multiple_entries",
        `Oqimda bittadan ortiq boshlanish bloki bor: ${owned.map(label).join(", ")}. ` +
          "Bitta oqim bitta shartga javob beradi — qolganlarini alohida oqimga ajrating",
        { nodeId: text(owned[1].id) },
      ),
    );
  }

  const entries = blocks.filter((node) => ENTRY_TYPES.includes(node.type));
  if (!entries.length) {
    findings.push(
      finding(
        SEVERITY_WARNING,
        "no_entry",
        "Oqimda boshlanish bloki yo'q — uni hech narsa ishga tushirmaydi. `start` yoki `trigger` bloki qo'shing",
      ),
    );
    /* Every block would be reported unreachable, which is one problem said
     * thirty times — and it is already said once, above. */
    return findings;
  }

  const reachable = reachableIds(blocks, edges);
  for (const node of blocks) {
    const id = text(node.id);
    if (!reachable.has(id)) {
      findings.push(
        finding(SEVERITY_WARNING, "unreachable", `${label(node)} blokiga hech qaysi yo'l olib bormaydi — u hech qachon ishlamaydi`, {
          nodeId: id,
        }),
      );
    }
  }
  return findings;
}

/**
 * Everything wrong with this graph, errors and warnings together.
 *
 * Never throws on a malformed payload, for the reason the Python does not
 * either: the caller is being told what is wrong with what they built, and an
 * exception two frames down is not that.
 */
export function checkGraph(graph) {
  if (!isObject(graph)) {
    return [finding(SEVERITY_ERROR, "invalid_graph", "Grafik obyekt bo'lishi kerak: {\"nodes\": [], \"edges\": []}")];
  }
  const nodes = graph.nodes;
  const edges = graph.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return [finding(SEVERITY_ERROR, "invalid_graph", "Grafikda «nodes» va «edges» ro'yxatlari bo'lishi kerak")];
  }
  if (!nodes.length) {
    /* The one rule this file has that `graph_validation.py` does not, and it
     * is a rule about the *caller* rather than about the graph: a blank canvas
     * is the most ordinary thing a person creates from the panel, and it is
     * never a thing a script means to create. `studio.py` states the same one
     * on its own side. */
    return [
      finding(SEVERITY_ERROR, "empty_graph", "Oqimda birorta ham blok yo'q — kamida bitta boshlanish bloki qo'shing"),
    ];
  }

  return [...checkNodes(nodes), ...checkEdges(nodes, edges), ...checkShape(nodes, edges)];
}

/** The findings that stop a `studio.flows.create` — see `CREATE_FATAL_CODES`. */
export function refusals(findings) {
  return findings.filter((item) => item.severity === SEVERITY_ERROR || CREATE_FATAL_CODES.includes(item.code));
}
