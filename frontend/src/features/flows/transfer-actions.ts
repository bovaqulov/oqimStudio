"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { moduleHref, toAvailableModuleKey } from "@/features/bots/modules";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";
import { flowTransferRepository } from "./data/transfer-repository";
import { parseFlowJson } from "./import-json";
import type { FlowImportCheck, FlowImportState } from "./transfer-types";

/**
 * The two writes behind the import panel.
 *
 * Kept apart from `actions.ts` for the same reason the repository is kept apart
 * from `flows-repository`: these two are the only calls in the app whose input
 * was written outside it, and the checks that go with that belong somewhere a
 * reader can find them all at once.
 */

/** Said the same way by both actions, so a refusal cannot read as a validation failure. */
const NO_RIGHTS = "Oqim import qilish uchun muharrir huquqi kerak.";

/**
 * Reads the graph and reports, creating nothing.
 *
 * Behind the same role check as the import itself, even though it writes
 * nothing: a viewer who is allowed to paste, validate and only then be told no
 * has been walked through four steps to reach an answer that was settled at the
 * first one.
 */
export async function validateFlowImportAction(graph: {
  nodes: unknown[];
  edges: unknown[];
}): Promise<FlowImportCheck> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: NO_RIGHTS };

  try {
    return { status: "checked", validation: await flowTransferRepository.validate(workspace.id, graph) };
  } catch (error) {
    // Named rather than swallowed: the panel's next step is a button that
    // creates a flow, and "tekshirib bo'lmadi" is what stands between the
    // author and pressing it in the belief that the graph passed.
    const message = error instanceof ApiError ? error.message : "Grafikni tekshirib bo'lmadi — server javob bermadi.";
    if (!(error instanceof ApiError)) console.error("validateFlowImportAction failed", error);
    return { status: "error", message };
  }
}

/**
 * Creates a flow from a pasted graph and goes there.
 *
 * It always creates. Nothing here can overwrite an existing flow, and the panel
 * says so above the box — an author who uploads a corrected version expecting
 * it to replace what is already live would otherwise find two flows answering
 * the same command, which is a bot that has started contradicting itself.
 *
 * A form action rather than a call from a click handler, because it ends in a
 * `redirect` and that is the one thing the framework has to be holding for the
 * navigation to happen — `connectBotAction` ends the same way for the same
 * reason. The JSON travels as the textarea's own value and is parsed again
 * here: what the browser held is a draft, and a server that trusts a client's
 * summary of a payload it is about to store has checked nothing.
 *
 * The backend validates a second time on this call, and it is right to: the
 * findings shown a moment ago were about the graph as it stood then. A refusal
 * arrives as its message rather than as findings — the list the author acted on
 * is still on screen, and re-drawing it from a failed create would say the same
 * things twice.
 */
export async function importFlowAction(
  _prev: FlowImportState,
  formData: FormData,
): Promise<FlowImportState> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: NO_RIGHTS, failedAt: Date.now() };

  const botId = String(formData.get("botId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const moduleKey = toAvailableModuleKey(String(formData.get("moduleKey") ?? ""));
  if (!botId || !projectId) return { status: "error", message: "Bot topilmadi.", failedAt: Date.now() };

  const parsed = parseFlowJson(String(formData.get("graph") ?? ""));
  if (!parsed.ok) return { status: "error", message: parsed.message, failedAt: Date.now() };

  let flowId: string;
  try {
    const flow = await flowTransferRepository.importGraph({
      workspaceId: workspace.id,
      botId,
      projectId,
      moduleKey,
      // The typed name wins over the one in the file: the field was shown
      // filled in from the file, so whatever stands in it is what the reader
      // was looking at when they pressed the button.
      name: String(formData.get("name") ?? "").trim() || parsed.value.name || "Import qilingan oqim",
      graph: parsed.value.graph,
      // The flow's hooks, carried through unedited. Nothing on this screen
      // holds them — there is no field to type them into and none to correct
      // them in — so what goes up is exactly what the file said, and a file
      // whose code does not compile is refused whole rather than landing as a
      // flow missing half of what was uploaded. That refusal arrives in the
      // catch below as one sentence with the line number already in it.
      script: parsed.value.script,
    });
    flowId = flow.id;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Import bajarilmadi — server javob bermadi.";
    if (!(error instanceof ApiError)) console.error("importFlowAction failed", error);
    return { status: "error", message, failedAt: Date.now() };
  }

  // The list the new flow belongs to, which for the default module is the
  // bot's own page — see `moduleHref`.
  revalidatePath(moduleHref(botId, moduleKey));
  redirect(`/flows/${flowId}`);
}
