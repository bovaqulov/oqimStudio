import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { getUsageReport } from "@/features/billing/get-usage";
import { billingRepository } from "@/features/billing/data/billing-repository";
import {
  removeMemberAction,
  setMemberRoleAction,
} from "@/features/workspace/actions";
import { InviteLinkPanel } from "@/features/workspace/components/InviteLinkPanel";
import { InviteMemberForm } from "@/features/workspace/components/InviteMemberForm";
import { MemberRoleSelect } from "@/features/workspace/components/MemberRoleSelect";
import {
  canManageWorkspace,
  getRoleDefinition,
  ROLE_DEFINITIONS,
  workspacesRepository,
} from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * What the four roles mean, as the one sentence the screen is allowed — behind
 * the (i) on the field that picks one.
 *
 * It used to be a third panel under the invite form: four badges and four
 * sentences, printed in full, for a question that is only ever asked while the
 * role select is open. Folded into that select's own label it is in the reader's
 * hand at the moment they need it and costs nothing the rest of the time.
 * Composed from `ROLE_DEFINITIONS` so a reworded role can only say one thing.
 */
const ROLE_LEGEND = ROLE_DEFINITIONS.map(
  (definition) => `${definition.label} — ${definition.description}`,
).join("\n");

export default async function TeamPage() {
  const { workspace, user, role } = await getSession();
  const canManage = canManageWorkspace(role);
  const [members, subscription] = await Promise.all([
    workspacesRepository.listMembers(workspace.id),
    billingRepository.getSubscription(workspace.id),
  ]);
  const usage = await getUsageReport(
    workspace.id,
    subscription?.planKey ?? workspace.planKey,
  );
  const memberLimit =
    usage.metrics.find((metric) => metric.key === "members")?.limit ?? null;
  const seatsLeft =
    memberLimit === null ? null : Math.max(0, memberLimit - members.length);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Sozlamalar", href: "/settings" },
          { label: "Jamoa" },
        ]}
        title="Jamoa"
        subtitle={`${workspace.name} · ${members.length} ta a'zo${seatsLeft === null ? "" : ` · ${seatsLeft} ta bo'sh o'rin`}`}
      />
      <PageBody maxWidth={820}>
        <Panel className="mb-4 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-neutral-900 px-4 py-3">
            <span className="flex-1 text-[13px] font-medium">A&apos;zolar</span>
            {!canManage && <Badge tone="neutral">Faqat ko&apos;rish</Badge>}
          </div>

          {members.map((member) => {
            const definition = getRoleDefinition(member.role);
            const isSelf = member.userId === user.id;
            const locked = !canManage || member.role === "owner";
            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center gap-2.5 border-t border-neutral-900 px-4 py-3"
              >
                <Avatar name={member.name} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px]">
                      {member.name}
                    </span>
                    {isSelf && (
                      <span className="text-[11px] text-neutral-600">
                        · siz
                      </span>
                    )}
                    {member.invited && (
                      <Badge tone="warning">Taklif yuborilgan</Badge>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-neutral-600">
                    {member.email} · {member.joinedAt}
                  </div>
                </div>

                {locked ? (
                  <Badge tone={definition.tone}>{definition.label}</Badge>
                ) : (
                  <form
                    action={setMemberRoleAction}
                    className="flex items-center"
                  >
                    <input type="hidden" name="memberId" value={member.id} />
                    <MemberRoleSelect
                      value={member.role}
                      title={definition.description}
                    />
                  </form>
                )}

                {canManage && member.role !== "owner" && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="memberId" value={member.id} />
                    <button
                      type="submit"
                      title={`${member.name} ni jamoadan chiqarish`}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-neutral-600 hover:bg-danger-bg hover:text-danger-fg"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </Panel>

        {/* Above the email form on purpose: a team that talks in Telegram
            invites by link, and the form that needs an address is the fallback
            for the ones that do not. Hidden with it when the seats are full —
            a link that cannot be redeemed is a link nobody should be handed. */}
        {canManage && seatsLeft !== 0 && (
          <Panel className="mb-4 p-4">
            <div className="mb-3 text-[13px] font-medium">Taklif havolasi</div>
            <InviteLinkPanel />
          </Panel>
        )}

        {canManage && (
          <Panel className="mb-4 p-4">
            <div className="mb-3 text-[13px] font-medium">
              Email orqali taklif qilish
            </div>
            {seatsLeft === 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-warning-bg bg-warning-bg/30 px-3 py-2.5 text-[12px] leading-relaxed text-neutral-300">
                <Icon
                  name="warning"
                  size={14}
                  className="mt-0.5 flex-none text-warning-fg"
                />
                Tarifdagi barcha o&apos;rinlar band. Yangi a&apos;zo
                qo&apos;shish uchun tarifni oshiring.
              </div>
            ) : (
              <InviteMemberForm roleLegend={ROLE_LEGEND} />
            )}
          </Panel>
        )}
      </PageBody>
    </>
  );
}
