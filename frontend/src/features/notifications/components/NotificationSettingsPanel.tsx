"use client";

import { useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Toggle } from "@/components/ui/Toggle";
import { setNotificationSwitchAction } from "../actions";
import type { NotificationSettings, NotificationSwitch } from "../types";

/**
 * Which notices this workspace raises.
 *
 * Until now: all of them, always, and nothing anywhere said so. Exactly two
 * things in this product reach the bell — a flow handing a conversation to a
 * person, and a plan limit filling up — and both arrived with a paragraph
 * explaining why they matter and no way at all to stop them. A notice nobody
 * can switch off is a notice people learn to ignore, and an ignored bell takes
 * the ones that matter down with it.
 *
 * Two rows, because there are two notices. Not five, one per `Notification.Kind`
 * — three of those kinds are declared and nothing raises them, and a switch for
 * something that never happens is a control that can only ever be wrong.
 *
 * The rows carry their own second line rather than leaning on the group footer,
 * which is `ListGroup`'s usual home for a sentence. Two switches need two
 * different explanations and the reader is deciding between them at the moment
 * they read, so the sentence has to be on the row it is about — the same shape
 * the notification rows themselves use, an `oq-row` with an icon, a title and
 * one clamped line under it.
 *
 * Optimistic, the same way `BotModuleSwitches` is and for the same reason: the
 * switch is one boolean and a toggle that waits for a round trip before moving
 * reads as broken. A refused write puts it straight back and says why.
 */

/** What each switch stops, in the words the reader would use for the notice. */
const SWITCHES: { key: NotificationSwitch; label: string; description: string; icon: IconName }[] = [
  {
    key: "handoff",
    label: "Operator kerak",
    icon: "headset",
    description: "Oqim suhbatni jonli operatorga uzatganda xabar keladi. Suhbatning o'zi baribir Suhbatlarda turadi.",
  },
  {
    key: "usageWarnings",
    // «to'layotgani» is the verb for paying money, which is the one thing this
    // switch has nothing to do with — read straight, the row offered to stop
    // notices about a bill. «to'lib bormoqda» is the limit filling up, which
    // is what the notice actually says.
    label: "Tarif limiti to'lib bormoqda",
    icon: "warning",
    description: "Tarifdagi limitning 80% i ishlatilganda va limit to'lganda xabar keladi.",
  },
];

/**
 * The one thing these switches do not cover.
 *
 * Its own constant because the backend holds the screen to this exact string:
 * `ALWAYS_WARN_SENTENCE` in `apps/notifications/services.py` is where the rule
 * is written, `ALWAYS_WARN` is where it is true, and a test in
 * `apps.notifications` reads this file to make sure the panel is not promising
 * something the server does not do.
 */
const ALWAYS_ON =
  "Kontaktlar limiti to'lganda — yangi mijozlar saqlanmay qolganda — ogohlantirish baribir keladi.";

export function NotificationSettingsPanel({
  settings,
  canManage,
}: {
  settings: NotificationSettings;
  canManage: boolean;
}) {
  const [on, setOn] = useState<NotificationSettings>(settings);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  function toggle(key: NotificationSwitch) {
    const next = !on[key];
    setError("");
    setOn((current) => ({ ...current, [key]: next }));
    startTransition(async () => {
      const outcome = await setNotificationSwitchAction(key, next);
      if (outcome.ok) {
        // The server's answer and not the guess: another member may have moved
        // the other switch while this one was in flight.
        setOn(outcome.settings);
        return;
      }
      setOn((current) => ({ ...current, [key]: !next }));
      setError(outcome.message);
    });
  }

  return (
    <ListGroup
      title="Bildirishnomalar"
      inset="icon"
      footer={
        error ||
        (canManage
          ? `Bu sozlama butun ish maydoniga tegishli — jamoadagi hamma bir xil bildirishnoma oladi. ${ALWAYS_ON}`
          : `Bildirishnomalarni ish maydoni egasi yoki admini o'zgartiradi. ${ALWAYS_ON}`)
      }
    >
      {SWITCHES.map((row) => (
        <ListRow key={row.key}>
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
            <Icon name={row.icon} size={17} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-body truncate">{row.label}</span>
            <span className="t-footnote t-secondary leading-[18px]">{row.description}</span>
          </span>
          <Toggle
            checked={on[row.key]}
            onToggle={() => toggle(row.key)}
            disabled={!canManage}
            label={row.label}
          />
        </ListRow>
      ))}
    </ListGroup>
  );
}
