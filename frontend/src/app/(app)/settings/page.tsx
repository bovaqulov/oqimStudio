import Link from "next/link";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { UsageMeter } from "@/features/billing/components/UsageMeter";
import { AppearanceSelect } from "@/features/workspace/components/AppearanceSelect";
import { InterfaceLocaleSelect } from "@/features/workspace/components/InterfaceLocaleSelect";
import { ProfileSettingsForm } from "@/features/workspace/components/ProfileSettingsForm";
import { NotificationSettingsPanel } from "@/features/notifications/components/NotificationSettingsPanel";
import { notificationsRepository } from "@/features/notifications/data/notifications-repository";
import { billingRepository } from "@/features/billing/data/billing-repository";
import { getPlanFor } from "@/features/billing/get-plans";
import { getUsageReport } from "@/features/billing/get-usage";
import { planPriceLabel } from "@/features/billing/plans";
import { WorkspaceSettingsForm } from "@/features/workspace/components/WorkspaceSettingsForm";
import { canManageWorkspace, getRoleDefinition, workspacesRepository } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { LOCALE_OPTIONS } from "@/lib/i18n/locales";
import { getT } from "@/lib/i18n/server";

const TIMEZONES = ["Asia/Tashkent", "Asia/Almaty", "Europe/Moscow", "Europe/Istanbul", "UTC"];

/**
 * Everything about this workspace and this account that can be switched or
 * picked, on one screen.
 *
 * The order is who it belongs to, narrowing: the reader's own settings first
 * (their name, their language, how the screen looks — none of which anybody
 * else sees), then the tenant's (its name, its zone, what its reports are
 * formatted in), then what the tenant *does to people* — the notices it raises
 * — and finally the two screens this one only links to, plus the plan.
 *
 * Two things this screen deliberately does not offer, both of them ways into
 * the account rather than preferences: the email address, which is drawn and
 * disabled with a reason beside it, and the password, which has no
 * signed-in-user endpoint at all. A Telegram account has neither a real address
 * nor a usable password, so "set one here" is a door onto an account rather
 * than a setting, and it needs a verification decision this screen cannot make
 * on its own.
 */
