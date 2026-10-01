"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { saveAgentAction } from "../actions";
import { buildAgentGraph, FIELD_HOME, graphProblems, type AgentNode } from "../canvas-model";
import { AGENT_FORM_INITIAL } from "../form-state";
import type { AgentDraft, AgentOutcome, AgentRecord, AgentStatus } from "../types";
import { AgentCanvas } from "./AgentCanvas";
import { AgentNodeInspector } from "./AgentNodeInspector";

/**
 * Building an agent on its own canvas.
 *
 * ## One state, two readings
 *
 * The agent is a flat row of columns — persona, instructions, the budgets, the
 * tool rows — and it stays one. `draft` below is the only state on this screen;
 * the canvas is one reading of it and the inspector is the other, and the save
 * posts the same field names to the same action it always did. There is no
 * `graph` column, no migration, and nothing the runtime could disagree with.
 * The argument for that is written down in `canvas-model.ts`, in short: nothing
 * in `run_agent` walks an edge, so an edge that was stored would be a line on a
 * canvas that controls nothing — which is the failure this tree keeps paying
 * for.
 *
 * ## What happened to the form
 *
 * It was not kept beside this. Two editors over one row of columns is two
 * things to keep in step, and the second one is always the one that goes
 * stale. What the canvas replaced is the *layout*, not the fields: the same
 * inputs, the same names, the same one payload — dealt onto the node each one
 * belongs to instead of stacked in three panels. `FIELD_HOME` is the list, and
 * it is typed over `keyof AgentDraft`, so a field that lost its home fails
 * typecheck instead of quietly disappearing off the screen.
 *
 * ## Why the payload comes from hidden inputs
 *
 * Only one node's fields are mounted at a time. If the visible inputs carried
 * the `name` attributes, closing a panel would drop those fields from the form
 * and the save would blank whatever was not on screen. So every value posts
 * from a hidden input fed by `draft`, and the visible controls are plain
 * controlled inputs with no names of their own.
 */

function SaveButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saqlanmoqda…" : isNew ? "Agentni yaratish" : "Saqlash"}
    </Button>
  );
}

/** A fresh agent's defaults — the same ones `actions.readDraft` falls back to. */
function initialDraft(agent: AgentRecord | undefined, projectId: string, status: AgentStatus): AgentDraft {
  return {
    projectId: agent?.projectId ?? projectId,
    name: agent?.name ?? "",
    persona: agent?.persona ?? "",
    instructions: agent?.instructions ?? "",
    model: agent?.model ?? status.defaultModel,
    effort: agent?.effort ?? status.defaultEffort,
    maxTurns: agent?.maxTurns ?? 4,
    maxOutputTokens: agent?.maxOutputTokens ?? 800,
    dailyTokenBudget: agent?.dailyTokenBudget ?? 200000,
    historyDepth: agent?.historyDepth ?? 6,
    replyMaxChars: agent?.replyMaxChars ?? 1200,
    escalateOnFailure: agent?.escalateOnFailure ?? true,
    enabled: agent?.enabled ?? true,
    tools: agent?.tools ?? [],
  };
}

/** Every node on the canvas, flattened — the spine and its branches. */
function flatten(spine: AgentNode[]): AgentNode[] {
  return spine.flatMap((node) => [node, ...flatten(node.children)]);
}

