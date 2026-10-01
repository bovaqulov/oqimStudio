import type {
  BusinessTriggerConfig,
  DmsTriggerConfig,
  FlowEdge,
  FlowNode,
  ModuleKey,
  NodeType,
} from "../types";

/** Row the starter blocks sit in, and the column each one takes — mirrors the seeded flows' spacing. */
const ROW_Y = 40;
const ENTRY_X = 300;

/**
 * Horizontal step between two starter blocks — the flow reads left to right,
 * because an exit leaves a card's right edge and lands on the next card's left
 * one. Laid out downwards instead, every edge in a brand-new flow would bulge
 * out of the right of one block and double back into the left of the one under
 * it: legible, but wrong-looking on the first screen anybody sees, and fixable
 * only by pressing "Tartiblash" on a flow nobody has touched yet.
 *
 * Wide enough for the *widest* a card can get (`MAX_NODE_WIDTH`) plus the gap
 * the editor's own tidy-up leaves, so a long trigger title can never overlap
 * the block it points at. Spelled as a number rather than imported: the backend
 * mirrors these coordinates in `apps/flows/services.py::starter_graph()`, and a
 * value this file computed would be one the other copy could not.
 */
const COLUMN_STEP = 384;

interface EntryBlock {
  type: NodeType;
  title: string;
  text: string;
  dmsTrigger?: DmsTriggerConfig;
  business?: BusinessTriggerConfig;
}

/**
 * The block that opens a flow, per module. Kept here rather than read from
 * `features/flow-builder/node-registry.ts` — the repository is the lower
 * layer, and the registry already imports this feature's types.
 *
 * The two modules whose Handler has a trigger editor (`dms`, `business` — see
 * `NodeFields`) open with that trigger already filled in, so a new flow is a
 * working bot the moment it is saved and its card names what fires it.
 */
const MODULE_ENTRY: Record<ModuleKey, EntryBlock> = {
  /*
   * Only the main flow opens on this one — see DMS_SUBFLOW_ENTRY below. It is
   * the "start" block type rather than a Handler carrying a command: the block
   * is the module's entry point, so it is not the author's to delete or to
   * point at another command.
   */
  dms: { type: "start", title: "start", text: "" },
  business: {
    type: "trigger",
    title: "Yangi xabar",
    text: "Mijoz biznes akkauntga yozganda",
    // The working-hours layer is left unset on purpose:
    // `features/flow-builder/lib/trigger.ts` supplies its default, so a new
    // flow opens as the widest useful Handler and narrows from there.
    business: {
      messageTypes: ["new"],
      match: "any",
    },
  },
  webapp: { type: "trigger", title: "Handler", text: "Shartni tanlang" },
  groups: { type: "groupjoin", title: "Yangi a'zo qo'shildi", text: "Guruhga yangi a'zo qo'shilganda" },
  channels: { type: "channelpost", title: "Yangi post", text: "Kanalga yangi post joylanganda" },
};

/**
 * Every `dms` flow except the main one. `/start` belongs to the main flow and
 * to nothing else — a second block answering it would race the module's own
 * entry point — so a flow created next to it opens on a command of its own,
 * waiting for its name. It runs on that command whether or not anything ever
 * links to it.
 */
const DMS_SUBFLOW_ENTRY: EntryBlock = {
  type: "trigger",
  title: "Buyruq",
  text: "Buyruq yozilganda",
  dmsTrigger: { kinds: ["command"] },
};

/**
 * What a brand-new flow opens with: the module's entry block and a greeting —
 * never a blank canvas.
 *
 * A bot's first contact is a hello, so that is what the starter is. It used to
 * be a four-question intake on the `dms` main flow, which answered a question
 * nobody had asked yet: an owner opening their first flow wants to see the bot
 * say something, not to collect a phone number before it has said hello. The
 * intake is still one click away — it is the "Anketa: mijoz ma'lumotlari"
 * template in `features/flow-kit/recipes/dms.ts`.
 *
 * Every block here is an ordinary one apart from the entry: rename, rewire or
 * delete them like any other. The entry block is the flow's own — one per
 * flow, neither addable nor deletable from the editor (see
 * `flow-builder/node-registry.ts`, `applyEntryRule`), which is also what puts
 * one there when a flow arrives without it.
 */
function createStarterNodes(entry: EntryBlock): FlowNode[] {
  const base = { y: ROW_Y, channel: "tg" as const, scopes: ["private"] };
  const column = (index: number) => ENTRY_X + index * COLUMN_STEP;

  const nodes: FlowNode[] = [
    {
      ...base,
      id: "n1",
      type: entry.type,
      x: column(0),
      title: entry.title,
      text: entry.text,
      ...(entry.dmsTrigger ? { dmsTrigger: entry.dmsTrigger } : {}),
      ...(entry.business ? { business: entry.business } : {}),
    },
    {
      ...base,
      id: "n2",
      type: "message",
      x: column(1),
      title: "Xush kelibsiz",
      text: "Assalomu alaykum! 👋\nSizga yordam berish uchun shu yerdaman — savolingizni yozing.",
      buttons: [],
    },
  ];

  return nodes;
}

export function createStarterGraph(
  moduleKey: ModuleKey,
  options?: { main?: boolean },
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const entry = moduleKey === "dms" && !options?.main ? DMS_SUBFLOW_ENTRY : MODULE_ENTRY[moduleKey];
  const nodes = createStarterNodes(entry);

  return {
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `e${index + 1}`,
      from: node.id,
      port: "out",
      to: nodes[index + 1]!.id,
    })),
  };
}
