/**
 * Reading a graph out of text somebody pasted.
 *
 * This runs in the browser, before anything is sent anywhere, because the two
 * commonest failures — "that was not JSON" and "that was JSON, but not a
 * graph" — need no server to name and a round trip to say them is a round trip
 * spent telling the author something the text itself already showed.
 *
 * Nothing here judges whether the graph is *correct*: that is the validation
 * endpoint's job, and duplicating its rules on this side would give the author
 * two sets of rules that drift apart. All this settles is whether there is a
 * graph in the box at all.
 */

/** What a paste turns into once it is known to hold a graph. */
export interface ParsedFlowJson {
  /**
   * Passed on untouched. The nodes and edges are `unknown[]` on purpose — the
   * backend is what knows a block from a shape that merely looks like one, and
   * casting them to `FlowNode` here would be this side claiming an answer it
   * has not checked.
   */
  graph: { nodes: unknown[]; edges: unknown[] };
  /** The name the file carries. Empty for a bare graph, which the panel fills in. */
  name: string;
  description: string;
  /** Raw — the panel decides whether it names a module this studio can run. */
  moduleKey: string;
  /**
   * The flow's own JavaScript, when the file carries any. Empty otherwise —
   * the export omits the key for a flow with no code, so "absent" is the
   * ordinary case rather than a damaged file.
   *
   * Read off the envelope only, the rule `name` and `description` already
   * follow: inside a bare `{nodes, edges}` a key belongs to the graph, and one
   * hand-written file would otherwise mean two different things depending on
   * how deep it was nested.
   *
   * Not trimmed, unlike the two above. This is a source file, and a parser
   * that quietly strips what it was handed is a parser editing somebody's
   * code — the same reason the backend's field sets `trim_whitespace=False`.
   */
  script: string;
}

export type FlowJsonParse = { ok: true; value: ParsedFlowJson } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Undoes what a chat window does to a JSON answer.
 *
 * The whole point of this screen is a graph written in another model, and a
 * model answering with JSON wraps it in a fenced code block. Copying the answer
 * copies the fence, and refusing that paste as "not JSON" would be technically
 * true and useless — the author can see the graph sitting there.
 */
function unfence(raw: string): string {
  // The BOM is written as an escape: a literal U+FEFF here is invisible in
  // every editor, and the one place it must not be is the file that strips it.
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

export function parseFlowJson(raw: string): FlowJsonParse {
  const source = unfence(raw);
  if (!source) return { ok: false, message: "JSON kiritilmagan — matnni qo'ying yoki fayl tanlang." };

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    // The engine's own message is appended because it names the offset, and
    // "45-belgida" is the difference between finding the stray comma and
    // re-reading the whole file.
    const detail = error instanceof Error ? error.message : "";
    return {
      ok: false,
      message: detail ? `Bu JSON emas: ${detail}` : "Bu JSON emas — matnni tekshiring.",
    };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      message: Array.isArray(value)
        ? "JSON ro'yxat bo'lib kelgan. Kutilgani — «nodes» va «edges» kalitlari bo'lgan obyekt."
        : "JSON obyekt emas. Kutilgani — «nodes» va «edges» kalitlari bo'lgan obyekt.",
    };
  }

  // Two shapes are accepted and it matters that both are: what "Yuklab olish"
  // hands over is the envelope (`{schemaVersion, name, graph}`), so the loop
  // export → boshqa AI → import only closes if what came out goes back in
  // unedited. A bare `{nodes, edges}` is what somebody writes by hand.
  const inner = isRecord(value.graph) ? value.graph : null;
  const envelope = inner ? value : null;
  const graph = inner ?? value;

  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) {
    return { ok: false, message: "«nodes» ro'yxati topilmadi — bu oqim grafigi emas." };
  }
  if (nodes.length === 0) {
    return { ok: false, message: "«nodes» bo'sh — importda hech qanday blok yaratilmaydi." };
  }

  // A one-block flow legitimately has none, so an absent list is empty rather
  // than an error; a list that is present but not a list is a broken file.
  const edges = graph.edges === undefined ? [] : graph.edges;
  if (!Array.isArray(edges)) {
    return { ok: false, message: "«edges» ro'yxat emas — faylni tekshiring." };
  }

  return {
    ok: true,
    value: {
      graph: { nodes, edges },
      name: text(envelope?.name).trim(),
      description: text(envelope?.description).trim(),
      moduleKey: text(envelope?.moduleKey),
      script: text(envelope?.script),
    },
  };
}
