import {
  getNodeDefinition,
  nodeSupportsButtons,
  nodeWidth,
  type NodeTypeDefinition,
} from "@/features/flow-builder/node-registry";
import type { FlowEdge, FlowNode, NodeType } from "@/features/flows";
import type {
  ActionRecipe,
  BlueprintStep,
  BlueprintSummary,
  FlowBlueprint,
  FlowTemplate,
  ModuleKit,
  NodeDraft,
  TriggerRecipe,
} from "../types";
import { withDefaults } from "./inputs";

/**
 * Compiles a blueprint — a trigger and a list of actions, each with its answers
 * — into the graph the visual editor opens. One column, top to bottom, in the
 * order the runtime executes it: the wizard's list of steps and the canvas the
 * author lands on are the same thing seen twice.
 *
 * Pure, and shared by both sides: the wizard builds the graph locally to preview
 * it, and the server action builds it again from the same recipe keys before
 * writing it down. The browser never posts a graph.
 */

/** The row the starter graphs already use, so a built flow lines up with a hand-made one. */
const ROW_Y = 40;
const FIRST_X = 300;
/**
 * Air after a block before the next one starts — enough for an edge to read as
 * a step. Rightwards, because that is the direction an exit leaves a card in;
 * built downwards, every edge would bulge out of one block's right side and
 * double back into the left of the one below it.
 */
const COLUMN_GAP = 120;
/** Floor on the step, so a run of narrow blocks does not read as one lump. */
const MIN_COLUMN_STEP = 260;

export function findTrigger(kit: ModuleKit, key: string): TriggerRecipe | undefined {
  return kit.triggers.find((recipe) => recipe.key === key);
}

export function findAction(kit: ModuleKit, key: string): ActionRecipe | undefined {
  return kit.actions.find((recipe) => recipe.key === key);
}

/**
 * Whether the editor still has this block type.
 *
 * A recipe names its blocks by string and the palette those names come from is
 * the editor's, so the two can be out of step in one direction the compiler
 * cannot see: `NodeType` gains a member (`features/flows/types.ts`) before the
 * registry gains its definition. A draft naming such a type type-checks and
 * then produces a node the canvas cannot even measure — `nodeWidth` reads a
 * definition that is not there — which is a card drawn as a hole in the
 * middle of somebody's new flow.
 *
 * The annotation is the point: `getNodeDefinition` promises a definition, and
 * the whole question here is whether it kept the promise.
 */
export function isKnownNodeType(type: NodeType): boolean {
  const definition: NodeTypeDefinition | undefined = getNodeDefinition(type);
  return definition !== undefined;
}

/** The drafts a step contributes, with its recipe's defaults filled in — `[]` for a key the kit no longer has. */
function draftsOf(recipe: TriggerRecipe | ActionRecipe | undefined, step: BlueprintStep): NodeDraft[] {
  if (!recipe) return [];
  return recipe.build(withDefaults(recipe.inputs, step.values));
}

/**
 * Every draft the blueprint produces, in execution order: the trigger's blocks
 * (its entry, plus any gate that belongs to *when* rather than to *what*), then
 * one group per action.
 */
export function blueprintDrafts(kit: ModuleKit, blueprint: FlowBlueprint): NodeDraft[] {
  return [
    ...draftsOf(findTrigger(kit, blueprint.trigger.recipe), blueprint.trigger),
    ...blueprint.actions.flatMap((step) => draftsOf(findAction(kit, step.recipe), step)),
  ];
}

/**
 * Drafts into a wired graph.
 *
 * Each block is joined to the next through the port the previous one names —
 * "out" for almost everything, "yes" for a gate, which leaves its "Yo'q" exit
 * open on purpose: the author decides what happens to a customer the flow was
 * not built for, and an edge invented here would answer that for them.
 */
