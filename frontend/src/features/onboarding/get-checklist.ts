import type { IconName } from "@/components/ui/Icon";
import { botsRepository } from "@/features/bots";
import { flowsRepository } from "@/features/flows";
import { paymentsRepository } from "@/features/payments/data/payments-repository";
import { workspacesRepository } from "@/features/workspace";

export interface ChecklistStep {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: IconName;
  done: boolean;
}

export interface OnboardingChecklist {
  steps: ChecklistStep[];
  doneCount: number;
  /** Every step ticked — the checklist stops rendering. */
  complete: boolean;
}

/**
 * What a new workspace still has to do, derived from its own records rather
 * than from a stored "onboarding state" flag: a step is done because the thing
 * exists, so the list can never disagree with the app.
 */
export async function getOnboardingChecklist(workspaceId: string): Promise<OnboardingChecklist> {
  const [bots, flows, members] = await Promise.all([
    botsRepository.list(workspaceId),
    flowsRepository.list(workspaceId),
    workspacesRepository.listMembers(workspaceId),
  ]);

  const connections = await Promise.all(bots.map((bot) => paymentsRepository.list(workspaceId, bot.id)));
  const hasPayments = connections.some((list) => list.length > 0);
  const firstBot = bots[0];

  /*
   * Three of the five steps live inside a bot — a flow belongs to one, so does
   * a payment provider — so until there is a bot they have nowhere of their own
   * to point at and all three fell back to `/bots`.
   *
   * The fallback is right; saying nothing about it was not. "To'lovlarni ulash"
   * offering "Provayder ulash" and landing on an empty bot list reads as a
   * broken link, when what actually happened is that the reader was three steps
   * early. So a blocked step says what it is waiting for and stops offering an
   * action it cannot carry out.
   */
  const blocked = { detail: "Avval bot ulang — to'lov ham, oqim ham botga tegishli.", cta: "Botlarga o'tish" };

  const steps: ChecklistStep[] = [
    {
      key: "bot",
      title: "Botni ulash",
      detail: "@BotFather'dan olingan token bilan birinchi botni qo'shing.",
      href: "/bots/new",
      cta: "Bot qo'shish",
      icon: "robot",
      done: bots.length > 0,
    },
    {
      key: "flow",
      title: "Birinchi oqim",
      ...(firstBot
        ? {
            detail: "Handler → xabar → tugma: mijoz yozganda bot nima qilishini belgilang.",
            href: `/bots/${firstBot.id}/modules/dms`,
            cta: "Oqim yaratish",
          }
        : { ...blocked, href: "/bots" }),
      icon: "flow-arrow",
      done: flows.length > 0,
    },
    {
      key: "live",
      title: "Oqimni ishga tushirish",
      ...(flows[0]
        ? {
            detail: "Tayyor oqimni «Ishga tushirish» tugmasi bilan yoqing.",
            href: `/flows/${flows[0].id}`,
            cta: "Oqimni ochish",
          }
        : {
            detail: firstBot
              ? "Avval oqim yarating — yoqiladigan narsa shundan keyin bo'ladi."
              : blocked.detail,
            href: firstBot ? `/bots/${firstBot.id}/modules/dms` : "/bots",
            cta: firstBot ? "Oqim yaratish" : blocked.cta,
          }),
      icon: "play",
      done: flows.some((flow) => flow.status.tone === "success"),
    },
    {
      key: "payments",
      title: "To'lovlarni ulash",
      ...(firstBot
        ? {
            detail: "Click, Payme yoki Stripe tokenini ulang — invoys bloki shundan keyin ishlaydi.",
            href: `/bots/${firstBot.id}/payments`,
            cta: "Provayder ulash",
          }
        : { ...blocked, href: "/bots" }),
      icon: "credit-card",
      done: hasPayments,
    },
    {
      key: "team",
      title: "Jamoani taklif qilish",
      detail: "Operator yoki muharrirni qo'shing — rollar kimga nima ruxsat berishini belgilaydi.",
      href: "/settings/team",
      cta: "A'zo taklif qilish",
      icon: "users-three",
      done: members.length > 1,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
}
