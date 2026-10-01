"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/server";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { agentsRepository } from "./data/agents-repository";
import { toAgentOption, type AgentFormState, type AgentOption } from "./form-state";
import type { AgentDraft, AgentRecord, AgentTool } from "./types";

/**
 * Everything that writes an agent, plus the one read a client component needs.
 *
 * The read is here rather than threaded through the flow editor's props on
 * purpose. The agent catalogue is not part of a flow document — it belongs to
 * the project and changes on its own — so handing it down through
 * `FlowEditor → Inspector → NodeFields` would make every flow that is opened
 * re-fetch a list that has nothing to do with it, and would put a prop on four
 * components that only one field reads. `listAgentsForPicker` is a GET behind
 * a server action, which is a read a client component may make.
 */

/**
 * The agents a block may pick, for the project the flow belongs to.
 *
 * `projectId` is what makes the picker honest: an «AI agent» block reaches an
 * agent of its own project and no other, and a list that offered the rest
 * would be offering an author a block that silently takes its «tushunmadi»
 * exit on every message. The runtime refuses the same thing from the other
 * end (`apps/agents/services.run_agent`), because a picker is a courtesy and a
 * graph can arrive by other roads — a template, a duplicate, a flow moved
 * between projects.
 *
 * Called with nothing it still answers with the workspace's agents. That is
 * the caller-has-no-project case and not a licence: it exists so a caller that
 * has not been given the flow's project yet degrades to the old, wider list
 * rather than to an empty one.
 */
export async function listAgentsForPicker(projectId?: string): Promise<AgentOption[]> {
  const { workspace } = await getSession();
  try {
    const agents = projectId
      ? await agentsRepository.listByProject(workspace.id, projectId)
      : await agentsRepository.list(workspace.id);
    return agents.map(toAgentOption);
  } catch (error) {
    // A picker that throws takes the whole inspector down with it, and the
    // block it is on has a perfectly good default: no agent picked. The screen
    // says so rather than the panel disappearing.
    if (error instanceof ApiError) return [];
    throw error;
  }
}

/** Numbers arrive from a form as strings; a blank one means "leave the default". */
function readNumber(form: FormData, field: string, fallback: number): number {
  const raw = String(form.get(field) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The tool list, as the editor posts it: one JSON string, not N form fields.
 *
 * The rows are dynamic — an author adds and removes them — and a form encoding
 * that numbered them would need the numbering to survive a deletion. A
 * malformed payload yields an empty list rather than throwing, because the
 * caller is a form submission and the alternative is an error page over a
 * bracket.
 */
function readTools(form: FormData): AgentTool[] {
  const raw = String(form.get("tools") ?? "").trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentTool[]) : [];
  } catch {
    return [];
  }
}

function readDraft(form: FormData): AgentDraft {
  return {
    projectId: String(form.get("projectId") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    persona: String(form.get("persona") ?? "").trim(),
    instructions: String(form.get("instructions") ?? "").trim(),
    model: String(form.get("model") ?? "").trim(),
    effort: String(form.get("effort") ?? "medium").trim(),
    maxTurns: readNumber(form, "maxTurns", 4),
    maxOutputTokens: readNumber(form, "maxOutputTokens", 800),
    dailyTokenBudget: readNumber(form, "dailyTokenBudget", 200000),
    historyDepth: readNumber(form, "historyDepth", 6),
    replyMaxChars: readNumber(form, "replyMaxChars", 1200),
    escalateOnFailure: form.get("escalateOnFailure") === "on",
    enabled: form.get("enabled") === "on",
    tools: readTools(form),
  };
}

export async function saveAgentAction(_state: AgentFormState, form: FormData): Promise<AgentFormState> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { error: "Bu amal uchun ruxsat yo'q" };

  const draft = readDraft(form);
  if (!draft.name) return { error: "Agentga nom bering", field: "name" };
  // An agent belongs to a project, and the only screens that open this form
  // already know which one. A form that arrived without it is a broken link
  // rather than a choice the author has to be asked to make, so it is said
  // plainly instead of posted and refused with the backend's field error.
  if (!draft.projectId) return { error: "Agent qaysi loyihaga tegishli ekani aniqlanmadi", field: "projectId" };

  const agentId = String(form.get("agentId") ?? "").trim();
  let saved: AgentRecord;
  try {
    saved = agentId
      ? await agentsRepository.update(workspace.id, agentId, draft)
      : await agentsRepository.create(workspace.id, draft);
  } catch (error) {
    // The backend's own words, including the 402 a plan limit answers with —
    // it already writes them for the person who hit them, and rewording it
    // here would be a second copy of the pricing rules.
    if (error instanceof ApiError) return { error: error.message, field: error.field };
    throw error;
  }

  // The project page is where the agent is listed now, so that is the page a
  // save has to make stale — both the one it was saved into and, on a move,
  // the one it left.
  revalidatePath(`/projects/${saved.projectId}`);
  if (draft.projectId !== saved.projectId) revalidatePath(`/projects/${draft.projectId}`);
  revalidatePath(`/agents/${saved.id}`);
  if (!agentId) redirect(`/agents/${saved.id}`);
  return {};
}

export async function deleteAgentAction(form: FormData): Promise<void> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return;

  const agentId = String(form.get("agentId") ?? "").trim();
  if (!agentId) return;

  // Carried on the form rather than read back off the agent: the row is about
  // to be gone, and the reader has to land somewhere that still exists. The
  // project list is the fallback for a form that somehow arrived without one —
  // never `/agents`, which is a redirect to the same list one hop later.
  const projectId = String(form.get("projectId") ?? "").trim();

  try {
    await agentsRepository.remove(workspace.id, agentId);
  } catch (error) {
    if (error instanceof ApiError) return;
    throw error;
  }

  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}`);
  }
  redirect("/projects");
}
