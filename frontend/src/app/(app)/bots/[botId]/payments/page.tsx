import { notFound } from "next/navigation";
import { botsRepository } from "@/features/bots";
import { paymentsRepository } from "@/features/payments/data/payments-repository";
import { providersWithConnected } from "@/features/payments/providers";
import { PaymentHistory } from "@/features/payments/components/PaymentHistory";
import { ProviderList } from "@/features/payments/components/ProviderList";
import { canManageWorkspace } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * Payments for one bot: what it can take money through, and what it has taken.
 *
 * The eight lines of explanation that used to stand in front of the provider
 * list are gone: what a provider is becomes clear from its own row, and what a
 * merchant has to *do* is on the sheet the row opens. Connections live in their
 * own repository, so this page only ever sees masked tokens — the real ones
 * stay on the server behind the connect/verify actions.
 *
 * The history under it is the half that was missing. Five rows of setup told
 * the owner their bot *could* be paid; the takings are the thing they come back
 * to this screen for, and they were only reachable through the analytics
 * report's revenue total, which is a number rather than a list of payments.
 */
export default async function BotPaymentsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const { workspace, role } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();

  const [connections, payments] = await Promise.all([
    paymentsRepository.list(workspace.id, botId),
    paymentsRepository.history(workspace.id, botId),
  ]);

  return (
    <div className="flex max-w-[560px] flex-col gap-4">
      <ProviderList
        providers={providersWithConnected(connections.map((connection) => connection.providerId))}
        connections={connections}
        botId={botId}
        canManage={canManageWorkspace(role)}
      />
      <PaymentHistory payments={payments} />
    </div>
  );
}
