import type { FlowSchema, FlowSchemaNodeType } from "./transfer-types";

/**
 * The block vocabulary, written out as something to paste into another model.
 *
 * This is the piece everybody forgets, and the loop does not work without it.
 * A model asked for "a Telegram bot flow as JSON" invents port names — `next`,
 * `default`, `success` — and every one of them comes back from the validator
 * as an edge leaving a port nobody publishes. Worse at run time than at import:
 * `walk` finds no edge, and the bot goes quiet at that block with nothing
 * anywhere saying why.
 *
 * One button and one string, not a page the reader assembles. The moment this
 * is three things to copy in the right order it becomes a thing people skip.
 *
 * The guards below are tolerant of shapes the contract does not describe. This
 * is our own backend answering, so a mismatch is a bug rather than untrusted
 * input — but the failure mode matters: a shorter line in a prompt is a worse
 * prompt, and a thrown error is a Kod tab that does not open.
 */

function portNames(ports: unknown): string[] {
  return Array.isArray(ports) ? ports.filter((port): port is string => typeof port === "string") : [];
}

/**
 * One line per field, and the sentence beside it.
 *
 * The sentences are what make this worth copying — `dmsTrigger` alone means
 * nothing to a model that has never seen the editor, while the line the backend
 * writes for it spells out the whole object.
 */
function fieldLines(fields: unknown): string[] {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields as Record<string, unknown>).map(([name, hint]) =>
    typeof hint === "string" && hint ? `    ${name} — ${hint}` : `    ${name}`,
  );
}

/** One block type, said the way a reader with no editor in front of them needs it. */
function describe(node: FlowSchemaNodeType): string {
  const head = [`- ${node.type} — ${node.label}`];
  if (node.entry) head.push("oqim shu blokdan boshlanadi, unga bog'lanish kirmaydi");
  const ports = portNames(node.ports);
  // "chiqishi yo'q" is said out loud rather than left as an absence: it is the
  // whole of what «Tugatish» is, and a missing line reads as an omission.
  head.push(ports.length ? `chiqishlar: ${ports.join(", ")}` : "chiqishi yo'q — oqim shu yerda tugaydi");
  if (node.buttonPorts) head.push("har bir tugma btn:<tugma id> chiqishini beradi");
  if (node.backPort) head.push("«Orqaga» qatori back chiqishini beradi");
  if (node.bodyLabel) head.push(`asosiy maydon: ${node.bodyLabel}${node.bodyRequired ? " (majburiy)" : ""}`);
  return [head.join(" · "), ...fieldLines(node.fields)].join("\n");
}

export function buildSchemaPrompt(schema: FlowSchema): string {
  return [
    "Menga Oqim Studio uchun Telegram bot oqimining grafigini JSON ko'rinishida yoz.",
    "",
    schema.howTo.trim(),
    "",
    `Bloklar lug'ati (schema v${schema.version}) — faqat shu turlar va shu chiqish nomlari ishlaydi:`,
    ...schema.nodeTypes.map(describe),
    "",
    'Javobni faqat JSON qilib ber, izohsiz: {"nodes": [...], "edges": [...]}.',
  ].join("\n");
}
