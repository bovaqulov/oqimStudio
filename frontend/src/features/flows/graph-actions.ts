"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/server";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { scriptsRepository } from "@/features/bots/data/scripts-repository";
import { flowsRepository } from "./data/flows-repository";
import type {
  ExpressionWarning,
  FlowEdge,
  FlowLayoutMode,
  FlowNode,
  FlowScripts,
  ScriptRunResult,
} from "./types";

/**
 * Saves the canvas.
 *
 * Its own file rather than one more export in `actions.ts` because it is the
 * editor's hot path: it runs on a debounce while somebody is dragging blocks
 * around, and the answer it needs is only "did that land".
 *
 * The backend re-derives the flow's trigger index in the same request, so a
 * graph is never live while the runtime still matches the previous one.
 */
export async function saveFlowGraphAction(
  flowId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  name: string,
  description: string,
): Promise<{ ok: boolean; message?: string; expressionWarnings?: ExpressionWarning[] }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Tahrirlash huquqi yo'q." };

  let expressionWarnings: ExpressionWarning[] = [];
  try {
    const saved = await flowsRepository.saveGraph(workspace.id, flowId, { nodes, edges, name, description });
    if (!saved) return { ok: false, message: "Oqim topilmadi." };
    expressionWarnings = saved.expressionWarnings;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Saqlab bo'lmadi." };
  }

  // The module's card list shows block counts and "last touched"; both just moved.
  revalidatePath(`/flows/${flowId}`);
  return { ok: true, expressionWarnings };
}


/**
 * Switching the flow on or off from the editor.
 *
 * It lives here rather than in `actions.ts` for the same reason the graph save
 * does: the editor is the caller, and it needs an answer it can act on. The
 * plan check runs at *publish* — saving is never refused, because deleting the
 * block that breaks the plan is itself a save — so this is the call that can
 * come back with "your plan does not cover this", and the toggle has to be
 * able to put itself back when it does.
 */
export async function setFlowLiveAction(
  flowId: string,
  enabled: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Tahrirlash huquqi yo'q." };

  try {
    const flow = await flowsRepository.setEnabled(workspace.id, flowId, enabled);
    if (!flow) return { ok: false, message: "Oqim topilmadi." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiError ? error.message : "Holatni o'zgartirib bo'lmadi — qayta urinib ko'ring.",
    };
  }
  return { ok: true };
}


/**
 * Which editor this flow opens in, remembered between visits.
 *
 * Fire-and-forget on purpose: this is a view preference, and a failed write
 * must never stop somebody switching modes. The worst case is that the next
 * visit opens in the other one.
 */
export async function setFlowLayoutModeAction(
  flowId: string,
  mode: FlowLayoutMode,
): Promise<{ ok: boolean; message?: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Tahrirlash huquqi yo'q." };

  try {
    const flow = await flowsRepository.setLayoutMode(workspace.id, flowId, mode);
    if (!flow) return { ok: false, message: "Oqim topilmadi." };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : "Saqlab bo'lmadi." };
  }
  return { ok: true };
}


/**
 * Runs a Kod block's source once, with inputs the author typed.
 *
 * In the editor's action file rather than the general one because it belongs to
 * the same loop as the autosave: somebody is at the canvas, changing a line and
 * pressing run. It writes nothing and revalidates nothing.
 *
 * A failed *script* is a successful call — the result carries `ok: false` and
 * the panel renders it. What this catches is the call itself failing, which is
 * a different sentence and a different thing to do about it.
 */
export async function runScriptAction(
  source: string,
  inputs: Record<string, unknown>,
  /** Whose shared library goes above the block. See the panel for why it is not optional in practice. */
  botId?: string | null,
): Promise<ScriptRunResult> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) {
    return {
      ok: false,
      value: null,
      logs: [],
      kind: "author",
      error: "Kodni ishga tushirish uchun tahrirlash huquqi kerak.",
      durationMs: 0,
      where: "",
      line: null,
    };
  }

  try {
    return await flowsRepository.runScript(workspace.id, source, inputs, botId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("runScriptAction failed", error);
    return {
      ok: false,
      value: null,
      logs: [],
      kind: "runtime",
      error: error instanceof ApiError ? error.message : "Kodni ishga tushirib bo'lmadi.",
      durationMs: 0,
      // The call never reached the sandbox, so there is no line anywhere to
      // point at — and a blank origin is what the panel reads as "say nothing".
      where: "",
      line: null,
    };
  }
}

// ---------------------------------------------------------------------------
// The Script panel's two files
// ---------------------------------------------------------------------------

