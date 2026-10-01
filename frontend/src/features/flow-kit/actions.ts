"use server";

import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/server";
import { flowsRepository, type FlowOrigin, type ModuleKey } from "@/features/flows";
import { getSession } from "@/features/workspace/session";
import {
  buildBlueprintGraph,
  findTrigger,
  isBuildableTemplate,
  summarizeBlueprint,
  templateBlueprint,
} from "./lib/build-graph";
import { getModuleKit } from "./registry";
import type { BlueprintStep, FlowBlueprint } from "./types";

/**
 * Creating a flow from a blueprint.
 *
 * The browser posts recipe *keys and answers*, never nodes and edges: the graph
 * is compiled here from the module's own kit, so a tampered payload can only
 * ever produce a flow the kit was already able to build. It is also why the
 * wizard's preview and the saved flow cannot drift — both run the same builder.
 */

/**
 * What the caller gets back.
 *
 * Nothing at all means the flow was created and the reader has been redirected
 * into it — a successful `redirect()` never returns. Anything else is a refusal
 * the caller has to *show*, which is the whole point of this type: the backend
 * answers "your plan covers five flows" with a 402, and that is a sentence
 * somebody can act on, not a crash. Letting the `ApiError` escape turned it
 * into a 500, a blank error boundary, and three wizard steps of work thrown
 * away with nowhere to get them back from.
 */
export interface CreateFlowFailure {
  status: "error";
  message: string;
  /**
   * The backend's own code for the refusal. Only `plan_limit` is acted on: it
   * is the one failure with somewhere for the reader to go, so the sheet can
   * offer the plan page beside the message instead of leaving them re-reading
   * "tarifni oshiring" with no way to.
   */
  code?: string;
}

/** Anything wrong that is not a refusal we can name. */
const GENERIC_FAILURE: CreateFlowFailure = {
  status: "error",
  message: "Oqim saqlanmadi — qayta urinib ko'ring.",
};

export interface CreateFromBlueprintInput {
  projectId: string;
  botId: string;
  moduleKey: ModuleKey;
  trigger: BlueprintStep;
  actions: BlueprintStep[];
  /** Left empty by the wizard when the author never renamed the suggestion. */
  name?: string;
  /** Set when the blueprint came from the gallery, so the flow remembers its template. */
  templateKey?: string;
  /** Whether it goes live immediately. The wizard asks; the gallery says yes. */
  enabled?: boolean;
}

/** "Kalit so'z → 2 amal" — the description a flow carries when nobody wrote one. */
function describeBlueprint(moduleKey: ModuleKey, blueprint: FlowBlueprint): string {
  const kit = getModuleKit(moduleKey);
  const summary = summarizeBlueprint(kit, blueprint);
  const when = summary.when.charAt(0).toUpperCase() + summary.when.slice(1);
  return summary.then.length ? `${when} → ${summary.then[0]}` : when;
}

function originOf(input: CreateFromBlueprintInput): FlowOrigin {
  const kit = getModuleKit(input.moduleKey);
  const template = input.templateKey
    ? kit.templates.find((item) => item.key === input.templateKey)
    : undefined;
  if (template) return { kind: "template", key: template.key, label: `Shablon · ${template.name}` };
  return { kind: "wizard", label: "Sozlash yordamchisi bilan yaratilgan" };
}

export async function createFlowFromBlueprintAction(
  input: CreateFromBlueprintInput,
): Promise<CreateFlowFailure | undefined> {
  const kit = getModuleKit(input.moduleKey);
  // An unknown trigger key means the payload does not describe a flow this
  // module can run.
  if (!findTrigger(kit, input.trigger.recipe)) {
    return { status: "error", message: "Bu boshlanish sharti bu bo'limda ishlamaydi." };
  }

  const blueprint: FlowBlueprint = {
    moduleKey: input.moduleKey,
    trigger: input.trigger,
    actions: input.actions,
  };

  const { workspace } = await getSession();

  let flow;
  try {
    flow = await flowsRepository.create({
      workspaceId: workspace.id,
      projectId: input.projectId,
      botId: input.botId,
      moduleKey: input.moduleKey,
      name: input.name?.trim() || undefined,
      description: describeBlueprint(input.moduleKey, blueprint),
      graph: buildBlueprintGraph(kit, blueprint),
      origin: originOf(input),
      enabled: input.enabled ?? false,
    });
  } catch (error) {
    // A plan limit (402) is the backend answering, not failing — its message is
    // already written for the reader, so it is passed through verbatim.
    if (error instanceof ApiError) return { status: "error", message: error.message, code: error.code };
    console.error("createFlowFromBlueprintAction failed", error);
    return GENERIC_FAILURE;
  }

  // Outside the `try`, and it has to stay outside: `redirect()` works by
  // throwing, and a catch around it would swallow the navigation and report a
  // failure for a flow that was created.
  //
  // A refused switch-on is not a failed creation, so the author still lands in
  // their new flow — with the reason it is paused, rather than a toggle that is
  // mysteriously off after a button that said it would be on.
  const notice = input.enabled && !flow.enabled ? "?notice=not-enabled" : "";
  redirect(`/flows/${flow.id}${notice}`);
}

export interface CreateFromTemplateInput {
  projectId: string;
  botId: string;
  moduleKey: ModuleKey;
  templateKey: string;
}

/**
 * One click in the gallery. The template's own answers are the blueprint, so the
 * flow arrives complete and switched on — a template that lands paused is a
 * template the author has to go and find a switch for before it does anything.
 */
export async function createFlowFromTemplateAction(
  input: CreateFromTemplateInput,
): Promise<CreateFlowFailure | undefined> {
  const kit = getModuleKit(input.moduleKey);
  const blueprint = templateBlueprint(kit, input.templateKey);
  if (!blueprint) return GENERIC_FAILURE;
  // The same check the gallery filters on, asked again here: a template whose
  // blocks the editor no longer has would land as a flow missing a step, and
  // the gallery is not the only way into this action.
  const template = kit.templates.find((item) => item.key === input.templateKey);
  if (!template || !isBuildableTemplate(kit, template)) return GENERIC_FAILURE;

  return createFlowFromBlueprintAction({
    projectId: input.projectId,
    botId: input.botId,
    moduleKey: input.moduleKey,
    trigger: blueprint.trigger,
    actions: blueprint.actions,
    name: blueprint.name,
    templateKey: input.templateKey,
    enabled: true,
  });
}
