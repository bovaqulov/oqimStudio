"use server";

import { ApiError, apiRequest } from "@/lib/api/server";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * Driving the *real* runtime from the editor's test chat.
 *
 * The studio used to walk the graph in the browser with a second
 * implementation of the same rules. Two walkers means the test chat can be
 * green while the bot is broken — which is exactly the confidence a test chat
 * is supposed to remove. So the chat now asks the backend to run the flow, on
 * the same engine Telegram updates go through; a test run sends nothing to
 * Telegram and is left out of the numbers, and that is the only difference.
 */

export interface TestRunStep {
  id: string;
  nodeId: string;
  nodeType: string;
  actor: "bot" | "user" | "system";
  text: string;
}

export interface TestRun {
  id: string;
  status: "running" | "waiting" | "sleeping" | "handoff" | "done" | "failed";
  currentNodeId: string;
  error: string;
  steps: TestRunStep[];
}

export type TestRunResult = { ok: true; run: TestRun } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  return {
    ok: false,
    message: error instanceof ApiError ? error.message : "Runtime javob bermadi — qayta urinib ko'ring.",
  };
}

export async function startFlowTestAction(flowId: string, nodeId?: string): Promise<TestRunResult> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Sinash uchun tahrirlash huquqi kerak." };

  try {
    const run = await apiRequest<TestRun>(`/api/flows/${flowId}/test/`, {
      method: "POST",
      workspaceId: workspace.id,
      body: nodeId ? { nodeId } : {},
    });
    return { ok: true, run };
  } catch (error) {
    return failure(error);
  }
}

export async function replyFlowTestAction(
  flowId: string,
  runId: string,
  reply: { text?: string; port?: string },
): Promise<TestRunResult> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Sinash uchun tahrirlash huquqi kerak." };

  try {
    const run = await apiRequest<TestRun>(`/api/flows/${flowId}/test-reply/`, {
      method: "POST",
      workspaceId: workspace.id,
      body: {
        runId,
        text: reply.text ?? "",
        port: reply.port ?? "out",
      },
    });
    return { ok: true, run };
  } catch (error) {
    return failure(error);
  }
}
