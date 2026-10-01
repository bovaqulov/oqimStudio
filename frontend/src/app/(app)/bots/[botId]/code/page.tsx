import { notFound } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { botsRepository } from "@/features/bots";
import { FlowTransferSection } from "@/features/bots/components/code/FlowTransferSection";
import { ScriptBlockList } from "@/features/bots/components/code/ScriptBlockList";
import { ScriptLibraryEditor } from "@/features/bots/components/code/ScriptLibraryEditor";
import { scriptsRepository } from "@/features/bots/data/scripts-repository";
import type { BotScripts } from "@/features/bots/types";
import { flowsRepository } from "@/features/flows";
import { flowTransferRepository } from "@/features/flows/data/transfer-repository";
import type { FlowSummary } from "@/features/flows";
import type { FlowSchema } from "@/features/flows/transfer-types";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";

type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * A read that answers "could not" rather than throwing.
 *
 * Three unrelated endpoints feed this page and only one of them is the page's
 * subject. A schema endpoint that is down must not take the script library
 * with it — and, just as much, must not come back as an empty list, because
 * "no block types" and "we could not ask" look identical on screen and only
 * one of them is a reason to reload.
 */
async function load<T>(read: () => Promise<T>, fallback: string, context: string): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    console.error(context, error);
    return { ok: false, message: fallback };
  }
}

/**
 * All of one bot's code on one screen.
 *
 * Until this page the code lived only inside the blocks that hold it, which
 * meant the question "what does this bot actually compute" could only be
 * answered by opening every flow and clicking every card — and the shared
 * library, which is prepended to all of them, had nowhere to be written at all.
 *
 * A failed read draws the notice and nothing else, editor included. An empty
 * textarea over a failed GET is not a blank library, it is a library nobody has
 * seen — and "Saqlash" under it would replace the real one with nothing.
 *
 * The section under it is the other way a flow can be written: as JSON, in
 * something that is not this app. It reads three endpoints of its own here
 * rather than in the components, because a `"use client"` panel may not touch a
 * repository — and because a read belongs in a render, where it is the writes
 * that do not.
 */
export default async function BotCodePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const { workspace, role } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();

  const scripts = await load<BotScripts>(
    () => scriptsRepository.overview(workspace.id, botId),
    "Kodni o'qib bo'lmadi.",
    "BotCodePage failed to load scripts",
  );
  if (!scripts.ok) {
    return (
      <Panel className="flex max-w-[720px] flex-col gap-1.5 p-4">
        <p className="t-body m-0">Kod bo&apos;limini ochib bo&apos;lmadi</p>
        <p className="t-footnote t-secondary m-0">{scripts.message}</p>
      </Panel>
    );
  }

  const [schema, flows] = await Promise.all([
    load<FlowSchema>(
      () => flowTransferRepository.schema(workspace.id),
      "Bloklar lug'atini o'qib bo'lmadi.",
      "BotCodePage failed to load flow schema",
    ),
    load<FlowSummary[]>(
      () => flowsRepository.listByBot(workspace.id, botId),
      "Oqimlarni o'qib bo'lmadi.",
      "BotCodePage failed to load flows",
    ),
  ]);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <ScriptLibraryEditor botId={botId} library={scripts.value.library} canEdit={canEditContent(role)} />
      <ScriptBlockList blocks={scripts.value.blocks} />
      <FlowTransferSection
        botId={botId}
        projectId={bot.projectId}
        canEdit={canEditContent(role)}
        schema={schema.ok ? schema.value : null}
        schemaError={schema.ok ? null : schema.message}
        flows={flows.ok ? flows.value : []}
        flowsError={flows.ok ? null : flows.message}
      />
    </div>
  );
}
