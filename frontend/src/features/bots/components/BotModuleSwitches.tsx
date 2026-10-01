"use client";

import { useState, useTransition } from "react";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Toggle } from "@/components/ui/Toggle";
import type { ModuleKey } from "@/features/flows";
import { setBotModuleAction } from "../actions";
import { AVAILABLE_MODULES } from "../modules";

/**
 * Which of the bot's surfaces answer at all.
 *
 * This is the switch behind `Bot.enabled_modules`, and until now nothing in the
 * interface touched it: a bot was connected with `["dms"]` and stayed that way
 * for ever, so a groups flow could be drawn, switched on and quietly ignored —
 * `apps/engine/matching.py::find_trigger` refuses a module that is off *before*
 * it looks for a flow, and nothing anywhere said so.
 *
 * Every module that has shipped gets a row. It drew «Guruh» and «Kanal» only,
 * which left «Business» and «Bot ichida» switchable by the API and by nothing
 * a person could press — and the module page says «bo'limi o'chirilgan …
 * Yoqish →» and linked here, so the one screen that promised the fix was the
 * screen that did not have it.
 *
 * It sits above the chat list because that is where the consequence is: the
 * chat rows underneath carry a `module_off` finding, and the fix for it should
 * not be on another screen. That argument used to be an argument against
 * Sozlamalar; it is not any more, because the chat list came here too — the
 * adjacency was the point, not which section the pair lived in.
 *
 * Optimistic on purpose. The switch is one boolean, the action re-reads the bot
 * before writing, and a toggle that waits half a second for a round trip before
 * moving reads as broken; a refused write puts it straight back and says why.
 */
export function BotModuleSwitches({
  botId,
  enabled,
  canManage,
}: {
  botId: string;
  enabled: ModuleKey[];
  canManage: boolean;
}) {
  const [on, setOn] = useState<ModuleKey[]>(enabled);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  function toggle(moduleKey: ModuleKey) {
    const next = on.includes(moduleKey);
    setError("");
    setOn((current) => (next ? current.filter((key) => key !== moduleKey) : [...current, moduleKey]));
    startTransition(async () => {
      const outcome = await setBotModuleAction(botId, moduleKey, !next);
      if (outcome.ok) return;
      setOn((current) => (next ? [...current, moduleKey] : current.filter((key) => key !== moduleKey)));
      setError(outcome.message);
    });
  }

  return (
    <ListGroup
      title="Bot qayerda ishlaydi"
      footer={
        error ||
        "O'chirilgan bo'lim uchun bot hech qanday oqimni izlamaydi — guruhga admin qilib qo'ysangiz ham javob bermaydi. Kamida bitta bo'lim yoqilgan bo'lishi kerak."
      }
    >
      {AVAILABLE_MODULES.map((definition) => {
        // `definition`, not `module`: `module` is a reserved identifier in a
        // Next.js client bundle and eslint refuses the assignment outright.
        const key = definition.key;
        return (
          <ListRow
            key={key}
            label={definition.name}
            icon={definition.icon}
            iconTone="accent"
            trailing={
              <Toggle
                checked={on.includes(key)}
                onToggle={() => toggle(key)}
                disabled={!canManage}
                label={definition.name}
              />
            }
          />
        );
      })}
    </ListGroup>
  );
}
