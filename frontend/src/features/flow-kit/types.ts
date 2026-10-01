import type { IconName } from "@/components/ui/Icon";
import type { FlowNode, ModuleKey, NodeType } from "@/features/flows";

/**
 * The no-code layer: "when this happens → do that", expressed in the words a
 * shop owner uses, and compiled down to the same `FlowNode`/`FlowEdge` graph the
 * visual editor already edits.
 *
 * Nothing here is specific to one module. A module contributes a `ModuleKit`
 * (see `registry.ts`) holding its own triggers, actions and templates; the
 * wizard, the template gallery and the graph builder are written once against
 * these types and work for `business`, `groups`, `channels`, `dms` and `webapp`
 * alike (Open/Closed — a new module is a new kit, not a new screen).
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a recipe still needs from the author, declared rather than rendered.
 * The wizard owns the one renderer per kind (`components/RecipeFields.tsx`), so
 * a recipe never writes markup and every module's questions look and behave the
 * same.
 */
export type RecipeInputKind =
  /** One line — a command name, a queue, an address. */
  | "text"
  /** A message body. Rendered with the variable hint and the preset chips. */
  | "textarea"
  /** One term per line, entered and removed as chips. */
  | "keywords"
  /** Exactly one of a closed set. */
  | "choice"
  /** Any number of a closed set, at least one. */
  | "chips"
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  | "days"
  /** "HH:MM-HH:MM" — one value, because a window is one decision. */
  | "time-range"
  /** Minutes, hours, counts. */
  | "number";

/** A JSON-simple value, so a whole blueprint survives the trip to a server action. */
export type RecipeValue = string | string[] | number;
export type RecipeValues = Record<string, RecipeValue>;

export interface RecipeChoice {
  value: string;
  label: string;
  /** Shown under the label — what picking this one actually means. */
  hint?: string;
  icon?: IconName;
}

/** Ready-made text for a `textarea`, offered as one-tap chips above the field. */
export interface RecipePreset {
  label: string;
  value: string;
}

export interface RecipeInput {
  key: string;
  kind: RecipeInputKind;
  label: string;
  /** One line under the label, in plain language — never a restatement of the label. */
  hint?: string;
  placeholder?: string;
  /**
   * The wizard refuses to move on while this is empty, and says which field is
   * missing. Everything else can be left at its default.
   */
  required?: boolean;
  /** `choice` / `chips`. */
  choices?: RecipeChoice[];
  /** `textarea` — the "tez javob shablonlari" library for this field. */
  presets?: RecipePreset[];
  /** `number`. */
  min?: number;
  max?: number;
  step?: number;
  /** `number` — the word after the field: "daqiqa", "kun". */
  unit?: string;
  default: RecipeValue;
}

/* -------------------------------------------------------------------------- */
/* Blocks a recipe emits                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One block, minus everything the builder decides: its id and its place on the
 * canvas. A recipe describes what the block *is*; where it sits is layout.
 */
export interface NodeDraft extends Omit<Partial<FlowNode>, "id" | "x" | "y" | "type"> {
  type: NodeType;
  title: string;
  text: string;
  /**
   * Which of this block's exits the rest of the flow hangs from. Only a branch
   * block needs it — a "first message?" gate continues out of "Ha", leaving
   * "Yo'q" open for the author to fill in later. Defaults to the plain "out".
   */
  nextPort?: string;
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

interface RecipeBase {
  key: string;
  /** Reads as a thing, not a setting: "Ish vaqtidan tashqari", "Operatorga uzatish". */
  label: string;
  /** One sentence naming the real Telegram event or effect behind it. */
  description: string;
  icon: IconName;
  inputs: RecipeInput[];
}

export interface TriggerRecipe extends RecipeBase {
  /**
   * The "Qachon" clause, with the author's own values folded in: "Ish kunlari
   * 09:00–18:00 dan tashqarida xabar kelganda". What the wizard's review step,
   * the flow card and the template card all read.
   */
  summary(values: RecipeValues): string;
  /**
   * The entry block, plus any gate that belongs to the trigger itself (a "first
   * message?" condition is part of *when*, not of what happens next).
   */
  build(values: RecipeValues): NodeDraft[];
}

export interface ActionRecipe extends RecipeBase {
  /** The "Nima bo'ladi" clause: "«Narxlar…» xabarini yuboradi". */
  summary(values: RecipeValues): string;
  build(values: RecipeValues): NodeDraft[];
  /**
   * Ends the run — an operator has the chat now, so nothing the bot could do
   * afterwards would happen. The wizard stops offering steps after one of these.
   */
  terminal?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Blueprints and templates                                                    */
/* -------------------------------------------------------------------------- */

/** A recipe plus the answers it was given — the unit both the wizard and a template store. */
export interface BlueprintStep {
  recipe: string;
  values: RecipeValues;
}

/**
 * A whole flow as choices rather than as a graph. Small enough to hand to a
 * server action, which rebuilds the graph from the module's kit — the browser
 * never posts nodes and edges it could have tampered with.
 */
export interface FlowBlueprint {
  moduleKey: ModuleKey;
  trigger: BlueprintStep;
  actions: BlueprintStep[];
  name?: string;
}

/** The flow in one plain-language line, split so the UI can style the halves. */
export interface BlueprintSummary {
  when: string;
  then: string[];
}

/**
 * A working flow behind one click. Not a starting point to be finished — every
 * template arrives complete enough to answer a real customer, and the editor is
 * where it gets personal.
 */
export interface FlowTemplate {
  key: string;
  name: string;
  /** What it does, in the owner's words. */
  description: string;
  /** Why you would turn it on — the line that sells it on the card. */
  outcome: string;
  icon: IconName;
  /** Gallery filters: "qo'llab-quvvatlash", "sotuv", "o'quv markazi"… */
  tags: string[];
  /** Marked in the gallery as the one most accounts should start from. */
  recommended?: boolean;
  trigger: BlueprintStep;
  actions: BlueprintStep[];
}

/* -------------------------------------------------------------------------- */
/* Kits                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything one module can automate. The five kits are the only place a module
 * differs — every screen in `flow-kit/components` is written against this shape.
 */
export interface ModuleKit {
  moduleKey: ModuleKey;
  /** What fires a flow here, as a noun: "Mijoz xabari", "Guruh hodisasi". */
  eventNoun: string;
  /** The wizard's first-step question, in the module's own terms. */
  triggerQuestion: string;
  /** The wizard's second-step question. */
  actionQuestion: string;
  triggers: TriggerRecipe[];
  actions: ActionRecipe[];
  templates: FlowTemplate[];
}
