import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { deleteAgentAction } from "@/features/agents/actions";
import { AgentEditor } from "@/features/agents/components/AgentEditor";
import { AgentStatusNotice } from "@/features/agents/components/AgentStatusNotice";
import { AgentTrace } from "@/features/agents/components/AgentTrace";
import { agentsRepository, UNKNOWN_STATUS } from "@/features/agents/data/agents-repository";
import { AGENT_OUTCOMES } from "@/features/agents/outcomes";
import type { AgentOutcome, AgentRunRecord } from "@/features/agents/types";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

/**
 * One agent: how it is built, and what it has actually done.
 *
 * The two halves are on one screen deliberately. Tuning an instruction without
 * the last ten answers in front of you is guessing, and the trace is the only
 * thing that says which tool was called with what — the question a flow's
 * canvas answered by simply being readable.
 *
 * Reached from the project that owns the agent, and the breadcrumb says so:
 * there is no workspace-wide agent list to go back to any more, and a trail
 * ending at one would send the reader through a redirect to a page that never
 * mentioned this agent.
 */

/**
 * How many of the traced turns left by each exit.
 *
 * Counted off the runs this page has already read, not asked for a second
 * time: the canvas draws the three exits and this is the only thing in the
 * data that says which of them the agent actually uses. A trace capped at
 * fifty turns makes it a recent count rather than a lifetime one, which is
 * also the more useful of the two — «this week it handed over nine times out
 * of fifty» is a sentence somebody acts on.
 */
function countOutcomes(runs: AgentRunRecord[]): Record<AgentOutcome, number> {
  const counts = Object.fromEntries(AGENT_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    AgentOutcome,
    number
  >;
  for (const run of runs) if (run.outcome in counts) counts[run.outcome] += 1;
  return counts;
}
export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { workspace } = await getSession();

  const [agent, status, runs] = await Promise.all([
    agentsRepository.get(workspace.id, agentId),
    agentsRepository.status(workspace.id).catch(() => UNKNOWN_STATUS),
    // An empty trace is a normal state — a new agent has one — so a failed
    // read here must not take the editor down with it.
    agentsRepository.runs(workspace.id, agentId).catch(() => []),
  ]);

  if (!agent) notFound();

  // The folder's own name, so the trail reads the way the reader walked in.
  // A project that cannot be read is not worth a 404 on an agent that can:
  // the crumb falls back to the list of projects.
  const project = await projectsRepository.getById(workspace.id, agent.projectId).catch(() => undefined);

  return (
    <>
      <PageHeader
        title={agent.name}
        breadcrumbs={[
          { label: "Loyihalar", href: "/projects" },
          { label: project?.name ?? "Loyiha", href: `/projects/${agent.projectId}` },
          { label: agent.name },
        ]}
      />
      {/* Wider than the 720 a form wants: the canvas is two columns of cards
          with a panel beside them, and at 720 the panel would have wrapped
          under the graph on every desktop. */}
      <PageBody maxWidth={1120}>
        <div className="flex flex-col gap-4">
          <AgentStatusNotice status={status} />
          <AgentEditor
            agent={agent}
            projectId={agent.projectId}
            status={status}
            outcomes={countOutcomes(runs)}
          />

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="t-headline">Nima qilgani</h2>
              <p className="t-footnote t-secondary">
                Har bir javob: mijoz nima yozgani, agent qaysi vositani qanday argument bilan chaqirgani va
                blok qaysi chiqishdan ketgani.
              </p>
            </div>
            <AgentTrace runs={runs} />
          </section>

          {/* A form and not a link: deleting is a write, and a write reached
              from a render is the thing `check:effects` exists to stop. */}
          <form action={deleteAgentAction} className="flex justify-end">
            <input type="hidden" name="agentId" value={agent.id} />
            {/* Where the reader lands afterwards. Read here while the agent
                still exists — the action cannot look it up once it is gone. */}
            <input type="hidden" name="projectId" value={agent.projectId} />
            <Button type="submit" variant="danger-ghost">
              <Icon name="trash" size={15} /> Agentni o&apos;chirish
            </Button>
          </form>
        </div>
      </PageBody>
    </>
  );
}
