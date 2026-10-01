import { notFound } from "next/navigation";
import { FlowEditor } from "@/features/flow-builder";
import { editorPlanLimits } from "@/features/billing/editor-limits";
import { getUsageReport } from "@/features/billing/get-usage";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { moduleHref } from "@/features/bots/modules";
import { flowsRepository } from "@/features/flows";
import { paymentsRepository } from "@/features/payments/data/payments-repository";
import { tablesRepository } from "@/features/tables/data/tables-repository";
import { customProvider, getPaymentProvider } from "@/features/payments/providers";
import { getSession } from "@/features/workspace/session";

export default async function FlowEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ flowId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { flowId } = await params;
  // Set by the create-and-switch-on actions when the switching-on half was
  // refused — the flow exists, and the author is owed the reason it is paused.
  const notEnabled = (await searchParams).notice === "not-enabled";
  const { workspace } = await getSession();
  const flow = await flowsRepository.getById(workspace.id, flowId);
  if (!flow) notFound();

  // Blocks travel with each sibling, not just its name: a jump block picks the
  // step it lands on, and the picker cannot list steps it was never given. Only
  // the three fields it reads are sent — a graph per sibling would be the whole
  // module in the page payload.
  const siblingFlows = (await flowsRepository.listRecordsByModule(workspace.id, flow.botId, flow.moduleKey))
    .filter((sibling) => sibling.id !== flow.id)
    .map((sibling) => ({
      id: sibling.id,
      name: sibling.name,
      blocks: sibling.nodes.map((node) => ({ id: node.id, title: node.title, type: node.type })),
    }));

  // What a «Jadvalga yozish» block may pick from. Loaded here rather than by
  // the field, which would fetch the same list once per block on a canvas that
  // may hold ten of them — the same reason the providers above travel this way.
  // Only the four fields the picker reads: a table's rows are not the editor's
  // business and would be the whole dataset in the page payload.
  const tables = (await tablesRepository.list(workspace.id)).map((table) => ({
    id: table.id,
    name: table.name,
    handle: table.handle,
    columns: table.columns.map((column) => ({ key: column.key, label: column.label })),
  }));

  // Only connected providers are handed to the editor: an invoice pointed at a
  // provider with no token is an invoice that fails when a customer taps it.
  const connections = await paymentsRepository.list(workspace.id, flow.botId);
  const paymentProviders = connections
    .filter((connection) => connection.status.tone === "success")
    .map((connection) => {
      // Every non-Stars connection is one the merchant named, so the catalogue
      // knows none of them by id — the definition is rebuilt from the id it was
      // stored under. Falling back rather than defaulting to nothing: an
      // invoice block pointed at a working provider would otherwise be offered
      // an empty currency list.
      const definition = getPaymentProvider(connection.providerId) ?? customProvider(connection.providerId);
      return {
        id: connection.providerId,
        name: definition.name,
        currencies: definition.currencies,
        mode: connection.mode,
      };
    });

  // The preview draws a Telegram chat with this bot in its header; a name from
  // somewhere else would be a preview of somebody else's conversation.
  const bot = await botsRepository.getById(workspace.id, flow.botId);
  const botIdentity = {
    name: bot?.settings.displayName?.trim() || bot?.handle || "Bot",
    avatarEmoji: bot?.settings.avatarEmoji || "🤖",
  };

  // What the plan will refuse, carried in so the palette can say so before the
  // author builds around a block that cannot be switched on. The editor used to
  // know nothing about it: «AI javob» was offered like any other block and the
  // refusal came from `check_graph_allows` on «Yoqish», about a finished flow.
  // Read here rather than in the editor because a client component may not
  // reach a repository, and because it is one request for the whole screen.
  const planLimits = editorPlanLimits(await getUsageReport(workspace.id, workspace.planKey));

  // Through the helper, not a template: the default module answers on the
  // bot's own URL now, and `moduleHref` is the one place that knows it.
  const backHref = moduleHref(flow.botId, flow.moduleKey);

  return (
    <FlowEditor
      flow={flow}
      backHref={backHref}
      siblingFlows={siblingFlows}
      paymentProviders={paymentProviders}
      tables={tables}
      botIdentity={botIdentity}
      botLanguages={bot?.settings.languages}
      planLimits={planLimits}
      notEnabled={notEnabled}
    />
  );
}
