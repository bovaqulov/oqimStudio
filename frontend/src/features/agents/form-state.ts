import type { AgentRecord } from "./types";

/**
 * The types the agent actions hand back and forth.
 *
 * Kept out of `actions.ts` on purpose, following the same rule
 * `features/bots/form-state.ts` names: a `"use server"` module is only allowed
 * to export async functions. Interfaces are erased before the bundler sees
 * them, so they would survive there — but a constant would not, and this is
 * the module the first one belongs in when somebody adds it, rather than the
 * one that turns into a build error the day they do.
 */

/** What the block's agent picker needs: which agents exist, and what each can do. */
export interface AgentOption {
  id: string;
  name: string;
  persona: string;
  enabled: boolean;
  /** How many tools it may use — the one number that says what it can do. */
  toolCount: number;
}

/** What a save hands back to the screen: an error to print, or nothing. */
export interface AgentFormState {
  error?: string;
  /** The input the message belongs under, when it is about one. */
  field?: string;
}

/** Nothing said yet. A save that succeeds redirects or re-renders, so there is
 *  no success state to carry — one that nothing ever renders would be a lie
 *  about what can happen. */
export const AGENT_FORM_INITIAL: AgentFormState = {};

/** The picker's view of one agent. */
export function toAgentOption(agent: AgentRecord): AgentOption {
  return {
    id: agent.id,
    name: agent.name,
    persona: agent.persona,
    enabled: agent.enabled,
    toolCount: agent.tools.filter((tool) => tool.enabled).length,
  };
}
