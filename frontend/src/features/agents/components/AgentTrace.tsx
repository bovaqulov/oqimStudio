import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { formatRelative } from "@/lib/utils/date";
import { AGENT_OUTCOME_LABEL, AGENT_OUTCOME_TONE } from "../outcomes";
import type { AgentRunMessage, AgentRunRecord } from "../types";

/**
 * Why the agent said what it said.
 *
 * A flow never needed this: the graph *was* the explanation, and "why did the
 * bot say that" was answered by opening the canvas and reading the block. An
 * agent has no graph, so the trace is the graph — every turn, every tool call
 * with the arguments it actually ran with, and which of the three exits the
 * block took.
 *
 * The three exits are named from `outcomes.ts` rather than here: the agent's
 * own canvas and the «AI agent» block draw the same three, and a trace that
 * called them something else would be describing a different bot.
 *
 * The tool rows are the part worth defending. A reply that reads wrong is
 * almost always a tool that was called with something surprising, and without
 * the arguments written down the only way to find out is to reproduce a
 * conversation that has already ended.
 */

/**
 * `AgentRun.Reason`, in words. The exit alone cannot say why — «tushunmadi» is
 * reached by a model with nothing to add, by a missing API key and by a spent
 * budget, and those are three different things to do something about.
 *
 * An unknown code prints as itself rather than as a blank: a reason added on
 * the backend and not here should still be readable.
 */
const REASON_LABEL: Record<string, string> = {
  ok: "Javob berildi",
  tool_handoff: "Model operator so'radi",
  empty: "Bo'sh javob",
  refused: "Model javob berishdan bosh tortdi",
  blocked: "Javob tekshiruvdan o'tmadi",
  turns: "Qadamlar tugadi",
  budget: "Kunlik byudjet tugadi",
  plan: "Tarif chegarasi",
  unavailable: "AI sozlanmagan",
  error: "Xato",
};

/** What each row of a turn is, in the reader's words rather than the API's. */
const ROLE_LABEL: Record<AgentRunMessage["role"], string> = {
  system: "Ko'rsatma",
  user: "Mijoz",
  assistant: "Agent",
  tool_use: "Vosita chaqirildi",
  tool_result: "Vosita javobi",
};

function MessageRow({ message }: { message: AgentRunMessage }) {
  const hasPayload = Object.keys(message.payload ?? {}).length > 0;
  return (
    <li className="flex flex-col gap-1 border-t border-neutral-800 py-2 first:border-t-0">
      <span className="t-caption t-tertiary">{ROLE_LABEL[message.role]}</span>
      {message.text && <span className="t-footnote whitespace-pre-wrap break-words">{message.text}</span>}
      {hasPayload && (
        // Wide content scrolls inside its own box rather than pushing the page
        // sideways — a tool result can be a long line of JSON.
        <pre className="t-caption t-secondary max-h-40 overflow-auto rounded-[8px] bg-neutral-900 p-2">
          {JSON.stringify(message.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

function RunCard({ run }: { run: AgentRunRecord }) {
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={AGENT_OUTCOME_TONE[run.outcome]}>{AGENT_OUTCOME_LABEL[run.outcome]}</Badge>
        <span className="t-footnote t-secondary">{REASON_LABEL[run.reason] ?? run.reason}</span>
        <span className="t-caption t-tertiary ml-auto">
          {formatRelative(run.startedAt)} · {run.turns} qadam · {run.inputTokens + run.outputTokens} token
        </span>
      </div>

      <div className="t-caption t-tertiary flex flex-wrap gap-x-3 gap-y-1">
        <span>{run.model}</span>
        {run.contactName && <span>{run.contactName}</span>}
        {run.nodeId && <span>blok {run.nodeId}</span>}
        {run.isTest && <span>sinov</span>}
        {run.error && <span className="text-danger-fg">{run.error}</span>}
      </div>

      <ul className="flex flex-col">
        {run.messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </ul>
    </Panel>
  );
}

export function AgentTrace({ runs }: { runs: AgentRunRecord[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon="clock-counter-clockwise"
        title="Hali ishlamagan"
        description="Agent oqimdagi «AI agent» blokida chaqirilganda, har bir javob — savol, chaqirilgan vositalar va natija — shu yerda yoziladi."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}