export function buildGraphFromDrafts(
  rawDrafts: NodeDraft[],
  moduleKey: FlowBlueprint["moduleKey"],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  // A step naming a block the editor does not have is dropped here rather than
  // drawn as a card nothing can render, and the chain closes over the gap: the
  // edges below are built from what survived, in order. The flow is then short
  // of a step, which is why the gallery refuses to offer such a template at
  // all — see [[isBuildableTemplate]].
  const drafts = rawDrafts.filter((draft) => isKnownNodeType(draft.type));
  const nodes: FlowNode[] = [];
  let x = FIRST_X;

  drafts.forEach((draft, index) => {
    const { nextPort: _nextPort, ...rest } = draft;
    const node: FlowNode = {
      channel: "tg",
      scopes: ["private"],
      ...rest,
      id: `n${index + 1}`,
      x,
      y: ROW_Y,
    };
    // A keyboard the module cannot deliver is dropped here rather than left for
    // the editor's load-time cleanup: the preview in the wizard has to show what
    // the customer will really see, and that is a message with no buttons.
    if (node.buttons && !nodeSupportsButtons(node.type, moduleKey)) {
      delete node.buttons;
      delete node.buttonMode;
    }
    nodes.push(node);
    x += Math.max(MIN_COLUMN_STEP, nodeWidth(node) + COLUMN_GAP);
  });

  const edges: FlowEdge[] = [];
  drafts.forEach((draft, index) => {
    const from = nodes[index];
    const to = nodes[index + 1];
    if (!from || !to) return;
    edges.push({ id: `e${index + 1}`, from: from.id, port: draft.nextPort ?? "out", to: to.id });
  });

  return { nodes, edges };
}

export function buildBlueprintGraph(
  kit: ModuleKit,
  blueprint: FlowBlueprint,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return buildGraphFromDrafts(blueprintDrafts(kit, blueprint), blueprint.moduleKey);
}

/**
 * The blueprint as one plain-language line — the sentence the wizard's review
 * step, the flow card and the template card all read, so what was chosen and
 * what was built can never describe different flows.
 */
export function summarizeBlueprint(kit: ModuleKit, blueprint: FlowBlueprint): BlueprintSummary {
  const trigger = findTrigger(kit, blueprint.trigger.recipe);
  return {
    when: trigger
      ? trigger.summary(withDefaults(trigger.inputs, blueprint.trigger.values))
      : kit.eventNoun.toLowerCase(),
    then: blueprint.actions.flatMap((step) => {
      const action = findAction(kit, step.recipe);
      return action ? [action.summary(withDefaults(action.inputs, step.values))] : [];
    }),
  };
}

/** A template as a blueprint, ready for the wizard to open or the action to save. */
export function templateBlueprint(kit: ModuleKit, templateKey: string): FlowBlueprint | undefined {
  const template = kit.templates.find((item) => item.key === templateKey);
  if (!template) return undefined;
  return {
    moduleKey: kit.moduleKey,
    name: template.name,
    trigger: template.trigger,
    actions: template.actions,
  };
}

/**
 * Whether this template still compiles to the flow its card promises.
 *
 * A template is sold as finished — "bir bosishda yoqiladi va darhol ishlaydi"
 * — so one silently missing step is worse than one missing template: nothing
 * on the card, and nothing on the canvas afterwards, says which step went. It
 * fails this check when a recipe key the kit no longer carries is named, or
 * when a block type the editor no longer has is (see [[isKnownNodeType]]).
 *
 * Every step is asked, not just the entry: the gallery would rather show seven
 * templates that work than eight of which one quietly does six-sevenths of
 * what it says.
 */
export function isBuildableTemplate(kit: ModuleKit, template: FlowTemplate): boolean {
  const trigger = findTrigger(kit, template.trigger.recipe);
  if (!trigger) return false;
  if (template.actions.some((step) => !findAction(kit, step.recipe))) return false;

  const drafts = blueprintDrafts(kit, {
    moduleKey: kit.moduleKey,
    trigger: template.trigger,
    actions: template.actions,
  });
  return drafts.length > 0 && drafts.every((draft) => isKnownNodeType(draft.type));
}

/** The kit's templates minus any the editor's current block set cannot build. */
export function buildableTemplates(kit: ModuleKit): FlowTemplate[] {
  return kit.templates.filter((template) => isBuildableTemplate(kit, template));
}
