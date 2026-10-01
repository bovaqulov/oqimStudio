"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { moduleHref } from "@/features/bots/modules";
import { getSession } from "@/features/workspace/session";
import { flowsRepository } from "./data/flows-repository";
import type { FlowEdge, FlowNode, ModuleKey } from "./types";

export async function createModuleFlowAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const botId = String(formData.get("botId") ?? "");
  const moduleKey = String(formData.get("moduleKey") ?? "") as ModuleKey;
  if (!projectId || !botId || !moduleKey) return;

  const { workspace } = await getSession();
  const flow = await flowsRepository.create({ workspaceId: workspace.id, projectId, botId, moduleKey });
  redirect(`/flows/${flow.id}`);
}

export interface ExtractFlowInput {
  projectId: string;
  botId: string;
  moduleKey: ModuleKey;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Creates the flow a branch is being split into and hands its id back.
 *
 * The only action here that does not redirect: the editor is mid-edit when it
 * calls this, and it still has to drop the moved blocks from the flow on
 * screen and write both graphs down. It navigates itself once that is done —
 * a redirect from here would leave the source flow holding blocks that now
 * live in two places.
 */
export async function extractFlowAction(input: ExtractFlowInput): Promise<{ id: string }> {
  const { workspace } = await getSession();
  const flow = await flowsRepository.create({
    workspaceId: workspace.id,
    projectId: input.projectId,
    botId: input.botId,
    moduleKey: input.moduleKey,
    name: input.name,
    description: "Boshqa oqimdan ajratilgan",
    graph: { nodes: input.nodes, edges: input.edges },
  });
  return { id: flow.id };
}

/**
 * The flow's on/off switch. Revalidates rather than redirects: the author is
 * looking at the module list when they flip it, and a redirect would throw away
 * their scroll position and any open panel to land them back where they already
 * were.
 */
export async function setFlowEnabledAction(input: {
  flowId: string;
  botId: string;
  moduleKey: ModuleKey;
  enabled: boolean;
}): Promise<{ enabled: boolean } | undefined> {
  const { workspace } = await getSession();
  const flow = await flowsRepository.setEnabled(workspace.id, input.flowId, input.enabled);
  if (!flow) return undefined;
  // Through `moduleHref` because the default module answers on the bot's own
  // URL: revalidating the path this flow is *listed* on is the point, and for
  // "Bot ichida" that page is `/bots/<id>`.
  revalidatePath(moduleHref(input.botId, input.moduleKey));
  return { enabled: flow.enabled ?? input.enabled };
}

/**
 * Deleting a flow. Revalidates rather than redirects, for the reason
 * `setFlowEnabledAction` above does and one more of its own.
 *
 * It used to `redirect(moduleHref(...))`, which was a redirect to the page the
 * only caller was already on — invisible there, and wrong the moment a second
 * list grew the same menu. A flow is listed twice: on its module's page and on
 * the home screen. Deleting one from the home screen threw the reader onto a
 * bot page they had not asked to see, and the row they meant to lose was gone
 * from a screen they were no longer looking at.
 *
 * Both paths are named because both hold a copy of the row, and neither page
 * is the one the reader is necessarily standing on.
 */
export async function deleteFlowAction(formData: FormData): Promise<void> {
  const flowId = String(formData.get("flowId") ?? "");
  const botId = String(formData.get("botId") ?? "");
  const moduleKey = String(formData.get("moduleKey") ?? "") as ModuleKey;
  if (!flowId || !botId || !moduleKey) return;

  const { workspace } = await getSession();
  await flowsRepository.delete(workspace.id, flowId);
  revalidatePath(moduleHref(botId, moduleKey));
  revalidatePath("/dashboard");
}
