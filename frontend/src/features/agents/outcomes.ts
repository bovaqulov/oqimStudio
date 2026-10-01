import type { Tone } from "@/components/ui/types";
import type { AgentOutcome } from "./types";

/**
 * The three exits, in one place.
 *
 * They are not this screen's words. `agent.ask` publishes exactly these three
 * ports on the flow canvas — `answered` / `unclear` / `handoff`, labelled
 * «Javob berdi» / «Tushunmadi» / «Operatorga» in
 * `flow-builder/node-definitions.ts` — and `AgentRun.Outcome` records the same
 * three by the same ids. An agent's own canvas draws the same exits, so the
 * words have to be the same words: an author who reads «Operatorga» on one
 * screen and «Odamga» on the other is being told there are two things.
 *
 * They were written out three times before this file existed (the block
 * definition, the trace, the agent field's hint) and the fourth copy is what
 * would have drifted.
 */
export const AGENT_OUTCOME_LABEL: Record<AgentOutcome, string> = {
  answered: "Javob berdi",
  unclear: "Tushunmadi",
  handoff: "Operatorga",
};

/** One line on what actually reaches that exit — the same distinction `AgentRun.Reason` draws. */
export const AGENT_OUTCOME_HINT: Record<AgentOutcome, string> = {
  answered: "Agent javob yozdi va u tekshiruvdan o'tdi.",
  unclear: "Javob topilmadi, bo'sh chiqdi yoki tekshiruvdan o'tmadi.",
  handoff: "Agent odam so'radi — yoki xatolik shu yerga yo'naltirilgan.",
};

/**
 * The colour each exit is drawn in.
 *
 * The same three tones `FlowNodeCard.PORT_COLOR` gives the ports of the
 * «AI agent» block — green for an answer, amber for the branch that did not
 * work out, blue for a handover. Copied rather than imported: those constants
 * are module-private to a client component in `flow-builder`, and exporting
 * them would be an edit to the editor for the sake of this screen. Blue and
 * not a second amber is the load-bearing part: a handover is the flow working,
 * and a reader scanning for what went wrong should not stop there.
 */
export const AGENT_OUTCOME_COLOR: Record<AgentOutcome, string> = {
  answered: "#5f9c7c",
  unclear: "#a08b5c",
  handoff: "#6d8fd0",
};

/** The same three as a badge tone, for the trace. */
export const AGENT_OUTCOME_TONE: Record<AgentOutcome, Tone> = {
  answered: "success",
  unclear: "warning",
  handoff: "accent",
};

/** The order the block publishes them in, top exit first. */
export const AGENT_OUTCOMES: readonly AgentOutcome[] = ["answered", "unclear", "handoff"];