/**
 * What the panel gets back from a save.
 *
 * The whole `FlowScripts` on success and not just an acknowledgement, because
 * three of its four parts change when either file is written: saving a hook
 * changes which hooks are `declared`, and saving the library changes which of
 * the flow's expressions are `missing`. A panel that only refreshed the text it
 * had just typed would keep showing a warning about a function the author has
 * this second written.
 */
export type ScriptSaveResult =
  | { ok: true; scripts: FlowScripts }
  | {
      ok: false;
      message: string;
      /**
       * Where to underline, when the refusal named a line. 1-based in the file
       * that was sent.
       */
      line: number | null;
    };

/**
 * The line out of a refusal, or null.
 *
 * `engine/script/sandbox.py::check_syntax` is the one place that formats this
 * sentence, and it appends « (3-qator) » when the sandbox reported a line. The
 * number is read back here rather than carried as a field of its own because
 * the error envelope this API answers with holds a code, a message and a field
 * and nothing else — widening it for one integer would change every error the
 * product can raise. If a second caller ever needs this, that is the trade to
 * revisit.
 */
function lineIn(message: string): number | null {
  const found = /\((\d+)-qator\)/.exec(message);
  if (!found) return null;
  const line = Number(found[1]);
  return Number.isSafeInteger(line) && line > 0 ? line : null;
}

/**
 * Everything the Script panel opens with.
 *
 * A read behind an action rather than a prop the editor page passes down: the
 * panel is opened by a keystroke and most sessions never open it, so loading
 * two source files and an expression inventory into every flow editor render
 * would be a round trip spent on a panel nobody asked for. Nothing is written,
 * so this is safe to call again whenever the panel is re-opened.
 */
export async function loadFlowScriptsAction(
  flowId: string,
): Promise<{ ok: true; scripts: FlowScripts } | { ok: false; message: string }> {
  try {
    // `getSession` is inside the try, unlike its neighbours in this file. It
    // reads the backend, so it fails whenever the backend is down — and a throw
    // from an action is a rejected promise on the client with nowhere to land:
    // the panel's spinner spins for as long as the reader is willing to watch
    // it. Every exit from here is a value the caller can render.
    const { workspace } = await getSession();
    const scripts = await flowsRepository.scripts(workspace.id, flowId);
    if (!scripts) return { ok: false, message: "Oqim topilmadi." };
    return { ok: true, scripts };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("loadFlowScriptsAction failed", error);
    return { ok: false, message: error instanceof ApiError ? error.message : "Kodni o'qib bo'lmadi." };
  }
}

/**
 * Stores one of the two files.
 *
 * Both go through here rather than the panel knowing which repository owns
 * which, and the difference between them is worth stating: the flow's script
 * belongs to the flow and its endpoint answers the whole panel state, while the
 * library belongs to the *bot* — every flow it runs reads the same file — so
 * saving it is followed by a re-read, because what changed is not only the text
 * on screen but which of this flow's expressions still name a function that
 * does not exist.
 *
 * A refusal is the point of this being a button. The backend compiles the file
 * before storing it, and a file that does not compile is never written — the
 * failure this whole panel was built for was a `const = obj.model` that saved
 * cleanly and killed every Kod block in a bot for five days.
 */
export async function saveScriptFileAction(
  flowId: string,
  file: "flow" | "library",
  source: string,
  botId: string | null,
): Promise<ScriptSaveResult> {
  try {
    // Inside the try for the reason `loadFlowScriptsAction` gives: this one is
    // reached from a button that has already said "Saqlanmoqda…", and an
    // escaping throw leaves that word on screen for the rest of the session
    // over a file that was never written.
    const { workspace, role } = await getSession();
    if (!canEditContent(role)) return { ok: false, message: "Kodni o'zgartirish uchun huquq yo'q.", line: null };

    if (file === "flow") {
      const scripts = await flowsRepository.saveScript(workspace.id, flowId, source);
      revalidatePath(`/flows/${flowId}`);
      return { ok: true, scripts };
    }

    if (!botId) return { ok: false, message: "Bu oqimning boti yo'q — kutubxona saqlanmadi.", line: null };
    await scriptsRepository.saveLibrary(workspace.id, botId, source);
    const scripts = await flowsRepository.scripts(workspace.id, flowId);
    if (!scripts) return { ok: false, message: "Oqim topilmadi.", line: null };
    // The bot's own code screen shows this file and the blocks that read it.
    revalidatePath(`/bots/${botId}/code`);
    revalidatePath(`/flows/${flowId}`);
    return { ok: true, scripts };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("saveScriptFileAction failed", error);
    const message = error instanceof ApiError ? error.message : "Saqlab bo'lmadi — server javob bermadi.";
    return { ok: false, message, line: lineIn(message) };
  }
}