export default async function SettingsPage() {
  const t = await getT();
  const session = await getSession();
  const { workspace, user, role } = session;
  const canManage = canManageWorkspace(role);
  const [members, subscription, notifications] = await Promise.all([
    workspacesRepository.listMembers(workspace.id),
    billingRepository.getSubscription(workspace.id),
    notificationsRepository.getSettings(workspace.id),
  ]);
  const planKey = subscription?.planKey ?? workspace.planKey;
  const [plan, usage] = await Promise.all([
    getPlanFor(workspace.id, planKey),
    getUsageReport(workspace.id, planKey),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.settings.title }]} title={t.settings.title} subtitle={`${workspace.name} · ${getRoleDefinition(role).label}`} />
      <PageBody maxWidth={820}>
        <div className="flex flex-col gap-4">
          {/*
            The reader's own, and nobody's business but theirs — which is why it
            carries no "faqat ko'rish" badge and no role check: an analyst may
            rename themselves and read the interface in Russian exactly as an
            owner may.
          */}
          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="t-headline flex-1">{t.settings.profile}</span>
            </div>
            <ProfileSettingsForm
              user={{
                name: user.name,
                email: user.email,
                viaTelegram: user.viaTelegram,
                telegramUsername: user.telegramUsername,
              }}
              labels={{
                name: t.settings.yourName,
                email: t.settings.email,
                emailInfo: t.settings.emailInfo,
                telegramAccount: t.settings.telegramAccount,
                telegramAccountInfo: t.settings.telegramAccountInfo,
                save: t.settings.save,
              }}
            />

            {/*
              Below the line, and outside the form: the two preferences that
              save the moment they are picked. Neither is a change anybody
              confirms — waiting for a button meant the language picker could
              sit on a language the screen was not written in — and one of them
              never reaches the server at all. The hairline above is what says
              they are not part of the save.
            */}
            <div className="mt-3.5 border-t border-separator pt-3.5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(196px,1fr))] gap-3">
                <Field label={t.settings.interfaceLanguage} info={t.settings.interfaceLanguageInfo}>
                  <InterfaceLocaleSelect value={user.locale} />
                </Field>
                <Field label={t.settings.appearance}>
                  <AppearanceSelect labels={{ dark: t.settings.themeDark, light: t.settings.themeLight }} />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="t-headline flex-1">{t.settings.workspace}</span>
              {!canManage && <Badge tone="neutral">{t.settings.readOnly}</Badge>}
            </div>
            <WorkspaceSettingsForm
              workspace={{ name: workspace.name, timezone: workspace.timezone, locale: workspace.locale }}
              timezones={TIMEZONES}
              locales={LOCALE_OPTIONS}
              canManage={canManage}
              labels={{
                name: t.settings.name,
                timezone: t.settings.timezone,
                reportLocale: t.settings.reportLanguage,
                reportLocaleInfo: t.settings.reportLanguageInfo,
                save: t.settings.save,
              }}
            />
          </Panel>

          {/*
            The bell's own switches. Under the workspace panel because that is
            whose they are — the notices are raised with no addressee, so
            everybody in the team sees the same ones — and above the team panel
            because the first of them, "Operator kerak", is about what that team
            is asked to do.

            Read here rather than linked to, which is the opposite of what the
            API keys panel below does — and for a reason that is about the
            failure domain rather than about the depth. That read is a fifth
            call to the same Django this page already asks four times (members,
            subscription, price list, usage), so it adds no way for the screen
            to break that it did not already have; the keys are the interesting
            case because reading them is the page's only reason to touch that
            surface at all. And there is nothing behind a link here: the
            switches *are* the panel.
          */}
          <NotificationSettingsPanel settings={notifications} canManage={canManage} />

          <Panel className="p-4">
            {/* The link keeps its 44px target on a touch screen and gives it
                back on a pointer, where it was setting the height of the whole
                heading row and opening a gap above and below the word. */}
            <div className="mb-2 flex items-center gap-2">
              <span className="t-headline flex-1">{t.settings.team}</span>
              <Link
                href="/settings/team"
                className="t-body -mr-2 flex min-h-[44px] items-center px-2 text-accent-400 md:min-h-0 md:py-1"
              >
                {t.settings.manageTeam}
              </Link>
            </div>
            <div className="flex flex-col">
              {members.slice(0, 4).map((member, index) => (
                <div
                  key={member.id}
                  className={`flex items-center gap-2.5 py-2.5 ${index > 0 ? "border-t border-separator" : ""}`}
                >
                  <Avatar name={member.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="t-subhead truncate">
                      {member.name}
                      {member.userId === user.id && <span className="t-footnote t-tertiary ml-1.5">· {t.settings.you}</span>}
                    </div>
                    <div className="t-footnote t-tertiary truncate">{member.email}</div>
                  </div>
                  <Badge tone={getRoleDefinition(member.role).tone}>{getRoleDefinition(member.role).label}</Badge>
                </div>
              ))}
              {members.length > 4 && (
                <div className="t-footnote t-tertiary border-t border-separator pt-2.5">
                  {t.settings.moreMembers(members.length - 4)}
                </div>
              )}
            </div>
          </Panel>

          {/*
            A link and one sentence, not the list itself. Reading the keys costs
            a request to an endpoint this screen has no other reason to touch,
            and a settings page that cannot draw because an integrations
            endpoint is down is a settings page that took the workspace name and
            the plan down with it. The screen behind the link is where that read
            belongs, and it is the one that can say "could not" without hiding
            everything else.
          */}
          <Panel className="p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="t-headline flex-1">{t.settings.apiKeys}</span>
              <Link
                href="/settings/api-keys"
                className="t-body -mr-2 flex min-h-[44px] items-center px-2 text-accent-400 md:min-h-0 md:py-1"
              >
                {t.settings.manageApiKeys}
              </Link>
            </div>
            <p className="t-footnote t-secondary m-0 max-w-[52ch] leading-[18px]">{t.settings.apiKeysHint}</p>
          </Panel>

          <div className="rounded-[16px] bg-surface p-4 shadow-md">
            <div className="flex flex-wrap items-start gap-3.5">
              <div className="min-w-0 flex-1">
                <div className="t-headline">{plan?.name ?? usage.planName}</div>
                {/*
                  The price comes with its own currency and is never read in
                  `workspace.currency`. That field is the tenant's formatting
                  default; a workspace that switched it to dollars had this line
                  answer "290 000 $ / oy" for a plan priced in so'm — and, as it
                  happens, for a plan that is free.
                */}
                {plan && (
                  <div className="t-footnote t-secondary mt-0.5">{planPriceLabel(plan, t.settings.perMonth)}</div>
                )}
                <div className="mt-[11px] flex max-w-[420px] flex-col gap-2.5">
                  {usage.metrics.slice(0, 2).map((metric) => (
                    <UsageMeter key={metric.key} metric={metric} />
                  ))}
                </div>
              </div>
              {/* A link to another screen, not a second primary action on
                  this one — "Saqlash" above is the only filled button here. */}
              <Link
                href="/billing"
                className="t-body -mr-2 flex min-h-[44px] flex-none items-center px-2 text-accent-400 md:min-h-0 md:py-1"
              >
                {t.settings.managePlan}
              </Link>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