export function AgentEditor({
  agent,
  projectId,
  status,
  outcomes,
}: {
  /** Absent when this is a new agent. */
  agent?: AgentRecord;
  /**
   * The project the agent belongs to, or the one it is about to be created in.
   * A prop rather than a field: which folder an agent lives in is decided by
   * the screen that opened this form — the project's own «Resurslar» tab — and
   * a control here would be a second, quieter place to get it wrong.
   */
  projectId: string;
  status: AgentStatus;
  /**
   * How many traced turns took each exit, counted off the trace the page has
   * already read. Not a second request, and not a new endpoint: the runs are
   * on the screen below anyway, and the exits are the one part of this canvas
   * where "what does it actually do" has an answer in the data.
   */
  outcomes?: Record<AgentOutcome, number>;
}) {
  const [state, formAction] = useActionState(saveAgentAction, AGENT_FORM_INITIAL);
  const [draft, setDraft] = useState<AgentDraft>(() => initialDraft(agent, projectId, status));
  const [pickedId, setPickedId] = useState<string | null>(null);
  const phone = usePhoneViewport();

  // Nothing is open until it is picked — *on a phone*, where the panel is a
  // sheet and an opening default would be a sheet covering the canvas the
  // moment the screen loads. On a desktop the panel is a column that is there
  // either way, and an empty one beside a full canvas is a wasted third of the
  // screen, so it opens on the first card. The two answers differ because the
  // panel is two different objects, and picking one of them for both would be
  // wrong on one of them.
  const openId = pickedId ?? (phone ? null : "persona");

  const modelLabel = status.models.find((option) => option.id === draft.model)?.label;
  const spine = useMemo(
    () => buildAgentGraph(draft, { modelLabel, usage: agent?.usage, outcomes }),
    [draft, modelLabel, agent?.usage, outcomes],
  );
  const nodes = useMemo(() => flatten(spine), [spine]);
  const open = nodes.find((node) => node.id === openId) ?? null;
  const problems = graphProblems(spine);

  // A refused save names a field; the panel opens on the node that owns it.
  // Without this the message lands in the bar at the bottom and the input it is
  // about is behind a card the reader has to guess at.
  //
  // Adjusted during render rather than in an effect, which is what React asks
  // for when one piece of state has to follow another: an effect would paint
  // the wrong panel first and then replace it, and `react-hooks` refuses it
  // outright. `answered` is compared by identity — `useActionState` hands back
  // a new object per submission, so the panel moves once per refusal and not
  // again while the reader is reading it.
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    // `FIELD_HOME` is already the list of which node owns which field, and
    // every spine node's id *is* its kind — so the map that places a control
    // is the map that places the complaint about it, with no second copy to
    // fall out of step when a field moves.
    const home = state.field ? FIELD_HOME[state.field as keyof AgentDraft] : undefined;
    if (home && home !== "screen") setPickedId(home);
  }

  const patch = (next: Partial<AgentDraft>) => setDraft((current) => ({ ...current, ...next }));

  const inspector = open ? (
    <AgentNodeInspector
      node={open}
      draft={draft}
      onChange={patch}
      onOpenNode={setPickedId}
      status={status}
      usage={agent?.usage}
      nameError={state.field === "name" ? state.error : null}
    />
  ) : (
    <p className="t-footnote t-secondary m-0">Tahrirlash uchun kanvasdagi kartani bosing.</p>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* The whole payload. Every one of these is `draft`, and `draft` is what
          the canvas is drawn from — so what is posted and what is on screen are
          the same object read twice. */}
      <input type="hidden" name="agentId" value={agent?.id ?? ""} />
      <input type="hidden" name="projectId" value={draft.projectId} />
      <input type="hidden" name="name" value={draft.name} />
      <input type="hidden" name="persona" value={draft.persona} />
      <input type="hidden" name="instructions" value={draft.instructions} />
      <input type="hidden" name="model" value={draft.model} />
      <input type="hidden" name="effort" value={draft.effort} />
      <input type="hidden" name="maxTurns" value={draft.maxTurns} />
      <input type="hidden" name="maxOutputTokens" value={draft.maxOutputTokens} />
      <input type="hidden" name="dailyTokenBudget" value={draft.dailyTokenBudget} />
      <input type="hidden" name="historyDepth" value={draft.historyDepth} />
      <input type="hidden" name="replyMaxChars" value={draft.replyMaxChars} />
      <input type="hidden" name="escalateOnFailure" value={draft.escalateOnFailure ? "on" : ""} />
      <input type="hidden" name="enabled" value={draft.enabled ? "on" : ""} />
      {/* The tool list is dynamic — rows are added and removed — so it travels
          as one JSON field rather than as numbered inputs whose numbering would
          have to survive a deletion. */}
      <input type="hidden" name="tools" value={JSON.stringify(draft.tools)} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <AgentCanvas
            spine={spine}
            selectedId={openId}
            onSelect={setPickedId}
            onAddTool={() => setPickedId("tools")}
          />
        </div>

        {!phone && (
          <Panel className="flex w-full flex-col gap-4 p-4 lg:w-[360px] lg:flex-none">
            {open && (
              <div className="flex items-center gap-2">
                <Icon name={open.icon} size={16} style={{ color: open.color }} className="flex-none" />
                <h2 className="t-headline m-0 min-w-0 flex-1 truncate">{open.title}</h2>
              </div>
            )}
            {inspector}
          </Panel>
        )}
      </div>

      {/* Pinned, because the canvas is taller than the window and a save button
          at the bottom of it is a save button the reader scrolls away from
          after every edit. */}
      <div className="bg-bg/85 sticky bottom-0 z-20 -mx-4 flex flex-col gap-2 px-4 py-3 backdrop-blur-sm md:-mx-[22px] md:px-[22px]">
        {state.error && (
          <div className="flex items-start gap-2.5 rounded-[12px] bg-danger-bg p-3 text-danger-fg">
            <Icon name="warning" size={17} className="mt-[2px] flex-none" />
            <p className="t-footnote m-0">{state.error}</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <p className="t-caption t-tertiary m-0 min-w-0 flex-1">
            {problems.length
              ? `${problems.length} ta karta e'tibor so'rayapti — sariq belgili kartalarni oching.`
              : "Kanvasdagi har bir karta — agentning o'sha qismi. Kartani bosib tahrirlang."}
          </p>
          <SaveButton isNew={!agent} />
        </div>
      </div>

      {/* On a phone the panel is a sheet over the list rather than a column
          beside it — the one window shape the product has there. */}
      {phone && (
        <Modal open={!!open} onClose={() => setPickedId(null)} labelledBy="agent-node-sheet-title">
          <div className="flex flex-none items-center gap-2 border-b border-separator px-4 py-3">
            {open && (
              <Icon name={open.icon} size={17} style={{ color: open.color }} className="flex-none" />
            )}
            <h2 id="agent-node-sheet-title" className="t-headline m-0 min-w-0 flex-1 truncate">
              {open?.title ?? "Karta"}
            </h2>
            <button
              type="button"
              aria-label="Yopish"
              onClick={() => setPickedId(null)}
              className="oq-tap relative cursor-pointer rounded p-1 text-neutral-400"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{inspector}</div>
          <div className="flex-none border-t border-separator p-4">
            <Button type="button" variant="primary" className="w-full" onClick={() => setPickedId(null)}>
              Tayyor
            </Button>
          </div>
        </Modal>
      )}
    </form>
  );
}
